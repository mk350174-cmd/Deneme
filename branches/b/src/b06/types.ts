// B06 — Distribution Strategy Types
// Channel selection, content scheduling, format rules

import type { EvidenceRef } from "../types/entities.js";
import type { ProvenanceRef } from "../b00/provenanceRef.js";
import type { Decision, Recommendation, ConflictRecord, Gap, B01CanonicalState } from "../b00/contracts.js";
import type { GovernanceEvent } from "../b00/governance.js";
import type { CanonicalIdentity, CanonicalParentReference } from "../b00/identity.js";
import type { B03CandidateState } from "../b03/types.js";
import type { B04CandidateState, B04CanonicalState } from "../b04/types.js";

/** Channel selection for campaign */
export interface ChannelSelection {
  selection_id: string;
  campaign_id: string;
  channel_id: string; // From B01

  // Role in campaign
  role: "primary_channel" | "secondary_channel" | "testing_ground" | "experimental";
  priority_rank: number; // 1 = highest

  // Why selected
  rationale: string;
  strategic_fit: number; // 0-1 confidence
  fit_basis: "HEURISTIC" | "EVIDENCE_BACKED" | "USER_SELECTED";

  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

/** Content scheduling strategy */
export interface ContentSchedule {
  schedule_id: string;
  campaign_id: string;
  channel_id: string;

  // Posting frequency
  posting_frequency: "daily" | "2_3_weekly" | "weekly" | "bi_weekly" | "monthly" | "as_available";

  // Optimal times
  optimal_posting_times: string[]; // framework defaults unless user/evidence supplied
  timezone_adapted: boolean;
  schedule_basis: "DEFAULT" | "EVIDENCE_BACKED" | "USER_DEFINED";
  timezone_basis: "DEFAULT" | "EVIDENCE_BACKED" | "USER_DEFINED" | "UNKNOWN";
  source_timezone: string | "UNKNOWN";
  target_timezone: string | "UNKNOWN";
  conversion_method: "NONE" | "IANA_CONVERSION" | "USER_DEFINED";
  empirically_optimized: boolean;

  // Content pacing
  days_between_posts?: number; // For scheduled frequency

  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

/** Format rules for channel */
export interface FormatRule {
  rule_id: string;
  campaign_id: string;
  channel_id: string;

  // Preferred formats
  preferred_content_formats: string[]; // "short_video", "carousel", "article", etc.
  forbidden_formats?: string[];

  // Duration guidance
  duration_category: "short" | "medium" | "long" | "flexible"; // Strategic, not exact specs
  duration_guidance?: string; // framework guidance, not empirical unless stated
  rule_basis: "DEFAULT" | "EVIDENCE_BACKED" | "USER_DEFINED";

  // Quality standards
  quality_standards: string[];

  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

/** Distribution strategy aggregated */
export interface DistributionStrategy {
  strategy_id: string;
  campaign_id: string;

  // Channels and their rules
  channel_selections: ChannelSelection[];
  content_schedules: ContentSchedule[];
  format_rules: FormatRule[];

  // Audience adaptation
  audience_customizations: Array<{
    segment_id: string;
    channel_id: string;
    customization: string;
  }>;

  // Territory rules
  territory_rules: Array<{
    territory_id: string;
    allowed_channels: string[];
    restrictions?: string[];
  }>;

  evidence_refs: EvidenceRef[];
}

/** B06 completeness scoring */
export interface CompletenessScore {
  score: number; // 0-100
  missing_inputs: string[];
  blocking_decisions: string[];
}

/** B06 pre-decision candidate state */
export interface B06CandidateState {
  candidate_id: string;
  parent_references: CanonicalParentReference[];
  created_at: string;
  b01_version: string;
  b03_version?: string;
  b04_version?: string;

  // Distribution outputs
  channel_selections: ChannelSelection[];
  content_schedules: ContentSchedule[];
  format_rules: FormatRule[];
  distribution_strategies: DistributionStrategy[];

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

/** B06 post-decision canonical state (versioned, immutable) */
export interface B06CanonicalState {
  identity: CanonicalIdentity;
  version: string; // v1.0, v1.1, etc.
  created_at: string;
  updated_at: string;
  user_decision_authority: string;

  // Context versions
  b01_canonical_version: string;
  b03_canonical_version?: string;
  b04_canonical_version?: string;

  // Only DECIDED provenance items
  channel_selections: ChannelSelection[];
  content_schedules: ContentSchedule[];
  format_rules: FormatRule[];
  distribution_strategies: DistributionStrategy[];

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

/** B06 input contract */
export interface B06Input {
  b01_canonical_state: B01CanonicalState;
  b03_candidate_state: B03CandidateState;
  b04_candidate_or_canonical?: B04CandidateState | B04CanonicalState;
}

/** Dependency injection for B06 */
export interface B06Deps {
  hash?: {
    stableSelectionId: (campaignId: string, channelId: string) => string;
    stableScheduleId: (campaignId: string, channelId: string) => string;
    stableFormatRuleId: (campaignId: string, channelId: string) => string;
    stableStrategyId: (campaignId: string) => string;
  };
  now?: () => string;
}

/** Persistence interface */
export interface B06StatePersistence {
  save: (state: B06CanonicalState) => Promise<void>;
  load: (version: string) => Promise<B06CanonicalState | null>;
  listVersions: () => Promise<string[]>;
  latest: () => Promise<B06CanonicalState | null>;
}

/** Declared canonicalization field drops (intentional loss) */
export const KNOWN_CANONICALIZATION_DROPS = {
  candidate_id: "Pre-decision unique ID; not persisted to canonical versioned state",
  conflicts_detected: "Candidate-phase conflict detection; preserved as canonical conflicts field if needed",
  gaps: "Candidate-phase distribution gaps identified during evaluation; not carried forward to canonical state",
  all_recommendations: "Candidate-phase recommendations; preserved as canonical.recommendations_considered",
  completeness: "Pre-decision completeness score; represents readiness at candidate stage",
  governance_events: "Internal governance event tracking; immutable in canonical state; candidate_governance carries full history",
} as const;
