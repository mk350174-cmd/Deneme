// P3.F — Finishing (captions + music bed) between P3.10 and Bridge 3.
//
// Why a separate stage: P3's render contract and P3Composition.tsx are
// FROZEN and have no music, SFX or caption layer. For 9:16 Shorts, burned
// captions and a ducked music bed are standard finishing. This stage takes
// the A7-approved master MP4 and produces a NEW file; because the pixels and
// audio change after Gate A7, the finished file needs its own human gate
// (F1) before it may be imported into the YouTube agent.
//
// Where claude-code-video-toolkit fits: its tools produce the INPUTS here —
// a music bed (tools/music_gen.py ACE-Step, tools/addmusic.py / sfx.py via
// ElevenLabs) and, optionally, word-level timings (tools/align_captions.py
// uses ElevenLabs Scribe). This module only mixes and burns, with ffmpeg,
// and records exactly what went in. It never generates or fetches media.
//
// Honesty rules:
//   * captions carry a timing_basis: WORD_ALIGNED (word timings supplied) or
//     ESTIMATED_CHARACTER_SHARE (narration duration split by text length);
//   * music requires an explicit license attestation from the owner; nothing
//     is assumed to be licensed;
//   * the master's SHA-256 must equal the value P3 recorded in its render
//     manifest — finishing a different file is refused.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { B00 } from "b-branch-strategic-control-plane";
import type { FinalDeliveryPackage } from "pipeline3-production/dist/types.js";
import { parseProductionPackage } from "pipeline3-production/dist/ingest.js";
import type { CanonicalIdentity } from "./contracts.js";
import { UNIFIED_SCHEMA_VERSION } from "./contracts.js";
import { BridgeError, assertHumanAuthority, sealEnvelope, shortHash, verifyEnvelope } from "./identity.js";
import { assertNoSecrets, atomicWrite } from "./safety.js";
import { defaultExec, type ExecSeam } from "./reachTransports.js";

const STAGE = "P3.F-finishing";

export interface CaptionCue {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

export interface MusicInput {
  path: string;
  /** e.g. "ACE-Step via claude-code-video-toolkit tools/music_gen.py", "ElevenLabs Music", "licensed library track". */
  source: string;
  license: string;
  attested_by: string;
  /** Music level under narration, dB (negative). Default -18. */
  gain_db?: number;
}

export interface FinishingOptions {
  outDir: string;
  captions?: { enabled: boolean; word_timings?: WordTiming[]; max_chars_per_line?: number; font_size?: number; language?: string };
  music?: MusicInput;
  ffmpeg?: string;
  ffprobe?: string;
  exec?: ExecSeam;
  now?: () => string;
}

export interface FinishingRecord {
  record_type: "P3F_FINISHING_RECORD";
  schema_version: typeof UNIFIED_SCHEMA_VERSION;
  final_delivery_package_id: string;
  production_package_id: string;
  master: { path: string; sha256: string };
  finished: { path: string; sha256: string; bytes: number; duration_seconds: number; width: number; height: number };
  captions: { path: string; sha256: string; cues: number; timing_basis: "WORD_ALIGNED" | "ESTIMATED_CHARACTER_SHARE"; burned: boolean; language: string } | null;
  music: { path: string; sha256: string; source: string; license: string; attested_by: string; gain_db: number; ducking: "sidechaincompress" } | null;
  tool_versions: { ffmpeg: string };
  status: "AWAITING_F1_REVIEW";
  created_at: string;
  identity: CanonicalIdentity;
}

export interface FinishingApproval {
  approval_type: "P3F_GATE_F1";
  record_hash: string;
  finished_sha256: string;
  actor: string;
  approved_at: string;
  notes: string;
  identity: CanonicalIdentity;
}

// ------------------------------------------------------------------ helpers

export function fileSha256(path: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash("sha256");
    createReadStream(path).on("error", rej).on("data", (c) => h.update(c)).on("end", () => res(h.digest("hex")));
  });
}

