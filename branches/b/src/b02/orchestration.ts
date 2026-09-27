import { externalObservations, externalLineage, externalProvenance } from "../b08/external/context.js";
// B02 Orchestration
// Execute opportunity evaluation and manage canonical state versioning

import type { B01CanonicalState } from "../b00/contracts.js";
import { bindProvenanceToSubject, bindUnboundProvenanceRefs } from "../b00/provenanceRef.js";
import type { B02CandidateState, B02CanonicalState, B02Deps, B02StatePersistence } from "./types.js";
import { buildRegistryContext, validateRegistry } from "./phases/B02_01_registry.js";
import { evaluatePositioningAlignment, evaluateEditorialFit, createDefaultB02Deps } from "./phases/B02_02_opportunities.js";
import { detectConstraintConflicts, identifyGaps, calculateCompleteness, validateNoFabrication } from "./phases/B02_03_validation.js";
import { classifyOpportunities, prioritizeOpportunities } from "./phases/B02_04_prioritization.js";
import { canonicalHasher } from "../b00/hashing.js";
import { proposeItem, approveItem, type GovernanceTransitionInput, type GovernanceEvent } from "../b00/governance.js";
import type { AuditEntry } from "../b00/auditTrail.js";
import { computeFieldDiff } from "../b00/auditTrail.js";
import { isApprovedForArtifact } from "../b00/governance.js";
import { createCanonicalIdentity, resolveParentReference, createArtifactBinding, hashApprovalSubject } from "../b00/identity.js";

/**
 * Execute B02 opportunity evaluation workflow
 *
 * Generates B02CandidateState (pre-decision, INFERRED/RECOMMENDED provenance)
 * from B01CanonicalState v1.0
 *
 * Process:
 * 1. Validate B01 registry data available
 * 2. Build deterministic registry layer
 * 3. Run analytical agents (positioning, editorial, capability matching)
 * 4. Detect conflicts and gaps
 * 5. Classify and prioritize opportunities
 * 6. Return candidate state (not yet canonical)
 */
function approvalCurrent(candidate: any, item: unknown, id: string, type: string): boolean {
  return isApprovedForArtifact(candidate.governance_events?.[id] ?? [], createArtifactBinding(item, id, type, candidate.candidate_id));
}

export async function runB02(
  b01CanonicalState: B01CanonicalState,
  deps?: B02Deps,
): Promise<B02CandidateState> {
  const deps_ = {...createDefaultB02Deps(), ...deps, hash:deps?.hash ?? createDefaultB02Deps().hash};

  // Validate B01 input is available
  const registryValidation = validateRegistry(b01CanonicalState);
  if (!registryValidation.valid) {
    console.warn("B02 registry validation failed:", registryValidation.gaps);
  }

  // LAYER 1: Deterministic registry mapping
  const registry = buildRegistryContext(b01CanonicalState, deps_);

  // LAYER 2: Analytical agents for opportunity evaluation
  let opportunities = evaluatePositioningAlignment(b01CanonicalState, deps_);
  opportunities = evaluateEditorialFit(b01CanonicalState, opportunities, deps_);

  opportunities = opportunities.map(opp => {
    const observations = externalObservations(deps_?.external_intelligence, ["TrendObservation", "CompetitiveObservation", "CommunityObservation"], opp.channel_id);
    return {...opp, supporting_evidence:[...opp.supporting_evidence,...observations.flatMap(o=>o.evidence_refs)]};
  });
  // LAYER 3: Validation & conflict detection
  const conflicts = detectConstraintConflicts(b01CanonicalState, opportunities);
  const gaps = identifyGaps(b01CanonicalState);

  // Aggregate all evidence and provenance
  const allEvidence = opportunities.flatMap((opp) => opp.supporting_evidence);
  const allProvenance = [...opportunities.map((opp) => bindProvenanceToSubject(opp.provenance,createArtifactBinding(opp,opp.opportunity_id,"b02_opportunity",b01CanonicalState.version),opp.supporting_evidence.map(e=>e.id),"opportunity_evaluation")),...externalProvenance(deps_.external_intelligence)];

  // Verify no fabrication
  if (!validateNoFabrication(opportunities)) {
    throw new Error("B02: Fabricated opportunity data detected (no evidence or invalid scoring)");
  }

  // LAYER 4: Classification and prioritization
  const opportunityClasses = classifyOpportunities(opportunities, deps_);
  const priorityMatrix = prioritizeOpportunities(opportunities);

  // Calculate completeness
  const completeness = calculateCompleteness(b01CanonicalState, opportunities.length, gaps);

  // Build candidate state
  // PHASE 3 FIX: Use deterministic hash for candidate_id instead of Date.now()
  const deterministicCandidateId = deps_.hash?.stableOpportunityId(b01CanonicalState.version, "b02", "candidate") ||
    `cand_${canonicalHasher.stableCandidateId("b02", `${b01CanonicalState.version}:${opportunities.length}`)}`;

  const candidate: B02CandidateState = {
    candidate_id: deterministicCandidateId,
    parent_references: [resolveParentReference("b01", b01CanonicalState, "opportunity_input"), ...externalLineage(deps_.external_intelligence)],
    created_at: deps_.now?.() || new Date().toISOString(),

    // All identified opportunities (INFERRED/RECOMMENDED, not canonical)
    opportunities,

    // Classification and prioritization
    opportunity_classes: opportunityClasses,
    priority_matrix: priorityMatrix,

    // Conflicts and gaps
    conflicts_detected: conflicts,
    gaps,

    // Evidence trail
    evidence_refs: allEvidence,
    provenance_refs: allProvenance,

    // Governance lifecycle events (empty until approveCandidate is called)
    governance_events: {},

    // Readiness scoring
    completeness,

    // Agent recommendations (will be populated if agents suggest refinements)
    all_recommendations: [],
  };

  return candidate;
}

