// B09 Orchestration

import { canonicalHasher } from "../b00/hashing.js";
import { bindUnboundProvenanceRefs } from "../b00/provenanceRef.js";
import { proposeItem, approveItem, type GovernanceTransitionInput, type GovernanceEvent } from "../b00/governance.js";
import { isApprovedForArtifact } from "../b00/governance.js";
import { createCanonicalIdentity, resolveParentReference, createArtifactBinding } from "../b00/identity.js";
import type { B09CandidateState, B09CanonicalState, B09Deps, B09StatePersistence, LearningObservation, LearningSignal, LearningProposal } from "./types.js";
import type { B08CandidateState, B08CanonicalState } from "../b08/types.js";
import type { B06CandidateState, B06CanonicalState } from "../b06/types.js";
import { generateLearningObservations, generateExternalLearningObservations, identifyOperationalGaps } from "./phases/B09_01_observations.js";
import { generateLearningSignals } from "./phases/B09_02_signals.js";
import { generateLearningProposals, generateFeedbackRules } from "./phases/B09_03_proposals.js";
import { detectLearningConflicts, identifyLearningGaps, calculateLearningCompleteness } from "./phases/B09_04_validation.js";

function approvalCurrent(candidate: any, item: unknown, id: string, type: string): boolean {
  return isApprovedForArtifact(candidate.governance_events?.[id] ?? [], createArtifactBinding(item, id, type, candidate.candidate_id));
}

export async function runB09(b08State: B08CandidateState | B08CanonicalState, b06State: B06CandidateState | B06CanonicalState, deps?: B09Deps): Promise<B09CandidateState> {
  const deps_ = deps || createDefaultB09Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  const observations = [...generateLearningObservations(b08State, b06State, deps_), ...generateExternalLearningObservations(b08State)];
  const operationalGaps = identifyOperationalGaps(b08State, b06State, deps_);
  const signals = generateLearningSignals(observations, deps_);
  const feedbackRules = generateFeedbackRules(signals, deps_);
  const proposals = generateLearningProposals(signals, deps_);

  const conflicts = detectLearningConflicts(observations.length, signals.length);
  const gaps = identifyLearningGaps(observations.length, signals.length, proposals.length);
  const completeness = calculateLearningCompleteness(observations.length, signals.length, proposals.length, gaps);

  const allEvidence = [
    ...operationalGaps.flatMap((g) => g.evidence_refs),
    ...observations.flatMap((o: LearningObservation) => o.evidence_refs),
    ...signals.flatMap((s: LearningSignal) => s.evidence_refs),
    ...proposals.flatMap((p: LearningProposal) => p.evidence_refs),
  ];

  const uniqueEvidence = Array.from(new Map(allEvidence.map((e) => [e.id, e])).values());

  return {
    candidate_id: `cand_${canonicalHasher.stableCandidateId("b09", `${'version' in b08State ? b08State.version : b08State.b07_version}:${observations.length}`)}`,
    parent_references: [resolveParentReference("b08", b08State, "actual_analytics_input"), resolveParentReference("b06", b06State, "distribution_context")],
    created_at: now(),
    b08_version: ('version' in b08State ? b08State.version : b08State.b07_version),

    observations,
    operational_gaps: operationalGaps,
    signals,
    feedback_rules: feedbackRules,
    proposals,

    conflicts_detected: conflicts,
    gaps,
    evidence_refs: uniqueEvidence,
    provenance_refs: [
      ...(b08State.external_intelligence?.results.flatMap(r=>r.provenance) ?? []),
      ...operationalGaps.map((g) => g.provenance),
      ...observations.flatMap((o: LearningObservation) => [o.provenance]),
      ...signals.flatMap((s: LearningSignal) => [s.provenance]),
      ...proposals.flatMap((p: LearningProposal) => [p.provenance]),
    ],
    governance_events: {},
    all_recommendations: [],
    completeness,
  };
}

