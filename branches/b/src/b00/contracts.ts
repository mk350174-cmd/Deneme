// B00 — Module Communication Contracts
//
// Defines the interfaces for inter-module communication in B-Branch.
// Each module consumes the canonical output of its predecessor modules.
// These contracts ensure type safety and data traceability across the DAG.

import type { EvidenceRef, EvidenceStatus } from "../types/entities.js";
import type { ProvenanceRef, ProvenanceChain } from "./provenanceRef.js";
import type { AuditEntry } from "./auditTrail.js";
import type { CanonicalIdentity, ArtifactBinding } from "./identity.js";
import type { GovernanceEvent } from "./governance.js";
import type {
  ChannelRole,
  DistributionRole,
  PlatformCapability,
  EditorialRuleType,
  TerritoryType,
  ConstraintLevel,
  ContentAngle,
  ProviderState,
} from "./terminology.js";

// Re-export EvidenceRef for use by B01+ modules
export type { EvidenceRef, EvidenceStatus } from "../types/entities.js";

/** B01 Input Contract: what B01 accepts as input.
 *  User can provide brand context, known channels, documentation.
 *  Missing data → marked UNKNOWN (never fabricated). */
export interface B01Input {
  input_id: string;
  created_at: string;

  brand_context?: {
    brand_name: string;
    positioning?: string;
    mission?: string;
    values?: string[];
  };

  known_channels?: Array<{
    channel_id?: string;
    channel_name?: string;
    name?: string;
    platform: string;
    audience_category?: string;
    source?: string;
    url?: string;
  }>;

  known_platforms?: Array<{
    name: string;
    capabilities?: PlatformCapability[];
  }>;

  documentation?: {
    brand_guidelines?: string;
    channel_policies?: string;
    editorial_standards?: string;
  };

  user_input?: string;
  user_notes?: string;
}

/** Single conflict or contradiction detected during validation (B01.11 phase) */
export interface ConflictRecord {
  conflict_id: string;
  description: string;
  affected_items: string[]; // References to conflicted entities
  severity: "high" | "medium" | "low";
  resolution?: string; // How conflict was resolved (if any)
}

/** Data gap identified (missing required information) */
export interface Gap {
  gap_id: string;
  description: string;
  required_for: string; // What decision/output requires this data
  priority: "high" | "medium" | "low";
}

/** User decision that shaped canonical state */
export interface Decision {
  decision_id: string;
  description: string;
  timestamp: string;
  user_authority: string; // Who made the decision
  rationale?: string;
}

/** Agent recommendation evaluated by user (may or may not be adopted) */
export interface Recommendation {
  recommendation_id: string;
  source_agent: string; // Which B module proposed this
  proposal: string;
  timestamp: string;
  adopted: boolean; // Was this adopted into canonical state?
  rationale_if_rejected?: string;
}

/** User approval of candidate items. Converts INFERRED→DECIDED.
 *  Enables partial approval: user can approve some items, reject others, modify some.
 *  Approval record is immutable audit trail. */
export interface Approval {
  approval_id: string;
  gate_event_type?: string;
  prior_event_provenance_id?: string;
  timestamp: string;
  authority: string; // User email or identifier who approved

  approved_count: number; // How many items approved
  rejected_count: number; // How many rejected

  approved_items: Array<{
    item_id: string;
    /** Exact artifact/version/hash this approval authorizes. */
    artifact: ArtifactBinding;
    rationale?: string; // Why user approved this
  }>;

  rejected_items: Array<{
    item_id: string;
    reason: string; // Why user rejected
  }>;

  modifications: Record<string, unknown>; // Any edits user made during approval

  provenance: ProvenanceRef; // Who approved, when, and why
}

/** B01.12 Canonical State Contract: what B01 produces as versioned canonical output.
 *  This is NOT auto-generated. User increments version when committing a decision.
 *  Includes complete audit trail, evidence refs, and provenance chain. */
export interface B01CanonicalState {
  /** Canonical object identity/hash/lineage envelope. */
  identity: CanonicalIdentity;

  // Metadata (Provenance)
  version: string; // v1.0, v1.1, etc. — user increments on decision
  created_at: string;
  updated_at: string;
  user_decision_authority: string; // Who approved this version

  // Provenance Trail (Evidence + Decision Chain)
  audit_trail: AuditEntry[];
  decisions_made: Decision[];
  recommendations_considered: Recommendation[];
  approvals: Approval[]; // Approval records (new in repair phase)

  // Evidence Refs (backing every claim)
  evidence_refs: EvidenceRef[];
  provenance_refs: ProvenanceRef[]; // Full decision chain (previously empty, now populated)
  provenance_chains: ProvenanceChain[]; // Complete OBSERVED→...→CANONICAL chains
  governance_events: Record<string, GovernanceEvent[]>; // Full auditable governance histories

  // Core State (Canonical Facts for This Brand)
  brand_profile: {
    brand_name: string;
    positioning?: string;
    mission?: string;
    values: string[];
  };

  channels: Array<{
    channel_id: string;
    name: string;
    platform: string;
    role: ChannelRole;
    audience_category?: string;
    url?: string;
    evidence_refs: EvidenceRef[];
  }>;

  platforms: Array<{
    platform_id: string;
    name: string;
    capabilities: PlatformCapability[];
    evidence_refs: EvidenceRef[];
  }>;

  // Strategic Decisions (What User Committed To)
  content_territories?: Array<{
    territory_id: string;
    type: TerritoryType;
    description: string;
    boundaries: string[];
    evidence_refs: EvidenceRef[];
  }>;

  distribution_strategy?: {
    strategy_description: string;
    channel_assignments: Array<{
      channel_id: string;
      role: DistributionRole;
      timing?: string;
    }>;
    evidence_refs: EvidenceRef[];
  };

  editorial_constitution?: {
    constitution_id: string;
    rules: Array<{
      rule_id: string;
      type: EditorialRuleType;
      description: string;
      applies_to?: ContentAngle[];
    }>;
    evidence_refs: EvidenceRef[];
  };

  strategic_constraints: Array<{
    constraint_id: string;
    description: string;
    level: ConstraintLevel;
    binding_module: string; // Which B module must enforce this
  }>;

  // Readiness Scoring (NOT Correctness Claim)
  completeness: {
    score: number; // 0-100: what % of decision space is defined
    missing_inputs: string[]; // What data gaps remain
    blocking_decisions: string[]; // What must user decide next
  };

  // Validation State (Conflicts & Gaps at This Version)
  conflicts: ConflictRecord[];
  gaps: Gap[];
}

// ============================================================================
// HELPERS
// ============================================================================

export function isStrongEvidence(status: EvidenceStatus, confidence?: number): boolean {
  if (status === "VERIFIED") return true;
  if (status === "INFERRED" && typeof confidence === "number") {
    return confidence > 0.7;
  }
  return false;
}
