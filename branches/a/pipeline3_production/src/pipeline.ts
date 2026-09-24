// P3 orchestration — ORCHESTRATION ONLY (correction 10). This module
// sequences calls into the capability modules and assembles the Final
// Delivery Package; it does not implement validation, timing math,
// provider-call logic, or error classification itself — that all lives in
// the named capability module (ingest.ts, assetMatching.ts, piper.ts,
// elevenlabs.ts, timing.ts, timeline.ts, render.ts, qa.ts, kaggle.ts, ...).

import { resolveAllAssetRequirements } from "./assetMatching.js";
import { defaultFfprobeMediaProbe, validateAssetDecodability, validateAssetHashAgainstBytes } from "./assetValidation.js";
import type { ReadAssetBytes } from "./assetValidation.js";
import type { MediaProbe } from "./assetValidation.js";
import { StageCache } from "./checkpoint.js";
import { CostLedger } from "./costLedger.js";
import { defaultExecPiperSubprocess, runPiperPreview } from "./piper.js";
import type { ExecPiperSubprocess } from "./piper.js";
import { defaultExecGttsSubprocess, runGttsPreview } from "./gtts.js";
import type { ExecGttsSubprocess } from "./gtts.js";
import { defaultPostElevenLabsHttp, generateProductionVoice } from "./elevenlabs.js";
import type { PostElevenLabsHttp, VoiceLock } from "./elevenlabs.js";
import { P3Error } from "./errors.js";
import { recordGateApproval, requireGateState } from "./gates.js";
import { stableFingerprint, stableFinalDeliveryPackageId } from "./ids.js";
import { buildManifestAndIntegrity } from "./manifest.js";
import type { AssetProbeRecord } from "./qa.js";
import { recordHumanQAFindings, runAutomatedQA } from "./qa.js";
import { computeTiming } from "./timing.js";
import { buildTimeline } from "./timeline.js";
import { renderTimeline } from "./render.js";
import type { ExecRemotionRender } from "./render.js";
import { createKaggleDatasetForVideo, defaultExecKaggleCli } from "./kaggle.js";
import type { ExecKaggleCli } from "./kaggle.js";
import type { StageAssetFile, WriteStagingFile } from "./assetStaging.js";
import { defaultStageAssetFile, defaultWriteStagingFile } from "./assetStaging.js";
import type {
  AssetRequirement,
  FinalDeliveryPackage,
  GateApprovalRecord,
  GeneratedAssetFile,
  GttsPreviewResult,
  HumanQAFeedback,
  HumanQAFindings,
  IntegrityHashes,
  KaggleDeliveryRecord,
  LargeAssetPointer,
  ManifestEntry,
  NarrationRecord,
  PiperPreviewResult,
  ProductionDeliveryInput,
  ProductionPackageHandoffInput,
  ProductionVoiceResult,
  QAReport,
  RenderManifest,
  ResolvedAsset,
  Scene,
  Shot,
  Timeline,
  TimingResult,
  VoicePreviewResult,
} from "./types.js";

const GATE_A4 = "A4";
const GATE_A6 = "A6";
const GATE_A7 = "A7";

// --- Gate A4: manual asset creation / Production Delivery received ---

export function approveDeliveryReceived(actor: string, deliveryPackageId: string): GateApprovalRecord {
  return recordGateApproval({
    gateId: GATE_A4,
    stateBefore: "AWAITING_PRODUCTION_DELIVERY",
    actor,
    objectVersionBeingApproved: deliveryPackageId,
    stateAfter: "PRODUCTION_DELIVERY_RECEIVED",
    downstreamOperationUnlocked: "P3.02 Asset Validation / P3.03 Asset Matching",
  });
}

// P3.01-P3.03: ingest + validate + match. Requires Gate A4.
export function runIngestValidateMatch(
  pkg: ProductionPackageHandoffInput,
  delivery: ProductionDeliveryInput,
  gates: GateApprovalRecord[],
): ResolvedAsset[] {
  requireGateState(gates, GATE_A4, "PRODUCTION_DELIVERY_RECEIVED");
  return resolveAllAssetRequirements(pkg.asset_requirements, delivery.asset_delivery_map, delivery.generated_assets);
}