/**
 * Approve B02 candidate state via B00 governance routing.
 *
 * Routes each opportunity through governance state machine:
 *   propose → approve → DECIDED (with governance event linkage)
 *
 * Populates governance_events and marks opportunities DECIDED.
 * Must be called before commitVersion() to establish governance chain.
 */
export async function approveCandidate(
  candidate: B02CandidateState,
  userAuthority: string,
  deps?: B02Deps,
): Promise<B02CandidateState> {
  const deps_ = {...createDefaultB02Deps(), ...deps, hash:deps?.hash ?? createDefaultB02Deps().hash};
  const now = () => deps_.now?.() || new Date().toISOString();

  // Approve each opportunity through governance
  const opportunitiesWithGovernance: typeof candidate.opportunities = [];
  const governanceEventsByOpportunity: Record<string, GovernanceEvent[]> = {};

  for (const opp of candidate.opportunities) {
    // PROPOSED → APPROVED for this opportunity
    const proposalInput: GovernanceTransitionInput = {
      itemId: opp.opportunity_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B02 opportunity: ${opp.title}`,
    };
    const proposalResult = proposeItem(proposalInput);

    // PROPOSED → APPROVED
    const approvalInput: GovernanceTransitionInput = {
      itemId: opp.opportunity_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B02 opportunity: ${opp.title}`,
      artifact: createArtifactBinding(opp, opp.opportunity_id, "b02_opportunity", candidate.candidate_id),
      requireArtifactBinding: true,
      sourceEvidenceRefs: opp.supporting_evidence.map((e) => e.id),
    };
    const approvalResult = approveItem(approvalInput);

    // Store governance events (GovernanceEvent objects, not results)
    governanceEventsByOpportunity[opp.opportunity_id] = [
      proposalResult.event,
      approvalResult.event,
    ];

    // Update opportunity provenance to DECIDED with real governance linkage
    const opportunityWithDecided = {
      ...opp,
      provenance: {
        ...opp.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id, // Link to governance event
      },
    };
    opportunitiesWithGovernance.push(opportunityWithDecided);
  }

  return {
    ...candidate,
    opportunities: opportunitiesWithGovernance,
    governance_events: governanceEventsByOpportunity,
  };
}

/**
 * Commit B02 candidate state to versioned canonical state
 *
 * SIMILAR TO B01.commitVersion BUT INDEPENDENT:
 * - B02 manages its own versioning
 * - User authority required (decision_id)
 * - Immutability enforced (duplicate versions rejected)
 * - Only DECIDED opportunities included in canonical
 * - INFERRED/RECOMMENDED not auto-promoted
 *
 * Throws if version already exists (immutability enforcement)
 */
