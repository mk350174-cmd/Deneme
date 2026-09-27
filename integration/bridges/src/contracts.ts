// Cross-branch contracts of the unified pipeline.
//
// Design rules (inherited from A-Branch Architectural Principle 8 and the
// B-Branch B00 identity authority):
//   1. Branches talk to each other ONLY through serialized, hash-sealed
//      envelopes defined here. No branch imports another branch's runtime
//      state object.
//   2. Every envelope carries a B00 CanonicalIdentity (SHA-256 over the
//      envelope content, identity excluded). Consumers re-validate it.
//   3. Frozen contracts are never edited: P2.11 ProductionPackageHandoff,
//      P3 render/timeline/kaggle, B01 contracts and B08 external contracts
//      are consumed as-is. Anything new lives in these envelopes.
//   4. Epistemic labels travel with the data. A HEURISTIC or TEMPLATE
//      strategy item stays labelled as such all the way into P2; nothing is
//      silently promoted to "evidence-backed".

import type { B00, B01, B03 } from "b-branch-strategic-control-plane";

export const UNIFIED_SCHEMA_VERSION = "unified-1.0.0" as const;

export type CanonicalIdentity = B00.CanonicalIdentity;

// ---------------------------------------------------------------------------
// Lineage shared by every envelope that descends from one P1 research package
// ---------------------------------------------------------------------------

export interface ResearchLineage {
  research_package_id: string;
  /** P1 manifest-level package_sha256 as recomputed by P2's ingest verifier. */
  research_package_sha256: string;
  /** P1 canonical identity content hash (T1.1). */
  research_identity_hash: string;
  project_id: string;
  topic: string;
  gate_a1_record_id: string;
  verified_claim_ids: string[];
  inferred_claim_ids: string[];
  unknown_claim_ids: string[];
}

// ---------------------------------------------------------------------------
// Bridge 1 — P1 -> B  (research informs strategy)
// ---------------------------------------------------------------------------

export interface StrategyInputBundle {
  bundle_type: "P1_TO_B_STRATEGY_INPUT";
  schema_version: typeof UNIFIED_SCHEMA_VERSION;
  lineage: ResearchLineage;
  /** Ready-to-run B01 input. input_id embeds the research hash prefix. */
  b01_input: B01.B01Input;
  /** Ready-to-merge B03 audience_sources (research digest as documentation). */
  b03_audience_sources: NonNullable<B03.B03Input["audience_sources"]>;
  created_at: string;
  identity: CanonicalIdentity;
}

// ---------------------------------------------------------------------------
// Bridge 2 — B -> P2  (committed strategy directs creative)
// ---------------------------------------------------------------------------

export type EpistemicBasis =
  | "EVIDENCE_BACKED"
  | "HUMAN_DECIDED"
  | "USER_DEFINED"
  | "HEURISTIC"
  | "TEMPLATE"
  | "DEFAULT";

export interface DirectiveItem {
  text: string;
  basis: EpistemicBasis;
  /** "B05:angle:<id>", "B06:format_rule:<id>", "B11:rule:<id>" ... */
  source_ref: string;
}

export interface DirectiveMemoryRecord {
  bucket: "BRAND_MEMORY" | "CAMPAIGN_MEMORY" | "AVOID_MEMORY" | "SUCCESS_MEMORY" | "REFERENCE_MEMORY";
  record_type: "RULE" | "PREFERENCE" | "OBSERVATION";
  content: string;
  reason: string;
  source_ref: string;
  basis: EpistemicBasis;
}

export interface DirectiveKpi {
  kpi_id: string;
  channel_id: string;
  metric_name: string;
  metric_category: string;
  target_value: number;
  target_unit: string;
  target_basis: string;
  data_sources: string[];
}

export interface StrategicCreativeDirective {
  directive_type: "B_TO_P2_CREATIVE_DIRECTIVE";
  schema_version: typeof UNIFIED_SCHEMA_VERSION;
  project_id: string;
  lineage: ResearchLineage;
  strategy_input_bundle_hash: string;
  branch_state: {
    state_id: string;
    content_hash: string;
    committed_by: string;
    committed_at: string;
    rationale: string;
    module_hashes: Record<string, string>;
  };
  channel: {
    channel_id: string;
    role: string;
    rationale: string;
    fit_basis: string;
  };
  /** -> P2.03 runP203Strategize(userGoals) */
  user_goals: DirectiveItem[];
  /** -> P2.04 decideFormat / buildFormatDecisionMatrix */
  format: {
    format: string;
    duration_category: string;
    aspect_ratio: string;
    constraints: DirectiveItem[];
  };
  /** -> P2 MemoryRecord[] (priorApproaches / directArt memory) */
  memory: DirectiveMemoryRecord[];
  kpis: DirectiveKpi[];
  schedule: {
    posting_frequency: string;
    optimal_posting_times: string[];
    timezone: string;
    basis: string;
  } | null;
  compliance: {
    /** Non-empty => the directive is NOT produced (builder throws). Kept for audit. */
    blocking: string[];
    /** UNKNOWN / PENDING checks: travel as explicit P2 constraints. */
    unresolved: string[];
  };
  created_at: string;
  identity: CanonicalIdentity;
}

