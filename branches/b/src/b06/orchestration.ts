// B06 Orchestration
// Coordinate distribution strategy phases

import { canonicalHasher } from "../b00/hashing.js";
import { bindUnboundProvenanceRefs } from "../b00/provenanceRef.js";
import { proposeItem, approveItem, type GovernanceTransitionInput, type GovernanceEvent } from "../b00/governance.js";
import { isApprovedForArtifact } from "../b00/governance.js";
import { createCanonicalIdentity, resolveParentReference, createArtifactBinding } from "../b00/identity.js";
import type { B06CandidateState, B06CanonicalState, B06Deps, ChannelSelection, ContentSchedule, FormatRule, DistributionStrategy } from "./types.js";
import type { B06StatePersistence } from "./types.js";
import type { B01CanonicalState } from "../b00/contracts.js";
import type { B03CandidateState } from "../b03/types.js";
import type { B04CandidateState, B04CanonicalState, CampaignStrategy } from "../b04/types.js";
import { buildDistributionContext, validateDistributionContext } from "./phases/B06_01_registry.js";
import { selectChannelsForCampaigns } from "./phases/B06_02_channels.js";
import { createContentSchedules } from "./phases/B06_03_scheduling.js";
import { defineFormatRules } from "./phases/B06_04_formats.js";
import {
  detectDistributionConflicts,
  identifyDistributionGaps,
  calculateDistributionCompleteness,
} from "./phases/B06_05_validation.js";

function approvalCurrent(candidate: any, item: unknown, id: string, type: string): boolean {
  return isApprovedForArtifact(candidate.governance_events?.[id] ?? [], createArtifactBinding(item, id, type, candidate.candidate_id));
}

export async function runB06(
  b01State: B01CanonicalState,
  b03State: B03CandidateState,
  b04State: B04CandidateState | B04CanonicalState,
  deps?: B06Deps,
): Promise<B06CandidateState> {
  const deps_ = deps || createDefaultB06Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  const context = buildDistributionContext(b01State, b03State, b04State);
  validateDistributionContext(context);

  const selections = selectChannelsForCampaigns(context, deps_);
  const schedules = createContentSchedules(context, selections, deps_);
  const rules = defineFormatRules(selections, deps_);

  const conflicts = detectDistributionConflicts(context, selections.length, schedules.length);
  const gaps = identifyDistributionGaps(
    context,
    selections.length,
    schedules.length,
    rules.length,
  );
  const completeness = calculateDistributionCompleteness(
    context,
    selections.length,
    schedules.length,
    rules.length,
    gaps,
  );

  // Create distribution strategies (one per campaign)
  const strategies = (b04State?.campaigns || []).map((campaign: CampaignStrategy): DistributionStrategy => {
    const campaignSelections = selections.filter((s) => s.campaign_id === campaign.campaign_id);
    const campaignSchedules = schedules.filter((s) => s.campaign_id === campaign.campaign_id);
    const campaignRules = rules.filter((r) => r.campaign_id === campaign.campaign_id);

    return {
      strategy_id: deps_?.hash?.stableStrategyId(campaign.campaign_id) || `strat_${campaign.campaign_id}`,
      campaign_id: campaign.campaign_id,
      channel_selections: campaignSelections,
      content_schedules: campaignSchedules,
      format_rules: campaignRules,
      audience_customizations: (campaign.target_segments || []).map((segId: string) => ({
        segment_id: segId,
        channel_id: campaignSelections[0]?.channel_id || "unknown",
        customization: `Tailored for segment ${segId}`,
      })),
      territory_rules: (campaign.territories || []).map((terrId: string) => ({
        territory_id: terrId,
        allowed_channels: campaignSelections.map((s) => s.channel_id),
      })),
      evidence_refs: [
        ...campaignSelections.flatMap((s: ChannelSelection) => s.evidence_refs),
        ...campaignSchedules.flatMap((s: ContentSchedule) => s.evidence_refs),
        ...campaignRules.flatMap((r: FormatRule) => r.evidence_refs),
      ],
    };
  });

  const allEvidence = [
    ...selections.flatMap((s: ChannelSelection) => s.evidence_refs),
    ...schedules.flatMap((s: ContentSchedule) => s.evidence_refs),
    ...rules.flatMap((r: FormatRule) => r.evidence_refs),
    ...strategies.flatMap((s: DistributionStrategy) => s.evidence_refs),
  ];

  const uniqueEvidence = Array.from(new Map(allEvidence.map((e) => [e.id, e])).values());

  return {
    candidate_id: `cand_${canonicalHasher.stableCandidateId("b06", `${b01State.version}:${selections.length}`)}`,
    parent_references: [resolveParentReference("b01", b01State, "distribution_foundation"), resolveParentReference("b03", b03State, "audience_input"), resolveParentReference("b04", b04State, "campaign_input")],
    created_at: now(),
    b01_version: b01State.version,
    b03_version: b03State.b01_canonical_version,
    b04_version: 'version' in b04State ? b04State.version : b04State.b03_version,

    channel_selections: selections,
    content_schedules: schedules,
    format_rules: rules,
    distribution_strategies: strategies,

    conflicts_detected: conflicts,
    gaps,
    evidence_refs: uniqueEvidence,
    provenance_refs: [
      ...selections.flatMap((s: ChannelSelection) => [s.provenance]),
      ...schedules.flatMap((s: ContentSchedule) => [s.provenance]),
      ...rules.flatMap((r: FormatRule) => [r.provenance]),
    ],
    governance_events: {},
    all_recommendations: [],
    completeness,
  };
}