export async function commitVersion(
  candidate: B02CandidateState,
  nextVersion: string, // e.g., "v1.0" → "v1.1"
  userAuthority: string,
  persistence: B02StatePersistence,
  priorState?: B02CanonicalState,
  deps?: B02Deps,
): Promise<B02CanonicalState> {
  const deps_ = {...createDefaultB02Deps(), ...deps, hash:deps?.hash ?? createDefaultB02Deps().hash};
  const now = () => deps_.now?.() || new Date().toISOString();

  // Validate version format (semantic: v1.0, v1.1, v2.0, etc.)
  if (!/^v\d+\.\d+$/.test(nextVersion)) {
    throw new Error(`Invalid version format: ${nextVersion}. Expected vX.Y`);
  }

  // Filter: only DECIDED opportunities (governance-approved)
  const decidedOpportunities = candidate.opportunities.filter(
    (opp) => opp.provenance.type === "DECIDED" && approvalCurrent(candidate, opp, opp.opportunity_id, "b02_opportunity"),
  );

  // Build audit trail entries using real field diff
  const newAuditEntries = buildAuditEntries(candidate, priorState, userAuthority, deps_);
  // Append-only: preserve prior entries, add new ones
  const auditTrail = [...(priorState?.audit_trail || []), ...newAuditEntries];

  // Assemble canonical state
  const canonicalStateWithoutIdentity: Omit<B02CanonicalState, "identity"> = {
    version: nextVersion,
    created_at: now(),
    updated_at: now(),
    user_decision_authority: userAuthority,

    // Only DECIDED opportunities (filtered, not auto-promoted)
    opportunities: decidedOpportunities,

    opportunity_classes: candidate.opportunity_classes,
    priority_matrix: candidate.priority_matrix,

    // Audit trail (append-only, never overwrite)
    audit_trail: auditTrail,
    decisions_made: [], // Would populate with explicit decisions if tracked
    recommendations_considered: candidate.all_recommendations,

    // Full evidence (preserved from candidate)
    evidence_refs: candidate.evidence_refs,
    provenance_refs: bindUnboundProvenanceRefs(candidate.provenance_refs, createArtifactBinding(candidate, candidate.candidate_id, "B02_CANDIDATE_STATE", candidate.candidate_id), candidate.evidence_refs.map((e)=>e.id)),

    // Governance events (append-only chain)
    governance_events: candidate.governance_events,

    // Conflicts and gaps preserved
    conflicts: candidate.conflicts_detected,
    gaps: candidate.gaps,

    // Completeness at this version
    completeness: candidate.completeness,
  };

  const canonicalState: B02CanonicalState = {
    ...canonicalStateWithoutIdentity,
    identity: createCanonicalIdentity({
      object_id: `b02:${nextVersion}`,
      object_type: "b02_canonical_state",
      version: nextVersion,
      artifact: canonicalStateWithoutIdentity,
      parent_references: candidate.parent_references,
      created_at: canonicalStateWithoutIdentity.created_at,
    }),
  };

  // Persist (only side-effect point in B02)
  await persistence.save(canonicalState);

  return canonicalState;
}

/**
 * Build audit trail entries for this version
 */
function buildAuditEntries(
  candidate: B02CandidateState,
  priorState: B02CanonicalState | undefined,
  authority: string,
  deps?: B02Deps,
): AuditEntry[] {
  const deps_ = {...createDefaultB02Deps(), ...deps, hash:deps?.hash ?? createDefaultB02Deps().hash};
  const timestamp = deps_.now?.() || new Date().toISOString();

  const version = priorState ? incrementVersion(priorState.version) : "v1.0";

  const before: Record<string, unknown> | undefined = priorState
    ? {
        opportunities: priorState.opportunities,
        opportunity_classes: priorState.opportunity_classes,
        priority_matrix: priorState.priority_matrix,
        conflicts: priorState.conflicts,
        gaps: priorState.gaps,
        completeness: priorState.completeness,
      }
    : undefined;

  const after: Record<string, unknown> = {
    opportunities: candidate.opportunities,
    opportunity_classes: candidate.opportunity_classes,
    priority_matrix: candidate.priority_matrix,
    conflicts: candidate.conflicts_detected,
    gaps: candidate.gaps,
    completeness: candidate.completeness,
  };

  const diffEntries = computeFieldDiff(before, after, {
    version,
    decision_authority: authority,
    timestamp,
    rationale: priorState ? "B02 opportunity evaluation updated" : "Initial B02 candidate evaluation",
    evidence_refs: candidate.evidence_refs,
    change_type: "canonical_state_update",
  });

  return diffEntries;
}

/**
 * Increment a semantic version (v1.0 → v1.1, etc.)
 */
function incrementVersion(version: string): string {
  const parts = version.slice(1).split(".").map(Number);
  if (parts.length < 2 || parts[0] === undefined || parts[1] === undefined) {
    return `${version}.1`;
  }
  parts[1]++;
  return `v${parts[0]}.${parts[1]}`;
}

/**
 * Load versioned canonical state from persistence
 */
export async function loadVersion(
  version: string,
  persistence: B02StatePersistence,
): Promise<B02CanonicalState | null> {
  return persistence.load(version);
}

/**
 * List all versions in canonical history
 */
export async function listVersions(persistence: B02StatePersistence): Promise<string[]> {
  return persistence.listVersions();
}

/**
 * Get latest canonical version
 */
export async function getLatestVersion(persistence: B02StatePersistence): Promise<B02CanonicalState | null> {
  return persistence.latest();
}
