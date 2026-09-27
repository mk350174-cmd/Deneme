// Canonical P3 contracts per docs/architecture/03_PIPELINE_3_ARCHITECTURE.md
// and the corrected implementation plan. Structural types for P2's output
// mirror pipeline2_creative/src/types.ts's REAL fields (verified by reading
// that frozen file directly — see plan §1b) but are NOT imported from it;
// P3 has no runtime dependency on pipeline2_creative.

// --- Structural view of the P2 Production Package handoff ---

export interface ShotCamera {
  angle: string;
  movement: string;
  lens: string;
  framing: string;
}

// P2.08 explicit motion planning (RESERVED FOR GOVERNANCE B — currently not produced by P2)
// Governance A: Motion execution is DEFERRED. This type is structure-only; P2 does not
// currently produce motion_plan data. If P2 motion planning is implemented (Governance B),
// this contract defines the required fields P2 must provide explicitly.
// P3 must NOT invent any of these fields (camera_movement, timing, easing, transitions).
export interface MotionPlan {
  camera_movement: string; // e.g., "slow pan", "push-in", "slide left" (explicit from P2)
  movement_duration_frames: number; // duration of camera movement in frames (explicit from P2, not P3-computed)
  transition_type: string; // e.g., "cut", "dissolve", "fade", "motion_emphasis" (explicit from P2)
  transition_duration_frames: number; // duration of transition effect in frames (explicit from P2)
  easing?: string; // e.g., "linear", "ease_in", "ease_out", "ease_in_out" (explicit from P2, optional)
}

// Read-only input. P3 never writes back to these fields — see
// IMPLEMENTATION INVARIANTS 4/5 (canonical creative data + duration_intention
// are immutable).
export interface Shot {
  shot_id: string;
  scene_id: string;
  purpose: string;
  duration_intention: string; // e.g. "3-4s" — P2's original intent, source of record
  camera: ShotCamera;
  action: string;
  continuity_anchors: string[];
  reference_requirements: string[];
  asset_type: string;
  generation_method: string;
  motion_plan?: MotionPlan; // P2.08 explicit motion planning (if provided)
}

export interface Scene {
  scene_id: string;
  purpose: string;
  shots: string[]; // FK -> Shot.shot_id
  continuity_requirements: string[];
  narrative_function: string;
}

// AssetRequirement.shot_id is the traceability FK confirmed present in P2's
// frozen contract (pipeline2_creative/src/types.ts:209-217) — required,
// never inferred.
export interface AssetRequirement {
  asset_requirement_id: string;
  shot_id: string;
  expected_media_type: string;
  expected_media_properties: Record<string, unknown>;
  generation_method: string;
  reference_lineage: string[];
  required: boolean;
}

export interface PromptSpecification {
  prompt_spec_id: string;
  prompt_family: string;
  traceable_to: { shot_id: string; decision_id: string };
  [field: string]: unknown; // remaining fields are passed through untouched
}

export interface RenderedPromptRecord {
  spec: PromptSpecification;
  rendered: { provider: string; prompt_text: string; rendered_at: string };
}

export interface Decision {
  decision_id: string;
  status: string;
  [field: string]: unknown;
}

export type PronunciationFlagType = "number" | "date" | "unit" | "special_terminology";

export interface PronunciationFlag {
  claim_id?: string;
  token: string;
  flag_type: PronunciationFlagType;
  note: string;
}

export interface ManifestEntry {
  path: string;
  sha256: string;
  purpose: string;
}

export interface IntegrityHashes {
  package_sha256: string;
  per_file: Record<string, string>;
}

export interface GateApprovalRecord {
  gate_id: string;
  state_before: string;
  approval_record_id: string;
  actor: string;
  timestamp: string;
  object_version_being_approved: string;
  state_after: string;
  downstream_operation_unlocked: string;
  // TIER-1 REPAIR T1.4 — approval binds to an immutable artifact.
  object_id?: string;
  object_type?: string;
  object_content_hash?: string;
}

export interface VoiceLine {
  line_id: string;
  claim_id?: string;
  text: string;
}

