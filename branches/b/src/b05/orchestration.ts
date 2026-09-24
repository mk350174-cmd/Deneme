// B05 Orchestration
// Coordinate creative synthesis phases, produce candidate state

import type { B05CandidateState, B05CanonicalState, B05Deps, CreativeBrief } from "./types.js";
import { bindUnboundProvenanceRefs } from "../b00/provenanceRef.js";
import type { B05StatePersistence } from "./types.js";
import type { B01CanonicalState } from "../b00/contracts.js";
import type { B03CandidateState } from "../b03/types.js";
import type { B04CandidateState, B04CanonicalState, CampaignStrategy } from "../b04/types.js";
import { canonicalHasher } from "../b00/hashing.js";
import { proposeItem, approveItem, type GovernanceTransitionInput, type GovernanceEvent } from "../b00/governance.js";
import { isApprovedForArtifact } from "../b00/governance.js";
import { createCanonicalIdentity, resolveParentReference, createArtifactBinding } from "../b00/identity.js";
import { buildCreativeContext, validateCreativeContext } from "./phases/B05_01_registry.js";
import { synthesizeCreativeAngles } from "./phases/B05_02_angles.js";
import { synthesizeMessagingStrategies } from "./phases/B05_03_messaging.js";
import { identifyCreativeConstraints } from "./phases/B05_04_constraints.js";
import {
  detectCreativeConflicts,
  identifyCreativeGaps,
  calculateCreativeCompleteness,
} from "./phases/B05_05_validation.js";

function approvalCurrent(candidate: any, item: unknown, id: string, type: string): boolean {
  return isApprovedForArtifact(candidate.governance_events?.[id] ?? [], createArtifactBinding(item, id, type, candidate.candidate_id));
}

export async function runB05(
  b01State: B01CanonicalState,
  b03State: B03CandidateState,
  b04State: B04CandidateState | B04CanonicalState,
  deps?: B05Deps,
): Promise<B05CandidateState> {
  const deps_ = deps || createDefaultB05Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  const context = buildCreativeContext(b01State, b03State, b04State);
  validateCreativeContext(context);

  const angles = synthesizeCreativeAngles(context, deps_);
  const messaging = synthesizeMessagingStrategies(context, deps_);
  const constraints = identifyCreativeConstraints(b01State, b04State, deps_);

  const conflicts = detectCreativeConflicts(angles, messaging, constraints, context);
  const gaps = identifyCreativeGaps(context, angles.length, messaging.length, constraints.length);
  const completeness = calculateCreativeCompleteness(
    context,
    angles.length,
    messaging.length,
    constraints.length,
    gaps,
  );

  // Create creative briefs (one per campaign)
  const briefs = (b04State?.campaigns || []).map((campaign: CampaignStrategy): CreativeBrief => {
    const campaignAngles = angles.filter((a) => a.campaign_id === campaign.campaign_id);
    const campaignMessaging = messaging.filter((m) => m.campaign_id === campaign.campaign_id);
    const campaignConstraints = constraints.filter((c) => c.campaign_id === campaign.campaign_id);

    return {
      brief_id: deps_?.hash?.stableBriefId(campaign.campaign_id) || `brief_${campaign.campaign_id}`,
      campaign_id: campaign.campaign_id,
      content_objectives: [campaign.primary_objective, ...(campaign.secondary_objectives || [])],
      creative_angles: campaignAngles,
      messaging_strategies: campaignMessaging,
      creative_constraints: campaignConstraints,
      key_metrics: ["engagement", "reach", "audience_retention"],
      quality_standards: ["brand_alignment", "audience_appropriateness", "consistency"],
      evidence_refs: [
        ...campaignAngles.flatMap((a) => a.evidence_refs),
        ...campaignMessaging.flatMap((m) => m.evidence_refs),
        ...campaignConstraints.flatMap((c) => c.evidence_refs),
      ],
    };
  });

  const allEvidence = [
    ...angles.flatMap((a) => a.evidence_refs),
    ...messaging.flatMap((m) => m.evidence_refs),
    ...constraints.flatMap((c) => c.evidence_refs),
    ...briefs.flatMap((b: CreativeBrief) => b.evidence_refs),
  ];

  const uniqueEvidence = Array.from(new Map(allEvidence.map((e) => [e.id, e])).values());

  return {
    candidate_id: `cand_${canonicalHasher.stableCandidateId("b05", `${b01State?.version}:${angles.length}`)}`,
    parent_references: [
      resolveParentReference("b01", b01State, "creative_foundation"),
      resolveParentReference("b03", b03State, "audience_input"),
      resolveParentReference("b04", b04State, "strategy_input"),
    ],
    created_at: now(),
    b01_version: b01State?.version,
    b02_version: undefined,
    b03_version: b03State?.b01_canonical_version,
    b04_version: ('version' in b04State ? b04State.version : b04State.b01_version),

    creative_angles: angles,
    messaging_strategies: messaging,
    creative_constraints: constraints,
    creative_briefs: briefs,

    conflicts_detected: conflicts,
    gaps,
    evidence_refs: uniqueEvidence,
    provenance_refs: [
      ...angles.flatMap((a) => [a.provenance]),
      ...messaging.flatMap((m) => [m.provenance]),
      ...constraints.flatMap((c) => [c.provenance]),
    ],
    governance_events: {},
    all_recommendations: [],
    completeness,
  };
}