function srtTime(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function toSrt(cues: CaptionCue[]): string {
  // libass reads {…} as style override tags; caption text must stay literal.
  const literal = (t: string) => t.replace(/\{/g, "(").replace(/\}/g, ")").replace(/\\N/gi, " ");
  return cues.map((c) => `${c.index}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${literal(c.text)}\n`).join("\n");
}

/** Split text into caption chunks of ≤ maxChars, breaking on word boundaries. */
function chunkText(text: string, maxChars: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > maxChars) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

/** Estimated cues: narration duration shared by character count. */
export function estimateCues(lines: string[], narrationSeconds: number, maxChars = 32): CaptionCue[] {
  const chunks = lines.flatMap((l) => chunkText(l, maxChars));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  if (!total || narrationSeconds <= 0) return [];
  let t = 0;
  return chunks.map((text, i) => {
    const d = (text.length / total) * narrationSeconds;
    const cue = { index: i + 1, start: t, end: t + d, text };
    t += d;
    return cue;
  });
}

/** Aligned cues from word timings (e.g. ElevenLabs Scribe via the toolkit). */
export function alignedCues(words: WordTiming[], maxChars = 32): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let cur: WordTiming[] = [];
  let prevStart = -Infinity;
  const flush = () => {
    if (!cur.length) return;
    cues.push({ index: cues.length + 1, start: cur[0]!.start, end: cur[cur.length - 1]!.end, text: cur.map((w) => w.text).join(" ") });
    cur = [];
  };
  for (const w of words) {
    if (!(Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start)) throw new BridgeError(STAGE, "BAD_WORD_TIMING", `invalid timing for "${w.text}"`);
    if (w.start < prevStart) throw new BridgeError(STAGE, "BAD_WORD_TIMING", `word timings are out of order at "${w.text}"`);
    prevStart = w.start;
    const next = [...cur, w].map((x) => x.text).join(" ");
    if (cur.length && next.length > maxChars) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  return cues;
}

async function probe(exec: ExecSeam, ffprobe: string, path: string) {
  const r = await exec(ffprobe, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path], { timeoutMs: 30000, maxBytes: 1_000_000 });
  if (r.code !== 0) throw new BridgeError(STAGE, "PROBE_FAILED", `ffprobe could not read ${basename(path)}`);
  const j = JSON.parse(r.stdout) as { streams?: Array<{ codec_type?: string; width?: number; height?: number }>; format?: { duration?: string } };
  const v = (j.streams ?? []).find((s) => s.codec_type === "video");
  return { duration: Number(j.format?.duration ?? 0), width: v?.width ?? 0, height: v?.height ?? 0, hasAudio: (j.streams ?? []).some((s) => s.codec_type === "audio") };
}

// ------------------------------------------------------------------ stage