export async function approveCandidate(
  candidate: B09CandidateState,
  userAuthority: string,
  deps?: B09Deps,
): Promise<B09CandidateState> {
  const deps_ = deps || createDefaultB09Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  const governanceEventsByObservation: Record<string, GovernanceEvent[]> = {};

  const observationsWithGovernance: typeof candidate.observations = [];
  for (const observation of candidate.observations) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: observation.observation_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B09 observation: ${observation.observation_type} in ${observation.affected_module}`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: observation.observation_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B09 observation: ${observation.description}`,
      artifact:createArtifactBinding(observation, observation.observation_id, "b09_learning_observation", candidate.candidate_id), requireArtifactBinding:true, sourceEvidenceRefs:observation.evidence_refs.map((e)=>e.id),
    };
    const approvalResult = approveItem(approvalInput);

    governanceEventsByObservation[observation.observation_id] = [
      proposalResult.event,
      approvalResult.event,
    ];

    const observationWithDecided = {
      ...observation,
      provenance: {
        ...observation.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id,
      },
    };
    observationsWithGovernance.push(observationWithDecided);
  }

  const signalsWithGovernance: typeof candidate.signals = [];
  const governanceEventsBySignal: Record<string, GovernanceEvent[]> = {};
  for (const signal of candidate.signals) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: signal.signal_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B09 signal: ${signal.signal_type} (${signal.severity})`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: signal.signal_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B09 signal: ${signal.description}`,
      artifact:createArtifactBinding(signal, signal.signal_id, "b09_learning_signal", candidate.candidate_id), requireArtifactBinding:true, sourceEvidenceRefs:signal.evidence_refs.map((e)=>e.id),
    };
    const approvalResult = approveItem(approvalInput);
    governanceEventsBySignal[signal.signal_id]=[proposalResult.event,approvalResult.event];

    const signalWithDecided = {
      ...signal,
      provenance: {
        ...signal.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id,
      },
    };
    signalsWithGovernance.push(signalWithDecided);
  }

  const proposalsWithGovernance: typeof candidate.proposals = [];
  const governanceEventsByProposal: Record<string, GovernanceEvent[]> = {};
  for (const proposal of candidate.proposals) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: proposal.proposal_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B09 proposal: ${proposal.proposal_type} for ${proposal.target_module}`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: proposal.proposal_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B09 proposal: ${proposal.description}`,
      artifact:createArtifactBinding(proposal, proposal.proposal_id, "b09_learning_proposal", candidate.candidate_id), requireArtifactBinding:true, sourceEvidenceRefs:proposal.evidence_refs.map((e)=>e.id),
    };
    const approvalResult = approveItem(approvalInput);
    governanceEventsByProposal[proposal.proposal_id]=[proposalResult.event,approvalResult.event];

    const proposalWithDecided = {
      ...proposal,
      provenance: {
        ...proposal.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id,
      },
    };
    proposalsWithGovernance.push(proposalWithDecided);
  }

  return {
    ...candidate,
    observations: observationsWithGovernance,
    signals: signalsWithGovernance,
    proposals: proposalsWithGovernance,
    governance_events: { ...governanceEventsByObservation, ...governanceEventsBySignal, ...governanceEventsByProposal },
  };
}