/**
 * Approve B05 candidate state via B00 governance routing.
 *
 * Routes creative entities through governance state machine:
 *   propose → approve → DECIDED (with governance event linkage)
 *
 * Populates governance_events and marks items DECIDED.
 * Must be called before commitVersion() to establish governance chain.
 */
export async function approveCandidate(
  candidate: B05CandidateState,
  userAuthority: string,
  deps?: B05Deps,
): Promise<B05CandidateState> {
  const deps_ = deps || createDefaultB05Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  const governanceEvents: Record<string, GovernanceEvent[]> = {};

  const anglesWithGovernance: typeof candidate.creative_angles = [];
  for (const angle of candidate.creative_angles) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: angle.angle_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B05 creative angle: ${angle.title}`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: angle.angle_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B05 creative angle: ${angle.title}`,
      artifact: createArtifactBinding(angle, angle.angle_id, "b05_creative_angle", candidate.candidate_id),
      requireArtifactBinding: true, sourceEvidenceRefs: angle.evidence_refs.map((e)=>e.id),
    };
    const approvalResult = approveItem(approvalInput);

    governanceEvents[angle.angle_id] = [
      proposalResult.event,
      approvalResult.event,
    ];

    const angleWithDecided = {
      ...angle,
      provenance: {
        ...angle.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id,
      },
    };
    anglesWithGovernance.push(angleWithDecided);
  }

  const messagingWithGovernance: typeof candidate.messaging_strategies = [];
  for (const msg of candidate.messaging_strategies) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: msg.messaging_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B05 messaging: segment ${msg.segment_id}`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: msg.messaging_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B05 messaging: segment ${msg.segment_id}`,
      artifact: createArtifactBinding(msg, msg.messaging_id, "b05_messaging", candidate.candidate_id),
      requireArtifactBinding: true, sourceEvidenceRefs: msg.evidence_refs.map((e)=>e.id),
    };
    const approvalResult = approveItem(approvalInput);

    governanceEvents[msg.messaging_id] = [
      proposalResult.event,
      approvalResult.event,
    ];

    const msgWithDecided = {
      ...msg,
      provenance: {
        ...msg.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id,
      },
    };
    messagingWithGovernance.push(msgWithDecided);
  }

  const constraintsWithGovernance: typeof candidate.creative_constraints = [];
  for (const constraint of candidate.creative_constraints) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: constraint.constraint_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B05 constraint: ${constraint.constraint_type}`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: constraint.constraint_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B05 constraint: ${constraint.constraint_type}`,
      artifact: createArtifactBinding(constraint, constraint.constraint_id, "b05_creative_constraint", candidate.candidate_id),
      requireArtifactBinding: true, sourceEvidenceRefs: constraint.evidence_refs.map((e)=>e.id),
    };
    const approvalResult = approveItem(approvalInput);

    governanceEvents[constraint.constraint_id] = [
      proposalResult.event,
      approvalResult.event,
    ];

    const constraintWithDecided = {
      ...constraint,
      provenance: {
        ...constraint.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id,
      },
    };
    constraintsWithGovernance.push(constraintWithDecided);
  }

  return {
    ...candidate,
    creative_angles: anglesWithGovernance,
    messaging_strategies: messagingWithGovernance,
    creative_constraints: constraintsWithGovernance,
    governance_events: governanceEvents,
  };
}

