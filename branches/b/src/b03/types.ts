// B03 — Audience Intelligence Types
// Audience segmentation, profiles, needs, pain points, questions

import type { EvidenceRef } from "../types/entities.js";
import type { ProvenanceRef } from "../b00/provenanceRef.js";
import type { Decision, Recommendation, ConflictRecord, Gap, B01CanonicalState } from "../b00/contracts.js";
import type { GovernanceEvent } from "../b00/governance.js";
import type { CanonicalIdentity, CanonicalParentReference } from "../b00/identity.js";

/** B03 audit trail entry (version history) */
export interface B03AuditEntry {
  version: string;
  changed_at: string;
  changed_by: string;
  summary: string;
}

/** Seniority level classification */
export type SeniorityLevel = "junior" | "mid" | "senior" | "executive" | "UNKNOWN";

/** Company size classification */
export type CompanySize = "startup" | "scale_up" | "enterprise" | "solo" | "UNKNOWN";

/** Audience need type */
export type AudienceNeedType = "knowledge" | "capability" | "tool" | "community" | "validation" | "mentorship" | "UNKNOWN";

/** Audience pain point type */
export type AudiencePainPointType = "efficiency" | "quality" | "cost" | "skill_gap" | "process" | "compliance" | "UNKNOWN";

/** Audience question category */
export type AudienceQuestionCategory = "technical" | "strategic" | "best_practice" | "tool_selection" | "career" | "UNKNOWN";

/** Observable audience characteristics */
export interface AudienceCharacteristics {
  role_title?: string; // "CTO", "Engineering Manager"
  seniority_level?: SeniorityLevel;
  company_size?: CompanySize;
  industry?: string[]; // "fintech", "saas", "hardware"
  education_level?: string;
  experience_years?: string; // "5-10 years"
  technical_background?: boolean;
  other_attributes?: Record<string, string>;
}

/** Single audience segment (channel-specific or cross-channel) */
export interface AudienceSegment {
  segment_id: string; // Stable hash

  // Identity
  segment_name: string; // "Enterprise CTOs" | "Indie hackers"
  segment_profile_id?: string; // Link to shared profile

  // Where is this audience?
  channel_ids: string[]; // Which channels reach this segment
  platform_names: string[]; // Which platforms
  geography?: string[]; // Where they're located
  timezone?: string[]; // Primary time zones

  // Who are they?
  characteristics: AudienceCharacteristics;

  // Evidence for this segment
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef; // OBSERVED, INFERRED, RECOMMENDED, DECIDED

  /** Segment naming/formation is explicitly classified; platform-derived segments are HEURISTIC. */
  segment_basis: "HEURISTIC" | "EVIDENCE_BACKED" | "HUMAN_DEFINED";
  geography_basis: "OBSERVED" | "INFERRED" | "UNKNOWN";
  timezone_basis: "OBSERVED" | "INFERRED" | "UNKNOWN";

  // Confidence
  confidence: number; // 0-1
  confidence_basis: "EVIDENCE_POLICY" | "HEURISTIC" | "USER_PROVIDED";
  data_sources: string[]; // Which sources support this segment
}

/** Reusable segment profile (shared across channels if same audience) */
export interface SegmentProfile {
  profile_id: string; // Stable hash

  segment_name: string; // Display name
  description: string; // Summary of who this segment is

  // Characteristics (aggregated from segments)
  characteristics: AudienceCharacteristics;
  /** Conflicting scalar characteristics are preserved instead of silently choosing one. */
  characteristic_conflicts?: Record<string, unknown[]>;

  // This profile reaches these segments (references)
  segment_ids: string[];

  // Platform affinity (which platforms this segment is most active on)
  platform_affinity: {
    platform_name: string;
    engagement_level: number; // 0-1
    evidence_refs: EvidenceRef[];
  }[];

  // Evidence
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef; // INFERRED, RECOMMENDED, DECIDED

  confidence: number; // 0-1
}

/** Single audience need */
export interface AudienceNeed {
  need_id: string;
  segment_id: string;
  need_type: AudienceNeedType;
  description: string; // e.g., "best practices for refactoring"
  urgency: "high" | "medium" | "low";
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

/** Single audience pain point */
export interface AudiencePainPoint {
  pain_point_id: string;
  segment_id: string;
  pain_point_type: AudiencePainPointType;
  description: string; // e.g., "technical debt management"
  severity: "high" | "medium" | "low";
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

/** Single audience question */
export interface AudienceQuestion {
  question_id: string;
  segment_id: string;
  category: AudienceQuestionCategory;
  description: string; // e.g., "how to assess code quality?"
  frequency: "common" | "occasional" | "rare";
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

/** Aggregated audience insight */
export interface AudienceInsight {
  insight_id: string;
  type: "need" | "pain_point" | "question";
  description: string;
  related_segments: string[]; // segment_ids affected
  relevance: number; // 0-1
  evidence_refs: EvidenceRef[];
  provenance: ProvenanceRef;
}

/** Input to B03 */
export interface B03Input {
  external_intelligence?: import("../b08/external/types.js").ExternalIntelligenceContext;
  b01_canonical_state: B01CanonicalState; // Immutable