export async function commitVersion(
  candidate: B09CandidateState,
  nextVersion: string,
  userAuthority: string,
  persistence: B09StatePersistence,
  priorState?: B09CanonicalState,
  deps?: B09Deps,
): Promise<B09CanonicalState> {
  const deps_ = deps || createDefaultB09Deps();
  const now = () => deps_.now?.() || new Date().toISOString();
  if (!/^v\d+\.\d+$/.test(nextVersion)) {
    throw new Error(`Invalid semantic version format: ${nextVersion}. Expected v#.#`);
  }

  const existing = await persistence.load(nextVersion);
  if (existing) {
    throw new Error(`Version ${nextVersion} already exists (immutable)`);
  }

  const newAuditEntries = buildAuditEntries(candidate, priorState, userAuthority, deps_);
  const auditTrail = [...(priorState?.audit_trail || []), ...newAuditEntries];

  const canonicalWithoutIdentity: Omit<B09CanonicalState, "identity"> = {
    version: nextVersion,
    created_at: now(),
    updated_at: now(),
    user_decision_authority: userAuthority,
    b08_canonical_version: candidate.b08_version,
    observations: candidate.observations.filter((x)=>x.provenance.type==="DECIDED" && approvalCurrent(candidate, x, x.observation_id, "b09_learning_observation")),
    operational_gaps: candidate.operational_gaps,
    signals: candidate.signals.filter((x)=>x.provenance.type==="DECIDED" && approvalCurrent(candidate, x, x.signal_id, "b09_learning_signal")),
    feedback_rules: candidate.feedback_rules,
    proposals: candidate.proposals.filter((x)=>x.provenance.type==="DECIDED" && approvalCurrent(candidate, x, x.proposal_id, "b09_learning_proposal")),
    audit_trail: auditTrail,
    decisions_made: [],
    recommendations_considered: candidate.all_recommendations,
    evidence_refs: candidate.evidence_refs,
    provenance_refs: bindUnboundProvenanceRefs(candidate.provenance_refs, createArtifactBinding(candidate, candidate.candidate_id, "B09_CANDIDATE_STATE", candidate.candidate_id), candidate.evidence_refs.map((e)=>e.id)),
    governance_events: candidate.governance_events,
    decision_timestamp: now(),
    cannot_be_modified_until_next_version: true,
  };

  const canonical:B09CanonicalState={...canonicalWithoutIdentity,identity:createCanonicalIdentity({object_id:`b09:${nextVersion}`,object_type:"b09_canonical_state",version:nextVersion,artifact:canonicalWithoutIdentity,parent_references:candidate.parent_references,created_at:canonicalWithoutIdentity.created_at})};
  await persistence.save(canonical);
  return canonical;
}

export async function loadVersion(version: string, persistence: B09StatePersistence): Promise<B09CanonicalState | null> {
  return persistence.load(version);
}

export async function listVersions(persistence: B09StatePersistence): Promise<string[]> {
  return persistence.listVersions();
}

export async function getLatestVersion(persistence: B09StatePersistence): Promise<B09CanonicalState | null> {
  return persistence.latest();
}

function buildAuditEntries(
  candidate: B09CandidateState,
  priorState: B09CanonicalState | undefined,
  authority: string,
  deps?: B09Deps,
): Array<{ version: string; changed_at: string; changed_by: string; summary: string }> {
  const deps_ = deps || createDefaultB09Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  if (!priorState) {
    return [
      {
        version: "v1.0",
        changed_at: now(),
        changed_by: authority,
        summary: `Initial B09 learning loops: ${candidate.observations.length} observations, ${candidate.signals.length} signals`,
      },
    ];
  }

  return [
    {
      version: incrementVersion(priorState.version),
      changed_at: now(),
      changed_by: authority,
      summary: `B09 learning loops updated: ${priorState.observations.length} → ${candidate.observations.length} observations, ${priorState.signals.length} → ${candidate.signals.length} signals`,
    },
  ];
}

function incrementVersion(version: string): string {
  const parts = version.slice(1).split(".").map(Number);
  if (parts.length < 2 || parts[0] === undefined || parts[1] === undefined) {
    return `${version}.1`;
  }
  parts[1]++;
  return `v${parts[0]}.${parts[1]}`;
}

function createDefaultB09Deps(): B09Deps {
  return {
    hash: {
      stableObservationId: (type: string, module: string) =>
        `obs_${canonicalHasher.hash(`${type}:${module}`)}`,
      stableSignalId: (type: string, description: string) =>
        `sig_${canonicalHasher.hash(`${type}:${description}`)}`,
      stableProposalId: (moduleId: string, proposalType: string) =>
        `prop_${canonicalHasher.hash(`${moduleId}:${proposalType}`)}`,
    },
    now: () => new Date().toISOString(),
  };
}