export interface ProductionPackageHandoffInput {
  package_id: string;
  production_package_version: string;
  // TIER-1 T1.1 — canonical content identity carried from P2.
  identity?: { object_id: string; object_type: string; version: string; content_hash: string; parent_id?: string; parent_content_hash?: string };
  project_id: string;
  research_package_ref: string;
  // TIER-1 T1.2 — the P1 package hash P2 actually verified.
  research_package_content_hash?: string;
  scenes: Scene[];
  shots: Shot[];
  asset_requirements: AssetRequirement[];
  prompts: RenderedPromptRecord[];
  decision_log: Decision[];
  voice_script: string;
  pronunciation_flags: PronunciationFlag[];
  // TIER-2 T2.4 — claim/line voice lineage, additive alongside voice_script.
  voice_lines?: VoiceLine[];
  user_approval_state: GateApprovalRecord[];
  manifest: ManifestEntry[];
  integrity_hashes: IntegrityHashes;
}

// --- Production Delivery (manual asset-creation stage output, separate
// input from the Production Package — architecture: "P3.01 Ingest ...
// Inputs: Production Package, user-created image/video assets") ---

export interface GeneratedAssetFile {
  asset_file_id: string;
  hash: string;
  media_properties: Record<string, unknown>;
}

// The DECLARED IDENTITY relationship (invariant 3) — never inferred from
// filename, order, or timestamp.
export interface AssetDeliveryMapEntry {
  asset_requirement_id: string;
  asset_file_id: string;
}

export interface ProductionDeliveryInput {
  // REQUIRED, non-optional. An empty array is valid (nothing delivered
  // yet); a missing/malformed field is a structural validation failure.
  asset_delivery_map: AssetDeliveryMapEntry[];
  generated_assets: GeneratedAssetFile[];
}

// --- P3.03 Asset Matching result ---

export interface ResolvedAsset {
  asset_requirement_id: string;
  shot_id: string;
  asset_file_id: string;
  hash: string;
  media_properties: Record<string, unknown>;
}

// --- P3.06 Timing — intended/allocated/actual kept as distinct fields,
// never merged (correction 3) ---

export interface ShotTiming {
  shot_id: string;
  intended_duration_s: number; // parsed read-only from Shot.duration_intention
  allocated_duration_s: number; // P3-calculated, scaled to actual narration
}

export interface TimingConflict {
  shot_id?: string; // absent = whole-package conflict
  intended_duration_s: number;
  actual_duration_s: number;
  deviation_pct: number;
  note: string;
}

export interface TimingResult {
  actual_narration_duration_s: number;
  intended_total_duration_s: number;
  shot_timings: ShotTiming[];
  conflicts: TimingConflict[];
}

// --- P3.07 Timeline ---

// P3-A: Motion metadata for execution coordination
export interface MotionMetadata {
  camera_movement: string; // "static" | "pan" | "zoom" | "slide" | "crane" or custom
  movement_duration_frames: number; // how long the camera movement takes
  transition_type: string; // "cut" | "dissolve" | "fade" | "wipe" | "motion_emphasis"
  transition_duration_frames: number; // frames for transition effect
  easing?: string; // "linear" | "ease_in" | "ease_out" | "ease_in_out"
}

export interface TimelineEntry {
  shot_id: string;
  asset_file_id: string;
  start_frame: number;
  duration_frames: number;
  motion?: MotionMetadata; // P3-A: optional motion metadata (if provided by P3.07)
}

export interface Timeline {
  fps: number;
  total_frames: number;
  entries: TimelineEntry[];
}

// --- P3.08 Render (ADAPT of Studio's render_manifest.schema.json) ---

export interface RenderOutput {
  path: string;
  sha256: string;
  bytes: number;
}

export interface RenderManifest {
  // TIER-1 T1.8/T1.9 — what was actually rendered, and by which code.
  render_bundle_hash?: string;
  code_version?: CodeVersion;
  run_id: string;
  scope: "scene" | "master";
  target_id: string;
  fps: number;
  resolution: string;
  codec: string;
  outputs: RenderOutput[];
  result: "success" | "failed" | "partial";
  error_details?: string;
}

// --- P3.09 QA (ADAPT of Studio's qa_report.schema.json, minus its
// subjective axis-score rubric — automated/technical only) ---

export type QAFindingCategory =
  | "missing_asset"
  | "wrong_asset"
  | "hash_mismatch"
  | "decode_error"
  | "codec"
  | "fps"
  | "dimensions"
  | "audio_presence"
  | "av_sync"
  | "duration"
  | "caption_timing"
  | "black_frame"
  | "render_integrity"
  | "package_integrity";

export interface QAFinding {
  category: QAFindingCategory;
  severity: "info" | "warning" | "error";
  message: string;
  object_id?: string;
}

