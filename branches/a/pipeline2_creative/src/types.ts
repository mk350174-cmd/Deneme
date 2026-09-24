// Canonical P2 contracts per docs/architecture/02_PIPELINE_2_ARCHITECTURE.md.
// Field names match the architecture doc's exact lists (Canonical Scene/Shot
// Model, Canonical Prompt Architecture, AI Director, P2 -> P3 Handoff) — not
// GRAFİK's/Studio's fuller source schemas. See the plan's "Source-to-
// canonical field mapping" section for the rationale behind every field this
// file adds beyond the doc's literal lists (all id/version fields, needed
// because a versioned/addressable store requires a primary key even where
// the architecture text didn't spell out the wrapper id, matching how P1
// needed package_id/schema_version for the same reason).

// --- Structural view of the P1 Research Package handoff (architecture doc
// "P1 -> P2 Handoff") — NOT imported from pipeline1_research; this is P2's
// own structural type for the contract, validated at runtime in ingest.ts.
// P2 consumes P1 strictly through this serialized shape. ---

export interface ResearchPackageHandoffInput {
  package_id: string;
  schema_version: string;
  project_id: string;
  manifest: unknown;
  integrity_hashes: { package_sha256: string; per_file: Record<string, string> };
  research_scope: {
    scope_id: string;
    project_id: string;
    topic: string;
    question?: string;
    objective?: string;
    constraints: string[];
    state: string;
  };
  sources: unknown[];
  evidence: unknown[];
  claims: Array<{
    claim_id: string;
    statement: string;
    evidence_refs: string[];
    derived_from: string;
    contradiction_refs: string[];
    dimension: string;
  }>;
  verifications?: Array<{ verification_id: string; claim_id: string; status: string }>;
  knowledge_package: {
    verification_state_schema_version: string;
    [dimension: string]: unknown;
  };
  unresolved_questions: string[];
  handoff_notes: string;
  gates?: unknown[];
}

// --- P2.01 Reference Discovery (new, no source equivalent) ---

export interface ReferenceCandidateSeed {
  label: string;
  rationale: string;
}

export interface ReferenceCandidate {
  candidate_id: string;
  label: string;
  rationale: string;
}

// R01.5 — reference provenance.
//
// `source: string` was, and remains, a free-text description/URL with no
// structured indicator of WHO or WHAT supplied the reference. Per the
// repair mandate's own caution ("Do not invent provenance for data where
// it cannot be established"), existing references are NOT retroactively
// classified — `provenance` is optional and populated only by a caller
// that genuinely knows the origin at construction time. Absence means
// "not established," not "assumed system-generated" or any other guess.
export type ReferenceProvenance = "USER_SUPPLIED" | "SYSTEM_GENERATED" | "EXTERNAL_SOURCE";

export interface Reference {
  reference_id: string;
  candidate_id?: string;
  source: string;
  approved: boolean;
  provenance?: ReferenceProvenance;
}

export interface Observation {
  observation_id: string;
  reference_id: string;
  // hook_structure | pacing | visual_rhythm | camera_language | framing |
  // typography | transitions | sound_design | narration_behavior |
  // edit_density | thumbnail_title_relationship | still_vs_video
  dimension: string;
  content: string;
}

// --- P2.02-P2.04 intermediate stage outputs (kept minimal; the architecture
// doc leaves these as opaque CreativeReasoningEngine return types with no
// field list, unlike Scene/Shot/Prompt/Decision) ---

export interface ContentStructure {
  central_idea: string;
  key_claims_used: string[]; // FK -> P1 Claim.claim_id, traceability grounding
  narrative_material: string[];
  objective: string;
}

// Small-improvements addition (C2, P2.02 narrative tension / sensitive
// angles). Deliberately NOT a field on ContentStructure — that type is
// FK-validated as verified content (runP202Understand checks
// key_claims_used against the ingested Research Package) and must stay
// exactly that. This is a separate, sibling advisory-notes artifact: it
// never changes facts and never presents unverified material as fact.
export interface CreativeAngleNotes {
  controversial_points: string[];
  intriguing_contrasts: string[];
  provocative_angle_options: string[];
  alternative_framings: string[];
  ethics_risk_notes: string[];
}

// Small-improvements addition (C3, P2.03 creative strategy spectrum).
// Neither of these existed before this addition — confirmed by direct
// search of the codebase — so both are genuinely new, not a preserved
// pre-existing distinction.
export type CreativeApproach =
  | "analytical"
  | "documentary"
  | "dramatic"
  | "investigative"
  | "provocative"
  | "poetic"
  | "intellectual"
  | "cinematic"
  | "minimal"
  | "experimental";