// AUDIT FIX (forensic integration audit, §13 item 2): validateAssetDecodability
// (assetValidation.ts) was defined but never invoked by any orchestration
// path, so the probe-based QA findings (decode_error/codec/fps/dimensions/
// audio_presence) could never fire. This wires it in: probes each resolved
// asset's actual file and produces the AssetProbeRecord[] that qa.ts's
// runAutomatedQA now requires. Fails loud (throws P3Error) on the first
// undecodable asset, per validateAssetDecodability itself.
export async function runP302AssetValidation(
  resolvedAssets: ResolvedAsset[],
  generatedFiles: GeneratedAssetFile[],
  probe: MediaProbe = defaultFfprobeMediaProbe,
  // TIER-1 REPAIR T1.2 — real byte-hash verification. Optional stagingDir
  // preserves the function's existing zero-filesystem-argument callers
  // (assetMatching's Stage 3 already checked hash SHAPE at match time); when
  // supplied, every resolved asset's declared hash is now recomputed against
  // its actual staged bytes, not merely shape-checked.
  stagingDir?: string,
  readBytes?: ReadAssetBytes,
): Promise<AssetProbeRecord[]> {
  const records: AssetProbeRecord[] = [];
  for (const asset of resolvedAssets) {
    const file = generatedFiles.find((f) => f.asset_file_id === asset.asset_file_id);
    if (!file) continue; // already caught by asset matching — nothing to probe
    if (stagingDir) {
      await validateAssetHashAgainstBytes(file, stagingDir, readBytes);
    }
    const probeResult = await validateAssetDecodability(file, probe);
    records.push({ asset_requirement_id: asset.asset_requirement_id, shot_id: asset.shot_id, probe: probeResult });
  }
  return records;
}

// AUDIT FIX (P3 final closure pass, §13.4): StageCache/checkpoint.ts was
// defined but never wired into the real orchestration flow — Piper preview
// and ElevenLabs production voice were always called directly, with no
// resume-cheap behavior. These wrappers add a real cache check in front of
// each costed stage. A cache hit skips ONLY the provider I/O call and the
// charge — never gate enforcement (correction 1): Gate A5/A6 checks inside
// generateProductionVoice run unconditionally, before the cache is even
// consulted, so a pre-warmed cache can never be used to bypass a human
// approval gate.

function isPiperPreviewResult(v: unknown): v is PiperPreviewResult {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.output_path === "string" &&
    typeof r.measured_duration_s === "number" &&
    typeof r.target_duration_s === "number" &&
    typeof r.deviation_pct === "number" &&
    typeof r.flagged === "boolean"
  );
}

function isGttsPreviewResult(v: unknown): v is GttsPreviewResult {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return isPiperPreviewResult(v) && r.provider === "gtts";
}

function isProductionVoiceResult(v: unknown): v is ProductionVoiceResult {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.audio_path === "string" &&
    typeof r.audio_hash === "string" &&
    typeof r.duration_s === "number" &&
    typeof r.character_count === "number" &&
    typeof r.cost_units === "number" &&
    typeof r.listen_check_word_ratio === "number" &&
    typeof r.listen_check_attempts === "number"
  );
}

// P3.04, cached. `outputPath` is included in the fingerprint deliberately:
// a re-run targeting a different output path with otherwise-identical
// inputs must not return a stale output_path pointing at the wrong file.
export async function runP304PiperPreview(
  params: { text: string; outputPath: string; modelPath: string; targetDurationS: number },
  cache: StageCache,
  costLedger: CostLedger,
  execPiper: ExecPiperSubprocess = defaultExecPiperSubprocess,
): Promise<PiperPreviewResult> {
  const fingerprint = stableFingerprint({
    stage: "P3.04_piper_preview",
    text: params.text,
    modelPath: params.modelPath,
    targetDurationS: params.targetDurationS,
    outputPath: params.outputPath,
  });

  const cached = cache.getValid(fingerprint, isPiperPreviewResult);
  if (cached) return cached;

  const result = await runPiperPreview(params, execPiper);
  costLedger.log({ provider: "piper", operation: "P3.04_piper_preview", units: result.measured_duration_s, unit_cost: 0, cost: 0, accepted: true });
  cache.put(fingerprint, result);
  return result;
}

