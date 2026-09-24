import type { CanonicalIdentity } from "./canonicalIdentity.js";

// Canonical P1 contracts per docs/architecture/01_PIPELINE_1_ARCHITECTURE.md.
// Field names and structures here are taken directly from the approved
// architecture document — this file must not silently redefine terminology
// from it (A-Branch Architectural Principle 2).

// --- Evidence & Provenance Contract (architecture §"Evidence & Provenance Contract") ---

// v1 vocabulary. Widening to a v2 vocabulary is an additive
// verification_state_schema_version bump on KnowledgePackage, not a
// rearchitecture (architecture doc, same section).
export type EvidenceStatusV1 = "VERIFIED" | "INFERRED" | "UNKNOWN";

export interface Source {
  source_id: string;
  origin: string;
  source_type: "primary" | "secondary" | "tertiary";
  retrieved_at: string; // ISO 8601
  access_method: string;
  reliability_notes?: string;
}

export interface Evidence {
  evidence_id: string;
  source_id: string;
  excerpt_or_pointer: string;
  retrieved_at: string; // ISO 8601
  extraction_method: string;
}

// The 18 knowledge dimensions the architecture doc's P1 -> P2 handoff
// requires the Knowledge Package to support. "contradictions", "unknowns"
// and "open_questions" are Synthesis-derived buckets (populated from a
// claim's Verification status / contradiction_refs, not chosen by whoever
// submitted the finding) — so a Claim's own `dimension` is drawn from the
// topical subset only (CLAIM_DIMENSIONS below).
export const KNOWLEDGE_DIMENSIONS = [
  "facts",
  "concepts",
  "people",
  "events",
  "places",
  "objects",
  "processes",
  "relationships",
  "chronology",
  "terminology",
  "quantitative",
  "visual",
  "examples",
  "interpretations",
  "contradictions",
  "unknowns",
  "open_questions",
  "production_context",
] as const;
export type KnowledgeDimension = (typeof KNOWLEDGE_DIMENSIONS)[number];

export const CLAIM_DIMENSIONS = [
  "facts",
  "concepts",
  "people",
  "events",
  "places",
  "objects",
  "processes",
  "relationships",
  "chronology",
  "terminology",
  "quantitative",
  "visual",
  "examples",
  "interpretations",
  "production_context",
] as const;
export type ClaimDimension = (typeof CLAIM_DIMENSIONS)[number];

export interface Claim {
  claim_id: string;
  statement: string;
  // FK -> Evidence.evidence_id. Required non-empty UNLESS the claim's
  // Verification.status is UNKNOWN (enforced in verification.ts).
  evidence_refs: string[];
  derived_from: string; // which research question/dimension this answers
  contradiction_refs: string[]; // other claim_ids this conflicts with
  dimension: ClaimDimension;
}

export interface Verification {
  verification_id: string;
  claim_id: string;
  status: EvidenceStatusV1;
  rationale: string;
  verified_at: string; // ISO 8601
  contradiction_relationship: "NONE" | "PARTIAL" | "DIRECT";
  // Required when status === "UNKNOWN" (schema-level enforcement).
  unresolved_reason?: string;
}

// Small-improvements addition (C1, P1.04 explainability layer). Fully
// separate from Verification — never a field on it, never touches its
// schema-level enforcement (assertClaimHasProvenance in verification.ts).
// Produced only for non-VERIFIED claims (see explainability.ts); a VERIFIED
// claim has nothing uncertain to explain.
export interface VerificationExplanation {
  verification_id: string; // FK -> Verification.verification_id, never inlined into it
  known: string[];
  unknown: string[];
  uncertainty_reason: string;
  missing_evidence: string[];
  source_conflicts: string[];
  follow_up_research_questions: string[];
}

// --- P1.02 / P1.03 boundary: the approved research scope object ---

export type ResearchScopeState = "SCOPE_PROPOSED" | "SCOPE_APPROVED";

export type RequestMode = "STANDARD_RESEARCH" | "CONCEPT_RESEARCH" | "REFERENCE_ANALYSIS" | "UPDATE_RESEARCH";

export interface UserMaterial {
  modality: "text" | "document" | "image" | "video" | "audio" | "dataset" | "mixed";
  content?: unknown;
}

export interface TargetContext {
  type?: string;
  channel?: string;
  project?: string;
  editorial_destination?: string;
}

export interface ResearchScope {
  scope_id: string;
  project_id: string;
  topic: string;
  question?: string;
  objective?: string;
  constraints: string[];
  source_type_preferences: string[];
  language_preference?: string;
  recency_preference?: string;
  candidate_source_families: string[];
  state: ResearchScopeState;
  // Category 1: Research intent and context
  request_mode?: RequestMode;
  source_language?: string;
  research_language?: string;
  output_language?: string;
  user_materials?: UserMaterial[];
  target_context?: TargetContext;
}

