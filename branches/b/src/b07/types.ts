// B07 — Performance Framework Types
// KPI definitions, measurement plans, success metrics

import type { EvidenceRef } from "../types/entities.js";
import type { ProvenanceRef } from "../b00/provenanceRef.js";
import type { Decision, Recommendation, ConflictRecord, Gap } from "../b00/contracts.js";
import type { GovernanceEvent } from "../b00/governance.js";
import type { CanonicalIdentity, CanonicalParentReference } from "../b00/identity.js";
import type { B04CandidateState, B04CanonicalState } from "../b04/types.js";
import type { B06CandidateState, B06CanonicalState } from "../b06/types.js";

export interface StrategicTargetDefinition {
  value: number;
  unit: string;
  basis: "DEFAULT" | "EVIDENCE_BACKED" | "USER_DEFINED";
  source: string;
  status: "INFERRED" | "VERIFIED" | "UNKNOWN";
  version: string;
}

/** KPI Definition */
export interface KPIDefinition {
  kpi_id: string;
  campaign_id: string;
  channel_id: string;

  // What to measure
  metric_name: string; // e.g., "Watch Time", "Click-Through Rate"
  metric_category: "engagement" | "reach" | "conversion" | "retention" | "brand_lift";

  // How to measure
  calculation_method: string;
  data_sources: string[]; // e.g., ["YouTube Analytics", "Google Analytics"]

  // Success definition
  target_value: number;
  target_unit: string; // legacy convenience mirrors target_definition
  target_definition: StrategicTargetDefinition;
  benchmark?: string;
  benchmark_definition: { value?: number; unit?: string; basis: "EVIDENCE_BACKED" | "UNKNOWN"; source?: string; status: "VERIFIED" | "UNKNOWN"; version: string };
  /** B07 defines KPIs/targets; actual values arrive only from validated B08 observations. */
  actual_metric_value?: number;
  external_measurements?: import("../b08/external/types.js").ExternalObservation[];

  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

/** Measurement Plan */
export interface MeasurementPlan {
  plan_id: string;
  campaign_id: string;

  // What to track
  tracked_kpis: string[]; // KPI IDs

  // How often
  measurement_frequency: "real_time" | "daily" | "weekly" | "monthly";
  reporting_cadence: string; // e.g., "weekly report"

  // Data pipeline
  data_collection_method: string;
  tools: string[]; // Analytics tools
  dashboards: string[]; // Where metrics are displayed

  // Success threshold
  minimum_sample_size?: number;
  minimum_sample_size_basis: "DEFAULT" | "EVIDENCE_BACKED" | "USER_DEFINED";
  execution_state: "DEFINED" | "CONNECTED" | "FETCHED" | "VALIDATED" | "USABLE" | "FAILED";

  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

/** Success Metric */
export interface SuccessMetric {
  metric_id: string;
  campaign_id: string;

  // Definition
  metric_name: string;
  description: string;

  // Measurement
  primary_kpi_id: string; // Links to KPI
  supporting_indicators: string[]; // Additional KPI IDs

  // Threshold
  success_threshold: number;
  threshold_unit: string;
  threshold_definition: StrategicTargetDefinition;
  actual_success_result?: { value: number; observed_at: string; source_metric_ids: string[] };

  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

/** B07 completeness scoring */
export interface CompletenessScore {
  score: number; // 0-100
  missing_inputs: string[];
  blocking_decisions: string[];
}

/** B07 pre-decision candidate state */
export interface B07CandidateState {
  candidate_id: string;
  parent_references: CanonicalParentReference[];
  framework_state: "DEFINED";
  created_at: string;
  b04_version?: string;
  b06_version?: string;

  // Performance outputs
  kpi_definitions: KPIDefinition[];
  measurement_plans: MeasurementPlan[];
  success_metrics: SuccessMetric[];

  // Validation
  conflicts_detected: ConflictRecord[];
  gaps: Gap[];

  // Evidence trail
  evidence_refs: EvidenceRef[];
  provenance_refs: ProvenanceRef[];
  governance_events: Record<string, GovernanceEvent[]>;

  // Recommendations
  all_recommendations: Recommendation[];

  // Readiness
  completeness: CompletenessScore;
}

/** B07 post-decision canonical state (versioned, immutable) */
export interface B07CanonicalState {
  identity: CanonicalIdentity;
  framework_state: "DEFINED";
  version: string; // v1.0, v1.1, etc.
  created_at: string;
  updated_at: string;
  user_decision_authority: string;

  // Context versions
  b04_canonical_version?: string;
  b06_canonical_version?: string;

  // Only DECIDED provenance items
  kpi_definitions: KPIDefinition[];
  measurement_plans: MeasurementPlan[];
  success_metrics: SuccessMetric[];

  // Audit trail
  audit_trail: Array<{
    version: string;
    changed_at: string;
    changed_by: string;
    summary: string;
  }>;

  decisions_made: Decision[];
  recommendations_considered: Recommendation[];

  // Evidence preservation
  evidence_refs: EvidenceRef[];
  provenance_refs: ProvenanceRef[];
  governance_events: Record<string, GovernanceEvent[]>;

  // Immutability enforcement
  decision_timestamp: string;
  cannot_be_modified_until_next_version: boolean;
}

/** B07 input contract */
export interface B07Input {
  b04_candidate_or_canonical?: B04CandidateState | B04CanonicalState;
  b06_candidate_or_canonical?: B06CandidateState | B06CanonicalState;
}

/** Dependency injection for B07 */
export interface B07Deps {
  external_intelligence?: import("../b08/external/types.js").ExternalIntelligenceContext;
  hash?: {
    stableKPIId: (campaignId: string, metricName: string) => string;
    stablePlanId: (campaignId: string) => string;
    stableMetricId: (campaignId: string, metricName: string) => string;
  };
  now?: () => string;
}

/** Persistence interface */
export interface B07StatePersistence {
  save: (state: B07CanonicalState) => Promise<void>;
  load: (version: string) => Promise<B07CanonicalState | null>;
  listVersions: () => Promise<string[]>;
  latest: () => Promise<B07CanonicalState | null>;
}

/** Declared canonicalization field drops (intentional loss) */
export const KNOWN_CANONICALIZATION_DROPS = {
  candidate_id: "Pre-decision unique ID; not persisted to canonical versioned state",
  conflicts_detected: "Candidate-phase conflict detection; preserved as canonical conflicts field if needed",
  gaps: "Candidate-phase performance gaps identified during evaluation; not carried forward to canonical state",
  all_recommendations: "Candidate-phase recommendations; preserved as canonical.recommendations_considered",
  completeness: "Pre-decision completeness score; represents readiness at candidate stage",
  governance_events: "Internal governance event tracking; immutable in canonical state; candidate_governance carries full history",
} as const;
