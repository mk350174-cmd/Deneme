// B04 Orchestration
// Coordinate phases 1-4, produce candidate state, handle canonicalization

import type { B01CanonicalState } from "../b00/contracts.js";
import { bindUnboundProvenanceRefs } from "../b00/provenanceRef.js";
import type { B02CandidateState } from "../b02/types.js";
import type { B03CandidateState } from "../b03/types.js";
import type { B04CandidateState, B04CanonicalState, B04Deps } from "./types.js";
import type { B04StatePersistence } from "./types.js";
import { canonicalHasher } from "../b00/hashing.js";
import { proposeItem, approveItem, type GovernanceTransitionInput, type GovernanceEvent } from "../b00/governance.js";
import { isApprovedForArtifact } from "../b00/governance.js";
import { createCanonicalIdentity, resolveParentReference, createArtifactBinding } from "../b00/identity.js";
import {
  buildStrategyContext,
  validateStrategyContext,
} from "./phases/B04_01_registry.js";
import { analyzeOpportunitySegmentAlignment } from "./phases/B04_02_opportunities.js";
import {
  synthesizeCampaigns,
  synthesizePriorities,
} from "./phases/B04_03_synthesis.js";
import {
  detectStrategyConflicts,
  identifyStrategicGaps,
  calculateStrategyCompleteness,
} from "./phases/B04_04_validation.js";

function approvalCurrent(candidate: any, item: unknown, id: string, type: string): boolean {
  return isApprovedForArtifact(candidate.governance_events?.[id] ?? [], createArtifactBinding(item, id, type, candidate.candidate_id));
}

export async function runB04(
  b01State: B01CanonicalState,
  b02State: B02CandidateState | undefined,
  b03State: B03CandidateState,
  deps?: B04Deps,
): Promise<B04CandidateState> {
  const deps_ = deps || createDefaultB04Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  const context = buildStrategyContext(b01State, b02State, b03State, deps_);
  const registryValidation = validateStrategyContext(context);

  const alignments = analyzeOpportunitySegmentAlignment(context, deps_);

  const campaigns = synthesizeCampaigns(context, alignments, deps_);
  const priorities = synthesizePriorities(campaigns, deps_);

  const conflicts = detectStrategyConflicts(b01State, campaigns, priorities);
  const gaps = identifyStrategicGaps(context, campaigns.length, priorities.length);
  const completeness = calculateStrategyCompleteness(
    context,
    campaigns.length,
    priorities.length,
    gaps,
  );

  const allEvidence = [
    ...campaigns.flatMap((c) => c.evidence_refs),
    ...priorities.flatMap((p) => p.evidence_refs),
    ...alignments.flatMap((a) => a.evidence_refs),
  ];

  const uniqueEvidence = Array.from(new Map(allEvidence.map((e) => [e.id, e])).values());

  return {
    candidate_id: `cand_${canonicalHasher.stableCandidateId("b04", `${b01State.version}:${campaigns.length}`)}`,
    parent_references: [
      resolveParentReference("b01", b01State, "strategic_foundation"),
      ...(b02State ? [resolveParentReference("b02", b02State, "opportunity_input")] : []),
      resolveParentReference("b03", b03State, "audience_input"),
    ],
    created_at: now(),
    b01_version: b01State.version,
    b02_version: b02State?.candidate_id,
    b03_version: b03State.b01_canonical_version,
    campaigns,
    strategic_priorities: priorities,
    alignment_matrix: alignments,
    territorial_strategies: [],
    conflicts_detected: conflicts,
    gaps,
    evidence_refs: uniqueEvidence,
    provenance_refs: [
      ...campaigns.flatMap((c) => [c.provenance]),
      ...priorities.flatMap((p) => [p.provenance]),
    ],
    governance_events: {},
    all_recommendations: [],
    completeness,
  };
}

/**
 * Approve B04 candidate state via B00 governance routing.
 *
 * Routes each campaign through governance state machine:
 *   propose → approve → DECIDED (with governance event linkage)
 *
 * Populates governance_events and marks campaigns DECIDED.
 * Must be called before commitVersion() to establish governance chain.
 */
export async function approveCandidate(
  candidate: B04CandidateState,
  userAuthority: string,
  deps?: B04Deps,
): Promise<B04CandidateState> {
  const deps_ = deps || createDefaultB04Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  const campaignsWithGovernance: typeof candidate.campaigns = [];
  const governanceEventsByCampaign: Record<string, GovernanceEvent[]> = {};

  for (const campaign of candidate.campaigns) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: campaign.campaign_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B04 campaign: ${campaign.campaign_name}`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: campaign.campaign_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B04 campaign: ${campaign.campaign_name}`,
      artifact: createArtifactBinding(campaign, campaign.campaign_id, "b04_campaign", candidate.candidate_id),
      requireArtifactBinding: true, sourceEvidenceRefs: campaign.evidence_refs.map((e)=>e.id),
    };
    const approvalResult = approveItem(approvalInput);

    governanceEventsByCampaign[campaign.campaign_id] = [
      proposalResult.event,
      approvalResult.event,
    ];

    const campaignWithDecided = {
      ...campaign,
      provenance: {
        ...campaign.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id,
      },
    };
    campaignsWithGovernance.push(campaignWithDecided);
  }

  const prioritiesWithGovernance: typeof candidate.strategic_priorities = [];
  const governanceEventsByPriority: Record<string, GovernanceEvent[]> = {};
  for (const priority of candidate.strategic_priorities) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: priority.priority_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B04 priority: ${priority.description}`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: priority.priority_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B04 priority: ${priority.description}`,
      artifact: createArtifactBinding(priority, priority.priority_id, "b04_priority", candidate.candidate_id),
      requireArtifactBinding: true, sourceEvidenceRefs: priority.evidence_refs.map((e)=>e.id),
    };
    const approvalResult = approveItem(approvalInput);
    governanceEventsByPriority[priority.priority_id] = [proposalResult.event, approvalResult.event];

    const priorityWithDecided = {
      ...priority,
      provenance: {
        ...priority.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id,
      },
    };
    prioritiesWithGovernance.push(priorityWithDecided);
  }

  return {
    ...candidate,
    campaigns: campaignsWithGovernance,
    strategic_priorities: prioritiesWithGovernance,
    governance_events: { ...governanceEventsByCampaign, ...governanceEventsByPriority },
  };
}