export interface ResearchRequest {
  project_id: string;
  topic: string;
  question?: string;
  objective?: string;
  constraints: string[];
  user_provided_material?: string;
  optional_references?: string[]; // Legacy field; deprecated in favor of user_example_references
  // P1.02 Improvement: User-seeded scope discovery. Optional array of example references
  // (YouTube channels, videos, academic papers, documentation URLs) that the user provides
  // to narrow/focus the research universe. P1.02 uses these to create controlled scope,
  // not to expand discovery breadth. Empty or undefined = system-proposed scope.
  user_example_references?: string[];
  // Category 1: Research intent and context
  request_mode?: RequestMode;
  source_language?: string;
  research_language?: string;
  output_language?: string;
  user_materials?: UserMaterial[];
  target_context?: TargetContext;
}

// --- Human gate state model (shared across all A-Branch gates) ---

export interface GateApprovalRecord {
  gate_id: string;
  state_before: string;
  approval_record_id: string;
  actor: string;
  timestamp: string; // ISO 8601
  object_version_being_approved: string;
  state_after: string;
  downstream_operation_unlocked: string;
  // --- TIER-1 REPAIR T1.4: approval binds to an immutable artifact ---
  // object_id identifies WHAT was approved; object_content_hash pins its
  // exact content at approval time. Optional in the type only so that
  // historical/legacy records deserialize; every record produced by
  // recordGateApproval carries them, and requireApprovedContent refuses to
  // accept a record without object_content_hash.
  object_id?: string;
  object_type?: string;
  object_content_hash?: string;
}

// --- Knowledge Package (P1.05 / P1.06) ---

export interface KnowledgePackage {
  verification_state_schema_version: "v1";
  facts: Claim[];
  concepts: Claim[];
  people: Claim[];
  events: Claim[];
  places: Claim[];
  objects: Claim[];
  processes: Claim[];
  relationships: Claim[];
  chronology: Claim[];
  terminology: Claim[];
  quantitative: Claim[];
  visual: Claim[];
  examples: Claim[];
  interpretations: Claim[];
  contradictions: Claim[];
  unknowns: Claim[];
  open_questions: string[];
  production_context: Claim[];
}

// --- P1.05 Category 4: Synthesis Metadata ---

// Synthesis metadata: knowledge identity (synthesis_run_id) vs execution metadata (synthesis_timestamp).
// Immutable once created; used for versioning, reproducibility verification, and multi-run evolution.
export interface SynthesisMetadata {
  // Knowledge identity: deterministic hash of (project_id + sorted source IDs + sorted claim IDs + sorted verification IDs).
  // Same canonical inputs always produce same synthesis_run_id (reproducible).
  // No time component; does not change on re-synthesis of identical inputs.
  synthesis_run_id: string;

  // Execution metadata: when synthesis was performed (ISO 8601).
  // Does NOT affect synthesis_run_id or deterministic output.
  // Different executions of same inputs have different timestamps but same synthesis_run_id.
  synthesis_timestamp: string;

  // Confidence breakdown: counts of each verification state.
  verified_facts_count: number; // Claims with status=VERIFIED
  inferred_facts_count: number; // Claims with status=INFERRED
  unknown_count: number; // Claims with status=UNKNOWN
  contradictions_count: number; // Claims with contradiction_refs.length > 0
  total_claims: number; // All claims examined (verified + inferred + unknown)
}

// --- P1 Category 2: Discovery & Acquisition (internal P1.03 state) ---

// Point-in-time observable signal on a Candidate during discovery phase
export interface ObservableSignal {
  signal_name: string; // "view_count", "engagement_rate", "creator_reputation", etc.
  signal_value: string | number;
  observed_at: string; // ISO 8601
  source_of_signal: string; // "api", "scrape", "manual", "realtime", etc.
}

// Discovered-but-not-yet-acquired source candidate (internal P1.03 state, not exported)
export interface Candidate {
  candidate_id: string; // Deterministic hash(topic, discovery_method, resource_id)
  discovered_at: string; // ISO 8601
  topic: string; // From ResearchScope
  discovery_method: string; // "search", "api", "manual", etc.
  discovery_provider: string; // Who discovered: "engine", "agent", etc.
  discovery_rationale: string; // Why selected
  resource_description: string; // What was found
  observable_signals: ObservableSignal[]; // Initial observations during discovery
  acquisition_attempts: string[]; // FK array to AcquisitionAttempt.attempt_id
  status: "discovered" | "acquiring" | "resolved" | "expired";
  resolved_source_id?: string; // FK to Source (set when acquisition succeeds)
  scope_id: string; // FK to ResearchScope
}

// One attempt to acquire a Candidate into a usable Source (immutable per attempt)
export interface AcquisitionAttempt {
  attempt_id: string; // Deterministic hash(candidate_id, provider, requested_at)
  // FK -> CandidateLineage.candidate_id. Optional because a user-supplied
  // research query was never "discovered" and therefore has no candidate;
  // T1.5 requires that when present it MUST resolve, and that an absent
  // candidate is represented as absent rather than as a fabricated key.
  candidate_id?: string;
  provider: string; // "piper", "gtts", "elevenlabs", "api", etc.
  access_method: string; // "local_subprocess", "http", "api", etc.
  requested_at: string; // ISO 8601 (attempt start)
  completed_at?: string; // ISO 8601 (attempt finish)
  status: "pending" | "in_progress" | "succeeded" | "failed";
  failure_reason?: string; // "rate_limited", "not_found", "timeout", etc.
  resolved_source_id?: string; // FK to Source (only if succeeded)
  duration_ms?: number;
  error_details?: {
    error_code?: string;
    error_message?: string;
    error_context?: Record<string, unknown>;
  };
}