export async function finishMaster(params: { finalDelivery: FinalDeliveryPackage; productionPackage: unknown; options: FinishingOptions }): Promise<FinishingRecord> {
  const { finalDelivery: fd, options } = params;
  const exec = options.exec ?? defaultExec;
  const ffmpeg = options.ffmpeg ?? "ffmpeg";
  const ffprobe = options.ffprobe ?? "ffprobe";
  const a7 = fd.gates.find((g) => g.gate_id === "A7" && g.state_after === "FINAL_QA_APPROVED");
  if (!a7) throw new BridgeError(STAGE, "GATE_A7_MISSING", "only an A7-approved master can be finished");
  for (const g of fd.gates) {
    try {
      assertHumanAuthority(STAGE, g.actor, `Gate ${g.gate_id} actor`);
    } catch {
      throw new BridgeError(STAGE, "GATE_ACTOR_INVALID", `Gate ${g.gate_id} (${g.state_after}) was not given by a named person (${JSON.stringify(g.actor)})`);
    }
  }
  const pp = parseProductionPackage(params.productionPackage);
  if (fd.production_package_ref !== pp.package_id) throw new BridgeError(STAGE, "DELIVERY_PACKAGE_MISMATCH", "final delivery does not belong to this production package");
  const out = fd.render.outputs.find((o) => o.path.toLowerCase().endsWith(".mp4")) ?? fd.render.outputs[0];
  if (!out) throw new BridgeError(STAGE, "NO_RENDER_OUTPUT", "render manifest lists no outputs");
  // One absolute path for hashing, probing and ffmpeg (ffmpeg runs with cwd = outDir).
  const masterPath = resolve(out.path);
  const masterSha = await fileSha256(masterPath).catch(() => {
    throw new BridgeError(STAGE, "MASTER_NOT_FOUND", masterPath);
  });
  if (masterSha !== out.sha256) throw new BridgeError(STAGE, "MASTER_HASH_MISMATCH", `file on disk is not the render P3 recorded (${shortHash(out.sha256)} vs ${shortHash(masterSha)})`);

  const verR = await exec(ffmpeg, ["-version"], { timeoutMs: 10000, maxBytes: 65536 });
  if (verR.code !== 0) throw new BridgeError(STAGE, "FFMPEG_UNAVAILABLE", "ffmpeg not found");
  const ffmpegVersion = (verR.stdout.split("\n")[0] ?? "").replace(/^ffmpeg version\s*/, "").split(" ")[0] ?? "unknown";

  const master = await probe(exec, ffprobe, masterPath);
  const outDir = resolve(options.outDir);
  await mkdir(outDir, { recursive: true });

  // captions
  let captions: FinishingRecord["captions"] = null;
  const capOpt = options.captions;
  if (capOpt?.enabled) {
    const maxChars = capOpt.max_chars_per_line ?? 32;
    const lines = (pp.voice_lines?.length ? pp.voice_lines.map((l: { text: string }) => l.text) : pp.voice_script.split(/\n+/)).filter((l: string) => l.trim());
    const narration = fd.narration.production_voice?.duration_s || master.duration;
    const cues = capOpt.word_timings?.length ? alignedCues(capOpt.word_timings, maxChars) : estimateCues(lines, Math.min(narration, master.duration), maxChars);
    if (!cues.length) throw new BridgeError(STAGE, "NO_CAPTIONS", "no caption text available");
    const srtPath = join(outDir, "captions.srt");
    const srt = toSrt(cues);
    assertNoSecrets(srt, "$captions");
    await atomicWrite(srtPath, srt);
    captions = { path: srtPath, sha256: await fileSha256(srtPath), cues: cues.length, timing_basis: capOpt.word_timings?.length ? "WORD_ALIGNED" : "ESTIMATED_CHARACTER_SHARE", burned: true, language: capOpt.language ?? "tr" };
  }

  // music
  let music: FinishingRecord["music"] = null;
  if (options.music) {
    const m = options.music;
    if (![m.source, m.license, m.attested_by].every((x) => typeof x === "string" && x.trim().length > 0)) {
      throw new BridgeError(STAGE, "MUSIC_LICENSE_REQUIRED", "music needs source, license and attested_by from the owner");
    }
    const gain = m.gain_db ?? -18;
    if (!Number.isFinite(gain) || gain > 0 || gain < -60) throw new BridgeError(STAGE, "BAD_MUSIC_GAIN", `music gain must be between -60 and 0 dB (got ${m.gain_db})`);
    const musicSha = await fileSha256(m.path).catch(() => {
      throw new BridgeError(STAGE, "MUSIC_NOT_FOUND", m.path);
    });
    music = { path: resolve(m.path), sha256: musicSha, source: m.source, license: m.license, attested_by: m.attested_by.trim(), gain_db: gain, ducking: "sidechaincompress" };
  }
  if (!captions && !music) throw new BridgeError(STAGE, "NOTHING_TO_FINISH", "enable captions and/or supply music");

  // ffmpeg graph (fixed argv, no shell; cwd = outDir so the subtitles filter gets a plain relative name)
  const finishedPath = join(outDir, "finished.mp4");
  // libass scales SRT styles to a 288-line script height: Fontsize 14 ≈ 1/20 of
  // the frame; MarginV 64 (~22% of the height) keeps captions above the YouTube Shorts UI band.
  const fontSize = capOpt?.font_size ?? 14;
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", masterPath];
  if (music) args.push("-stream_loop", "-1", "-i", music.path);
  const filters: string[] = [];
  let vOut = "0:v";
  if (captions) {
    filters.push(`[0:v]subtitles=captions.srt:force_style='FontName=DejaVu Sans,Fontsize=${fontSize},Outline=2,Shadow=0,Alignment=2,MarginV=64'[v]`);
    vOut = "[v]";
  }
  let aOut = master.hasAudio ? "0:a" : "";
  if (music) {
    const gain = `volume=${music.gain_db}dB`;
    if (master.hasAudio) {
      filters.push(`[0:a]asplit=2[nar][sc]`, `[1:a]${gain}[mus]`, `[mus][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[duck]`, `[nar][duck]amix=inputs=2:duration=first:normalize=0[a]`);
    } else {
      filters.push(`[1:a]${gain},atrim=0:${master.duration.toFixed(3)}[a]`);
    }
    aOut = "[a]";
  }
  if (filters.length) args.push("-filter_complex", filters.join(";"));
  args.push("-map", vOut);
  if (aOut) args.push("-map", aOut);
  args.push("-c:v", captions ? "libx264" : "copy");
  if (captions) args.push("-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p");
  if (aOut) args.push("-c:a", "aac", "-b:a", "192k");
  args.push("-t", master.duration.toFixed(3), "-movflags", "+faststart", finishedPath);

  const run = await new Promise<{ code: number }>((res) =>
    execFile(ffmpeg, args, { cwd: outDir, timeout: 30 * 60_000, maxBuffer: 10_000_000, shell: false, windowsHide: true }, (err) => res({ code: err ? 1 : 0 })),
  );
  if (run.code !== 0) throw new BridgeError(STAGE, "FFMPEG_FAILED", "ffmpeg finishing failed");
  const fin = await probe(exec, ffprobe, finishedPath);
  const st = await stat(finishedPath);
  const created_at = (options.now ?? (() => new Date().toISOString()))();

  const body: Omit<FinishingRecord, "identity"> = {
    record_type: "P3F_FINISHING_RECORD",
    schema_version: UNIFIED_SCHEMA_VERSION,
    final_delivery_package_id: fd.final_delivery_package_id,
    production_package_id: pp.package_id,
    master: { path: out.path, sha256: masterSha },
    finished: { path: finishedPath, sha256: await fileSha256(finishedPath), bytes: st.size, duration_seconds: Math.round(fin.duration * 100) / 100, width: fin.width, height: fin.height },
    captions,
    music,
    tool_versions: { ffmpeg: ffmpegVersion },
    status: "AWAITING_F1_REVIEW",
    created_at,
  };
  return sealEnvelope<FinishingRecord>(body, { object_id: `p3f_${shortHash(masterSha)}`, object_type: "UNIFIED_P3F_FINISHING_RECORD", version: "v1", created_at });
}