export type StrategyScopeLevel = "project" | "series" | "video_episode";

export interface CreativeStrategy {
  strategy_id: string;
  communication_direction: string;
  narrative_direction: string;
  audience_intent?: string;
  creative_priorities: string[];
  creative_approach?: CreativeApproach;
  scope_level?: StrategyScopeLevel;
}

export interface FormatDecision {
  format: string;
  constraints: string[];
}

// P2.04 Improvement (P2-B): Format Decision Matrix
// Structured decision log for the complete format decision chain.
// Captures each step in the pipeline from format to production_complexity,
// with rationale at each decision point. User must review before creative lock-in.
export interface FormatDecisionMatrixPoint {
  step: string; // step name in the chain (e.g., "format", "duration", "narrative_density")
  input: string; // what fed this decision
  output: string; // what was decided
  rationale: string; // why this choice was made
  implications?: Record<string, string>; // downstream effects of this choice
}

export interface FormatDecisionMatrix {
  matrix_id: string;
  format_decision_id: string; // FK -> Decision.decision_id (the approved format choice)
  chain: FormatDecisionMatrixPoint[]; // ordered steps: format → duration → ... → production_complexity
  is_user_reviewed: boolean; // false until user approves (review checkpoint)
  review_timestamp?: string; // ISO 8601, set when user reviews
  review_actor?: string; // who reviewed (actor email/id)
  notes?: string; // optional user notes during review
}

export interface ArtDirection {
  art_direction_id: string;
  visual_language: string;
  checklist: string[];
  decision_ids: string[]; // FK -> Decision.decision_id
}

// --- Canonical Scene / Shot Model (architecture doc, exact fields) ---

export interface ShotCamera {
  angle: string;
  movement: string;
  lens: string;
  framing: string;
}

export interface Shot {
  shot_id: string;
  scene_id: string;
  purpose: string;
  duration_intention: string;
  camera: ShotCamera;
  action: string;
  continuity_anchors: string[];
  reference_requirements: string[];
  asset_type: string;
  generation_method: string;
}

export interface Scene {
  scene_id: string;
  purpose: string;
  shots: string[]; // FK -> Shot.shot_id (not embedded — see plan rationale)
  continuity_requirements: string[];
  narrative_function: string;
}

// --- Canonical Prompt Architecture (four layers, architecture doc) ---

// Layer 1 — Creative Intent: provider-agnostic, human-readable.
export interface CreativeIntent {
  shot_id: string;
  decision_id: string;
  narrative_purpose: string;
}

// Layer 2 — Structured Prompt Specification: the canonical stored/versioned
// layer. Provider-neutral — must never contain rendered/provider text.
export interface PromptSpecification {
  prompt_spec_id: string;
  version: number;
  subject: string;
  action?: string;
  environment?: string;
  composition: string;
  camera?: string;
  lighting?: string;
  motion?: string;
  style: string;
  materials?: string;
  atmosphere?: string;
  continuity?: string;
  negative_constraints: string[];
  prompt_family: string;
  axis_tags: string[];
  // TIER-1 REPAIR T1.7 — canonical asset lineage.
  //
  // The chain the brief requires is
  //     Shot -> AssetRequirement -> PromptSpecification -> Delivered Asset.
  // Previously traceable_to carried only { shot_id, decision_id }, so the
  // AssetRequirement link was missing entirely and P3 could not prove which
  // delivered asset satisfied which requirement — a shot with several asset
  // requirements had several prompts and no way to tell them apart.
  //
  // asset_requirement_id is required. decision_id remains required and must
  // resolve; it is never the empty string.
  traceable_to: { shot_id: string; asset_requirement_id: string; decision_id: string };
}

// Layer 3 — Provider-specific rendering representation (interface only; the
// concrete GoogleFlowRenderer lives in promptArchitecture.ts).
export interface RenderedPrompt {
  provider: string;
  prompt_text: string; // Layer 4 — Google Flow prompt text
  rendered_at: string;
}

export interface RenderedPromptRecord {
  spec: PromptSpecification; // Layer 2, stored as-is
  rendered: RenderedPrompt; // Layer 3/4, derived — never the stored canonical prompt
}

// --- AI Director / Decision object (architecture doc, exact fields) ---

export type DecisionStatus = "proposed" | "recommended" | "approved" | "rejected" | "modified" | "superseded";

export interface DecisionOption {
  choice: string;
  rationale?: string;
}

export interface Decision {
  decision_id: string;
  question: string;
  options_considered: DecisionOption[];
  recommendation: string;
  rationale: string;
  status: DecisionStatus;
  approving_actor?: string;
  timestamp: string;
  precedent_refs: string[];
}

