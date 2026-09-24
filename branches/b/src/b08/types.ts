// B08 — Analytics Strategy Types

import type { EvidenceRef } from "../types/entities.js";
import type { ProvenanceRef } from "../b00/provenanceRef.js";
import type { ConflictRecord, Gap, Recommendation, Decision } from "../b00/contracts.js";
import type { GovernanceEvent } from "../b00/governance.js";
import type { CanonicalIdentity, CanonicalParentReference } from "../b00/identity.js";

export type AnalyticsSourceMode = "REAL" | "MOCK" | "SYNTHETIC";

export interface DataSourceDefinition {
  source_id: string;
  source_name: string;
  source_type: "native_platform" | "third_party_analytics" | "custom_event" | "manual_input";
  platform_id?: string;
  /** Catalog capability only; does not imply connection or fetch. */
  api_available: boolean;
  api_availability_basis: "CATALOG_DEFAULT" | "VERIFIED_PROVIDER_METADATA" | "UNKNOWN";
  real_time: boolean;
  execution_state: AnalyticsExecutionState;
  source_mode: AnalyticsSourceMode | "UNKNOWN";
  execution_verified: boolean;
  latency_hours?: number;
  data_retention_days?: number;
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

export type AnalyticsExecutionState = "DEFINED" | "CONNECTED" | "FETCHED" | "VALIDATED" | "USABLE" | "FAILED";

export interface DataIngestion {
  ingestion_id: string; source_id: string; state: AnalyticsExecutionState; source_mode: AnalyticsSourceMode; fetched_at?: string; evidence_refs: EvidenceRef[]; error?: string;
}
export interface RawObservation { observation_id:string; ingestion_id:string; source_id:string; observed_at:string; payload:unknown; source_mode:AnalyticsSourceMode; evidence_refs:EvidenceRef[]; }
export interface NormalizedObservation { observation_id:string; raw_observation_id:string; metric_id:string; observed_at:string; value:number; unit:string; source_mode:AnalyticsSourceMode; validation_state:"VALIDATED"|"FAILED"; evidence_refs:EvidenceRef[]; }
export interface MetricValue { metric_value_id:string; metric_id:string; value:number; unit:string; observed_at:string; source_mode:AnalyticsSourceMode; evidence_refs:EvidenceRef[]; }
export interface Aggregation { aggregation_id:string; metric_id:string; method:MetricDefinition["aggregation_method"]; window:MetricDefinition["aggregation_window"]; input_metric_value_ids:string[]; value:number; source_mode:AnalyticsSourceMode; }
export interface AnalyticsResult { result_id:string; metric_id:string; value:number; unit:string; period_start:string; period_end:string; state:"VALIDATED"|"USABLE"|"FAILED"; source_mode:AnalyticsSourceMode; evidence_refs:EvidenceRef[]; }

export interface MetricDefinition {
  metric_id: string;
  kpi_id: string;
  metric_name: string;
  source_id: string;
  aggregation_method: "sum" | "average" | "max" | "min" | "count" | "unique_count";
  aggregation_window: "daily" | "weekly" | "monthly" | "rolling_7day" | "rolling_30day";
  data_quality_rules: string[];
  attribution_window?: number; // days
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
  definition_state: "DEFINED";
}

export interface AnalyticsWorkflow {
  workflow_id: string;
  workflow_name: string;
  source_ids: string[];
  metric_ids: string[];
  processing_frequency: "real_time" | "hourly" | "daily" | "weekly";
  data_freshness_requirement: string;
  quality_checks: string[];
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
  execution_state: AnalyticsExecutionState;
}

export interface CompletenessScore {
  score: number;
  missing_inputs: string[];
  blocking_decisions: string[];
}

export interface B08CandidateState {
  external_intelligence?: import("./external/types.js").ExternalIntelligenceContext;
  candidate_id: string;
  parent_references: CanonicalParentReference[];
  created_at: string;
  b07_version?: string;
  b06_version?: string;
  b01_version?: string;

  data_sources: DataSourceDefinition[];
  metrics: MetricDefinition[];
  workflows: AnalyticsWorkflow[];
  data_ingestions: DataIngestion[];
  raw_observations: RawObservation[];
  normalized_observations: NormalizedObservation[];
  metric_values: MetricValue[];
  aggregations: Aggregation[];
  analytics_results: AnalyticsResult[];

  conflicts_detected: ConflictRecord[];
  gaps: Gap[];
  evidence_refs: EvidenceRef[];
  provenance_refs: ProvenanceRef[];
  governance_events: Record<string, GovernanceEvent[]>;
  all_recommendations: Recommendation[];
  completeness: CompletenessScore;
}

export interface B08CanonicalState {
  external_intelligence?: import("./external/types.js").ExternalIntelligenceContext;
  identity: CanonicalIdentity;
  version: string;
  created_at: string;
  updated_at: string;
  user_decision_authority: string;

  b01_canonical_version?: string;
  b06_canonical_version?: string;
  b07_canonical_version?: string;

  data_sources: DataSourceDefinition[];
  metrics: MetricDefinition[];
  workflows: AnalyticsWorkflow[];
  data_ingestions: DataIngestion[];
  raw_observations: RawObservation[];
  normalized_observations: NormalizedObservation[];
  metric_values: MetricValue[];
  aggregations: Aggregation[];
  analytics_results: AnalyticsResult[];

  audit_trail: Array<{
    version: string;
    changed_at: string;
    changed_by: string;
    summary: string;
  }>;

  decisions_made: Decision[];
  recommendations_considered: Recommendation[];
  evidence_refs: EvidenceRef[];
  provenance_refs: ProvenanceRef[];
  governance_events: Record<string, GovernanceEvent[]>;
  decision_timestamp: string;
  cannot_be_modified_until_next_version: boolean;
}

export interface B08Deps {
  external_intelligence?: import("../b08/external/types.js").ExternalIntelligenceContext;
  hash?: {
    stableSourceId: (sourceType: string, platformId: string) => string;
    stableMetricId: (kpiId: string, sourceName: string) => string;
    stableWorkflowId: (campaignId: string) => string;
  };
  now?: () => string;
}

export interface B08StatePersistence {
  save: (state: B08CanonicalState) => Promise<void>;
  load: (version: string) => Promise<B08CanonicalState | null>;
  listVersions: () => Promise<string[]>;
  latest: () => Promise<B08CanonicalState | null>;
}

/** Declared canonicalization field drops (intentional loss) */
export const KNOWN_CANONICALIZATION_DROPS = {
  candidate_id: "Pre-decision unique ID; not persisted to canonical versioned state",
  conflicts_detected: "Candidate-phase conflict detection; not carried forward to canonical state",
  gaps: "Candidate-phase data sourcing gaps identified during evaluation; not carried forward to canonical state",
  all_recommendations: "Candidate-phase recommendations; preserved as canonical.recommendations_considered",
  completeness: "Pre-decision completeness score; not persisted to canonical state",
  governance_events: "Internal governance event tracking; immutable in canonical state; candidate_governance carries full history",
} as const;
