// B04 — Strategic Planning Types
// Campaign strategy, priority matrix, territorial messaging

import type { EvidenceRef } from "../types/entities.js";
import type { ProvenanceRef } from "../b00/provenanceRef.js";
import type { Decision, Recommendation, ConflictRecord, Gap, B01CanonicalState } from "../b00/contracts.js";
import type { GovernanceEvent } from "../b00/governance.js";
import type { CanonicalIdentity, CanonicalParentReference } from "../b00/identity.js";
import type { B02CanonicalState } from "../b02/types.js";
import type { B03CandidateState } from "../b03/types.js";

/** Campaign strategy definition */
export interface CampaignStrategy {
  campaign_id: string;
  campaign_name: string; // e.g., "Q4 2026 Enterprise CTOs"
  description: string;

  // Strategic context
  target_segments: string[]; // B03 segment IDs
  aligned_opportunities: string[]; // B02 opportunity IDs

  // Territory & timing
  territories: string[]; // territory IDs from B01
  timeline_months: number; // Duration in months
  timeline_basis: "DEFAULT" | "USER_DEFINED" | "EVIDENCE_BACKED";
  timeline_source?: string;

  // Strategic objectives
  primary_objective: string; // e.g., "Build thought leadership in enterprise segment"
  secondary_objectives: string[];

  // Evidence & provenance
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
  confidence: number; // 0-1
  confidence_basis: "HEURISTIC" | "EVIDENCE_POLICY" | "USER_PROVIDED";
}

/** Strategic priority entry */
export interface StrategicPriority {
  priority_id: string;
  rank: number; // 1 = highest
  campaign_id: string;
  description: string;
  rationale: string; // Why this matters

  // Constraints & dependencies
  blocks?: string[]; // priority_ids this blocks
  depends_on?: string[]; // priority_ids this depends on

  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

/** Strategic alignment score */
export interface AlignmentScore {
  score_id: string;
  opportunity_id: string; // B02 opportunity
  segment_id: string; // B03 segment
  alignment_score: number; // 0-1
  rationale: string;
  evidence_refs: EvidenceRef[];
}

/** Territorial messaging strategy */
export interface TerritorialStrategy {
  territory_id: string; // from B01
  campaigns: string[]; // campaign_ids
  messaging_tone: string; // e.g., "formal", "casual", "technical"
  localization_needs: string[];
  evidence_refs: EvidenceRef[];
}

/** B04 completeness scoring */
export interface CompletenessScore {
  score: number; // 0-100
  missing_inputs: string[];
  blocking_decisions: string[];
}

/** B04 pre-decision candidate state */
export interface B04CandidateState {
  candidate_id: string;
  parent_references: CanonicalParentReference[];
  created_at: string;
  b01_version: string;
  b02_version?: string; // Latest B02 consumed
  b03_version?: string; // Latest B03 consumed

  // Campaign strategies
  campaigns: CampaignStrategy[];

  // Priority matrix
  strategic_priorities: StrategicPriority[];

  // Alignment analysis
  alignment_matrix: AlignmentScore[];

  // Territorial strategies
  territorial_strategies: TerritorialStrategy[];

  // Validation
  conflicts_detected: ConflictRecord[];
  gaps: Gap[];

  // Evidence trail
  evidence_refs: EvidenceRef[];
  provenance_refs: ProvenanceRef[];

  // Governance lifecycle events (append-only; populated by approveCandidate)
  governance_events: Record<string, GovernanceEvent[]>;

  // Recommendations
  all_recommendations: Recommendation[];

  // Readiness
  completeness: CompletenessScore;
}

/** B04 post-decision canonical state (versioned, immutable) */
export interface B04CanonicalState {
  identity: CanonicalIdentity;
  version: string; // v1.0, v1.1, etc.
  created_at: string;
  updated_at: string;
  user_decision_authority: string;

  // Context versions
  b01_canonical_version: string;
  b02_canonical_version?: string;
  b03_canonical_version?: string;

  // Only DECIDED provenance items
  campaigns: CampaignStrategy[];
  strategic_priorities: StrategicPriority[];
  alignment_matrix: AlignmentScore[];
  territorial_strategies: TerritorialStrategy[];

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

  // Governance lifecycle events (all events leading to this canonical version)
  governance_events: Record<string, GovernanceEvent[]>;

  // Immutability enforcement
  decision_timestamp: string;
  cannot_be_modified_until_next_version: boolean;
}

/** B04 input contract */
export interface B04Input {
  b01_canonical_state: B01CanonicalState;
  b02_candidate_or_canonical?: B02CanonicalState;
  b03_candidate_state: B03CandidateState;
}

/** Dependency injection for B04 */
export interface B04Deps {
  hash?: {
    stableCampaignId: (name: string, b01Version: string) => string;
    stablePriorityId: (campaignId: string, rank: number) => string;
    stableAlignmentId: (opportunityId: string, segmentId: string, score: string) => string;
  };
  now?: () => string;
}

/** Persistence interface */
export interface B04StatePersistence {
  save: (state: B04CanonicalState) => Promise<void>;
  load: (version: string) => Promise<B04CanonicalState | null>;
  listVersions: () => Promise<string[]>;
  latest: () => Promise<B04CanonicalState | null>;
}

/**
 * Canonicalization loss guard (Invariant 1).
 * Declares any fields intentionally dropped during candidate→canonical transition.
 * All top-level B04CandidateState fields are either preserved in canonical or explicitly declared below.
 */
export const KNOWN_CANONICALIZATION_DROPS = {
  candidate_id: "Pre-decision unique ID; not persisted to canonical versioned state",
  conflicts_detected: "Candidate-phase conflict detection; dropped during canonicalization (Phase 1 scope: no conflicts tracking in canonical state)",
  gaps: "Candidate-phase strategic gaps identified during evaluation; not carried forward to canonical state",
  territorial_strategies: "Candidate-phase territorial mapping; carried to canonical but hardcoded empty in Phase 1 (deferred population)",
  all_recommendations: "Candidate-phase recommendations; preserved as canonical.recommendations_considered",
  completeness: "Pre-decision completeness score; represents readiness at candidate stage, not persisted to canonical",
} as const;