// P3.04 Tier 2, cached — same shape as runP304PiperPreview, gTTS instead of
// Piper. Not called directly by production code; only reached through
// runP304VoicePreviewWithFallback below, after Piper has already failed.
export async function runP304GttsFallbackPreview(
  params: { text: string; outputPath: string; language: string; targetDurationS: number },
  cache: StageCache,
  costLedger: CostLedger,
  execGtts: ExecGttsSubprocess = defaultExecGttsSubprocess,
): Promise<GttsPreviewResult> {
  const fingerprint = stableFingerprint({
    stage: "P3.04_gtts_fallback_preview",
    text: params.text,
    language: params.language,
    targetDurationS: params.targetDurationS,
    outputPath: params.outputPath,
  });

  const cached = cache.getValid(fingerprint, isGttsPreviewResult);
  if (cached) return cached;

  const result = await runGttsPreview(params, execGtts);
  costLedger.log({ provider: "gtts", operation: "P3.04_gtts_fallback_preview", units: result.measured_duration_s, unit_cost: 0, cost: 0, accepted: true });
  cache.put(fingerprint, result);
  return result;
}

// P3.04 real production path — the ONLY tiered voice-preview policy this
// pipeline implements (see docs/VOICE_PROVIDER_POLICY.md):
//   Tier 1: Piper (local, free) — tried first, always.
//   Tier 2: gTTS (online, free) — tried ONLY if Piper throws.
//   Both fail: this function throws, listing both providers' errors.
//   There is NO automatic Tier-3 escalation to ElevenLabs anywhere in this
//   function or anywhere else in this codebase — ElevenLabs production
//   voice is a separate, explicit call (runP305ElevenLabsProductionVoice)
//   that only runs after a human approves Gate A5 on WHATEVER preview this
//   function returned (Piper's or gTTS's).
export async function runP304VoicePreviewWithFallback(
  params: { text: string; piperOutputPath: string; gttsOutputPath: string; modelPath: string; language: string; targetDurationS: number },
  cache: StageCache,
  costLedger: CostLedger,
  execPiper: ExecPiperSubprocess = defaultExecPiperSubprocess,
  execGtts: ExecGttsSubprocess = defaultExecGttsSubprocess,
): Promise<VoicePreviewResult> {
  try {
    return await runP304PiperPreview(
      { text: params.text, outputPath: params.piperOutputPath, modelPath: params.modelPath, targetDurationS: params.targetDurationS },
      cache,
      costLedger,
      execPiper,
    );
  } catch (piperError) {
    try {
      return await runP304GttsFallbackPreview(
        { text: params.text, outputPath: params.gttsOutputPath, language: params.language, targetDurationS: params.targetDurationS },
        cache,
        costLedger,
        execGtts,
      );
    } catch (gttsError) {
      const piperMsg = piperError instanceof Error ? piperError.message : String(piperError);
      const gttsMsg = gttsError instanceof Error ? gttsError.message : String(gttsError);
      throw new Error(
        `P3.04 voice preview failed on both tiers — Piper: ${piperMsg} | gTTS: ${gttsMsg}. ` +
          `No automatic ElevenLabs fallback (see docs/VOICE_PROVIDER_POLICY.md); resolve one of the two ` +
          `free-tier providers before proceeding.`,
      );
    }
  }
}

