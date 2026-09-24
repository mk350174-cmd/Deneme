// P3 stage runner — a resumable, file-based driver around the REAL, frozen
// pipeline3-production library (A-Branch P3.01 → P3.09 + Gate A4–A7).
//
// Why a runner: P3 has manual work in the middle (the owner generates Google
// Flow images/videos, listens to a narration preview, watches the render).
// Each step here is one call that reads p3_state.json from outDir, verifies
// it, does one phase, and writes it back. Nothing in branches/ is modified.
//
//   1. p3Plan             asset checklist (file names + Google Flow prompts) + voice script. No gate.
//   2. p3Ingest           Gate A4 (actor) → P3.01–P3.03 ingest/match → P3.02 hash+decode validation
//   3. p3Preview          P3.04 narration preview (Piper → gTTS, P3's own tier policy; never ElevenLabs)
//   4. p3ApproveVoice     Gate A5 (actor listened to the preview; optional pronunciation confirmations)
//   (4b. p3ResolveAmbiguity  Gate A6 — only when pronunciation flags remain unconfirmed)
//   5. p3Voice            P3.05 production narration: ElevenLabs (key from env/.env) or Voicebox
//   6. p3Render           P3.06 timing (real narration duration) → P3.07 timeline → P3.08 Remotion
//                         render (9:16, narration muxed in) → P3.09 automated QA
//   7. p3Approve          Gate A7 (actor watched the MP4) → Final Delivery Package (final_delivery.json)
//
// Honesty / safety rules:
//   * every human gate takes an explicit actor, checked by assertHumanAuthority — no defaults;
//   * p3_state.json is a sealed (HMAC-signed when a seal key exists) envelope; a hand edit is refused;
//   * every step re-checks the Production Package and the files earlier steps produced
//     (staged assets, preview, narration, MP4) by SHA-256;
//   * the ElevenLabs key is read at call time from process.env / P3's .env and never written anywhere;
//   * P3.10 Kaggle archive is not run: the Final Delivery carries an explicit NOT_ARCHIVED record.

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  approveAmbiguityResolution,
  approveDeliveryReceived,
  approveFinalQA,
  assembleFinalDeliveryPackage,
  runIngestValidateMatch,
  runP302AssetValidation,
  runP304VoicePreviewWithFallback,
  runP306Timing,
  runP307Timeline,
  runP308Render,
  runP309QA,
} from "pipeline3-production/dist/pipeline.js";
import { parseProductionDelivery, parseProductionPackage, verifyProductionPackageIntegrity } from "pipeline3-production/dist/ingest.js";
import { approvePiperPreview } from "pipeline3-production/dist/voiceApproval.js";
import { runElevenLabsPreflight, type PreflightCheckFns, type PreflightResult } from "pipeline3-production/dist/preflight.js";
import { buildElevenLabsPreflightCheckFns, type GetElevenLabsHttp } from "pipeline3-production/dist/elevenlabsConnectivity.js";
import { ElevenLabsProvider } from "pipeline3-production/dist/elevenlabsProvider.js";
import { VoiceboxProvider } from "pipeline3-production/dist/voiceboxProvider.js";
import type { VoiceboxClient } from "pipeline3-production/dist/voiceboxClient.js";
import type { PostElevenLabsHttp } from "pipeline3-production/dist/elevenlabs.js";
import { CostLedger } from "pipeline3-production/dist/costLedger.js";
import { StageCache } from "pipeline3-production/dist/checkpoint.js";
import { defaultExecRemotionRender, type ExecRemotionRender } from "pipeline3-production/dist/render.js";
import { defaultFfprobeMediaProbe, type MediaProbeResult } from "pipeline3-production/dist/assetValidation.js";
import { defaultExecPiperSubprocess, type ExecPiperSubprocess } from "pipeline3-production/dist/piper.js";
import { defaultExecGttsSubprocess, type ExecGttsSubprocess } from "pipeline3-production/dist/gtts.js";
import { parseDurationIntention } from "pipeline3-production/dist/timing.js";
import { recordHumanQAFindings } from "pipeline3-production/dist/qa.js";
import type { AssetProbeRecord } from "pipeline3-production/dist/qa.js";
import type {
  FinalDeliveryPackage,
  GateApprovalRecord,
  KaggleDeliveryRecord,
  ProductionDeliveryInput,
  ProductionPackageHandoffInput,
  ProductionVoiceResult,
  PronunciationFlag,
  QAReport,
  RenderManifest,
  ResolvedAsset,
  Timeline,
  TimingResult,
  VoicePreviewResult,
} from "pipeline3-production/dist/types.js";
import { BridgeError, assertHumanAuthority, hashValue, sealEnvelope, shortHash, signValue, verifyEnvelope, verifyValueSignature } from "../identity.js";
import { assertNoSecrets, atomicWrite } from "../safety.js";
import { fileSha256 } from "../finishing.js";

const STAGE = "P3-stage";
export const P3_STATE_FILE = "p3_state.json";
const STATE_OBJECT_TYPE = "UNIFIED_P3_STAGE_STATE";
const FPS = 30;
const RESOLUTION = "1080x1920"; // 9:16 — P3's composition is fixed at 1080x1920
const CODEC = "h264";

/** Step order; running a step discards every later step (and its gate). */
export const P3_STEPS = ["plan", "ingest", "preview", "voice_approval", "ambiguity", "voice", "render", "approve"] as const;
export type P3Step = (typeof P3_STEPS)[number];

const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp"];
const VIDEO_EXT = [".mp4", ".mov", ".webm"];
const KIND_BY_MEDIA_TYPE: Record<string, "image" | "video"> = {
  VISUAL_IMAGE: "image",
  GRAPHIC: "image",
  REFERENCE: "image",
  VISUAL_VIDEO: "video",
};

// ------------------------------------------------------------------ types

