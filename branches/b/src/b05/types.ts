// B05 — Creative Synthesis Types
// Strategic creative direction and creative constraints

import type { EvidenceRef } from "../types/entities.js";
import type { ProvenanceRef } from "../b00/provenanceRef.js";
import type { Decision, Recommendation, ConflictRecord, Gap, B01CanonicalState } from "../b00/contracts.js";
import type { GovernanceEvent } from "../b00/governance.js";
import type { CanonicalIdentity, CanonicalParentReference } from "../b00/identity.js";
import type { B03CandidateState } from "../b03/types.js";
import type { B04CandidateState, B04CanonicalState } from "../b04/types.js";

/** Creative angle for a campaign */
export interface CreativeAngle {
  angle_id: string;
  campaign_id: string; // From B04
  title: string; // e.g., "Enterprise thought leadership angle"
  description: string;
  target_audience_segment: string; // B03 segment_id

  // Strategic positioning
  core_message: string;
  emotional_appeal?: string; // What feelings should it evoke
  credibility_angle?: string; // Why is this brand credible on this topic

  // Content approach
  content_types: string[]; // "explainer", "case_study", "advice", "story", etc.
  tone: "formal" | "casual" | "technical" | "narrative" | "humorous";

  // Evidence & provenance
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
  confidence: number; // 0-1
  confidence_basis: "HEURISTIC_DEFAULT" | "EVIDENCE_POLICY" | "USER_PROVIDED";
  derivation_basis: "TEMPLATE" | "HEURISTIC" | "EVIDENCE_BACKED" | "HUMAN_DECIDED";
}

/** Creative constraint for safety/brand compliance */
export interface CreativeConstraint {
  constraint_id: string;
  campaign_id: string;
  constraint_type: "forbidden_topics" | "required_elements" | "tone_requirements" | "brand_protection";
  description: string;
  details: string[];

  // Why this matters
  rationale: string;
  editorial_authority?: string; // Who enforced this

  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
  derivation_basis: "TEMPLATE" | "HEURISTIC" | "EVIDENCE_BACKED" | "HUMAN_DECIDED";
}

/** Messaging strategy for target segment */
export interface MessagingStrategy {
  messaging_id: string;
  segment_id: string; // B03 segment
  campaign_id: string;

  // Core messaging
  primary_message: string;
  supporting_messages: string[];
  value_proposition: string; // Why should this segment care

  // Audience adaptation
  pain_points_addressed: string[];
  desired_outcome: string;

  // Tone & style
  language_style: string;
  key_terminology: string[];

  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
  derivation_basis: "TEMPLATE" | "HEURISTIC" | "EVIDENCE_BACKED" | "HUMAN_DECIDED";
}

/** Creative brief synthesized for production handoff */
export interface CreativeBrief {
  brief_id: string;
  campaign_id: string;

  // What to create
  content_objectives: string[];
  creative_angles: CreativeAngle[];
  messaging_strategies: MessagingStrategy[];
  creative_constraints: CreativeConstraint[];

  // Success criteria
  key_metrics: string[];
  quality_standards: string[];

  evidence_refs: EvidenceRef[];
}

/** B05 completeness scoring */
export interface CompletenessScore {
  score: number; // 0-100
  missing_inputs: string[];
  blocking_decisions: string[];
}

/** B05 pre-decision candidate state */
export interface B05CandidateState {
  candidate_id: string;
  parent_references: CanonicalParentReference[];
  created_at: string;
  b01_version: string;
  b02_version?: string;
  b03_version?: string;
  b04_version?: string;

  // Creative synthesis outputs
  creative_angles: CreativeAngle[];
  messaging_strategies: MessagingStrategy[];
  creative_constraints: CreativeConstraint[];
  creative_briefs: CreativeBrief[];

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

/** B05 post-decision canonical state (versioned, immutable) */
export interface B05CanonicalState {
  identity: CanonicalIdentity;
  version: string; // v1.0, v1.1, etc.
  created_at: string;
  updated_at: string;
  user_decision_authority: string;

  // Context versions
  b01_canonical_version: string;
  b02_canonical_version?: string;
  b03_canonical_version?: string;
  b04_canonical_version?: string;

  // Only DECIDED provenance items
  creative_angles: CreativeAngle[];
  messaging_strategies: MessagingStrategy[];
  creative_constraints: CreativeConstraint[];
  creative_briefs: CreativeBrief[];

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

/** B05 input contract */
export interface B05Input {
  b01_canonical_state: B01CanonicalState;
  b03_candidate_state: B03CandidateState;
  b04_candidate_or_canonical?: B04CandidateState | B04CanonicalState;
}

/** Dependency injection for B05 */
export interface B05Deps {
  hash?: {
    stableAngleId: (campaignId: string, angleTitle: string) => string;
    stableMessagingId: (segmentId: string, campaignId: string) => string;
    stableConstraintId: (campaignId: string, type: string) => string;
    stableBriefId: (campaignId: string) => string;
  };
  now?: () => string;
}

/** Persistence interface */
export interface B05StatePersistence {
  save: (state: B05CanonicalState) => Promise<void>;
  load: (version: string) => Promise<B05CanonicalState | null>;
  listVersions: () => Promise<string[]>;
  latest: () => Promise<B05CanonicalState | null>;
}

/**
 * Canonicalization loss guard (Invariant 1).
 * Declares any fields intentionally dropped during candidate→canonical transition.
 * All top-level B05CandidateState fields are either preserved in canonical or explicitly declared below.
 */
export const KNOWN_CANONICALIZATION_DROPS = {
  candidate_id: "Pre-decision unique ID; not persisted to canonical versioned state",
  conflicts_detected: "Candidate-phase conflict detection; preserved as canonical.conflicts (mapped during commitVersion)",
  gaps: "Data completeness gaps; not carried forward to B05CanonicalState (architectural decision: gaps are pre-decision readiness metric)",
  all_recommendations: "Candidate-phase recommendations; preserved as canonical.recommendations_considered",
  completeness: "Pre-decision completeness score; represents readiness at candidate stage, not persisted to canonical",
} as const;
