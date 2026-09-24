// B10 — Continuous Optimization Types

import type { EvidenceRef } from "../types/entities.js";
import type { ProvenanceRef } from "../b00/provenanceRef.js";
import type { ConflictRecord, Gap, Decision, Recommendation } from "../b00/contracts.js";
import type { GovernanceEvent } from "../b00/governance.js";
import type { CanonicalIdentity, CanonicalParentReference } from "../b00/identity.js";

export interface OptimizationProposal {
  proposal_id: string;
  proposal_type: "parameter_adjustment" | "strategy_refinement" | "gap_closure";
  target_module: string;
  parameter_name: string;
  current_state: string;
  observed_problem: string;
  hypothesis: string;
  proposed_change: string;
  expected_effect: string;
  required_approval: boolean;
  proposal_basis: "LEARNING_SIGNAL" | "HEURISTIC" | "USER_DEFINED";
  /** Legacy-compatible aliases; these must contain meaningful values, never placeholders. */
  current_value: string;
  proposed_value: string;
  confidence: number;
  confidence_basis: "SIGNAL_CHAIN" | "HEURISTIC" | "USER_PROVIDED";
  expected_impact: string;
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

export interface ImpactAssessment {
  assessment_id: string;
  proposal_id: string;
  risk_level: "low" | "medium" | "high";
  risk_reason: string;
  benefit_score: number;
  benefit_reason: string;
  affected_modules: string[];
  affected_modules_basis: "DEPENDENCY_GRAPH";
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

export interface CompletenessScore { score: number; missing_inputs: string[]; blocking_decisions: string[]; }

export interface B10CandidateState {
  candidate_id: string;
  parent_references: CanonicalParentReference[];
  created_at: string;
  b09_version?: string;
  optimization_proposals: OptimizationProposal[];
  impact_assessments: ImpactAssessment[];
  conflicts_detected: ConflictRecord[];
  gaps: Gap[];
  evidence_refs: EvidenceRef[];
  provenance_refs: ProvenanceRef[];
  governance_events: Record<string, GovernanceEvent[]>;
  all_recommendations: Recommendation[];
  completeness: CompletenessScore;
}

export interface B10CanonicalState {
  identity: CanonicalIdentity;
  version: string;
  created_at: string;
  updated_at: string;
  user_decision_authority: string;
  b09_canonical_version?: string;
  optimization_proposals: OptimizationProposal[];
  impact_assessments: ImpactAssessment[];
  audit_trail: Array<{ version: string; changed_at: string; changed_by: string; summary: string }>;
  decisions_made: Decision[];
  recommendations_considered: Recommendation[];
  evidence_refs: EvidenceRef[];
  provenance_refs: ProvenanceRef[];
  governance_events: Record<string, GovernanceEvent[]>;
  decision_timestamp: string;
  cannot_be_modified_until_next_version: boolean;
}

export interface B10Deps {
  hash?: { stableProposalId: (moduleId: string, paramName: string) => string; stableAssessmentId: (proposalId: string) => string };
  now?: () => string;
}
export interface B10StatePersistence { save:(state:B10CanonicalState)=>Promise<void>; load:(version:string)=>Promise<B10CanonicalState|null>; listVersions:()=>Promise<string[]>; latest:()=>Promise<B10CanonicalState|null>; }

export const KNOWN_CANONICALIZATION_DROPS = {
  candidate_id: "Pre-decision unique ID; not persisted to canonical versioned state",
  conflicts_detected: "Candidate-phase conflict detection; not carried forward to canonical state",
  gaps: "Candidate-phase optimization gaps; not carried forward to canonical state",
  all_recommendations: "Candidate recommendations are preserved as canonical.recommendations_considered",
  completeness: "Candidate structural completeness score; not persisted as semantic readiness",
} as const;