// P3.05, cached. Gate A5 (and A6, when material ambiguity was flagged) are
// enforced INSIDE generateProductionVoice itself, unconditionally, before
// this function ever consults the cache — see the module comment above.
// gates/voiceLock are deliberately excluded from the fingerprint: gate
// records carry timestamps that would defeat caching and are enforced
// separately; voiceLock is static config re-checked on every real miss.
export async function runP305ElevenLabsProductionVoice(
  params: {
    text: string;
    voiceId: string;
    modelId: string;
    apiKey: string;
    voiceLock: VoiceLock;
    gates: GateApprovalRecord[];
    listenCheck: (audio: Buffer, sourceText: string) => Promise<{ ratio: number; attempts: number }>;
    materialAmbiguityDetected?: boolean;
  },
  cache: StageCache,
  costLedger: CostLedger,
  postHttp: PostElevenLabsHttp = defaultPostElevenLabsHttp,
): Promise<ProductionVoiceResult> {
  // Gate check(s) duplicated here — the SAME calls generateProductionVoice
  // makes internally — run first, unconditionally, BEFORE the cache is even
  // consulted. This is what makes "a cache hit never bypasses a gate" true:
  // without this, a pre-warmed cache entry could return a result without
  // ever re-proving Gate A5/A6 for THIS call. Redundant with the check
  // inside generateProductionVoice on a real miss — that redundancy is
  // intentional defense-in-depth, the same pattern kaggle.ts already uses.
  requireGateState(params.gates, "A5", "NARRATION_APPROVED_FOR_PRODUCTION");
  if (params.materialAmbiguityDetected) {
    requireGateState(params.gates, "A6", "AMBIGUITY_RESOLVED");
  }

  const fingerprint = stableFingerprint({
    stage: "P3.05_elevenlabs_production_voice",
    text: params.text,
    voiceId: params.voiceId,
    modelId: params.modelId,
  });

  const cached = cache.getValid(fingerprint, isProductionVoiceResult);
  if (cached) return cached;

  const result = await generateProductionVoice(params, postHttp);
  costLedger.log({ provider: "elevenlabs", operation: "P3.05_elevenlabs_production_voice", units: result.cost_units, unit_cost: 1, cost: result.cost_units, accepted: true });
  cache.put(fingerprint, result);
  return result;
}

// --- P3.06 Timing: Narration is master clock ---

export function runP306Timing(shots: readonly Shot[], actualNarrationDurationS: number): TimingResult {
  return computeTiming(shots, actualNarrationDurationS);
}

// --- P3.07 Timeline: Build ordered timed entries ---

export function runP307Timeline(
  scenes: readonly Scene[],
  timing: TimingResult,
  resolvedAssets: readonly ResolvedAsset[],
  shots?: readonly Shot[],
  // R02.1 — real fps, threaded through from the canonical render
  // configuration rather than defaulting silently inside buildTimeline.
  fps?: number,
): Timeline {
  return buildTimeline(scenes, timing, resolvedAssets, shots, fps);
}

// --- P3.08 Render: Remotion video composition ---

export async function runP308Render(
  params: {
    projectId: string;
    targetId: string;
    outputPath: string;
    resolution: string;
    codec: string;
    timeline: Timeline;
    resolvedAssets: ResolvedAsset[];
    stagingDir: string;
  },
  execRender: ExecRemotionRender,
): Promise<RenderManifest> {
  return renderTimeline(params, execRender);
}

// --- P3.09 QA: Automated quality assurance ---

export function runP309QA(params: {
  targetId: string;
  // T1.12 — QA binds to the exact package version and render.
  productionPackageId: string;
  productionPackageVersion: string;
  productionPackageHash: string;
  assetRequirements: AssetRequirement[];
  resolvedAssets: ResolvedAsset[];
  assetProbes: AssetProbeRecord[];
  timeline: Timeline;
  render: RenderManifest;
  narrationDurationS: number;
  manifest: ManifestEntry[];
  integrityHashes: IntegrityHashes;
  recomputedPackageSha256: string;
}): QAReport {
  return runAutomatedQA(params);
}

// --- P3.10 Kaggle: Delivery to Kaggle dataset ---

export async function runP310Kaggle(
  params: {
    finalVideoId: string;
    files: string[];
    existingDeliveryRecords: KaggleDeliveryRecord[];
    gates: GateApprovalRecord[];
    largeAssetPointers?: LargeAssetPointer[];
    stagingDir?: string;
  },
  execKaggle: ExecKaggleCli = defaultExecKaggleCli,
  stageAssetFile: StageAssetFile = defaultStageAssetFile,
  writeStagingFile: WriteStagingFile = defaultWriteStagingFile,
): Promise<KaggleDeliveryRecord> {
  return createKaggleDatasetForVideo(params, execKaggle, stageAssetFile, writeStagingFile);
}

// --- Gate A6: ElevenLabs preflight ambiguity resolution ---