/** Gate F1 — a named person watched the finished file and approves it. */
export function approveFinishing(record: FinishingRecord, actor: string, notes = "", now: () => string = () => new Date().toISOString()): FinishingApproval {
  verifyEnvelope(STAGE, record, "UNIFIED_P3F_FINISHING_RECORD");
  actor = assertHumanAuthority(STAGE, actor, "F1 actor");
  const approved_at = now();
  const body: Omit<FinishingApproval, "identity"> = { approval_type: "P3F_GATE_F1", record_hash: record.identity.content_hash, finished_sha256: record.finished.sha256, actor, approved_at, notes };
  return sealEnvelope<FinishingApproval>(body, {
    object_id: `f1_${shortHash(record.identity.content_hash)}`,
    object_type: "UNIFIED_P3F_GATE_F1",
    version: "v1",
    created_at: approved_at,
    parents: [B00.parentReferenceFromIdentity("P3F", record.identity, "approves_finishing_record")],
  });
}

/** Used by Bridge 3: the finishing record + its F1 approval, verified together. */
export function assertFinishingApproved(record: FinishingRecord, approval: FinishingApproval, masterSha: string): void {
  verifyEnvelope(STAGE, record, "UNIFIED_P3F_FINISHING_RECORD");
  verifyEnvelope(STAGE, approval, "UNIFIED_P3F_GATE_F1");
  if (approval.record_hash !== record.identity.content_hash || approval.finished_sha256 !== record.finished.sha256) {
    throw new BridgeError(STAGE, "F1_NOT_FOR_THIS_RECORD", "F1 approval does not bind this finishing record");
  }
  if (record.master.sha256 !== masterSha) throw new BridgeError(STAGE, "FINISHING_OF_OTHER_MASTER", "finishing record was made from a different master render");
}
