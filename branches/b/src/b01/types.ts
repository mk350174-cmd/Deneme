// B01 — Internal Phase Types
// Data structures flowing between phases (distinct from B00 public contracts)

import type { EvidenceRef, EvidenceStatus } from "../types/entities.js";
import type { ProvenanceRef, ProvenanceChain } from "../b00/provenanceRef.js";
import type { GovernanceEvent } from "../b00/governance.js";
import type { AuditEntry } from "../b00/auditTrail.js";
import type {
  B01Input,
  B01CanonicalState,
  Decision,
  Recommendation,
  ConflictRecord,
  Gap,
  Approval,
} from "../b00/contracts.js";
import type {
  Platform,
  PlatformCapability,
  ChannelRole,
  DistributionRole,
  TerritoryType,
  ConstraintLevel,
} from "../b00/terminology.js";

// ============================================================================
// PHASE OUTPUTS (internal shape before B01.12 assembly)
// ============================================================================

export interface EcosystemData {
  channels: Array<{
    channel_id: string;
    name: string;
    raw_platform: string; // user-provided string
    platform: Platform; // normalized enum
    audience_category?: string;
    url?: string;
    source: string; // "user_input:known_channels[i]"
    evidence_refs?: EvidenceRef[]; // Per-channel evidence (was previously only tracked at the top level, making it impossible to carry per-channel evidence through to canonicalization)
  }>;
  platforms: Array<{
    platform_id: string;
    name: string;
    raw_name?: string; // if user-provided
    evidence_refs?: EvidenceRef[]; // Per-platform evidence, when directly attributable (e.g. user-provided platform entries)
  }>;
  evidence_refs: EvidenceRef[];
  provenance_refs?: ProvenanceRef[]; // PHASE 2: Track OBSERVED provenance
}

export interface BrandArchitecture {
  /** UNIFIED FIX B-1: echoed from user-provided brand_context (user assertion, not verified). */
  brand_name?: string | "UNKNOWN";
  mission?: string | "UNKNOWN";
  positioning_summary: string | "UNKNOWN";
  value_themes: string[];
  evidence_refs: EvidenceRef[];
  provenance_refs?: ProvenanceRef[]; // PHASE 2: Track decision chain
  recommendation: Recommendation;
}

export interface RoleMap {
  [channel_id: string]: {
    role: ChannelRole;
    evidence_refs: EvidenceRef[];
    provenance_refs?: ProvenanceRef[]; // PHASE 2: Track decision chain per role
  };
}

export interface RelationshipGraph {
  edges: Array<{
    from_channel_id: string;
    to_channel_id: string;
    relationship_type: "primary_to_secondary" | "feeds_into" | "mirrors" | "complements" | "conflicts" | "UNKNOWN";
    strength: number; // 0-1 confidence score
    provenance_refs: ProvenanceRef[]; // Tracks INFERRED vs DECIDED vs OBSERVED
    evidence_refs: EvidenceRef[]; // Data backing the relationship
  }>;
  evidence_refs: EvidenceRef[];
  provenance_refs?: ProvenanceRef[]; // PHASE 2: Track graph-level decision chain
  recommendation: Recommendation;
}

export interface PlatformRegistry {
  [platform_id: string]: {
    name: string;
    capabilities: Array<{
      capability: PlatformCapability;
      source: "provider_registry" | "channel_presence" | "user_provided";
      evidence_status: "VERIFIED" | "INFERRED" | "UNKNOWN";
      evidence_refs: EvidenceRef[]; // Where this capability was found
      provenance_refs?: ProvenanceRef[]; // Per-capability decision chain
    }>;
    audience_reach?: "broad" | "professional" | "niche" | "UNKNOWN";
    content_formats?: string[]; // ContentFormat[] — supported content types
    monetization_eligible?: boolean;
    requires_verification?: boolean;
    evidence_refs: EvidenceRef[]; // Platform-level evidence
    provenance_refs?: ProvenanceRef[]; // Platform-level decision chain
  };
}

export interface ChannelFitMap {
  [channel_id: string]: {
    fit_score: number;
    platform: string;
    audience_category: string;
    reasoning: string[];
    provenance_refs: ProvenanceRef[];
    evidence_refs: EvidenceRef[];
  };
}