// --- P2.07 Asset Planning (architecture doc, exact fields) ---

// Small-improvements addition (C5, P2.07 advanced asset planning).
// Deliberately kept separate from expected_media_type: P3's
// pipeline3_production/src/assetMatching.ts ASSET_TYPE_MEDIA_KIND lookup
// only recognizes a fixed, small set of expected_media_type values for its
// media-compatibility check, and silently *skips* (not fails) that check
// for any value it doesn't recognize. Writing an AssetRole value into
// expected_media_type would silently disable P3's already-closed audit fix
// for any shot using it. asset_role therefore stays a separate, optional,
// additive field on AssetRequirement — P3 never reads it, and
// expected_media_type keeps using only the existing P3-recognized set.
export type AssetRole =
  | "primary_visual"
  | "secondary_visual"
  | "transition"
  | "detail_insert"
  | "texture"
  | "diagram"
  | "map"
  | "chart"
  | "animation"
  | "loop"
  | "background";

export interface AssetRequirement {
  asset_requirement_id: string;
  shot_id: string; // links Asset Traceability: Shot -> Asset Requirement
  expected_media_type: string;
  expected_media_properties: Record<string, unknown>;
  generation_method: string;
  reference_lineage: string[]; // Reference.reference_id[]
  required: boolean;
  asset_role?: AssetRole; // see AssetRole doc comment above — never merge into expected_media_type
}

// --- P2.10 Voice + Production Spec ---

export type PronunciationFlagType = "number" | "date" | "unit" | "special_terminology";

export interface PronunciationFlag {
  claim_id?: string;
  token: string;
  flag_type: PronunciationFlagType;
  note: string;
}

// TIER-2 REPAIR T2.4 — canonical voice line lineage. Kept separate from the
// flattened voice_script (the canonical rendered-text representation P3
// actually synthesizes from): this is the structured object that lets a
// sentence in the narration be traced back to the claim it came from.
export interface VoiceLine {
  line_id: string;
  claim_id?: string; // FK -> Claim.claim_id (P1), when the line narrates a specific claim
  text: string;
}

// --- Human gate state model (same shape as P1) ---

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

// --- Memory buckets (GRAFİK's 7 buckets, ADAPT + populate) ---

export const MEMORY_BUCKETS = [
  "BRAND_MEMORY",
  "CAMPAIGN_MEMORY",
  "CREATIVE_HISTORY",
  "SUCCESS_MEMORY",
  "REJECTION_MEMORY",
  "AVOID_MEMORY",
  "REFERENCE_MEMORY",
] as const;
export type MemoryBucket = (typeof MEMORY_BUCKETS)[number];

export type MemoryRecordType = "RULE" | "PREFERENCE" | "EXAMPLE" | "REJECTION" | "OBSERVATION";

export interface MemoryRecord {
  record_id: string;
  bucket: MemoryBucket;
  record_type: MemoryRecordType;
  content: string;
  reason?: string;
  created_at: string;
  locked?: boolean;
}

import type { CanonicalIdentity } from "./canonicalIdentity.js";

// --- Manifest / integrity (same pattern as P1) ---

export interface ManifestEntry {
  path: string;
  sha256: string;
  purpose: string;
}

export interface IntegrityHashes {
  package_sha256: string;
  per_file: Record<string, string>;
}

// --- P2 -> P3 Handoff (architecture doc, exact fields) ---

export interface ProductionPackageHandoff {
  package_id: string;
  production_package_version: string;
  // TIER-1 REPAIR T1.1 — canonical content identity (see canonicalIdentity.ts).
  identity: CanonicalIdentity;
  project_id: string;
  research_package_ref: string; // P1 package_id
  // TIER-1 REPAIR T1.2 — the P1 package hash P2 actually verified. Carrying
  // only research_package_ref (a name) made the P1->P2->P3 chain
  // unverifiable downstream: P3 could not tell WHICH version of the
  // Research Package this Production Package was built from.
  research_package_content_hash: string;
  scenes: Scene[];
  shots: Shot[];
  asset_requirements: AssetRequirement[];
  prompts: RenderedPromptRecord[];
  decision_log: Decision[];
  voice_script: string;
  pronunciation_flags: PronunciationFlag[];
  // T2.4 — structured claim/line lineage, additive alongside voice_script.
  voice_lines: VoiceLine[];
  user_approval_state: GateApprovalRecord[];
  manifest: ManifestEntry[];
  integrity_hashes: IntegrityHashes;
}