export async function commitVersion(
  candidate: B05CandidateState,
  nextVersion: string,
  userAuthority: string,
  persistence: B05StatePersistence,
  priorState?: B05CanonicalState,
  deps?: B05Deps,
): Promise<B05CanonicalState> {
  const deps_ = deps || createDefaultB05Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  if (!/^v\d+\.\d+$/.test(nextVersion)) {
    throw new Error(`Invalid semantic version format: ${nextVersion}. Expected v#.#`);
  }

  const existing = await persistence.load(nextVersion);
  if (existing) {
    throw new Error(`Version ${nextVersion} already exists (immutable)`);
  }

  const canonicalAngles = candidate.creative_angles.filter(
    (a) => a.provenance.type === "DECIDED" && approvalCurrent(candidate, a, a.angle_id, "b05_creative_angle"),
  );
  const canonicalMessaging = candidate.messaging_strategies.filter(
    (m) => m.provenance.type === "DECIDED" && approvalCurrent(candidate, m, m.messaging_id, "b05_messaging"),
  );

  const newAuditEntries = buildAuditEntries(candidate, priorState, userAuthority, deps_);
  const auditTrail = [...(priorState?.audit_trail || []), ...newAuditEntries];

  const canonicalConstraints = candidate.creative_constraints.filter((c) => c.provenance.type === "DECIDED" && approvalCurrent(candidate, c, c.constraint_id, "b05_creative_constraint"));
  const canonicalBriefs = candidate.creative_briefs.map((brief) => ({
    ...brief,
    creative_angles: canonicalAngles.filter((a) => a.campaign_id === brief.campaign_id),
    messaging_strategies: canonicalMessaging.filter((m) => m.campaign_id === brief.campaign_id),
    creative_constraints: canonicalConstraints.filter((c) => c.campaign_id === brief.campaign_id),
  }));

  const canonicalWithoutIdentity: Omit<B05CanonicalState, "identity"> = {
    version: nextVersion,
    created_at: now(),
    updated_at: now(),
    user_decision_authority: userAuthority,
    b01_canonical_version: candidate.b01_version,
    b02_canonical_version: candidate.b02_version,
    b03_canonical_version: candidate.b03_version,
    b04_canonical_version: candidate.b04_version,
    creative_angles: canonicalAngles,
    messaging_strategies: canonicalMessaging,
    creative_constraints: canonicalConstraints,
    creative_briefs: canonicalBriefs,
    audit_trail: auditTrail,
    decisions_made: [],
    recommendations_considered: candidate.all_recommendations,
    evidence_refs: candidate.evidence_refs,
    provenance_refs: bindUnboundProvenanceRefs(candidate.provenance_refs, createArtifactBinding(candidate, candidate.candidate_id, "B05_CANDIDATE_STATE", candidate.candidate_id), candidate.evidence_refs.map((e)=>e.id)),
    governance_events: candidate.governance_events,
    decision_timestamp: now(),
    cannot_be_modified_until_next_version: true,
  };

  const canonical:B05CanonicalState={...canonicalWithoutIdentity,identity:createCanonicalIdentity({object_id:`b05:${nextVersion}`,object_type:"b05_canonical_state",version:nextVersion,artifact:canonicalWithoutIdentity,parent_references:candidate.parent_references,created_at:canonicalWithoutIdentity.created_at})};
  await persistence.save(canonical);
  return canonical;
}

export async function loadVersion(
  version: string,
  persistence: B05StatePersistence,
): Promise<B05CanonicalState | null> {
  return persistence.load(version);
}

export async function listVersions(persistence: B05StatePersistence): Promise<string[]> {
  return persistence.listVersions();
}

export async function getLatestVersion(
  persistence: B05StatePersistence,
): Promise<B05CanonicalState | null> {
  return persistence.latest();
}

/**
 * Build audit trail entries for this version
 */
function buildAuditEntries(
  candidate: B05CandidateState,
  priorState: B05CanonicalState | undefined,
  authority: string,
  deps?: B05Deps,
): Array<{ version: string; changed_at: string; changed_by: string; summary: string }> {
  const deps_ = deps || createDefaultB05Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  if (!priorState) {
    return [
      {
        version: "v1.0",
        changed_at: now(),
        changed_by: authority,
        summary: `Initial B05 creative synthesis: ${candidate.creative_angles.length} angles, ${candidate.messaging_strategies.length} messaging strategies synthesized`,
      },
    ];
  }

  return [
    {
      version: incrementVersion(priorState.version),
      changed_at: now(),
      changed_by: authority,
      summary: `B05 creative synthesis updated: ${priorState.creative_angles.length} → ${candidate.creative_angles.length} angles`,
    },
  ];
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

function createDefaultB05Deps(): B05Deps {
  return {
    hash: {
      stableAngleId: (campaignId: string, angleTitle: string) =>
        `angle_${canonicalHasher.hash(`${campaignId}:${angleTitle}`)}`,
      stableMessagingId: (segmentId: string, campaignId: string) =>
        `msg_${canonicalHasher.hash(`${segmentId}:${campaignId}`)}`,
      stableConstraintId: (campaignId: string, type: string) =>
        `const_${canonicalHasher.hash(`${campaignId}:${type}`)}`,
      stableBriefId: (campaignId: string) => `brief_${canonicalHasher.hash(campaignId)}`,
    },
    now: () => new Date().toISOString(),
  };
}