export interface TerritoryData {
  territories: Array<{
    territory_id: string;
    type: TerritoryType; // "geographic" | "regulatory" | "timezone" | "audience_segment" | "UNKNOWN"
    description: string;
    boundaries: string[]; // Geographic regions, time zones, regulatory scopes — NOT audience attributes
    channels_allowed: string[]; // channel_ids permitted in this territory
    channels_restricted: string[]; // channel_ids with limitations
    compliance_notes: string[]; // Regulatory/policy constraints
    evidence_refs: EvidenceRef[]; // MUST be from user_input or documentation, never inferred from platform name
  }>;
  provenance_refs?: ProvenanceRef[]; // PHASE 2: Track decision chain
}

export interface DistributionData {
  strategy_description: string;
  channel_assignments: Array<{
    channel_id: string;
    distribution_role: DistributionRole; // "primary_channel" | "secondary_channel" | "testing_ground" | "experimental" | "UNKNOWN"
    routing_priority: number; // 1 (highest), 2, 3, ... N (for multi-channel routing)
    timing_rules: {
      posting_frequency: string; // "daily", "2_3_weekly", "weekly", "as_available"
      optimal_times: string[]; // ["9am EST", "2pm EST"] — strategy, not exact scheduling
      timezone_adapted: boolean;
    };
    format_rules: {
      preferred_formats: string[]; // ContentFormat[] — strategic categories
      forbidden_formats: string[];
      strategic_duration_category: "short" | "medium" | "long" | "flexible"; // NOT exact specs
    };
    territory_rules: {
      allowed_territories: string[]; // territory_ids permitted
      geo_restrictions: string[]; // ["China", "Russia"] — regulatory blocks
      age_restrictions?: string; // "13+", "18+", or null
    };
    evidence_refs: EvidenceRef[];
    provenance_refs?: ProvenanceRef[]; // PHASE 2: Track per-assignment decision chain
  }>;
  evidence_refs: EvidenceRef[];
  provenance_refs?: ProvenanceRef[]; // PHASE 2: Track strategy decision chain
}

/**
 * Canonical B01-domain shape for an editorial rule.
 *
 * This is the ONE definition of "editorial rule" in B01 — B01.09 (which
 * produces these) and B01.10/B01.11 and conflicts.ts/completeness.ts (which
 * consume them) all import this type instead of declaring their own
 * incompatible local shadow (a prior architectural defect: three separate
 * "EditorialData" shapes existed — in this file, in B01_09, and implicitly
 * consumed-as-different-shape by B01_10/B01_11 — bridged only by `as any`).
 *
 * `category`/`rule_text`/`applies_to_channels` reflect what B01.09 actually
 * extracts from documentation (tone, content-type, brand-safety keyword
 * matching). This is intentionally NOT the same axis as B00's
 * `EditorialRuleType` ("required"|"forbidden"|"restricted"|"encouraged"),
 * which classifies what a rule DOES rather than what KIND of rule it is —
 * B01.09 does not currently produce that classification. See
 * `mapEditorialDataToCanonical` in orchestration.ts for how (and why only
 * partially) this maps into B00's canonical `editorial_constitution` shape.
 */
export interface EditorialRule {
  rule_id: string;
  category: "tone" | "content_type" | "audience_fit" | "brand_safety" | "compliance";
  rule_text: string;
  applies_to_channels?: string[]; // channel_ids; undefined/empty = all channels
  evidence_refs: EvidenceRef[];
}

export interface EditorialData {
  constitution_id: string;
  rules: EditorialRule[];
  evidence_refs: EvidenceRef[];
  provenance_refs?: ProvenanceRef[]; // PHASE 2: Track decision chain
  recommendation: Recommendation;
}

/**
 * Canonical B01-domain shape for a rule applicability/feasibility verdict
 * (produced by B01.10). Previously shadowed by an incompatible local
 * interface of the same name declared inside B01_10_decision_logic.ts.
 */
export interface RuleVerdict {
  rule_id: string;
  status: "approved" | "flagged" | "blocked" | "needs_revision" | "UNKNOWN";
  // "approved" = rule is clear, feasible, can be applied (NOT = content approved)
  // "flagged" = rule conflicts with strategy/platform capability, needs review
  // "blocked" = deterministic rule incompatibility detected
  // "needs_revision" = conditions unsatisfiable
  // "UNKNOWN" = insufficient data for evaluation
  basis: "deterministic" | "analytical" | "mixed";
  deterministic_confidence: number; // 0-1 for automated checks
  analytical_confidence?: number; // 0-1 for agent scoring (optional)
  agent_recommendation?: Recommendation; // Agent suggestions (optional)
  evidence_refs: EvidenceRef[]; // Rule evaluation evidence
  provenance_refs?: ProvenanceRef[]; // Track decision chain per verdict
  rationale?: string;
}