// Immutable point-in-time observation of a metric (candidate_id XOR source_id)
export interface Observation {
  observation_id: string; // Deterministic hash(owner_id, metric_name, observed_at)
  candidate_id?: string; // FK to Candidate (mutually exclusive with source_id)
  source_id?: string; // FK to Source (mutually exclusive with candidate_id)
  observed_at: string; // ISO 8601
  metric_name: string; // "view_count", "engagement_rate", "like_ratio", etc.
  metric_value: string | number;
  source_of_observation: string; // "api", "scrape", "manual", "realtime", etc.
  context?: Record<string, unknown>; // Platform, region, demographic, etc.
  immutable: true; // Enforced: never update, only append new
}

// TIER-1 REPAIR T1.5 — Candidate lineage must resolve in the handoff.
//
// Previously this context exported AcquisitionAttempt[] and Observation[],
// both of which carry `candidate_id` foreign keys, while deliberately NOT
// exporting Candidate[]. Every one of those FKs therefore dangled the
// moment the package left P1, and P1's own validator only warned about
// `resolved_source_id`, never about candidate_id.
//
// Repair follows option 2 in the brief: the internal Candidate object stays
// unexported, but an explicit CandidateLineage object — carrying the
// candidate_id the downstream records actually reference — is exported and
// is required to resolve. discovery_lineage IS that object now, so a
// discovery entry and the acquisitions it produced are joinable.
export interface CandidateLineage {
  candidate_id: string; // the key AcquisitionAttempt/Observation reference
  topic: string;
  discovery_method: string;
  discovery_provider: string;
  discovery_rationale: string;
  resource_description: string;
  scope_id: string;
  status: "discovered" | "acquiring" | "resolved" | "expired";
  resolved_source_id?: string;
}

export interface Category2Context {
  acquisition_history: AcquisitionAttempt[]; // Provider fallback history
  observations: Observation[]; // Source observations for strategic evaluation
  // Canonical lineage objects the above FKs resolve against (T1.5).
  discovery_lineage: CandidateLineage[];
}

// --- P1 -> P2 Handoff (architecture §"P1 -> P2 Handoff") ---

export interface ManifestEntry {
  path: string;
  sha256: string;
  purpose: string;
}

export interface IntegrityHashes {
  package_sha256: string;
  per_file: Record<string, string>;
  // R01.1 REPAIR — category_2_context integrity.
  //
  // CLASSIFICATION DECISION (documented per the repair mandate's "Do not
  // arbitrarily add it to content hash. If non-canonical, document its
  // integrity/lineage relationship explicitly."):
  //
  // category_2_context is CANONICAL LINEAGE CONTENT, not pure process/
  // extension metadata — T1.5 already established that its candidate_id
  // foreign keys are a correctness invariant the package must satisfy
  // (draftHandoff throws if they don't resolve). A field whose internal
  // consistency is load-bearing for the package's own correctness claims
  // is canonical, even though it is optional.
  //
  // It is NOT merged into the shared 8-section content hash / manifest
  // (research_scope..handoff_notes) that pipeline2_creative/src/ingest.ts
  // independently reimplements to verify the P1->P2 boundary (T1.2). Doing
  // so would silently break that boundary for every package sealed before
  // this change, and would force P2's reimplementation to track a field it
  // never reads or forwards (confirmed: P2 does not reference
  // category_2_context anywhere). Instead it gets its OWN, separate,
  // P1-internal integrity hash — real tamper-evidence, without widening
  // the cross-pipeline contract for a field only P1 ever consumes.
  //
  // Absent when category_2_context is absent (not present-but-null) — a
  // package without Category 2 data does not synthesize a hash for data
  // it doesn't have.
  category_2_context_sha256?: string;
}

export interface ResearchPackageHandoff {
  package_id: string;
  schema_version: "1.0.0";
  // TIER-1 REPAIR T1.1: canonical content identity. package_id is derived
  // from (project_id, scope_id, claim_ids) only, so it does NOT change when
  // handoff_notes / verifications / knowledge_package change. `identity`
  // carries the version + content_hash that actually do.
  identity: CanonicalIdentity;
  project_id: string;
  manifest: ManifestEntry[];
  integrity_hashes: IntegrityHashes;
  research_scope: ResearchScope;
  sources: Source[];
  evidence: Evidence[];
  claims: Claim[];
  verifications: Verification[];
  knowledge_package: KnowledgePackage;
  unresolved_questions: string[];
  handoff_notes: string;
  gates: GateApprovalRecord[];
  // Optional Category 2 extension: discovery/acquisition context
  // (Candidate[] NOT exported, only observations and acquisition history)
  category_2_context?: Category2Context;
  // Optional Category 4 metadata: synthesis run identity and execution metadata
  synthesis_metadata?: SynthesisMetadata;
}