export interface QAReport {
  report_id: string;
  scope: "artifact" | "shot" | "scene" | "master";
  target_id: string;
  result: "pass" | "pass_with_findings" | "retry" | "fail" | "halt";
  findings: QAFinding[];
  human_review_required: boolean;
  // TIER-1 REPAIR T1.12 — a QA report must identify the EXACT artifact it
  // describes. Previously report_id was hash(scope, target_id) only, so a
  // report said nothing about which render or which package version it
  // examined, and Gate A7 approved by report_id alone.
  production_package_id: string;
  production_package_version: string;
  production_package_hash: string;
  render_run_id: string;
  /** sha256 of the render's primary output file. */
  render_output_sha256: string;
}

// Human QA is recorded separately and can never itself set an "approved"
// state — only Gate A7 (gates.ts) can.
export interface HumanQAFindings {
  narrative_quality?: string;
  continuity?: string;
  aesthetics?: string;
  emotion?: string;
  notes: string[];
}

// --- P3.04/P3.05 Narration ---

export interface PiperPreviewResult {
  output_path: string;
  measured_duration_s: number;
  target_duration_s: number;
  deviation_pct: number;
  flagged: boolean; // |deviation_pct| >= 15
}

// P3-C: gTTS fallback preview result (Tier 2 fallback if Piper unavailable)
export interface GttsPreviewResult {
  output_path: string;
  measured_duration_s: number;
  target_duration_s: number;
  deviation_pct: number;
  flagged: boolean; // |deviation_pct| >= 15
  provider: "gtts";
  language: string;
}

// P3-C: Voice provider result — either Piper or gTTS (never auto-escalate to ElevenLabs)
export type VoicePreviewResult = PiperPreviewResult | GttsPreviewResult;

export interface ProductionVoiceResult {
  audio_path: string;
  audio_hash: string;
  duration_s: number; // the actual narration duration — feeds P3.06 Timing as the master clock
  character_count: number;
  cost_units: number;
  listen_check_word_ratio: number;
  listen_check_attempts: number;
  // R03/R04 REPAIR — provider routing metadata. All optional so
  // ElevenLabs's existing construction (elevenlabs.ts::generateProductionVoice,
  // unmodified) keeps returning a valid ProductionVoiceResult without
  // setting any of these; the provider abstraction (voiceProvider.ts)
  // populates them for every result it returns, from either provider.
  // Reused here rather than inventing a second, competing audio-result type
  // (per the repair mandate: "Reuse existing P3 artifact models where
  // possible. Do not create duplicate competing audio models.").
  provider?: "elevenlabs" | "voicebox";
  profile_id?: string;
  generation_id?: string;
  engine?: string;
  text_hash?: string;
  source_mode?: "REAL" | "FIXTURE";
}

export interface NarrationRecord {
  // Field name kept as piper_preview for backward compatibility with
  // existing consumers (manifest.ts hashes NarrationRecord generically, so
  // no consumer depends on this being Piper-only) — but the value is
  // whichever tier actually produced the preview: Piper (Tier 1) normally,
  // or the real gTTS fallback result (Tier 2) when Piper failed. Check
  // `"provider" in piper_preview && piper_preview.provider === "gtts"` to
  // tell them apart (see runP304VoicePreviewWithFallback in pipeline.ts).
  piper_preview: VoicePreviewResult;
  production_voice: ProductionVoiceResult;
}

// --- P3.10 Kaggle ---

export interface LargeAssetPointer {
  asset_file_id: string;
  kaggle_dataset: string;
  kaggle_filename: string;
}

export interface KaggleDeliveryRecord {
  final_video_id: string;
  kaggle_dataset_id: string;
  created_at: string;
  files: string[];
  large_asset_pointers: LargeAssetPointer[];
}

// --- Cost governance ---

export interface CostLedgerEntry {
  ts: string;
  provider: "piper" | "gtts" | "elevenlabs" | "remotion" | "kaggle";
  operation: string;
  units: number;
  unit_cost: number;
  cost: number;
  accepted: boolean;
}

// --- Checkpoint / stage cache ---

export interface CacheEntry<T> {
  fingerprint: string;
  result: T;
  result_hash: string;
}

// --- Final Delivery Package ---

export interface FinalDeliveryPackage {
  final_delivery_package_id: string;
  production_package_ref: string;
  resolved_assets: ResolvedAsset[];
  narration: NarrationRecord;
  timing: TimingResult;
  timeline: Timeline;
  render: RenderManifest;
  qa: QAReport;
  human_qa: HumanQAFindings | null;
  gates: GateApprovalRecord[];
  kaggle: KaggleDeliveryRecord;
  manifest: ManifestEntry[];
  integrity_hashes: IntegrityHashes;
}