/**
 * Approve B06 candidate state via B00 governance routing.
 *
 * Routes channel selections through governance state machine:
 *   propose → approve → DECIDED (with governance event linkage)
 *
 * Populates governance_events and marks selections DECIDED.
 * Must be called before commitVersion() to establish governance chain.
 */
export async function approveCandidate(
  candidate: B06CandidateState,
  userAuthority: string,
  deps?: B06Deps,
): Promise<B06CandidateState> {
  const deps_ = deps || createDefaultB06Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  const governanceEventsBySelection: Record<string, GovernanceEvent[]> = {};

  const selectionsWithGovernance: typeof candidate.channel_selections = [];
  for (const selection of candidate.channel_selections) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: selection.selection_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B06 channel selection: ${selection.channel_id} for ${selection.campaign_id}`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: selection.selection_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B06 channel selection: ${selection.channel_id} for ${selection.campaign_id}`,
      artifact: createArtifactBinding(selection, selection.selection_id, "b06_channel_selection", candidate.candidate_id), requireArtifactBinding: true, sourceEvidenceRefs: selection.evidence_refs.map((e)=>e.id),
    };
    const approvalResult = approveItem(approvalInput);

    governanceEventsBySelection[selection.selection_id] = [
      proposalResult.event,
      approvalResult.event,
    ];

    const selectionWithDecided = {
      ...selection,
      provenance: {
        ...selection.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id,
      },
    };
    selectionsWithGovernance.push(selectionWithDecided);
  }

  const schedulesWithGovernance: typeof candidate.content_schedules = [];
  const governanceEventsBySchedule: Record<string, GovernanceEvent[]> = {};
  for (const schedule of candidate.content_schedules) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: schedule.schedule_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B06 schedule: ${schedule.channel_id}`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: schedule.schedule_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B06 schedule: ${schedule.channel_id}`,
      artifact: createArtifactBinding(schedule, schedule.schedule_id, "b06_content_schedule", candidate.candidate_id), requireArtifactBinding: true, sourceEvidenceRefs: schedule.evidence_refs.map((e)=>e.id),
    };
    const approvalResult = approveItem(approvalInput);
    governanceEventsBySchedule[schedule.schedule_id] = [proposalResult.event, approvalResult.event];

    const scheduleWithDecided = {
      ...schedule,
      provenance: {
        ...schedule.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id,
      },
    };
    schedulesWithGovernance.push(scheduleWithDecided);
  }

  const rulesWithGovernance: typeof candidate.format_rules = [];
  const governanceEventsByRule: Record<string, GovernanceEvent[]> = {};
  for (const rule of candidate.format_rules) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: rule.rule_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B06 format rule: ${rule.channel_id}`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: rule.rule_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B06 format rule: ${rule.channel_id}`,
      artifact: createArtifactBinding(rule, rule.rule_id, "b06_format_rule", candidate.candidate_id), requireArtifactBinding: true, sourceEvidenceRefs: rule.evidence_refs.map((e)=>e.id),
    };
    const approvalResult = approveItem(approvalInput);
    governanceEventsByRule[rule.rule_id] = [proposalResult.event, approvalResult.event];

    const ruleWithDecided = {
      ...rule,
      provenance: {
        ...rule.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id,
      },
    };
    rulesWithGovernance.push(ruleWithDecided);
  }

  return {
    ...candidate,
    channel_selections: selectionsWithGovernance,
    content_schedules: schedulesWithGovernance,
    format_rules: rulesWithGovernance,
    governance_events: { ...governanceEventsBySelection, ...governanceEventsBySchedule, ...governanceEventsByRule },
  };
}