// ---------------------------------------------------------------------------
// Bridge 3 — P3 -> YouTube agent  (delivered video enters review/publish)
// ---------------------------------------------------------------------------

export interface YouTubeImportScene {
  label: string;
  scriptText: string;
  prompt: string;
  duration: number;
  assetType: "video" | "image" | "missing";
  assetOrigin: "generated" | "uploaded";
  provider: string | null;
  provenanceSourceIds: string[];
  containsSyntheticMedia: boolean;
  /** Always false on import: rights are confirmed by a human in Review Studio. */
  rightsConfirmed: false;
  locked: true;
}

export interface YouTubeImportSource {
  id: string;
  url: string;
  title: string;
  sourceType: "article" | "video" | "dataset" | "official" | "asset" | "other";
  status: "verified" | "pending";
  notes: string;
}

export interface YouTubeImportClaim {
  id: string;
  text: string;
  sourceIds: string[];
  status: "supported" | "pending";
  riskLevel: "standard" | "high";
  notes: string;
}

export interface YouTubeImportPackage {
  package_type: "P3_TO_YOUTUBE_IMPORT";
  schema_version: typeof UNIFIED_SCHEMA_VERSION;
  production_id: string;
  project_id: string;
  lineage: ResearchLineage;
  directive_hash: string;
  production_package: { package_id: string; version: string; content_hash: string };
  final_delivery: {
    final_delivery_package_id: string;
    package_sha256: string;
    render_run_id: string;
    video_path: string;
    video_sha256: string;
    video_bytes: number;
    duration_seconds: number;
    resolution: string;
    aspect_ratio: string;
    qa_result: string;
    gate_a7_record_id: string;
  };
  channel_id: string;
  /** P2 voice_script — the narration actually rendered. */
  script_text: string;
  /** P3.05 production narration (already mixed into the master render). */
  narration_audio: { path: string; sha256: string; provider: string; duration_seconds: number };
  seo_draft: {
    title: string;
    description: string;
    tags: string[];
    defaultLanguage: string;
    origin: "unified-pipeline-draft";
  };
  scenes: YouTubeImportScene[];
  provenance: {
    sources: YouTubeImportSource[];
    claims: YouTubeImportClaim[];
    containsSyntheticMedia: boolean;
  };
  publishing_hints: {
    content_type: "short" | "long_form";
    privacy_status: "private";
    schedule: StrategicCreativeDirective["schedule"];
    kpis: DirectiveKpi[];
  };
  /** P3.F finishing (captions / music) — null when the A7 master is imported as-is. */
  finishing: {
    record_hash: string;
    f1_approval_hash: string;
    f1_actor: string;
    master_sha256: string;
    captions: { path: string; sha256: string; language: string; timing_basis: string; burned: boolean } | null;
    music: { sha256: string; source: string; license: string; attested_by: string } | null;
  } | null;
  /** Gates that remain OPEN in the YouTube agent and must be passed by a human. */
  open_human_gates: string[];
  created_at: string;
  identity: CanonicalIdentity;
}

// ---------------------------------------------------------------------------
// Bridge 4 — YouTube agent -> B08  (published results feed strategy)
// ---------------------------------------------------------------------------

export interface LearningFeedSnapshot {
  video_id: string;
  production_id: string;
  measurement_window: string;
  published_at: string | null;
  measured_at: string;
  simulated: boolean;
  metrics: Record<string, number>;
}

export interface LearningFeedEngagement {
  video_id: string;
  production_id: string | null;
  analyzed_at: string | null;
  comment_count: number;
  themes: Array<{ theme: string; count?: number; examples?: string[] }>;
  analysis_method: string;
}

export interface LearningFeed {
  feed_type: "YOUTUBE_AGENT_LEARNING_FEED";
  schema_version: typeof UNIFIED_SCHEMA_VERSION;
  exported_at: string;
  exporter: string;
  channel_id: string;
  project_id: string;
  snapshots: LearningFeedSnapshot[];
  engagement: LearningFeedEngagement[];
}

/** Explicit, human-authored KPI binding. The bridge never guesses which
 * YouTube metric answers which B07 KPI. */
export interface KpiBinding {
  kpi_id: string;
  youtube_metric: string;
  unit: string;
  measurement_window: string;
}