// --- P3.08-DIST Distributed Render Orchestration ---
// NOT phase P3.09 (canonical Automated QA, qa.ts) — see the naming note in
// orchestration_p309.ts. Despite the "p309" fragment left over from an
// earlier numbering scheme, these types belong to the distributed-render
// variant of P3.08 Render, not to QA.

export interface ShardSpecification {
  shard_id: string;
  frame_range: { start: number; end: number };
  entry_indices: number[];
  estimated_frames: number;
  asset_file_ids: string[];
  // TIER-2 REPAIR T2.5 — shard identity must cover every input that
  // materially affects the rendered result, not just the frame range.
  render_bundle_hash?: string;
}

// --- TIER-1 REPAIR T1.8 — immutable render bundle ---
//
// The distributed path used to send `timeline_json: JSON.stringify({})` to
// every Kaggle worker, and the remote kernel then rendered whatever the
// repository's default composition happened to be. The approved timeline,
// the resolved asset mapping and the render configuration never left the
// local process, so the distributed render did NOT consume the approved
// canonical input at all.
//
// A RenderBundle is the single immutable object both the local and the
// distributed paths render from. Its bundle_hash covers everything inside
// it, so "which inputs produced this frame range" is answerable after the
// fact.
export interface RenderBundleAssetEntry {
  asset_requirement_id: string;
  asset_file_id: string;
  /** sha256 of the asset's actual bytes (T1.2). */
  content_hash: string;
  media_type?: string;
}

export interface RenderConfiguration {
  resolution: string;
  codec: string;
  fps: number;
}

export interface RenderBundle {
  bundle_id: string;
  bundle_hash: string;
  timeline: Timeline;
  asset_manifest: RenderBundleAssetEntry[];
  render_config: RenderConfiguration;
  /** The Production Package manifest this render is derived from. */
  package_manifest: ManifestEntry[];
  production_package_id: string;
  production_package_hash: string;
  /** TIER-1 REPAIR T1.9 — the exact, immutable code version used. */
  code_version: CodeVersion;
}

/**
 * TIER-1 REPAIR T1.9 — production code pinning.
 *
 * The Kaggle kernel used to `git clone <repo>` then `git pull`, resolving
 * whatever HEAD happened to be at execution time. An approved package could
 * therefore be rendered by code that did not exist when it was approved.
 * A render must name an immutable code version.
 */
export interface CodeVersion {
  kind: "git_commit" | "release_digest";
  /** 40-hex commit SHA, or an immutable release/artifact digest. */
  value: string;
  repo_url?: string;
}

export type WorkerType = "local_cpu" | "local_gpu" | "kaggle_cpu_2core" | "kaggle_cpu_4core" | "kaggle_gpu_t4";

export interface WorkerCapabilityProfile {
  worker_type: WorkerType;
  estimated_fps: number;
  memory_gb: number;
  session_timeout_hours: number;
  cost_per_hour_units: number;
  available: boolean;
}

export interface ShardAssignment {
  shard_id: string;
  assigned_worker: WorkerType;
  estimated_duration_s: number;
  cost_estimate_units: number;
  priority: number;
  retry_count: number;
}

export interface ShardRenderOutput {
  shard_id: string;
  frame_range: { start: number; end: number };
  video_file_path: string;
  sha256: string;
  bytes: number;
  duration_s: number;
}

export interface ContinuityValidation {
  valid: boolean;
  gap_frames?: number[];
  overlap_frames?: number[];
  message?: string;
}

export interface PreviewArtifact {
  preview_id: string;
  output_path: string;
  resolution: string;
  fps: number;
  // R02.6 REPAIR — was a required `number`, permanently faked to 0
  // ("would probe from video metadata in production"). Genuinely
  // unavailable metadata is now represented as `null`, never as a
  // plausible-looking fake measurement a caller could mistake for real
  // data.
  duration_s: number | null;
  bytes: number;
}

export interface HumanQAFeedback {
  feedback_id: string;
  preview_id: string;
  narrative_quality: "excellent" | "good" | "poor" | "unreviewed";
  continuity_issues: string[];
  aesthetic_issues: string[];
  technical_issues: string[];
  specific_shot_ids: string[];
  timestamp_markers: Array<{ frame: number; note: string }>;
  recommendation: "approve" | "request_reshard" | "request_remix" | "escalate";
}
