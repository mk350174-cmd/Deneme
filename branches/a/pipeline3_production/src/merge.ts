// P3.08-DIST Distributed Render — Shard Merge & Preview Generation
// NOT phase P3.09 (Automated QA, qa.ts) — see the naming note in orchestration_p309.ts.
// Merges sharded video outputs via FFmpeg concat demuxer, validates frame continuity,
// generates low-bandwidth preview for human QA

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { sha256Buffer } from "./ids.js";
import type { MediaProbe } from "./assetValidation.js";
import type { ContinuityValidation, PreviewArtifact, ShardRenderOutput } from "./types.js";

const execFileAsync = promisify(execFile);

// FFmpeg execution seam
export type ExecFfmpeg = (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr?: string }>;

export const defaultExecFfmpeg: ExecFfmpeg = async (args) => {
  try {
    const { stdout } = await execFileAsync("ffmpeg", args);
    return { exitCode: 0, stdout };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { exitCode: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr };
  }
};

// Validate shard outputs for frame continuity
export async function validateShardContinuity(shards: ShardRenderOutput[]): Promise<ContinuityValidation> {
  if (shards.length === 0) {
    return { valid: true };
  }

  const gaps: number[] = [];
  const overlaps: number[] = [];

  // Sort by frame range for validation
  const sorted = [...shards].sort((a, b) => a.frame_range.start - b.frame_range.start);

  // Check frame continuity. Non-null: i ranges [0, sorted.length-2] and
  // i+1 ranges [1, sorted.length-1], both always valid indices into `sorted`.
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]!;
    const next = sorted[i + 1]!;

    if (current.frame_range.end !== next.frame_range.start) {
      if (current.frame_range.end < next.frame_range.start) {
        // Gap
        for (let f = current.frame_range.end; f < next.frame_range.start; f++) {
          gaps.push(f);
        }
      } else {
        // Overlap
        for (let f = next.frame_range.start; f < current.frame_range.end; f++) {
          overlaps.push(f);
        }
      }
    }
  }

  const valid = gaps.length === 0 && overlaps.length === 0;
  const message = valid
    ? "Frame continuity validated"
    : `${gaps.length} gap frames, ${overlaps.length} overlap frames`;

  return {
    valid,
    gap_frames: gaps.length > 0 ? gaps : undefined,
    overlap_frames: overlaps.length > 0 ? overlaps : undefined,
    message,
  };
}

// Merge shard outputs into single video via FFmpeg concat demuxer
export async function mergeShardOutputs(
  params: {
    shards: ShardRenderOutput[];
    outputPath: string;
    workingDir: string;
    // TIER-2 REPAIR T2.6 — the timeline's real fps. Defaults to 30 only for
    // backwards compatibility with existing callers that render at the
    // project's standard 30fps; a caller rendering at any other fps must
    // supply it or duration_s silently misreports.
    fps?: number;
  },
  execFfmpeg: ExecFfmpeg = defaultExecFfmpeg,
): Promise<ShardRenderOutput> {
  if (params.shards.length === 0) {
    throw new Error("No shards to merge");
  }

  // Validate continuity first
  const validation = await validateShardContinuity(params.shards);
  if (!validation.valid) {
    throw new Error(`Frame continuity validation failed: ${validation.message}`);
  }

  // Single shard — no merge needed
  if (params.shards.length === 1) {
    const shard = params.shards[0]!; // length === 1 just checked
    // Just verify the file exists and return it as-is
    if (!existsSync(shard.video_file_path)) {
      throw new Error(`Shard file not found: ${shard.video_file_path}`);
    }
    return shard;
  }

  // Create concat demuxer input file
  const concatListPath = path.join(params.workingDir, "concat_list.txt");
  const concatContent = params.shards.map((s) => `file '${s.video_file_path}'`).join("\n");
  await fs.writeFile(concatListPath, concatContent);

  // FFmpeg concat (stream copy, no re-encoding)
  const result = await execFfmpeg([
    "-f", "concat",
    "-safe", "0",
    "-i", concatListPath,
    "-c", "copy", // stream copy (no re-encode, pixel-perfect)
    params.outputPath,
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`FFmpeg concat failed: ${result.stderr || result.stdout}`);
  }

  // Verify output
  if (!existsSync(params.outputPath)) {
    throw new Error("FFmpeg concat produced no output");
  }

  const stat = await fs.stat(params.outputPath);
  const buffer = await fs.readFile(params.outputPath);
  const sha = sha256Buffer(buffer);

  // Merged output frame range covers all shards. Non-null: `params.shards.length
  // === 0` already threw above, so index 0 and the last index both exist.
  const firstShard = params.shards[0]!;
  const lastShard = params.shards[params.shards.length - 1]!;

  return {
    shard_id: "merged",
    frame_range: { start: firstShard.frame_range.start, end: lastShard.frame_range.end },
    video_file_path: params.outputPath,
    sha256: sha,
    bytes: stat.size,
    // TIER-2 REPAIR T2.6 — was hardcoded "/ 30 // 30 FPS locked". Uses the
    // real timeline fps now, never a project-wide assumption.
    duration_s: (lastShard.frame_range.end - firstShard.frame_range.start) / (params.fps ?? 30),
  };
}