export async function commitVersion(
  candidate: B04CandidateState,
  nextVersion: string,
  userAuthority: string,
  persistence: B04StatePersistence,
  priorState?: B04CanonicalState,
  deps?: B04Deps,
): Promise<B04CanonicalState> {
  const deps_ = deps || createDefaultB04Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  if (!/^v\d+\.\d+$/.test(nextVersion)) {
    throw new Error(`Invalid semantic version format: ${nextVersion}. Expected v#.#`);
  }

  const existing = await persistence.load(nextVersion);
  if (existing) {
    throw new Error(`Version ${nextVersion} already exists (immutable)`);
  }

  const canonicalCampaigns = candidate.campaigns.filter(
    (c) => c.provenance.type === "DECIDED" && approvalCurrent(candidate, c, c.campaign_id, "b04_campaign"),
  );

  const newAuditEntries = buildAuditEntries(candidate, priorState, userAuthority, deps_);
  const auditTrail = [...(priorState?.audit_trail || []), ...newAuditEntries];

  const canonicalWithoutIdentity: Omit<B04CanonicalState, "identity"> = {
    version: nextVersion,
    created_at: now(),
    updated_at: now(),
    user_decision_authority: userAuthority,
    b01_canonical_version: candidate.b01_version,
    b02_canonical_version: candidate.b02_version,
    b03_canonical_version: candidate.b03_version,
    campaigns: canonicalCampaigns,
    strategic_priorities: candidate.strategic_priorities.filter(
      (p) => p.provenance.type === "DECIDED" && approvalCurrent(candidate, p, p.priority_id, "b04_priority"),
    ),
    alignment_matrix: candidate.alignment_matrix,
    territorial_strategies: [],
    audit_trail: auditTrail,
    decisions_made: [],
    recommendations_considered: candidate.all_recommendations,
    evidence_refs: candidate.evidence_refs,
    provenance_refs: bindUnboundProvenanceRefs(candidate.provenance_refs, createArtifactBinding(candidate, candidate.candidate_id, "B04_CANDIDATE_STATE", candidate.candidate_id), candidate.evidence_refs.map((e)=>e.id)),
    governance_events: candidate.governance_events,
    decision_timestamp: now(),
    cannot_be_modified_until_next_version: true,
  };

  const canonical:B04CanonicalState={...canonicalWithoutIdentity,identity:createCanonicalIdentity({object_id:`b04:${nextVersion}`,object_type:"b04_canonical_state",version:nextVersion,artifact:canonicalWithoutIdentity,parent_references:candidate.parent_references,created_at:canonicalWithoutIdentity.created_at})};
  await persistence.save(canonical);
  return canonical;
}

export async function loadVersion(
  version: string,
  persistence: B04StatePersistence,
): Promise<B04CanonicalState | null> {
  return persistence.load(version);
}

export async function listVersions(persistence: B04StatePersistence): Promise<string[]> {
  return persistence.listVersions();
}

export async function getLatestVersion(
  persistence: B04StatePersistence,
): Promise<B04CanonicalState | null> {
  return persistence.latest();
}

/**
 * Build audit trail entries for this version
 */
function buildAuditEntries(
  candidate: B04CandidateState,
  priorState: B04CanonicalState | undefined,
  authority: string,
  deps?: B04Deps,
): Array<{ version: string; changed_at: string; changed_by: string; summary: string }> {
  const deps_ = deps || createDefaultB04Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  if (!priorState) {
    return [
      {
        version: "v1.0",
        changed_at: now(),
        changed_by: authority,
        summary: `Initial B04 candidate evaluation: ${candidate.campaigns.length} campaigns synthesized`,
      },
    ];
  }

  return [
    {
      version: incrementVersion(priorState.version),
      changed_at: now(),
      changed_by: authority,
      summary: `B04 campaign evaluation updated: ${priorState.campaigns.length} → ${candidate.campaigns.length} campaigns`,
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

function createDefaultB04Deps(): B04Deps {
  return {
    hash: {
      stableCampaignId: (name: string, b01Version: string) =>
        `camp_${canonicalHasher.hash(`${b01Version}:${name}`)}`,
      stablePriorityId: (campaignId: string, rank: number) =>
        `prio_${canonicalHasher.hash(`${campaignId}:${rank}`)}`,
      stableAlignmentId: (opportunityId: string, segmentId: string, score: string) =>
        `align_${canonicalHasher.hash(`${opportunityId}:${segmentId}:${score}`)}`,
    },
    now: () => new Date().toISOString(),
  };
}