  audience_sources?: {
    platform_analytics?: Array<{
      platform_id: string;
      channel_id: string;
      demographic_data?: string;
      geography?: string[];
      interests?: string[];
      engagement_pattern?: string;
      source: string; // "YouTube Analytics", "LinkedIn Insights"
      verified_at?: string;
    }>;

    user_research?: Array<{
      research_id: string;
      method: "survey" | "interview" | "observation" | "market_research";
      findings: string;
      sample_size?: number;
      conducted_at?: string;
      confidence?: number; // 0-1
    }>;

    documentation?: {
      brand_guidelines?: string;
      audience_profile_doc?: string;
      market_research?: string;
      competitive_analysis?: string;
    };

    user_input?: string; // Free-form user input
  };
}

/** Completeness scoring for B03 analysis */
export interface CompletenessScore {
  score: number; // 0-100
  missing_inputs: string[]; // What data gaps prevent complete analysis?
  blocking_decisions: string[]; // What must user decide next?
}

/** B03 pre-decision candidate state (all identified segments, not yet approved) */
export interface B03CandidateState {
  candidate_id: string;
  parent_references: CanonicalParentReference[];
  created_at: string;
  b01_canonical_version: string; // Which B01 version was consumed

  // All segments identified (INFERRED/RECOMMENDED provenance)
  audience_segments: AudienceSegment[];

  // Reusable profiles
  segment_profiles: SegmentProfile[];

  // Aggregated insights
  audience_insights: AudienceInsight[];

  // Detailed needs/pain points/questions
  audience_needs: AudienceNeed[];
  audience_pain_points: AudiencePainPoint[];
  audience_questions: AudienceQuestion[];

  // Validation
  conflicts_detected: ConflictRecord[];
  gaps: Gap[];

  // Evidence trail
  evidence_refs: EvidenceRef[];
  provenance_refs: ProvenanceRef[];

  // Governance lifecycle events (append-only; populated by approveCandidate)
  governance_events: Record<string, GovernanceEvent[]>;

  // Recommendations (not yet canonical)
  all_recommendations: Recommendation[];

  // Readiness
  completeness: CompletenessScore;
}

/** B03 post-decision canonical state (versioned, immutable) */
export interface B03CanonicalState {
  identity: CanonicalIdentity;
  version: string; // v1.0, v1.1, etc. — user-incremented
  created_at: string;
  updated_at: string;
  user_decision_authority: string;

  b01_canonical_version: string; // Which B01 version this was built from

  // Only DECIDED provenance (user-approved)
  audience_segments: AudienceSegment[];
  segment_profiles: SegmentProfile[];
  audience_insights: AudienceInsight[];
  audience_needs: AudienceNeed[];
  audience_pain_points: AudiencePainPoint[];
  audience_questions: AudienceQuestion[];

  // Audit trail
  audit_trail: B03AuditEntry[];
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

/** Dependency injection interface for B03 */
export interface B03Deps {
  hash?: {
    stableSegmentId: (b01Version: string, channelId: string, segmentName: string) => string;
    stableProfileId: (b01Version: string, profileName: string) => string;
    stableInsightId: (b01Version: string, insightType: string, description: string) => string;
  };
  secretGuard?: {
    redactSecrets: (text: string) => string;
  };
  now?: () => string;
}

/** Persistence interface for B03 state versions */
export interface B03StatePersistence {
  save: (state: B03CanonicalState) => Promise<void>;
  load: (version: string) => Promise<B03CanonicalState | null>;
  listVersions: () => Promise<string[]>;
  latest: () => Promise<B03CanonicalState | null>;
}

/**
 * Canonicalization loss guard (Invariant 1).
 * Declares any fields intentionally dropped during candidate→canonical transition.
 * All top-level B03CandidateState fields are either preserved in canonical or explicitly declared below.
 */
export const KNOWN_CANONICALIZATION_DROPS = {
  parent_references: "Preserved in canonical.identity.parent_references",
  candidate_id: "Pre-decision unique ID; not persisted to canonical versioned state",
  conflicts_detected: "Candidate-phase conflict detection; not carried forward to B03CanonicalState (architectural decision: conflicts handled in B11)",
  gaps: "Data completeness gaps; not carried forward to B03CanonicalState (architectural decision: gaps are pre-decision readiness metric)",
  all_recommendations: "Candidate-phase recommendations; preserved as canonical.recommendations_considered",
  completeness: "Pre-decision completeness score; represents readiness at candidate stage, not persisted to canonical",
} as const;