// TIER-1 REPAIR T1.3: AMBIGUITY_RESOLVED requires Gate A5's
// NARRATION_APPROVED_FOR_PRODUCTION to already be on record — ambiguity
// resolution is meaningless before the narration it concerns was approved.
// `history` defaults to [] for callers not yet passing it explicitly, but
// the transition then correctly fails as out-of-order.
export function approveAmbiguityResolution(
  actor: string,
  preflightObjectVersion: string,
  history: GateApprovalRecord[] = [],
): GateApprovalRecord {
  return recordGateApproval({
    gateId: GATE_A6,
    stateBefore: "MATERIAL_AMBIGUITY_DETECTED",
    actor,
    objectVersionBeingApproved: preflightObjectVersion,
    stateAfter: "AMBIGUITY_RESOLVED",
    downstreamOperationUnlocked: "P3.05 ElevenLabs production voice call may proceed",
    history,
  });
}

// --- Gate A7: final human creative QA ---

/**
 * TIER-1 REPAIR T1.12 — final approval must verify the QA result AND that
 * the QA report describes the exact artifact being approved.
 *
 * PROBLEM: approveFinalQA(actor, qaReportId) took a bare string. It never
 * checked that QA had passed, and it never checked that the report belonged
 * to the render being delivered — the brief's "do not approve by arbitrary
 * qa_report_id alone".
 *
 * The signature now takes the QAReport and the RenderManifest, and refuses
 * to record an approval when either check fails.
 */
export function approveFinalQA(
  actor: string,
  qa: QAReport,
  render: RenderManifest,
  history: GateApprovalRecord[] = [],
): GateApprovalRecord {
  if (qa.result !== "pass" && qa.result !== "pass_with_findings") {
    throw new P3Error({
      code: "USER_ACTION_REQUIRED",
      field: "qa.result",
      object_id: qa.report_id,
      reason: `cannot approve final delivery: automated QA result is "${qa.result}" (T1.12)`,
    });
  }
  if (qa.render_run_id !== render.run_id) {
    throw new P3Error({
      code: "USER_ACTION_REQUIRED",
      field: "qa.render_run_id",
      object_id: qa.report_id,
      reason:
        `QA report describes render "${qa.render_run_id}" but the artifact being approved is ` +
        `render "${render.run_id}" — approval would be bound to the wrong artifact (T1.12)`,
    });
  }
  const actualOutputHash = render.outputs[0]?.sha256 ?? "";
  if (qa.render_output_sha256 !== actualOutputHash) {
    throw new P3Error({
      code: "USER_ACTION_REQUIRED",
      field: "qa.render_output_sha256",
      object_id: qa.report_id,
      reason:
        `QA report was produced against output hash "${qa.render_output_sha256}" but the render ` +
        `output now hashes to "${actualOutputHash}" — the artifact changed after QA (T1.12)`,
    });
  }
  if (render.result !== "success") {
    throw new P3Error({
      code: "USER_ACTION_REQUIRED",
      field: "render.result",
      object_id: render.run_id,
      reason: `cannot approve a render whose result is "${render.result}" (T1.10/T1.12)`,
    });
  }

  return recordGateApproval({
    gateId: GATE_A7,
    stateBefore: "AUTOMATED_QA_COMPLETE",
    actor,
    objectVersionBeingApproved: qa.report_id,
    stateAfter: "FINAL_QA_APPROVED",
    downstreamOperationUnlocked: "P3.10 Kaggle Delivery",
    objectId: qa.report_id,
    objectType: "qa_report",
    objectContent: qa,
    history,
  });
}

// --- Final Delivery Package assembly ---