export async function commitVersion(
  candidate: B06CandidateState,
  nextVersion: string,
  userAuthority: string,
  persistence: B06StatePersistence,
  priorState?: B06CanonicalState,
  deps?: B06Deps,
): Promise<B06CanonicalState> {
  const deps_ = deps || createDefaultB06Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  if (!/^v\d+\.\d+$/.test(nextVersion)) {
    throw new Error(`Invalid semantic version format: ${nextVersion}. Expected v#.#`);
  }

  const existing = await persistence.load(nextVersion);
  if (existing) {
    throw new Error(`Version ${nextVersion} already exists (immutable)`);
  }

  const canonicalSelections = candidate.channel_selections.filter(
    (s) => s.provenance.type === "DECIDED" && approvalCurrent(candidate, s, s.selection_id, "b06_channel_selection"),
  );

  const newAuditEntries = buildAuditEntries(candidate, priorState, userAuthority, deps_);
  const auditTrail = [...(priorState?.audit_trail || []), ...newAuditEntries];

  const canonicalSchedules = candidate.content_schedules.filter((s) => s.provenance.type === "DECIDED" && approvalCurrent(candidate, s, s.schedule_id, "b06_content_schedule"));
  const canonicalRules = candidate.format_rules.filter((r) => r.provenance.type === "DECIDED" && approvalCurrent(candidate, r, r.rule_id, "b06_format_rule"));
  const canonicalStrategies = candidate.distribution_strategies.map((strategy) => ({
    ...strategy,
    channel_selections: canonicalSelections.filter((x)=>x.campaign_id===strategy.campaign_id),
    content_schedules: canonicalSchedules.filter((x)=>x.campaign_id===strategy.campaign_id),
    format_rules: canonicalRules.filter((x)=>x.campaign_id===strategy.campaign_id),
  }));
  const canonicalWithoutIdentity: Omit<B06CanonicalState, "identity"> = {
    version: nextVersion,
    created_at: now(),
    updated_at: now(),
    user_decision_authority: userAuthority,
    b01_canonical_version: candidate.b01_version,
    b03_canonical_version: candidate.b03_version,
    b04_canonical_version: candidate.b04_version,
    channel_selections: canonicalSelections,
    content_schedules: canonicalSchedules,
    format_rules: canonicalRules,
    distribution_strategies: canonicalStrategies,
    audit_trail: auditTrail,
    decisions_made: [],
    recommendations_considered: candidate.all_recommendations,
    evidence_refs: candidate.evidence_refs,
    provenance_refs: bindUnboundProvenanceRefs(candidate.provenance_refs, createArtifactBinding(candidate, candidate.candidate_id, "B06_CANDIDATE_STATE", candidate.candidate_id), candidate.evidence_refs.map((e)=>e.id)),
    governance_events: candidate.governance_events,
    decision_timestamp: now(),
    cannot_be_modified_until_next_version: true,
  };

  const canonical:B06CanonicalState={...canonicalWithoutIdentity,identity:createCanonicalIdentity({object_id:`b06:${nextVersion}`,object_type:"b06_canonical_state",version:nextVersion,artifact:canonicalWithoutIdentity,parent_references:candidate.parent_references,created_at:canonicalWithoutIdentity.created_at})};
  await persistence.save(canonical);
  return canonical;
}

export async function loadVersion(
  version: string,
  persistence: B06StatePersistence,
): Promise<B06CanonicalState | null> {
  return persistence.load(version);
}

export async function listVersions(persistence: B06StatePersistence): Promise<string[]> {
  return persistence.listVersions();
}

export async function getLatestVersion(
  persistence: B06StatePersistence,
): Promise<B06CanonicalState | null> {
  return persistence.latest();
}

/**
 * Build audit trail entries for this version
 */
function buildAuditEntries(
  candidate: B06CandidateState,
  priorState: B06CanonicalState | undefined,
  authority: string,
  deps?: B06Deps,
): Array<{ version: string; changed_at: string; changed_by: string; summary: string }> {
  const deps_ = deps || createDefaultB06Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  if (!priorState) {
    return [
      {
        version: "v1.0",
        changed_at: now(),
        changed_by: authority,
        summary: `Initial B06 distribution strategy: ${candidate.channel_selections.length} channel selections`,
      },
    ];
  }

  return [
    {
      version: incrementVersion(priorState.version),
      changed_at: now(),
      changed_by: authority,
      summary: `B06 distribution strategy updated: ${priorState.channel_selections.length} → ${candidate.channel_selections.length} selections`,
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

function createDefaultB06Deps(): B06Deps {
  return {
    hash: {
      stableSelectionId: (campaignId: string, channelId: string) =>
        `sel_${canonicalHasher.hash(`${campaignId}:${channelId}`)}`,
      stableScheduleId: (campaignId: string, channelId: string) =>
        `sch_${canonicalHasher.hash(`${campaignId}:${channelId}`)}`,
      stableFormatRuleId: (campaignId: string, channelId: string) =>
        `fmt_${canonicalHasher.hash(`${campaignId}:${channelId}`)}`,
      stableStrategyId: (campaignId: string) => `strat_${canonicalHasher.hash(campaignId)}`,
    },
    now: () => new Date().toISOString(),
  };
}