export interface FileRef {
  /** Relative to outDir for files the runner owns; absolute for the render output. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface ExpectedAsset {
  asset_requirement_id: string;
  shot_id: string;
  scene_id: string;
  kind: "image" | "video";
  expected_media_type: string;
  file_name: string;
  accepted_extensions: string[];
  duration_intention: string;
  required: boolean;
  prompts: string[];
}

export interface P3StageState {
  state_type: "P3_STAGE_RUNNER_STATE";
  schema_version: 1;
  production: { package_id: string; version: string; project_id: string; package_sha256: string; input_hash: string };
  language: string;
  plan: { at: string; expected: ExpectedAsset[]; voice_script_sha256: string; target_duration_s: number };
  ingest?: {
    at: string;
    source_dir: string;
    delivery: ProductionDeliveryInput;
    delivery_hash: string;
    staged: FileRef[];
    resolved_assets: ResolvedAsset[];
    asset_probes: AssetProbeRecord[];
    warnings: string[];
    gate_a4: GateApprovalRecord;
  };
  preview?: { at: string; provider: "piper" | "gtts"; result: VoicePreviewResult; file: FileRef };
  voice_approval?: { at: string; gate_a5: GateApprovalRecord; preview_sha256: string; confirmed_pronunciations: string[] };
  ambiguity?: { at: string; object_version: string; unresolved: PronunciationFlag[]; gate_a6?: GateApprovalRecord };
  voice?: {
    at: string;
    provider: "elevenlabs" | "voicebox";
    config: Record<string, string>;
    key_source?: "env" | "dotenv";
    preflight?: PreflightResult["checks"];
    material_ambiguity: boolean;
    listen_check: "PERFORMED" | "NOT_PERFORMED";
    result: ProductionVoiceResult;
    narration_file: FileRef;
  };
  render?: { at: string; timing: TimingResult; timeline: Timeline; render: RenderManifest; qa: QAReport; narration_muxed: true };
  approve?: { at: string; gate_a7: GateApprovalRecord; final_delivery_package_id: string; final_delivery_path: string; final_delivery_sha256: string };
}

// ------------------------------------------------------------------ helpers

function fail(code: string, message: string): never {
  throw new BridgeError(STAGE, code, message);
}

const now = () => new Date().toISOString();

function statePath(outDir: string): string {
  return join(resolve(outDir), P3_STATE_FILE);
}

async function fileRef(outDir: string, relOrAbs: string): Promise<FileRef> {
  const abs = resolve(outDir, relOrAbs);
  const st = await stat(abs);
  return { path: relOrAbs, sha256: await fileSha256(abs), bytes: st.size };
}

async function assertFileUnchanged(outDir: string, ref: FileRef, what: string): Promise<void> {
  const abs = resolve(outDir, ref.path);
  if (!existsSync(abs)) fail("P3_ARTIFACT_MISSING", `${what} bulunamadı: ${abs}. Bu adımı yeniden çalıştırın.`);
  const sha = await fileSha256(abs);
  if (sha !== ref.sha256) {
    fail("P3_ARTIFACT_CHANGED", `${what} kaydedildikten sonra değişmiş (${shortHash(ref.sha256)} → ${shortHash(sha)}): ${abs}. Dosyayı elle değiştirmeyin; ilgili adımı yeniden çalıştırın.`);
  }
}

function parsePackage(raw: unknown): ProductionPackageHandoffInput {
  try {
    return parseProductionPackage(raw);
  } catch (e) {
    return fail("P3_PRODUCTION_PACKAGE_REJECTED", `P2 üretim paketi P3 doğrulamasından geçmedi: ${(e as Error).message}`);
  }
}

function gatesOf(s: P3StageState): GateApprovalRecord[] {
  return [s.ingest?.gate_a4, s.voice_approval?.gate_a5, s.ambiguity?.gate_a6, s.approve?.gate_a7].filter((g): g is GateApprovalRecord => !!g);
}

/** Drops every step after `step` — their outputs/gates no longer describe the new state. */
function invalidateAfter(s: P3StageState, step: P3Step): void {
  const idx = P3_STEPS.indexOf(step);
  for (const later of P3_STEPS.slice(idx + 1)) delete (s as unknown as Record<string, unknown>)[later];
}

const STEP_LABEL: Record<P3Step, string> = {
  plan: "p3-plan (varlık listesi)",
  ingest: "p3-ingest (Gate A4 + varlık doğrulama)",
  preview: "p3-preview (anlatım önizlemesi)",
  voice_approval: "p3-approve-voice (Gate A5)",
  ambiguity: "p3-resolve-ambiguity (Gate A6)",
  voice: "p3-voice (üretim anlatımı)",
  render: "p3-render (zamanlama + Remotion + QA)",
  approve: "p3-approve (Gate A7)",
};

function need<K extends P3Step>(s: P3StageState, step: K): NonNullable<P3StageState[K]> {
  const v = s[step];
  if (!v) fail("P3_STEP_ORDER", `önce ${STEP_LABEL[step]} adımını çalıştırın.`);
  return v as NonNullable<P3StageState[K]>;
}

async function loadState(outDir: string): Promise<P3StageState> {
  const p = statePath(outDir);
  if (!existsSync(p)) fail("P3_STATE_MISSING", `${p} yok. Önce p3-plan ile bu klasörü başlatın.`);
  let doc: any;
  try {
    doc = JSON.parse(await readFile(p, "utf8"));
  } catch {
    return fail("P3_STATE_TAMPERED", `${P3_STATE_FILE} geçerli JSON değil (bozuk ya da elle düzenlenmiş). p3-plan'dan yeniden başlayın.`);
  }
  try {
    verifyEnvelope(STAGE, doc, STATE_OBJECT_TYPE);
  } catch (e) {
    return fail("P3_STATE_TAMPERED", `${P3_STATE_FILE} kaydedildikten sonra değiştirilmiş (${(e as Error).message}). Elle düzenlemeyin; ilgili adımı yeniden çalıştırın ya da p3-plan'dan başlayın.`);
  }
  const { identity: _identity, ...body } = doc;
  return body as P3StageState;
}

async function saveState(outDir: string, s: P3StageState): Promise<void> {
  const body = JSON.parse(JSON.stringify(s)) as P3StageState;
  assertNoSecrets(body, "$p3_state");
  const sealed = sealEnvelope<P3StageState & { identity?: any }>(body, {
    object_id: `p3state_${s.production.package_id}`,
    object_type: STATE_OBJECT_TYPE,
    version: "v1",
    created_at: now(),
  });
  await atomicWrite(statePath(outDir), JSON.stringify(sealed, null, 2) + "\n");
}

/** Loads state, checks the Production Package is the one the plan was made from. */
async function open(outDir: string, productionPackage: unknown): Promise<{ s: P3StageState; pkg: ProductionPackageHandoffInput }> {
  const s = await loadState(outDir);
  const pkg = parsePackage(productionPackage);
  const h = hashValue(productionPackage);
  if (h !== s.production.input_hash || pkg.package_id !== s.production.package_id) {
    fail("P3_INPUT_CHANGED", `üretim paketi plan adımından sonra değişmiş (${s.production.package_id}@${shortHash(s.production.input_hash)} → ${pkg.package_id}@${shortHash(h)}). Yeni paket için p3-plan'ı yeni bir klasörde çalıştırın.`);
  }
  return { s, pkg };
}

function scrub(message: string, secret?: string): string {
  return secret ? message.split(secret).join("***") : message;
}

function wavHeader(dataBytes: number, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
  const h = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(byteRate, 28);
  h.writeUInt16LE((channels * bitsPerSample) / 8, 32);
  h.writeUInt16LE(bitsPerSample, 34);
  h.write("data", 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

// ------------------------------------------------------------------ seams

/** Probes a real file by absolute path. Default: P3's own ffprobe adapter. */
export type P3MediaProbe = (absPath: string) => Promise<MediaProbeResult>;

/** Muxes the narration into the Remotion master (P3Composition has no audio layer). */
export type MuxNarration = (p: { videoPath: string; audioPath: string; outputPath: string }) => Promise<void>;

export const ffmpegMuxNarration: MuxNarration = ({ videoPath, audioPath, outputPath }) =>
  new Promise((res, rej) =>
    execFile(
      "ffmpeg",
      ["-y", "-hide_banner", "-loglevel", "error", "-i", videoPath, "-i", audioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputPath],
      { timeout: 10 * 60_000, maxBuffer: 10_000_000, shell: false, windowsHide: true },
      (err, _o, stderr) => (err ? rej(new Error(`ffmpeg narration mux failed: ${String(stderr).slice(0, 400) || err.message}`)) : res()),
    ),
  );

/** "Not performed" sentinel — same convention as P3's VoiceboxProvider (ratio 0 + attempts 0). */
const LISTEN_CHECK_NOT_PERFORMED = async () => ({ ratio: 0, attempts: 0 });

/** Default location of P3's .env (never read into any output). */
export function defaultP3DotenvPath(): string {
  return fileURLToPath(new URL("../../../../branches/a/pipeline3_production/.env", import.meta.url));
}

export function readElevenLabsKey(env: NodeJS.ProcessEnv = process.env, dotenvPath: string = defaultP3DotenvPath()): { key: string; source: "env" | "dotenv" } | undefined {
  const fromEnv = env.ELEVENLABS_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  if (!existsSync(dotenvPath)) return undefined;
  const text = readFileSync(dotenvPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const v = m[1]!.trim().replace(/^(['"])(.*)\1$/, "$2").trim();
    if (v && !/^<|your_|_here$|^x+$/i.test(v)) return { key: v, source: "dotenv" };
  }
  return undefined;
}

// ------------------------------------------------------------------ config file

export interface P3VoiceConfig {
  language: string;
  piper_model_path?: string;
  provider?: "elevenlabs" | "voicebox";
  elevenlabs?: { voice_id: string; model_id?: string; char_budget?: number };
  voicebox?: { profile_id: string; engine?: string; base_url?: string };
}

/** Validates docs/examples/p3_input.example.json-style config. Never carries a key. */
export function parseP3Config(raw: unknown): P3VoiceConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("P3_CONFIG_INVALID", "p3 girdi dosyası bir JSON nesnesi olmalı");
  assertNoSecrets(raw, "$p3_input");
  const text = JSON.stringify(raw);
  if (/api[_-]?key|secret|token/i.test(text)) fail("P3_CONFIG_INVALID", "girdi dosyasına API anahtarı yazmayın; ELEVENLABS_API_KEY yalnızca ortam değişkeni ya da .env içinde durur");
  const c = raw as Record<string, any>;
  if (typeof c.language !== "string" || !/^[a-z]{2,3}(-[A-Za-z]{2})?$/.test(c.language)) fail("P3_CONFIG_INVALID", `language (ör. "tr") gerekli`);
  if (c.provider !== undefined && c.provider !== "elevenlabs" && c.provider !== "voicebox") fail("P3_PROVIDER_NOT_PRODUCTION", `provider "elevenlabs" ya da "voicebox" olmalı (Piper/gTTS yalnızca önizleme)`);
  const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0 && !v.trim().startsWith("<");
  if (c.elevenlabs !== undefined && !filled(c.elevenlabs?.voice_id)) fail("P3_CONFIG_INVALID", "elevenlabs.voice_id doldurulmalı (örnekteki <…> yer tutucusunu değiştirin)");
  if (c.voicebox !== undefined && !filled(c.voicebox?.profile_id)) fail("P3_CONFIG_INVALID", "voicebox.profile_id doldurulmalı (örnekteki <…> yer tutucusunu değiştirin)");
  if (c.provider === "elevenlabs" && c.elevenlabs === undefined) fail("P3_VOICE_CONFIG_MISSING", "provider elevenlabs ise elevenlabs.voice_id gerekli");
  if (c.provider === "voicebox" && c.voicebox === undefined) fail("P3_VOICE_CONFIG_MISSING", "provider voicebox ise voicebox.profile_id gerekli");
  return c as P3VoiceConfig;
}

// ================================================================== 1. PLAN

export interface P3PlanResult {
  statePath: string;
  checklistPath: string;
  assetsDir: string;
  expected: ExpectedAsset[];
}

export async function p3Plan(params: { productionPackage: unknown; outDir: string; language: string }): Promise<P3PlanResult> {
  const pkg = parsePackage(params.productionPackage);
  if (typeof params.language !== "string" || !/^[a-z]{2,3}(-[A-Za-z]{2})?$/.test(params.language)) fail("P3_CONFIG_INVALID", `language gerekli (ör. "tr")`);
  const outDir = resolve(params.outDir);
  await mkdir(join(outDir, "assets"), { recursive: true });

  const shotById = new Map(pkg.shots.map((s) => [s.shot_id, s]));
  const sceneOrder = new Map<string, number>();
  pkg.scenes.forEach((sc, i) => sc.shots.forEach((id, j) => sceneOrder.set(id, i * 1000 + j)));
  const expected: ExpectedAsset[] = [];
  const unsupported: string[] = [];
  for (const req of pkg.asset_requirements) {
    if (!/^[A-Za-z0-9._-]+$/.test(req.asset_requirement_id)) fail("P3_PLAN_INVALID", `asset_requirement_id "${req.asset_requirement_id}" dosya adı olarak kullanılamaz`);
    const kind = KIND_BY_MEDIA_TYPE[req.expected_media_type];
    if (!kind) {
      unsupported.push(`${req.asset_requirement_id} (${req.expected_media_type})`);
      continue;
    }
    const shot = shotById.get(req.shot_id)!;
    expected.push({
      asset_requirement_id: req.asset_requirement_id,
      shot_id: req.shot_id,
      scene_id: shot.scene_id,
      kind,
      expected_media_type: req.expected_media_type,
      file_name: `${req.asset_requirement_id}${kind === "image" ? ".png" : ".mp4"}`,
      accepted_extensions: kind === "image" ? IMAGE_EXT : VIDEO_EXT,
      duration_intention: shot.duration_intention,
      required: req.required,
      prompts: pkg.prompts.filter((p) => p.spec.traceable_to.shot_id === req.shot_id).map((p) => p.rendered.prompt_text),
    });
  }
  if (unsupported.length) {
    fail("P3_UNSUPPORTED_ASSET_TYPE", `P3'ün Remotion kompozisyonu yalnızca görsel/video gösterir; bu gereksinimler desteklenmiyor: ${unsupported.join(", ")}. P2 paketini düzeltin.`);
  }
  expected.sort((a, b) => (sceneOrder.get(a.shot_id) ?? 1e9) - (sceneOrder.get(b.shot_id) ?? 1e9));
  const target = pkg.shots.reduce((sum, sh) => sum + parseDurationIntention(sh.duration_intention), 0);

  const s: P3StageState = {
    state_type: "P3_STAGE_RUNNER_STATE",
    schema_version: 1,
    production: {
      package_id: pkg.package_id,
      version: pkg.production_package_version,
      project_id: pkg.project_id,
      package_sha256: pkg.integrity_hashes.package_sha256,
      input_hash: hashValue(params.productionPackage),
    },
    language: params.language,
    plan: { at: now(), expected, voice_script_sha256: hashValue(pkg.voice_script), target_duration_s: target },
  };

  const md = checklistMarkdown(pkg, expected, target, params.language);
  assertNoSecrets(md, "$assets_checklist");
  const checklistPath = join(outDir, "assets_checklist.md");
  await atomicWrite(checklistPath, md);
  await atomicWrite(join(outDir, "voice_script.txt"), pkg.voice_script + "\n");
  await saveState(outDir, s);
  return { statePath: statePath(outDir), checklistPath, assetsDir: join(outDir, "assets"), expected };
}

function checklistMarkdown(pkg: ProductionPackageHandoffInput, expected: ExpectedAsset[], target: number, language: string): string {
  const shotById = new Map(pkg.shots.map((s) => [s.shot_id, s]));
  const L: string[] = [];
  L.push(`# P3 varlık listesi — ${pkg.package_id} (v${pkg.production_package_version})`, "");
  L.push(`Format: **9:16 dikey, 1080×1920**. Toplam hedef süre ≈ ${target.toFixed(1)} sn (asıl süreyi üretim anlatımı belirler). Anlatım dili: \`${language}\`.`, "");
  L.push("Her çekim için Google Flow'da görseli/videoyu üretin ve **tam olarak aşağıdaki dosya adıyla** `assets/` klasörüne koyun.", "");
  L.push("- Görsel: `.png` (ya da `.jpg`/`.jpeg`/`.webp`) — Video: `.mp4` (ya da `.mov`/`.webm`). Dosya adının uzantıdan önceki kısmı değişmemeli.");
  L.push("- 9:16 olmayan dosyalar kırpılarak doldurulur (object-fit: cover); ingest adımı bunu uyarı olarak yazar.");
  L.push("- Bir dosyayı ingest'ten sonra değiştirirseniz ingest adımını yeniden çalıştırın (A4 yeniden alınır, sonraki adımlar sıfırlanır).", "");
  L.push("| # | Dosya adı | Tür | Sahne | Çekim | Süre niyeti | Zorunlu |", "|---|---|---|---|---|---|---|");
  expected.forEach((e, i) => L.push(`| ${i + 1} | \`${e.file_name}\` | ${e.kind === "image" ? "görsel" : "video"} | ${e.scene_id} | ${e.shot_id} | ${e.duration_intention} | ${e.required ? "evet" : "hayır"} |`));
  L.push("");
  expected.forEach((e, i) => {
    const shot = shotById.get(e.shot_id)!;
    L.push(`## ${i + 1}. \`${e.file_name}\` — ${e.shot_id}`, "");
    L.push(`- Amaç: ${shot.purpose}`);
    L.push(`- Aksiyon: ${shot.action}`);
    L.push(`- Kamera: açı ${shot.camera.angle}, hareket ${shot.camera.movement}, lens ${shot.camera.lens}, kadraj ${shot.camera.framing}`);
    if (shot.continuity_anchors.length) L.push(`- Süreklilik: ${shot.continuity_anchors.join(", ")}`);
    L.push(`- Süre niyeti: ${e.duration_intention}`, "");
    if (e.prompts.length) {
      e.prompts.forEach((p, j) => L.push(`**Google Flow prompt${e.prompts.length > 1 ? ` ${j + 1}` : ""}:**`, "", "```text", p, "```", ""));
    } else L.push("_P2 bu çekim için prompt üretmemiş — P2 paketini kontrol edin._", "");
  });
  L.push("## Anlatım metni (voice_script)", "", "```text", pkg.voice_script, "```", "");
  if (pkg.pronunciation_flags.length) {
    L.push("## Telaffuz işaretleri", "", "Önizlemeyi dinlerken bunları kontrol edin. Doğru okunanları p3-approve-voice'ta `--confirm` ile onaylayın; onaylanmayanlar Gate A6 ister.", "");
    for (const f of pkg.pronunciation_flags) L.push(`- \`${f.token}\` (${f.flag_type}) — ${f.note}`);
    L.push("");
  }
  const cmd = (c: string) => `\`npm run unified -- ${c} --production production_package.json --dir <bu klasör>\``;
  L.push("## Sıradaki adımlar", "");
  L.push(`1. Dosyalar assets/ içinde hazır olunca: ${cmd('p3-ingest --actor "<adınız>"')} (Gate A4)`);
  L.push(`2. ${cmd("p3-preview")} → önizlemeyi dinleyin → ${cmd('p3-approve-voice --actor "<adınız>"')} (Gate A5)`);
  L.push(`3. ${cmd("p3-voice --config p3_input.json")} (ElevenLabs: ELEVENLABS_API_KEY ortamda ya da P3 .env içinde; ya da Voicebox)`);
  L.push(`4. ${cmd("p3-render")} → render/master.mp4'ü izleyin → ${cmd('p3-approve --actor "<adınız>"')} (Gate A7) → final_delivery.json`, "");
  return L.join("\n");
}

// ================================================================== 2. INGEST (A4)

export interface P3IngestResult {
  resolvedAssets: ResolvedAsset[];
  warnings: string[];
  gate: GateApprovalRecord;
}

export async function p3Ingest(params: {
  outDir: string;
  productionPackage: unknown;
  actor: string;
  /** Where the owner put the Google Flow files. Default: <outDir>/assets. */
  assetsDir?: string;
  probe?: P3MediaProbe;
}): Promise<P3IngestResult> {
  const actor = assertHumanAuthority(STAGE, params.actor, "Gate A4 actor");
  const outDir = resolve(params.outDir);
  const { s, pkg } = await open(outDir, params.productionPackage);
  const probe = params.probe ?? ((p: string) => defaultFfprobeMediaProbe(p));
  const srcDir = resolve(params.assetsDir ?? join(outDir, "assets"));
  if (!existsSync(srcDir)) fail("P3_ASSETS_MISSING", `varlık klasörü yok: ${srcDir}`);
  const stagingAbs = join(outDir, "staging");
  if (srcDir === stagingAbs || srcDir.startsWith(stagingAbs + (process.platform === "win32" ? "\\" : "/"))) {
    fail("P3_ASSETS_MISSING", "varlık klasörü staging/ olamaz (staging her ingest'te yeniden oluşturulur); Google Flow dosyalarını assets/ içine koyun.");
  }

  const files = (await readdir(srcDir, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name);
  const missing: string[] = [];
  const ambiguous: string[] = [];
  const wrongType: string[] = [];
  const chosen = new Map<string, string>();
  for (const e of s.plan.expected) {
    const same = files.filter((f) => f.slice(0, f.length - extname(f).length) === e.asset_requirement_id);
    const ok = same.filter((f) => e.accepted_extensions.includes(extname(f).toLowerCase()));
    if (ok.length === 1) chosen.set(e.asset_requirement_id, ok[0]!);
    else if (ok.length > 1) ambiguous.push(`${ok.join(" + ")} (yalnızca birini bırakın)`);
    else if (same.length) wrongType.push(`${same.join(", ")} → ${e.kind === "image" ? "görsel" : "video"} bekleniyor (${e.accepted_extensions.join("/")})`);
    else missing.push(`${e.file_name} (sahne ${e.scene_id}, çekim ${e.shot_id})`);
  }
  const problems = [
    missing.length ? `Eksik dosyalar: ${missing.join("; ")}` : "",
    wrongType.length ? `Yanlış tür: ${wrongType.join("; ")}` : "",
    ambiguous.length ? `Birden fazla aday: ${ambiguous.join("; ")}` : "",
  ].filter(Boolean);
  if (problems.length) {
    fail(missing.length ? "P3_ASSETS_MISSING" : wrongType.length ? "P3_ASSET_WRONG_TYPE" : "P3_ASSET_AMBIGUOUS", `${srcDir} içinde: ${problems.join(" | ")}. Liste: assets_checklist.md`);
  }

  // Stage exactly the validated bytes into <outDir>/staging (render reads only from here).
  const stagingDir = join(outDir, "staging");
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  const staged: FileRef[] = [];
  const delivery: ProductionDeliveryInput = { asset_delivery_map: [], generated_assets: [] };
  const invalid: string[] = [];
  const warnings: string[] = [];
  for (const e of s.plan.expected) {
    const name = chosen.get(e.asset_requirement_id)!;
    const dest = join(stagingDir, name);
    await copyFile(join(srcDir, name), dest);
    const ref = await fileRef(outDir, join("staging", name));
    staged.push(ref);
    const pr = await probe(dest);
    if (!pr.decodable) {
      invalid.push(`${name} (açılamıyor / bozuk)`);
      continue;
    }
    if (typeof pr.width === "number" && typeof pr.height === "number" && pr.height > 0 && Math.abs(pr.width / pr.height - 9 / 16) > 0.01) {
      warnings.push(`${name}: ${pr.width}×${pr.height} 9:16 değil — 1080×1920 kareye kırpılarak yerleşecek`);
    }
    const media: Record<string, unknown> = { type: e.kind };
    if (typeof pr.width === "number") media.width = pr.width;
    if (typeof pr.height === "number") media.height = pr.height;
    if (e.kind === "video" && typeof pr.duration_s === "number") media.duration_s = pr.duration_s;
    delivery.asset_delivery_map.push({ asset_requirement_id: e.asset_requirement_id, asset_file_id: name });
    delivery.generated_assets.push({ asset_file_id: name, hash: ref.sha256, media_properties: media });
  }
  if (invalid.length) fail("P3_ASSET_INVALID", `geçersiz dosyalar: ${invalid.join("; ")}. Google Flow'dan yeniden indirin.`);

  const parsed = parseProductionDelivery(delivery);
  const delivery_hash = hashValue(parsed);
  const gate_a4 = approveDeliveryReceived(actor, `delivery_${pkg.package_id}_${shortHash(delivery_hash, 16)}`);
  let resolvedAssets: ResolvedAsset[];
  let probes: AssetProbeRecord[];
  try {
    resolvedAssets = runIngestValidateMatch(pkg, parsed, [gate_a4]);
    probes = await runP302AssetValidation(resolvedAssets, parsed.generated_assets, (id: string) => probe(join(stagingDir, id)), stagingDir);
  } catch (e) {
    return fail("P3_ASSET_REJECTED", `P3.02/P3.03 varlık doğrulaması başarısız: ${(e as Error).message}`);
  }

  s.ingest = { at: now(), source_dir: srcDir, delivery: parsed, delivery_hash, staged, resolved_assets: resolvedAssets, asset_probes: probes, warnings, gate_a4 };
  invalidateAfter(s, "ingest");
  await atomicWrite(join(outDir, "production_delivery.json"), JSON.stringify(parsed, null, 2) + "\n");
  await saveState(outDir, s);
  return { resolvedAssets, warnings, gate: gate_a4 };
}

// ================================================================== 3. PREVIEW (P3.04)

export async function p3Preview(params: {
  outDir: string;
  productionPackage: unknown;
  /** Piper .onnx voice model. Without it Piper is skipped and P3 falls back to gTTS. */
  piperModelPath?: string;
  execPiper?: ExecPiperSubprocess;
  execGtts?: ExecGttsSubprocess;
}): Promise<{ provider: "piper" | "gtts"; path: string; result: VoicePreviewResult }> {
  const outDir = resolve(params.outDir);
  const { s, pkg } = await open(outDir, params.productionPackage);
  need(s, "ingest");
  const voiceDir = join(outDir, "voice");
  await mkdir(voiceDir, { recursive: true });
  const piperOut = join(voiceDir, "preview_piper.wav");
  const gttsOut = join(voiceDir, "preview_gtts.mp3");
  await rm(piperOut, { force: true });
  await rm(gttsOut, { force: true });
  const noPiperModel: ExecPiperSubprocess = async () => {
    throw new Error("Piper model yolu verilmedi (piperModelPath)");
  };
  const execPiper = params.execPiper ?? (params.piperModelPath ? defaultExecPiperSubprocess : noPiperModel);
  let result: VoicePreviewResult;
  try {
    result = await runP304VoicePreviewWithFallback(
      { text: pkg.voice_script, piperOutputPath: piperOut, gttsOutputPath: gttsOut, modelPath: params.piperModelPath ?? "", language: s.language.split("-")[0]!, targetDurationS: s.plan.target_duration_s },
      new StageCache(),
      new CostLedger(Number.MAX_SAFE_INTEGER),
      execPiper,
      params.execGtts ?? defaultExecGttsSubprocess,
    );
  } catch (e) {
    return fail("P3_PREVIEW_FAILED", `${(e as Error).message}. Piper için bir .onnx model yolu verin ya da gTTS kurun (pip install gTTS).`);
  }
  const provider = "provider" in result && result.provider === "gtts" ? "gtts" : "piper";
  if (!existsSync(result.output_path)) fail("P3_PREVIEW_FAILED", `önizleme dosyası oluşmadı: ${result.output_path}`);
  const file = await fileRef(outDir, provider === "gtts" ? join("voice", "preview_gtts.mp3") : join("voice", "preview_piper.wav"));
  s.preview = { at: now(), provider, result, file };
  invalidateAfter(s, "preview");
  await saveState(outDir, s);
  return { provider, path: result.output_path, result };
}

// ================================================================== 4. VOICE APPROVAL (A5)

export async function p3ApproveVoice(params: {
  outDir: string;
  productionPackage: unknown;
  actor: string;
  /** Pronunciation-flag tokens the actor heard read correctly in the preview. */
  confirmedPronunciations?: string[];
}): Promise<{ gate: GateApprovalRecord; unresolvedPronunciations: string[] }> {
  const actor = assertHumanAuthority(STAGE, params.actor, "Gate A5 actor");
  const outDir = resolve(params.outDir);
  const { s, pkg } = await open(outDir, params.productionPackage);
  const ingest = need(s, "ingest");
  const preview = need(s, "preview");
  await assertFileUnchanged(outDir, preview.file, "anlatım önizlemesi");
  const known = new Set(pkg.pronunciation_flags.map((f) => f.token));
  const confirmed = [...new Set(params.confirmedPronunciations ?? [])];
  const unknown = confirmed.filter((t) => !known.has(t));
  if (unknown.length) fail("P3_UNKNOWN_PRONUNCIATION_TOKEN", `pakette böyle telaffuz işareti yok: ${unknown.join(", ")} (geçerli: ${[...known].join(", ") || "yok"})`);
  let gate_a5: GateApprovalRecord;
  try {
    gate_a5 = approvePiperPreview(preview.result, actor, [ingest.gate_a4]);
  } catch (e) {
    return fail("P3_GATE_REFUSED", `Gate A5 kaydedilemedi: ${(e as Error).message}`);
  }
  s.voice_approval = { at: now(), gate_a5, preview_sha256: preview.file.sha256, confirmed_pronunciations: confirmed };
  invalidateAfter(s, "voice_approval");
  await saveState(outDir, s);
  return { gate: gate_a5, unresolvedPronunciations: pkg.pronunciation_flags.map((f) => f.token).filter((t) => !confirmed.includes(t)) };
}

// ================================================================== 4b. AMBIGUITY (A6)

export async function p3ResolveAmbiguity(params: { outDir: string; productionPackage: unknown; actor: string }): Promise<{ gate: GateApprovalRecord }> {
  const actor = assertHumanAuthority(STAGE, params.actor, "Gate A6 actor");
  const outDir = resolve(params.outDir);
  const { s } = await open(outDir, params.productionPackage);
  const ingest = need(s, "ingest");
  const va = need(s, "voice_approval");
  const amb = s.ambiguity;
  if (!amb) fail("P3_NO_AMBIGUITY", "çözülecek bir belirsizlik kaydı yok (p3-voice önce belirsizliği tespit etmeli).");
  if (amb.gate_a6) return { gate: amb.gate_a6 };
  let gate_a6: GateApprovalRecord;
  try {
    gate_a6 = approveAmbiguityResolution(actor, amb.object_version, [ingest.gate_a4, va.gate_a5]);
  } catch (e) {
    return fail("P3_GATE_REFUSED", `Gate A6 kaydedilemedi: ${(e as Error).message}`);
  }
  amb.gate_a6 = gate_a6;
  invalidateAfter(s, "ambiguity");
  await saveState(outDir, s);
  return { gate: gate_a6 };
}

// ================================================================== 5. PRODUCTION VOICE (P3.05)

export interface P3VoiceParams {
  outDir: string;
  productionPackage: unknown;
  provider: "elevenlabs" | "voicebox";
  elevenlabs?: { voiceId: string; modelId?: string; charBudget?: number };
  voicebox?: { profileId: string; engine?: string; baseUrl?: string };
  /** Re-generate even if a matching narration already exists (costs ElevenLabs credits). */
  force?: boolean;
  /** Key lookup — defaults to process.env and P3's .env. The key is never persisted. */
  env?: NodeJS.ProcessEnv;
  dotenvPath?: string;
  // I/O seams (tests)
  postElevenLabsHttp?: PostElevenLabsHttp;
  getElevenLabsHttp?: GetElevenLabsHttp;
  preflightFns?: PreflightCheckFns;
  listenCheck?: (audio: Buffer, text: string) => Promise<{ ratio: number; attempts: number }>;
  voiceboxClient?: VoiceboxClient;
  probe?: P3MediaProbe;
}

export async function p3Voice(params: P3VoiceParams): Promise<{ provider: "elevenlabs" | "voicebox"; narrationPath: string; durationS: number; reused: boolean }> {
  const provider = params.provider as string;
  if (provider === "piper" || provider === "gtts") {
    fail("P3_PROVIDER_NOT_PRODUCTION", `${provider} yalnızca önizleme sağlayıcısıdır (p3-preview). P3 üretim anlatımı ElevenLabs ya da Voicebox ile yapılır.`);
  }
  if (provider !== "elevenlabs" && provider !== "voicebox") fail("P3_PROVIDER_NOT_PRODUCTION", `bilinmeyen sağlayıcı "${provider}" (elevenlabs | voicebox)`);
  const outDir = resolve(params.outDir);
  const { s, pkg } = await open(outDir, params.productionPackage);
  need(s, "ingest");
  const preview = need(s, "preview");
  const va = need(s, "voice_approval");
  if (va.preview_sha256 !== preview.file.sha256) fail("P3_STEP_ORDER", "Gate A5 başka bir önizlemeye ait; p3-approve-voice'ı yeniden çalıştırın.");

  // --- configuration + key (key checked before any network call)
  let key: { key: string; source: "env" | "dotenv" } | undefined;
  const config: Record<string, string> = {};
  if (provider === "elevenlabs") {
    const el = params.elevenlabs;
    if (!el?.voiceId?.trim() || el.voiceId.trim().startsWith("<")) fail("P3_VOICE_CONFIG_MISSING", "ElevenLabs için voiceId gerekli (p3_input.json → elevenlabs.voice_id).");
    config.voice_id = el.voiceId.trim();
    config.model_id = el.modelId?.trim() || "eleven_multilingual_v2";
    key = readElevenLabsKey(params.env ?? process.env, params.dotenvPath ?? defaultP3DotenvPath());
    if (!key) {
      fail("P3_ELEVENLABS_KEY_MISSING", `ELEVENLABS_API_KEY bulunamadı. Ortam değişkeni olarak ya da ${params.dotenvPath ?? defaultP3DotenvPath()} içine "ELEVENLABS_API_KEY=..." satırı olarak ekleyin; hiçbir JSON dosyasına yazmayın. Alternatif: provider "voicebox".`);
    }
  } else {
    const vb = params.voicebox;
    if (!vb?.profileId?.trim() || vb.profileId.trim().startsWith("<")) fail("P3_VOICE_CONFIG_MISSING", "Voicebox için profileId gerekli (p3_input.json → voicebox.profile_id).");
    config.profile_id = vb.profileId.trim();
    if (vb.engine) config.engine = vb.engine;
    if (vb.baseUrl) config.base_url = vb.baseUrl;
  }

  // --- idempotent resume: never pay twice for the same narration
  if (s.voice && !params.force && s.voice.provider === provider && JSON.stringify(s.voice.config) === JSON.stringify(config)) {
    const abs = resolve(outDir, s.voice.narration_file.path);
    if (existsSync(abs) && (await fileSha256(abs)) === s.voice.narration_file.sha256) {
      return { provider, narrationPath: abs, durationS: s.voice.result.duration_s, reused: true };
    }
  }

  // --- paid-narration cache: re-running an earlier step (e.g. swapping one image and
  // re-ingesting) clears s.voice, but the narration depends only on the script and the
  // voice config. Reuse the signed cached file instead of paying ElevenLabs again.
  // Only cached runs that needed no Gate A6 are reused (A6 is never skipped).
  const cacheKey = hashValue({ provider, config, script: s.plan.voice_script_sha256, language: s.language, confirmed: [...va.confirmed_pronunciations].sort() });
  const cachePath = join(outDir, "voice", "narration_cache.json");
  if (!params.force && existsSync(cachePath)) {
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8"));
      verifyValueSignature(STAGE, "narration_cache.json", cached.record, cached.signature);
      const rec = cached.record;
      const abs = resolve(outDir, rec.voice.narration_file.path);
      if (rec.key === cacheKey && rec.voice.material_ambiguity === false && existsSync(abs) && (await fileSha256(abs)) === rec.voice.narration_file.sha256) {
        s.voice = { ...rec.voice, at: now(), reused_from_cache: true };
        delete s.ambiguity;
        invalidateAfter(s, "voice");
        await saveState(outDir, s);
        return { provider, narrationPath: abs, durationS: rec.voice.result.duration_s, reused: true };
      }
    } catch {
      /* unreadable or unsigned cache: ignore it and generate */
    }
  }

  // --- preflight + pronunciation ambiguity (Gate A6)
  const confirmed = new Set(va.confirmed_pronunciations);
  let preflight: PreflightResult | undefined;
  let unresolved: PronunciationFlag[];
  if (provider === "elevenlabs") {
    try {
      preflight = await runElevenLabsPreflight({
        text: pkg.voice_script,
        voiceId: config.voice_id!,
        modelId: config.model_id!,
        pronunciationFlags: pkg.pronunciation_flags,
        resolvedFlagTokens: confirmed,
        costLedger: new CostLedger(params.elevenlabs?.charBudget ?? 10_000),
        provider: "elevenlabs",
        fns: params.preflightFns ?? buildElevenLabsPreflightCheckFns(key!.key, params.getElevenLabsHttp),
      });
    } catch (e) {
      return fail("P3_PREFLIGHT_FAILED", `ElevenLabs ön kontrolü çalışmadı: ${scrub((e as Error).message, key?.key)}`);
    }
    const c = preflight.checks;
    const infra = [
      !c.api_connectivity ? "API'ye bağlanılamadı ya da anahtar geçersiz" : "",
      !c.voice_availability ? `ses bulunamadı (voice_id ${config.voice_id})` : "",
      !c.model_availability ? `model bulunamadı (${config.model_id})` : "",
      !c.within_hard_cost_limit ? `kota/bütçe yetersiz (gerekli ${c.estimated_usage_units} karakter, kalan ${c.quota_remaining_units})` : "",
    ].filter(Boolean);
    if (infra.length) fail("P3_PREFLIGHT_FAILED", `ElevenLabs ön kontrolü geçmedi: ${infra.join("; ")}.`);
    unresolved = [...c.unresolved_number_date_unit_flags, ...c.unresolved_terminology_flags];
  } else {
    unresolved = pkg.pronunciation_flags.filter((f) => !confirmed.has(f.token));
  }

  let material = false;
  if (unresolved.length) {
    const object_version = `ambiguity_${shortHash(hashValue({ tokens: unresolved.map((f) => f.token).sort(), script: s.plan.voice_script_sha256, a5: va.gate_a5.approval_record_id }), 16)}`;
    if (s.ambiguity?.object_version === object_version && s.ambiguity.gate_a6) {
      material = true;
    } else {
      s.ambiguity = { at: now(), object_version, unresolved };
      invalidateAfter(s, "ambiguity");
      await saveState(outDir, s);
      fail("P3_AMBIGUITY_A6_REQUIRED", `onaylanmamış telaffuz işaretleri var: ${unresolved.map((f) => `"${f.token}" (${f.flag_type})`).join(", ")}. Ya önizlemede doğru okunduklarını p3-approve-voice → confirmedPronunciations ile onaylayın, ya da p3-resolve-ambiguity ile Gate A6'yı verin; sonra p3-voice'u yeniden çalıştırın.`);
    }
  } else if (s.ambiguity) {
    delete s.ambiguity;
  }

  // --- generation
  const voiceDir = join(outDir, "voice");
  await mkdir(voiceDir, { recursive: true });
  const gates = gatesOf(s);
  const request = { text: pkg.voice_script, voiceLineId: pkg.package_id, language: s.language.split("-")[0]!, gates, materialAmbiguityDetected: material, outputDir: voiceDir };
  let result: ProductionVoiceResult;
  let narrationRel: string;
  if (provider === "elevenlabs") {
    const el = new ElevenLabsProvider({
      voiceId: config.voice_id!,
      modelId: config.model_id!,
      voiceLock: { providers: { elevenlabs: { voice_id: config.voice_id!, model: config.model_id! } } },
      listenCheck: params.listenCheck ?? LISTEN_CHECK_NOT_PERFORMED,
      apiKey: key!.key,
      postHttp: params.postElevenLabsHttp,
    });
    let res;
    try {
      res = await el.generate(request);
    } catch (e) {
      return fail("P3_VOICE_REFUSED", scrub((e as Error).message, key!.key));
    }
    if (res.status !== "SUCCESS" || !res.voice) fail("P3_VOICE_FAILED", `ElevenLabs ${res.status}: ${scrub(res.errorMessage ?? "", key!.key)}`);
    const rawAbs = join(voiceDir, res.voice.audio_path);
    const pcm = await readFile(rawAbs); // ElevenLabs pcm_24000: raw 16-bit mono, no header
    narrationRel = join("voice", "narration.wav");
    await writeFile(join(outDir, narrationRel), Buffer.concat([wavHeader(pcm.length, 24000, 1, 16), pcm]));
    await rm(rawAbs, { force: true });
    // Same samples, now a playable WAV. audio_hash stays P3's own value (sha256 over the PCM bytes' base64).
    result = { ...res.voice, audio_path: join(outDir, narrationRel) };
  } else {
    const vb = new VoiceboxProvider({
      profileId: config.profile_id!,
      engine: config.engine,
      clientConfig: config.base_url ? { baseUrl: config.base_url } : undefined,
      client: params.voiceboxClient,
      probe: params.probe ? (p: string) => params.probe!(p) : undefined,
    });
    let res;
    try {
      res = await vb.generate(request);
    } catch (e) {
      return fail("P3_VOICE_REFUSED", (e as Error).message);
    }
    if (res.status !== "SUCCESS" || !res.voice) fail("P3_VOICE_FAILED", `Voicebox ${res.status}: ${res.errorMessage ?? ""}. Voicebox açık mı (npm run doctor)? Türkçe için motor "chatterbox".`);
    if (!(res.voice.duration_s > 0)) fail("P3_VOICE_FAILED", "Voicebox sesinin süresi ölçülemedi (ffprobe gerekli).");
    narrationRel = join("voice", res.voice.audio_path);
    result = { ...res.voice, audio_path: join(voiceDir, res.voice.audio_path) };
  }

  s.voice = {
    at: now(),
    provider,
    config,
    ...(key ? { key_source: key.source } : {}),
    ...(preflight ? { preflight: preflight.checks } : {}),
    material_ambiguity: material,
    listen_check: params.listenCheck ? "PERFORMED" : "NOT_PERFORMED",
    result,
    narration_file: await fileRef(outDir, narrationRel),
  };
  invalidateAfter(s, "voice");
  await saveState(outDir, s);
  const record = { key: cacheKey, voice: s.voice };
  await atomicWrite(cachePath, JSON.stringify({ record, signature: signValue(record) ?? null }, null, 2) + "\n");
  return { provider, narrationPath: join(outDir, narrationRel), durationS: result.duration_s, reused: false };
}

// ================================================================== 6. RENDER + QA (P3.06–P3.09)

export interface P3RenderResult {
  mp4Path: string;
  sha256: string;
  qa: QAReport;
  timingConflicts: TimingResult["conflicts"];
}

export async function p3Render(params: {
  outDir: string;
  productionPackage: unknown;
  /** Remotion seam (P3's own type). Default: the real Remotion render of P3Composition. */
  execRender?: ExecRemotionRender;
  /** Narration mux seam. Default: ffmpeg (-c:v copy, AAC audio). */
  mux?: MuxNarration;
}): Promise<P3RenderResult> {
  const outDir = resolve(params.outDir);
  const { s, pkg } = await open(outDir, params.productionPackage);
  const ingest = need(s, "ingest");
  need(s, "voice_approval");
  const voice = need(s, "voice");
  for (const ref of ingest.staged) await assertFileUnchanged(outDir, ref, "hazırlanan varlık");
  await assertFileUnchanged(outDir, voice.narration_file, "üretim anlatımı");

  const timing = runP306Timing(pkg.shots, voice.result.duration_s);
  const timeline = runP307Timeline(pkg.scenes, timing, ingest.resolved_assets, pkg.shots, FPS);
  const renderDir = join(outDir, "render");
  await mkdir(renderDir, { recursive: true });
  const outputPath = join(renderDir, "master.mp4");
  const videoOnly = join(renderDir, "master.video_only.mp4");
  await rm(outputPath, { force: true });
  await rm(videoOnly, { force: true });
  const inner = params.execRender ?? defaultExecRemotionRender;
  const mux = params.mux ?? ffmpegMuxNarration;
  const narrationAbs = resolve(outDir, voice.narration_file.path);
  const withNarration: ExecRemotionRender = async (p) => {
    await inner({ ...p, outputPath: videoOnly });
    if (!existsSync(videoOnly)) throw new Error("Remotion çıktı dosyası üretmedi");
    await mux({ videoPath: videoOnly, audioPath: narrationAbs, outputPath: p.outputPath });
    return { bytes: (await stat(p.outputPath)).size };
  };

  const render = await runP308Render(
    { projectId: pkg.project_id, targetId: pkg.package_id, outputPath, resolution: RESOLUTION, codec: CODEC, timeline, resolvedAssets: ingest.resolved_assets, stagingDir: join(outDir, "staging") },
    withNarration,
  );
  if (render.result !== "success" || !render.outputs[0]) {
    delete s.render;
    delete s.approve;
    await saveState(outDir, s);
    fail("P3_RENDER_FAILED", `P3.08 render başarısız: ${render.error_details ?? render.result}. Chrome/Remotion ve ffmpeg kurulu mu (npm run doctor)?`);
  }
  await rm(videoOnly, { force: true });

  const qa = runP309QA({
    targetId: pkg.package_id,
    productionPackageId: pkg.package_id,
    productionPackageVersion: pkg.production_package_version,
    productionPackageHash: pkg.integrity_hashes.package_sha256,
    assetRequirements: pkg.asset_requirements,
    resolvedAssets: ingest.resolved_assets,
    assetProbes: ingest.asset_probes,
    timeline,
    render,
    narrationDurationS: voice.result.duration_s,
    manifest: pkg.manifest,
    integrityHashes: pkg.integrity_hashes,
    recomputedPackageSha256: verifyProductionPackageIntegrity(pkg).package_sha256,
  });
  s.render = { at: now(), timing, timeline, render, qa, narration_muxed: true };
  invalidateAfter(s, "render");
  await saveState(outDir, s);
  return { mp4Path: render.outputs[0]!.path, sha256: render.outputs[0]!.sha256, qa, timingConflicts: timing.conflicts };
}

// ================================================================== 7. FINAL APPROVAL (A7) + FINAL DELIVERY

export async function p3Approve(params: {
  outDir: string;
  productionPackage: unknown;
  /** The person who watched render/master.mp4. Required, no default. */
  actor: string;
  notes?: string;
  /** Where to write the Final Delivery Package. Default <outDir>/final_delivery.json. */
  finalOut?: string;
}): Promise<{ finalDeliveryPath: string; finalDelivery: FinalDeliveryPackage; gate: GateApprovalRecord }> {
  const actor = assertHumanAuthority(STAGE, params.actor, "Gate A7 actor");
  const outDir = resolve(params.outDir);
  const { s, pkg } = await open(outDir, params.productionPackage);
  const ingest = need(s, "ingest");
  const preview = need(s, "preview");
  const voice = need(s, "voice");
  const r = need(s, "render");
  if (!["pass", "pass_with_findings"].includes(r.qa.result)) {
    fail("P3_QA_NOT_PASSED", `otomatik QA sonucu "${r.qa.result}": ${r.qa.findings.map((f) => `${f.category}: ${f.message}`).join("; ")}. Sorunu giderip p3-render'ı yeniden çalıştırın.`);
  }
  const out = r.render.outputs[0]!;
  if (!existsSync(out.path)) fail("P3_ARTIFACT_MISSING", `render dosyası yok: ${out.path}`);
  const sha = await fileSha256(out.path);
  if (sha !== out.sha256) fail("P3_ARTIFACT_CHANGED", `izlenecek MP4 render'dan sonra değişmiş (${shortHash(out.sha256)} → ${shortHash(sha)}). p3-render'ı yeniden çalıştırın.`);
  for (const ref of ingest.staged) await assertFileUnchanged(outDir, ref, "hazırlanan varlık");
  await assertFileUnchanged(outDir, voice.narration_file, "üretim anlatımı");

  const history = gatesOf(s);
  let gate_a7: GateApprovalRecord;
  try {
    gate_a7 = approveFinalQA(actor, r.qa, r.render, history);
  } catch (e) {
    return fail("P3_GATE_REFUSED", `Gate A7 kaydedilemedi: ${(e as Error).message}`);
  }
  const at = now();
  // P3.10 (Kaggle archive) is optional and not run by this runner — recorded honestly.
  const kaggle: KaggleDeliveryRecord = { final_video_id: pkg.package_id, kaggle_dataset_id: "NOT_ARCHIVED", created_at: at, files: [], large_asset_pointers: [] };
  const notes = params.notes?.trim();
  const fd = assembleFinalDeliveryPackage({
    pkg,
    resolvedAssets: ingest.resolved_assets,
    narration: { piper_preview: preview.result, production_voice: voice.result },
    timing: r.timing,
    timeline: r.timeline,
    render: r.render,
    qa: r.qa,
    kaggle,
    gates: [...history, gate_a7],
    humanQa: notes ? recordHumanQAFindings({ notes: [`A7 reviewer (${actor}): ${notes}`] }) : null,
  });
  const finalDelivery = JSON.parse(JSON.stringify(fd)) as FinalDeliveryPackage;
  assertNoSecrets(finalDelivery, "$final_delivery");
  const finalDeliveryPath = resolve(params.finalOut ?? join(outDir, "final_delivery.json"));
  await atomicWrite(finalDeliveryPath, JSON.stringify(finalDelivery, null, 2) + "\n");
  s.approve = { at, gate_a7, final_delivery_package_id: fd.final_delivery_package_id, final_delivery_path: finalDeliveryPath, final_delivery_sha256: await fileSha256(finalDeliveryPath) };
  await saveState(outDir, s);
  return { finalDeliveryPath, finalDelivery, gate: gate_a7 };
}

// ================================================================== status

/**
 * A final_delivery.json written by p3-approve is bound to the signed p3_state.json in
 * the same folder. Downstream commands (finish, to-youtube, status) call this so an
 * edited or swapped final delivery (e.g. forged gate records) is refused.
 */
export async function assertFinalDeliveryBound(finalDeliveryPath: string): Promise<void> {
  const dir = resolve(finalDeliveryPath, "..");
  if (!existsSync(statePath(dir))) fail("P3_STATE_REQUIRED", `${statePath(dir)} yok — final_delivery.json, p3-approve'un yazdığı klasörde (döngü klasörü) olmalı.`);
  const s = await loadState(dir);
  if (!s.approve) fail("P3_FINAL_DELIVERY_CHANGED", "p3_state.json'da Gate A7 kaydı yok — p3-approve çalıştırılmamış.");
  const sha = await fileSha256(resolve(finalDeliveryPath));
  if (sha !== s.approve.final_delivery_sha256 || resolve(s.approve.final_delivery_path) !== resolve(finalDeliveryPath)) {
    fail("P3_FINAL_DELIVERY_CHANGED", `final_delivery.json p3-approve'dan sonra değişmiş ya da başka bir yerden kopyalanmış (${shortHash(s.approve.final_delivery_sha256)} → ${shortHash(sha)}). p3-approve'u yeniden çalıştırın.`);
  }
}

export async function p3Status(outDir: string): Promise<{ package_id: string; completed: P3Step[]; gates: string[]; next: string }> {
  const s = await loadState(outDir);
  const completed = P3_STEPS.filter((k) => !!s[k]);
  const gates = gatesOf(s).map((g) => `${g.gate_id}:${g.state_after} (${g.actor})`);
  let next: string;
  if (s.approve) next = `bitti — ${s.approve.final_delivery_path} (sonra: unified finish / to-youtube)`;
  else if (s.render) next = s.render.qa.result === "fail" || s.render.qa.result === "halt" ? "QA geçmedi — sorunu giderip p3-render" : `render/master.mp4'ü izleyin → ${STEP_LABEL.approve}`;
  else if (s.voice) next = STEP_LABEL.render;
  else if (s.ambiguity && !s.ambiguity.gate_a6) next = `${STEP_LABEL.ambiguity} ya da p3-approve-voice (confirmedPronunciations)`;
  else if (s.voice_approval) next = STEP_LABEL.voice;
  else if (s.preview) next = `önizlemeyi dinleyin → ${STEP_LABEL.voice_approval}`;
  else if (s.ingest) next = STEP_LABEL.preview;
  else next = `assets_checklist.md'deki dosyaları assets/ içine koyun → ${STEP_LABEL.ingest}`;
  return { package_id: s.production.package_id, completed, gates, next };
}

/** Turkish, action-oriented hints for the runner's BridgeError codes (for the CLI). */
export const P3_ERROR_HINTS: Record<string, string> = {
  P3_STATE_REQUIRED: "final_delivery.json'u p3-approve'un yazdığı döngü klasöründen verin (yanında p3_state.json olmalı). P3'ü doğrudan kütüphaneyle çalıştırdıysanız --external-p3 ekleyin.",
  P3_FINAL_DELIVERY_CHANGED: "final_delivery.json onaydan sonra değişmiş. p3-approve'u yeniden çalıştırın; dosyayı elle düzenlemeyin.",
  P3_STATE_MISSING: "Bu klasörde P3 durumu yok. Önce plan adımını çalıştırın.",
  P3_STATE_TAMPERED: "p3_state.json elle değiştirilmiş. Düzenlemeyin; ilgili adımı yeniden çalıştırın ya da yeni klasörde plan'dan başlayın.",
  P3_INPUT_CHANGED: "Üretim paketi plan'dan sonra değişmiş. Yeni paket için yeni klasörde plan çalıştırın.",
  P3_STEP_ORDER: "Adımlar sırayla çalışır: plan → ingest → preview → approve-voice → voice → render → approve.",
  P3_PRODUCTION_PACKAGE_REJECTED: "P2 paketi A3 onaysız ya da değişmiş.",
  P3_ASSETS_MISSING: "assets_checklist.md'deki dosya adlarıyla eksik görselleri/videoları assets/ klasörüne koyun.",
  P3_ASSET_WRONG_TYPE: "Görsel beklenen yere video (ya da tersi) konmuş. Doğru türde dosya koyun.",
  P3_ASSET_AMBIGUOUS: "Aynı çekim için birden fazla dosya var; yalnızca birini bırakın.",
  P3_ASSET_INVALID: "Dosya açılamıyor. Google Flow'dan yeniden indirin.",
  P3_ASSET_REJECTED: "P3 varlık eşleştirme/doğrulaması reddetti; mesajdaki dosyayı kontrol edin.",
  P3_UNSUPPORTED_ASSET_TYPE: "P3 yalnızca görsel/video gösterebilir; P2 paketini düzeltin.",
  P3_PREVIEW_FAILED: "Piper modeli (--piper-model) verin ya da gTTS kurun (pip install gTTS).",
  P3_UNKNOWN_PRONUNCIATION_TOKEN: "Yalnızca paketteki telaffuz işaretlerini onaylayabilirsiniz.",
  P3_PROVIDER_NOT_PRODUCTION: "Piper/gTTS yalnızca önizleme; üretim anlatımı ElevenLabs ya da Voicebox.",
  P3_VOICE_CONFIG_MISSING: "p3_input.json'da elevenlabs.voice_id ya da voicebox.profile_id verin.",
  P3_ELEVENLABS_KEY_MISSING: "ELEVENLABS_API_KEY'i ortam değişkeni ya da branches/a/pipeline3_production/.env olarak ekleyin (JSON'a yazmayın).",
  P3_PREFLIGHT_FAILED: "ElevenLabs erişimi/ses/model/kota sorunu. Anahtarı, voice_id'yi ve krediyi kontrol edin.",
  P3_AMBIGUITY_A6_REQUIRED: "Telaffuzu doğru olanları approve-voice'ta onaylayın ya da resolve-ambiguity (A6) verin.",
  P3_NO_AMBIGUITY: "A6 gerektiren bir belirsizlik yok.",
  P3_VOICE_FAILED: "Ses sağlayıcısı başarısız oldu; mesajdaki durumu kontrol edin.",
  P3_VOICE_REFUSED: "Kapı (A5/A6) ya da ses kilidi üretimi durdurdu.",
  P3_RENDER_FAILED: "Remotion/Chrome ya da ffmpeg sorunu (npm run doctor).",
  P3_ARTIFACT_CHANGED: "Kaydedilmiş bir dosya sonradan değişmiş; ilgili adımı yeniden çalıştırın.",
  P3_ARTIFACT_MISSING: "Kaydedilmiş bir dosya silinmiş; ilgili adımı yeniden çalıştırın.",
  P3_QA_NOT_PASSED: "Otomatik QA geçmedi; bulguları giderip render'ı yeniden çalıştırın.",
  P3_GATE_REFUSED: "P3 kapı kaydını reddetti (sıra ya da çift onay).",
  P3_CONFIG_INVALID: "p3_input.json'u docs/examples/p3_input.example.json'a göre düzeltin.",
  P3_PLAN_INVALID: "P2 paketindeki kimlikler dosya adı olarak kullanılamıyor.",
};
