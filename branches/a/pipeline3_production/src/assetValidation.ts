// P3.02 Asset Validation — hash well-formedness on each GeneratedAssetFile,
// plus a low-level media-probe I/O seam (ADAPT of Studio's
// scripts/lib/checklist_common.py `probe_duration`, which shells to
// `ffprobe`). This is a raw I/O seam only (invariant 9): one real
// implementation, tests substitute the low-level probe function.

import { P3Error } from "./errors.js";
import { isWellFormedSha256, sha256Buffer } from "./ids.js";
import { resolveAssetFilePath } from "./assetStaging.js";
import type { GeneratedAssetFile } from "./types.js";

/** Raw file-read seam — one real implementation, tests inject a fixture. */
export type ReadAssetBytes = (path: string) => Promise<Buffer>;

export const defaultReadAssetBytes: ReadAssetBytes = async (path) => {
  const { promises: fs } = await import("node:fs");
  return fs.readFile(path);
};

export interface MediaProbeResult {
  decodable: boolean;
  codec?: string;
  fps?: number;
  width?: number;
  height?: number;
  duration_s?: number;
  has_audio?: boolean;
}

export type MediaProbe = (assetFileId: string) => Promise<MediaProbeResult>;

// ffprobe reports frame rate as a "num/den" fraction string (e.g. "30/1",
// "30000/1001") — parsed explicitly rather than via eval().
function parseFrameRate(rFrameRate: string): number | undefined {
  const [num, den] = rFrameRate.split("/").map(Number);
  if (!num || !den) return undefined;
  return num / den;
}

// Real adapter: shells to ffprobe. Not invoked in unit/contract tests
// (which inject a fixture probe); documented here as the single real path.
export const defaultFfprobeMediaProbe: MediaProbe = async (assetFileId: string) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=codec_name,width,height,r_frame_rate:format=duration",
      "-of", "json",
      assetFileId,
    ]);
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ codec_name?: string; width?: number; height?: number; r_frame_rate?: string; codec_type?: string }>;
      format?: { duration?: string };
    };
    const videoStream = parsed.streams?.find((s) => s.width);
    const audioStream = parsed.streams?.some((s) => !s.width);
    return {
      decodable: true,
      codec: videoStream?.codec_name,
      fps: videoStream?.r_frame_rate ? parseFrameRate(videoStream.r_frame_rate) : undefined,
      width: videoStream?.width,
      height: videoStream?.height,
      duration_s: parsed.format?.duration ? Number(parsed.format.duration) : undefined,
      has_audio: audioStream,
    };
  } catch {
    return { decodable: false };
  }
};

export function validateAssetHash(asset: GeneratedAssetFile): void {
  if (!isWellFormedSha256(asset.hash)) {
    throw new P3Error({
      code: "ASSET_ERROR",
      field: "hash",
      object_id: asset.asset_file_id,
      reason: `hash "${asset.hash}" is not a well-formed sha256 hex digest`,
    });
  }
}

/**
 * TIER-1 REPAIR T1.2 — real per-file integrity verification.
 *
 * validateAssetHash only checked that the DECLARED hash was shaped like a
 * sha256 digest; it never recomputed anything from the actual staged file.
 * A delivery could declare any well-formed-looking hash for the wrong
 * bytes and pass. This recomputes SHA-256 over the real staged file and
 * hard-fails on any mismatch — "declared file hash == SHA256(actual file
 * bytes)", per the brief.
 */
export async function validateAssetHashAgainstBytes(
  asset: GeneratedAssetFile,
  stagingDir: string,
  readBytes: ReadAssetBytes = defaultReadAssetBytes,
): Promise<void> {
  validateAssetHash(asset);
  const filePath = resolveAssetFilePath(asset.asset_file_id, stagingDir);
  const bytes = await readBytes(filePath);
  const actual = sha256Buffer(bytes);
  if (actual !== asset.hash) {
    throw new P3Error({
      code: "ASSET_ERROR",
      field: "hash",
      object_id: asset.asset_file_id,
      reason: `declared hash "${asset.hash}" does not match SHA256 of the actual staged file bytes ("${actual}")`,
    });
  }
}

export async function validateAssetDecodability(
  asset: GeneratedAssetFile,
  probe: MediaProbe = defaultFfprobeMediaProbe,
): Promise<MediaProbeResult> {
  const result = await probe(asset.asset_file_id);
  if (!result.decodable) {
    throw new P3Error({
      code: "ASSET_ERROR",
      field: "media",
      object_id: asset.asset_file_id,
      reason: "asset failed to decode",
    });
  }
  return result;
}
