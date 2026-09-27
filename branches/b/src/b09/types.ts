// B09 — Learning Loops Types

import type { EvidenceRef } from "../types/entities.js";
import type { ProvenanceRef } from "../b00/provenanceRef.js";
import type { ConflictRecord, Gap, Recommendation, Decision } from "../b00/contracts.js";
import type { GovernanceEvent } from "../b00/governance.js";
import type { CanonicalIdentity, CanonicalParentReference } from "../b00/identity.js";

export interface LearningObservation {
  observation_id: string;
  observation_type: "metric_observation" | "performance_variance" | "strategy_mismatch" | "opportunity_identified" | "external_audience" | "external_community" | "external_trend" | "external_competitive";
  observation_kind: "ACTUAL";
  observed_at: string;
  source_analytics_result_id?: string;
  source_external_observation_id?: string;
  description: string;
  magnitude?: number; // normalized signal strength when computable
  magnitude_basis: "OBSERVED_VALUE" | "TARGET_VARIANCE" | "UNKNOWN";
  affected_module: string;
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

export interface OperationalGap {
  gap_id: string; affected_module: string; description: string; evidence_refs: EvidenceRef[]; provenance: ProvenanceRef;
}

export interface LearningSignal {
  signal_id: string;
  signal_type: "positive_signal" | "negative_signal" | "neutral_observation";
  severity: "low" | "medium" | "high";
  description: string;
  source_observations: string[];
  recommended_action?: string;
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
  interpretation_basis: "EXTERNAL_REVIEWED_OBSERVATION" | "ACTUAL_OBSERVATION" | "TARGET_COMPARISON" | "UNKNOWN";
}

export interface FeedbackRule {
  rule_id: string;
  rule_type: "optimization_candidate" | "risk_flag" | "compliance_concern";
  condition: string;
  action: string;
  priority: "low" | "medium" | "high";
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

export interface LearningProposal {
  proposal_id: string;
  proposal_type: "strategy_refinement" | "gap_closure" | "performance_optimization";
  target_module: string;
  description: string;
  confidence: number; // 0-1
  confidence_basis: "SIGNAL_CHAIN" | "HEURISTIC" | "USER_PROVIDED";
  supporting_signals: string[];
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

export interface CompletenessScore {
  score: number;
  missing_inputs: string[];
  blocking_decisions: string[];
}

export interface B09CandidateState {
  candidate_id: string;
  parent_references: CanonicalParentReference[];
  created_at: string;
  b08_version?: string;

  observations: LearningObservation[];
  operational_gaps: OperationalGap[];
  signals: LearningSignal[];
  feedback_rules: FeedbackRule[];
  proposals: LearningProposal[];

  conflicts_detected: ConflictRecord[];
  gaps: Gap[];
  evidence_refs: EvidenceRef[];
  provenance_refs: ProvenanceRef[];
  governance_events: Record<string, GovernanceEvent[]>;
  all_recommendations: Recommendation[];
  completeness: CompletenessScore;
}

export interface B09CanonicalState {
  identity: CanonicalIdentity;
  version: string;
  created_at: string;
  updated_at: string;
  user_decision_authority: string;

  b08_canonical_version?: string;

  observations: LearningObservation[];
  operational_gaps: OperationalGap[];
  signals: LearningSignal[];
  feedback_rules: FeedbackRule[];
  proposals: LearningProposal[];

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

export interface B09Deps {
  hash?: {
    stableObservationId: (type: string, module: string) => string;
    stableSignalId: (type: string, description: string) => string;
    stableProposalId: (moduleId: string, proposalType: string) => string;
  };
  now?: () => string;
}

export interface B09StatePersistence {
  save: (state: B09CanonicalState) => Promise<void>;
  load: (version: string) => Promise<B09CanonicalState | null>;
  listVersions: () => Promise<string[]>;
  latest: () => Promise<B09CanonicalState | null>;
}

/** Declared canonicalization field drops (intentional loss) */
export const KNOWN_CANONICALIZATION_DROPS = {
  candidate_id: "Pre-decision unique ID; not persisted to canonical versioned state",
  conflicts_detected: "Candidate-phase conflict detection; not carried forward to canonical state",
  gaps: "Candidate-phase content gaps identified during evaluation; not carried forward to canonical state",
  all_recommendations: "Candidate-phase recommendations; preserved as canonical.recommendations_considered",
  completeness: "Pre-decision completeness score; not persisted to canonical state",
  governance_events: "Internal governance event tracking; immutable in canonical state; candidate_governance carries full history",
} as const;