// Generate low-bandwidth preview from full render
// R02.6 REPAIR — preview duration / sampling.
//
// TWO defects here:
//   1. `duration_s: 0` was a FAKE measured value — a plausible-looking
//      number that was never actually measured, indistinguishable from a
//      genuine zero-duration preview.
//   2. `select=not(mod(n\,${frameStep}))` with a fixed `frameStep = 10`
//      silently assumed the SOURCE was 30fps ("30fps / 10 = 3fps" per the
//      old comment) regardless of the real input fps. At 24fps this
//      produces 2.4fps, not 3fps; at 60fps it produces 6fps, not 3fps —
//      the sampling rate silently drifted from what was requested whenever
//      the source wasn't actually 30fps.
//
// REPAIR: the caller now supplies the REAL source fps (`inputFps`), from
// which frameStep is computed to hit the requested output fps exactly
// (rounded, with a floor of 1). Duration is genuinely probed via an
// injectable MediaProbe seam (same seam type as P3.02's asset validation,
// reused rather than duplicated); when probing is unavailable or fails,
// `duration_s` is explicitly `null` — never a fabricated number.
export async function generatePreview(
  params: {
    inputPath: string;
    outputPath: string;
    resolution: string; // e.g., "1280x720"
    fps: number; // output FPS (typically 3 from 30)
    // R02.6 — the real fps of the SOURCE video. Required (not defaulted to
    // 30) so the caller must know and state its actual input rather than
    // this function silently assuming one.
    inputFps: number;
  },
  execFfmpeg: ExecFfmpeg = defaultExecFfmpeg,
  probe?: MediaProbe,
): Promise<PreviewArtifact> {
  if (!Number.isFinite(params.inputFps) || params.inputFps <= 0) {
    throw new Error(`generatePreview: inputFps must be a positive finite number, got ${params.inputFps}`);
  }
  // FFmpeg filter: select every Nth frame to hit the REQUESTED output fps
  // from the REAL input fps (previously hardcoded to "10", assuming 30fps).
  const frameStep = Math.max(1, Math.round(params.inputFps / params.fps));
  const ffmpegFilter = `select=not(mod(n\\,${frameStep})),scale=${params.resolution},fps=${params.fps}`;

  const result = await execFfmpeg([
    "-i", params.inputPath,
    "-vf", ffmpegFilter,
    params.outputPath,
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Preview generation failed: ${result.stderr || result.stdout}`);
  }

  if (!existsSync(params.outputPath)) {
    throw new Error("Preview generation produced no output");
  }

  const stat = await fs.stat(params.outputPath);

  // R02.6 — genuinely measure duration via the injected probe seam. No
  // probe supplied / probe fails / probe reports no duration -> explicit
  // null, never a fabricated number.
  let duration_s: number | null = null;
  if (probe) {
    try {
      const probed = await probe(params.outputPath);
      duration_s = probed.decodable && typeof probed.duration_s === "number" ? probed.duration_s : null;
    } catch {
      duration_s = null;
    }
  }

  return {
    preview_id: `preview_${Date.now()}`,
    output_path: params.outputPath,
    resolution: params.resolution,
    fps: params.fps,
    duration_s,
    bytes: stat.size,
  };
}