// R02.3 REPAIR — human QA representation.
//
// PROBLEM: `FinalDeliveryPackage.human_qa` is typed `HumanQAFindings |
// null`, but `phase5QA` (orchestration_p309.ts) collects human review
// input as a DIFFERENT, unrelated type — `HumanQAFeedback` — routes it
// through `routeFeedback`/`shouldReRender`/`shouldEscalate`, and then
// discards it. `assembleFinalDeliveryPackage` hardcoded `human_qa: null`
// unconditionally, so even when a human reviewer submitted real findings,
// they never reached the final package. Nothing ever bridged the two
// types.
//
// REPAIR: an explicit mapping from the actually-collected
// `HumanQAFeedback` to the final package's `HumanQAFindings` shape. When no
// human review was collected (the fully-automated path, or a delivery
// where human review was never solicited), `human_qa: null` remains a
// legitimate, honestly-null value — it is no longer an unconditional
// discard of real findings.
export function mapHumanQaFeedbackToFindings(feedback: HumanQAFeedback): HumanQAFindings {
  return {
    narrative_quality: feedback.narrative_quality !== "unreviewed" ? feedback.narrative_quality : undefined,
    continuity: feedback.continuity_issues.length > 0 ? feedback.continuity_issues.join("; ") : undefined,
    aesthetics: feedback.aesthetic_issues.length > 0 ? feedback.aesthetic_issues.join("; ") : undefined,
    notes: [
      ...feedback.technical_issues,
      ...feedback.timestamp_markers.map((m) => `[frame ${m.frame}] ${m.note}`),
      `recommendation: ${feedback.recommendation}`,
      ...(feedback.specific_shot_ids.length > 0 ? [`shots flagged: ${feedback.specific_shot_ids.join(", ")}`] : []),
    ],
  };
}

export function assembleFinalDeliveryPackage(params: {
  pkg: ProductionPackageHandoffInput;
  resolvedAssets: ResolvedAsset[];
  narration: NarrationRecord;
  timing: TimingResult;
  timeline: Timeline;
  render: RenderManifest;
  qa: QAReport;
  kaggle: KaggleDeliveryRecord;
  gates: GateApprovalRecord[];
  // R02.3 — real human QA findings when a human reviewed the render.
  //
  // Two independent human-review surfaces exist in A-Branch and BOTH were
  // previously dead ends into this function:
  //   * the linear P3.01->P3.10 path's own recordHumanQAFindings() (qa.ts)
  //     — imported here but never called anywhere;
  //   * the distributed P3.08-DIST path's phase5QA(), which collects a
  //     HumanQAFeedback and routes/logs it but never forwards it anywhere.
  // `humanQa` accepts the former's output directly (identical shape, no
  // mapping needed). `humanQaFeedback` accepts the latter and is mapped via
  // mapHumanQaFeedbackToFindings(). A package that genuinely had no human
  // review at all passes neither and gets an honest `human_qa: null`,
  // distinguishable from "findings existed but were discarded."
  humanQa?: HumanQAFindings | null;
  humanQaFeedback?: HumanQAFeedback | null;
}): FinalDeliveryPackage {
  // R02.2 REPAIR — Final Delivery A7 invariant.
  //
  // PROBLEM: this function assembled and returned a FinalDeliveryPackage
  // unconditionally — it never checked that Gate A7 (FINAL_QA_APPROVED)
  // was actually present in `params.gates`. A caller could construct a
  // "final" artifact with an empty gates array, or with A7 still pending,
  // and nothing here would refuse it. A FinalDeliveryPackage produced this
  // way is misleading: it looks final and approved but never received the
  // one approval that makes final delivery legitimate.
  //
  // REPAIR: require A7's FINAL_QA_APPROVED to already be on record before
  // assembling. No redundant approval system is introduced — this reuses
  // the same GateApprovalRecord history and the same requireGateState
  // mechanism as every other gate check in A-Branch.
  requireGateState(params.gates, "A7", "FINAL_QA_APPROVED");

  const human_qa: HumanQAFindings | null =
    params.humanQa ?? (params.humanQaFeedback ? mapHumanQaFeedbackToFindings(params.humanQaFeedback) : null);

  const { manifest, integrity_hashes } = buildManifestAndIntegrity({
    resolved_assets: params.resolvedAssets,
    narration: params.narration,
    timing: params.timing,
    timeline: params.timeline,
    render: params.render,
    qa: params.qa,
    kaggle: params.kaggle,
  });

  const final_delivery_package_id = stableFinalDeliveryPackageId(params.pkg.project_id, params.pkg.package_id, params.render.run_id);

  return {
    final_delivery_package_id,
    production_package_ref: params.pkg.package_id,
    resolved_assets: params.resolvedAssets,
    narration: params.narration,
    timing: params.timing,
    timeline: params.timeline,
    render: params.render,
    qa: params.qa,
    human_qa,
    gates: params.gates,
    kaggle: params.kaggle,
    manifest,
    integrity_hashes,
  };
}
