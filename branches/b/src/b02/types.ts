// B02 — Content Intelligence Types
// Strategic opportunity evaluation and opportunity classification

import type { EvidenceRef } from "../types/entities.js";
import type { ProvenanceRef } from "../b00/provenanceRef.js";
import type { AuditEntry, VersionDiff } from "../b00/auditTrail.js";
import type { Decision, Recommendation, ConflictRecord, Gap } from "../b00/contracts.js";
import type { B01CanonicalState } from "../b00/contracts.js";
import type { GovernanceEvent } from "../b00/governance.js";
import type { CanonicalIdentity, CanonicalParentReference } from "../b00/identity.js";

/** Opportunity classification types */
export type OpportunityType =
  | "format_opportunity" // Platform format matches brand content strategy
  | "territory_opportunity" // Platform reaches specific content territory
  | "constraint_satisfaction" // Opportunity satisfies editorial/strategic constraint
  | "positioning_alignment" // Platform audience aligns with brand positioning
  | "capability_match"; // Platform has needed capability

export type ConstraintEvaluationStatus = "SATISFIED" | "UNSATISFIED" | "UNKNOWN";
export type StrategicScoreBasis = "HEURISTIC" | "EVIDENCE_BACKED" | "USER_PROVIDED";

/** Single strategic content opportunity */
export interface B02StrategicOpportunity {
  opportunity_id: string; // Stable hash

  // What is the opportunity?
  title: string; // e.g., "TikTok short-form video format opportunity"
  description: string; // Why this opportunity exists

  // Where and what?
  channel_id: string; // Which channel (from B01)
  platform_name: string; // e.g., "TIKTOK"

  // How does it fit?
  opportunity_type: OpportunityType;

  // How strategically important?
  strategic_relevance: number; // 0-1 score
  strategic_relevance_basis: StrategicScoreBasis;
  strategic_relevance_reason: string;

  // What must be satisfied?
  blocking_constraints: Array<{
    constraint_id: string;
    description: string;
    status: ConstraintEvaluationStatus;
    /** Legacy convenience. Present only when status is established. */
    satisfied?: boolean;
    evidence_refs: EvidenceRef[];
    reason: string;
  }>;

  // Why do we believe this?
  supporting_evidence: EvidenceRef[]; // Evidence from B01 + analysis

  // Who/what identified this?
  provenance: ProvenanceRef; // OBSERVED (from B01), INFERRED (algorithmic), RECOMMENDED (agent)

  // What does the agent recommend?
  recommendation?: Recommendation; // Agent's suggestion (not canonical truth)

  // What's unknown?
  gaps: Gap[]; // Data gaps affecting evaluation
}

/** Opportunity classification entry */
export interface OpportunityClass {
  class_id: string;
  type: OpportunityType;
  opportunities: string[]; // opportunity_ids in this class
  count: number;
  rationale: string; // Why these opportunities are grouped
}

/** Priority matrix entry */
export interface PriorityEntry {
  rank: number; // 1 = highest priority
  opportunity_id: string;
  strategic_relevance: number; // 0-1
  reasoning: string; // Why this priority?
}

/** Completeness scoring for B02 analysis */
export interface CompletenessScore {
  score: number; // 0-100
  missing_inputs: string[]; // What data gaps prevent complete analysis?
  blocking_decisions: string[]; // What must user decide next?
}

/** B02 pre-decision candidate state (all identified opportunities, not yet approved) */
export interface B02CandidateState {
  candidate_id: string;
  parent_references: CanonicalParentReference[];
  created_at: string;

  // All opportunities identified (INFERRED/RECOMMENDED provenance)
  opportunities: B02StrategicOpportunity[];

  // How are they classified?
  opportunity_classes: OpportunityClass[];

  // What's the priority?
  priority_matrix: PriorityEntry[];

  // What went wrong?
  conflicts_detected: ConflictRecord[]; // Opportunity vs constraint conflicts
  gaps: Gap[]; // Missing data for evaluation

  // Evidence trail
  evidence_refs: EvidenceRef[];
  provenance_refs: ProvenanceRef[];

  // Governance lifecycle events (append-only; populated by approveCandidate)
  governance_events: Record<string, GovernanceEvent[]>;

  // How complete is analysis?
  completeness: CompletenessScore;

  // Agent recommendations (not decisions)
  all_recommendations: Recommendation[];
}

/** B02 canonical state (after user approval, DECIDED provenance only) */
export interface B02CanonicalState {
  identity: CanonicalIdentity;
  version: string; // "v1.0", "v1.1", etc.
  created_at: string;
  updated_at: string;
  user_decision_authority: string; // Who approved this version?

  // Approved opportunities only (DECIDED provenance)
  opportunities: B02StrategicOpportunity[];
  opportunity_classes: OpportunityClass[];
  priority_matrix: PriorityEntry[];

  // Decision trail
  audit_trail: AuditEntry[]; // What was approved and when
  decisions_made: Decision[]; // Which opportunities were approved
  recommendations_considered: Recommendation[]; // Suggestions evaluated

  // Full evidence
  evidence_refs: EvidenceRef[];
  provenance_refs: ProvenanceRef[];

  // Governance lifecycle events (all events leading to this canonical version)
  governance_events: Record<string, GovernanceEvent[]>;

  // State of conflicts/gaps at this version
  conflicts: ConflictRecord[];
  gaps: Gap[];

  // Readiness
  completeness: CompletenessScore;
}

/** Dependencies for B02 phases (injected, same pattern as B01) */
export interface B02Deps {
  external_intelligence?: import("../b08/external/types.js").ExternalIntelligenceContext;
  hash?: {
    stableOpportunityId: (inputId: string, channelId: string, opportunityType: string) => string;
    stableClassId: (inputId: string, className: string) => string;
  };
  secretGuard?: {
    redactSecrets: (text: string) => string;
  };
  now?: () => string;
}

/** Persistence interface for B02 canonical state */
export interface B02StatePersistence {
  save(state: B02CanonicalState): Promise<void>;
  load(version: string): Promise<B02CanonicalState | null>;
  listVersions(): Promise<string[]>;
  latest(): Promise<B02CanonicalState | null>;
}

/** Evaluation context for internal analysis (not exported) */
export interface EvaluationContext {
  b01State: B01CanonicalState;
  opportunities: B02StrategicOpportunity[];
  gaps: Gap[];
  conflicts: ConflictRecord[];
}

/**
 * Canonicalization loss guard (Invariant 1).
 * Declares any fields intentionally dropped during candidate→canonical transition.
 * All top-level B02CandidateState fields are either preserved in canonical or explicitly declared below.
 */
export const KNOWN_CANONICALIZATION_DROPS = {
  parent_references: "Preserved in canonical.identity.parent_references",
  candidate_id: "Pre-decision unique ID; not persisted to canonical versioned state",
  conflicts_detected: "Candidate-phase conflict detection; preserved as canonical.conflicts field",
  all_recommendations: "Candidate-phase recommendations; preserved as canonical.recommendations_considered",
} as const;