/**
 * Canonical B01-domain shape for one aggregated strategic constraint
 * (produced by B01.11). Uses B00's `ConstraintLevel` enum directly rather
 * than B01.11's prior incompatible local "required"|"recommended"|
 * "informational" levels (mapped 1:1 in B01.11: required->hard_blocker,
 * recommended->soft_constraint, informational->guidance).
 */
export interface AggregatedConstraint {
  constraint_id: string;
  description: string;
  level: ConstraintLevel;
  binding_module: string;
  scope: string[]; // channel_ids/territory_ids/etc. this constraint applies to
  evidence_refs: EvidenceRef[];
}

export interface ConstraintAggregation {
  strategic_constraints: AggregatedConstraint[];
  conflicts: ConflictRecord[];
  gaps: Gap[];
  evidence_refs?: EvidenceRef[]; // PHASE 2: Track evidence for constraints
  provenance_refs?: ProvenanceRef[]; // PHASE 2: Track decision chain
  recommendation?: Recommendation; // PHASE 2: Track constraint recommendations
}

// ============================================================================
// CANDIDATE STATE (before commitVersion)
// ============================================================================

export interface B01CandidateState {
  // Metadata
  candidate_id: string;
  created_at: string;
  updated_at: string;

  // All phase outputs collected (optional in MVP; only integrated phases are populated)
  ecosystem?: EcosystemData;
  brand_arch?: BrandArchitecture;
  role_map?: RoleMap;
  relationship_graph?: RelationshipGraph;
  platform_registry?: PlatformRegistry;
  channel_fit?: ChannelFitMap;
  territories?: TerritoryData;
  distribution?: DistributionData;
  editorial?: EditorialData;
  rule_verdicts?: RuleVerdict[];
  constraints?: ConstraintAggregation;

  // Prior state (if this is an update cycle)
  prior_canonical_state?: B01CanonicalState;
  prior_audit_trail?: AuditEntry[];

  // Completeness
  completeness: {
    score: number; // 0-100
    missing_inputs: string[];
    blocking_decisions: string[];
  };

  // Evidence and recommendations
  evidence_refs: EvidenceRef[];
  all_recommendations?: Recommendation[];
  all_decisions?: Decision[];

  // Provenance and approvals (added PHASE 2)
  provenance_refs?: ProvenanceRef[]; // INFERRED, DECIDED, CANONICAL chain
  approvals?: Approval[]; // User approval records

  /** Per-item governance lifecycle history (B00 governance.ts primitives),
   *  keyed by whatever item_id string the caller uses when approving/
   *  rejecting/revoking via approveCandidate/rejectCandidate/revokeCandidate.
   *  Enables real approve->reject->re-approve semantics with full,
   *  reconstructable history — see src/b00/governance.ts. */
  governance_events?: Record<string, GovernanceEvent[]>;
}

// ============================================================================
// STORAGE ABSTRACTION
// ============================================================================

export interface B01StatePersistence {
  save(state: B01CanonicalState): Promise<void>;
  load(version: string): Promise<B01CanonicalState | null>;
  listVersions(): Promise<string[]>;
  latest(): Promise<B01CanonicalState | null>;
}

// NOTE: a second in-memory mock implementation of B01StatePersistence
// previously lived here (`MockB01Persistence`), inconsistent with
// `persistence.ts`'s `createMockPersistence()` (this one did not enforce
// version immutability; that one does, and throws on duplicate saves).
// Removed as part of consolidating to a single mock — use
// `createMockPersistence()` from `./persistence.js`.

// ============================================================================
// PHASE DEPS
// ============================================================================

export interface B01Deps {
  hash?: {
    stableChannelId: (inputId: string, name: string, platform: string) => string;
    stablePlatformId: (name: string) => string;
    stableTerritoryId: (inputId: string, description: string) => string;
    stableConstraintId: (inputId: string, description: string) => string;
    stableConflictId: (inputId: string, affectedItems: string) => string;
    stableGapId: (inputId: string, description: string) => string;
    stableRecommendationId: (agent: string, subject: string) => string;
  };
  secretGuard?: {
    redactSecrets: (text: string) => string;
  };
  now?: () => string; // ISO 8601, for testing
}

/**
 * Declared canonicalization field drops (intentional loss).
 * Re-exported from orchestration.ts for type-contract consistency with B02-B12.
 */
export { KNOWN_CANONICALIZATION_DROPS } from "./orchestration.js";
