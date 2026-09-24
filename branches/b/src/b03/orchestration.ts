import { externalObservations, externalLineage, externalProvenance } from "../b08/external/context.js";
// B03 — Orchestration & Canonicalization
// Executes 5-layer B03 pipeline, manages candidate→canonical transition, versioning

import type { B01CanonicalState } from "../b00/contracts.js";
import { bindProvenanceToSubject, bindUnboundProvenanceRefs } from "../b00/provenanceRef.js";
import type {
  B03Input,
  B03Deps,
  B03CandidateState,
  B03CanonicalState,
  B03StatePersistence,
} from "./types.js";
import type { Decision, Recommendation } from "../b00/contracts.js";
import type { ProvenanceRef } from "../b00/provenanceRef.js";
import { canonicalHasher } from "../b00/hashing.js";
import { proposeItem, approveItem, type GovernanceTransitionInput, type GovernanceEvent } from "../b00/governance.js";
import { isApprovedForArtifact } from "../b00/governance.js";
import { createCanonicalIdentity, resolveParentReference, createArtifactBinding } from "../b00/identity.js";

import { buildAudienceRegistry, validateRegistry } from "./phases/B03_01_registry.js";
import { aggregateAudienceEvidence } from "./phases/B03_02_evidence.js";
import { inferAudienceSegments, createDefaultB03Deps } from "./phases/B03_03_segmentation.js";
import {
  synthesizeSegmentProfiles,
  synthesizeAudienceNeeds,
  synthesizeAudiencePainPoints,
  synthesizeAudienceQuestions,
} from "./phases/B03_04_synthesis.js";
import {
  detectSegmentConflicts,
  identifyGaps,
  calculateCompleteness,
  validateNoFabrication,
} from "./phases/B03_05_validation.js";

/** Execute full B03 pipeline: registry → evidence → segmentation → synthesis → validation → candidate state */
export function runB03(b01State: B01CanonicalState, input: B03Input, deps?: B03Deps): B03CandidateState {
  const deps_ = deps || createDefaultB03Deps();

  // LAYER 1: Deterministic Registry
  const registry = buildAudienceRegistry(b01State, deps_);
  const registryValidation = validateRegistry(b01State);

  // LAYER 2: Evidence Aggregation
  const evidenceSet = aggregateAudienceEvidence(input, deps_);

  // LAYER 3: Analytical Segmentation
  const segments = b01State.channels.flatMap(channel => {
    const observations = externalObservations(input.external_intelligence, ["AudienceObservation", "CommunityObservation"], channel.channel_id);
    const externalEvidence = observations.flatMap(o=>o.evidence_refs);
    evidenceSet.all_evidence.push(...externalEvidence);
    // Channel binding is explicit; content text is left byte-for-byte intact.
    return inferAudienceSegments({...b01State, channels:[channel]}, evidenceSet.all_evidence.filter(e=>!e.id.startsWith("extev_")), deps_, externalEvidence);
  });

  // LAYER 4: Profile Synthesis
  const profiles = synthesizeSegmentProfiles(segments, deps_);
  const needs = synthesizeAudienceNeeds(segments, deps_);
  const painPoints = synthesizeAudiencePainPoints(segments, deps_);
  const questions = synthesizeAudienceQuestions(segments, deps_);

  // LAYER 5: Validation & Conflict Detection
  const conflicts = detectSegmentConflicts(b01State, segments);
  const gaps = identifyGaps(b01State, segments.length);
  gaps.push(...evidenceSet.gaps);

  // Validate no fabrication
  validateNoFabrication(segments);

  // Calculate completeness
  const completeness = calculateCompleteness(b01State, segments.length, profiles.length, gaps);

  // Aggregate insights
  const insights = [
    ...needs.map((n) => ({
      insight_id: `ins_${canonicalHasher.hash(n.need_id)}`,
      type: "need" as const,
      description: n.description,
      related_segments: [n.segment_id],
      relevance: 0.7,
      evidence_refs: n.evidence_refs,
      provenance: n.provenance,
    })),
    ...painPoints.map((p) => ({
      insight_id: `ins_${canonicalHasher.hash(p.pain_point_id)}`,
      type: "pain_point" as const,
      description: p.description,
      related_segments: [p.segment_id],
      relevance: 0.7,
      evidence_refs: p.evidence_refs,
      provenance: p.provenance,
    })),
    ...questions.map((q) => ({
      insight_id: `ins_${canonicalHasher.hash(q.question_id)}`,
      type: "question" as const,
      description: q.description,
      related_segments: [q.segment_id],
      relevance: 0.7,
      evidence_refs: q.evidence_refs,
      provenance: q.provenance,
    })),
  ];

  // Create candidate state
  // PHASE 3 FIX: Use deterministic hash for candidate_id
  const deterministicCandidateId = `cand_${canonicalHasher.stableCandidateId("b03", `${b01State.version}:${segments.length}`)}`;

  const candidate: B03CandidateState = {
    candidate_id: deterministicCandidateId,
    parent_references: [resolveParentReference("b01", b01State, "audience_input"), ...externalLineage(input.external_intelligence)],
    created_at: deps_.now?.() || new Date().toISOString(),
    b01_canonical_version: b01State.version,

    audience_segments: segments,
    segment_profiles: profiles,
    audience_insights: insights,
    audience_needs: needs,
    audience_pain_points: painPoints,
    audience_questions: questions,

    conflicts_detected: conflicts,
    gaps,

    evidence_refs: evidenceSet.all_evidence,
    provenance_refs: segments.map(s=>bindProvenanceToSubject(s.provenance,createArtifactBinding(s,s.segment_id,"b03_segment",deterministicCandidateId),s.evidence_refs.map(e=>e.id),"audience_segmentation")).concat(profiles.map(p=>bindProvenanceToSubject(p.provenance,createArtifactBinding(p,p.profile_id,"b03_profile",deterministicCandidateId),p.evidence_refs.map(e=>e.id),"profile_synthesis")), externalProvenance(input.external_intelligence)),

    // Governance lifecycle events (empty until approveCandidate is called)
    governance_events: {},

    all_recommendations: [],

    completeness,
  };

  return candidate;
}

/**
 * Approve B03 candidate state via B00 governance routing.
 *
 * Routes each segment through governance state machine:
 *   propose → approve → DECIDED (with governance event linkage)
 *
 * Populates governance_events and marks segments/profiles DECIDED.
 * Must be called before commitVersion() to establish governance chain.
 */
function approvalCurrent(candidate: any, item: unknown, id: string, type: string): boolean {
  return isApprovedForArtifact(candidate.governance_events?.[id] ?? [], createArtifactBinding(item, id, type, candidate.candidate_id));
}

export async function approveCandidate(
  candidate: B03CandidateState,
  userAuthority: string,
  deps?: B03Deps,
): Promise<B03CandidateState> {
  const deps_ = deps || createDefaultB03Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  // Helper to approve items through governance
  const approveItemsViaGovernance = <T extends { segment_id?: string; profile_id?: string; need_id?: string; pain_point_id?: string; question_id?: string; insight_id?: string; provenance: ProvenanceRef }>(
    items: T[],
    itemType: string,
  ): { approved: T[]; events: Record<string, GovernanceEvent[]> } => {
    const approvedItems: T[] = [];
    const governanceEventsByItem: Record<string, GovernanceEvent[]> = {};

    for (const item of items) {
      const itemId = item.insight_id || item.need_id || item.pain_point_id || item.question_id || item.profile_id || item.segment_id || "unknown";

      // PROPOSED → APPROVED via governance
      const proposalInput: GovernanceTransitionInput = {
        itemId,
        history: [],
        authority: userAuthority,
        timestamp: now(),
        rationale: `Proposed B03 ${itemType}: ${itemId}`,
      };
      const proposalResult = proposeItem(proposalInput);

      const approvalInput: GovernanceTransitionInput = {
        itemId,
        history: proposalResult.history,
        authority: userAuthority,
        timestamp: now(),
        rationale: `Approved B03 ${itemType}: ${itemId}`,
        artifact: createArtifactBinding(item, itemId, `b03_${itemType}`, candidate.candidate_id),
        requireArtifactBinding: true,
        sourceEvidenceRefs: ((item as unknown as { evidence_refs?: Array<{id:string}> }).evidence_refs ?? []).map((e) => e.id),
      };
      const approvalResult = approveItem(approvalInput);

      governanceEventsByItem[itemId] = [proposalResult.event, approvalResult.event];

      // Update item provenance to DECIDED with governance linkage
      const itemWithDecided = {
        ...item,
        provenance: {
          ...item.provenance,
          type: "DECIDED" as const,
          decision_authority: userAuthority,
          timestamp: now(),
          prior_provenance_id: approvalResult.event.provenance.id,
        },
      };
      approvedItems.push(itemWithDecided);
    }

    return { approved: approvedItems, events: governanceEventsByItem };
  };

  // Approve each major item type
  const { approved: segmentsApproved, events: segmentEvents } = approveItemsViaGovernance(
    candidate.audience_segments,
    "segment",
  );
  const { approved: profilesApproved, events: profileEvents } = approveItemsViaGovernance(
    candidate.segment_profiles,
    "profile",
  );
  const { approved: insightsApproved, events: insightEvents } = approveItemsViaGovernance(
    candidate.audience_insights,
    "insight",
  );
  const { approved: needsApproved, events: needEvents } = approveItemsViaGovernance(
    candidate.audience_needs,
    "need",
  );
  const { approved: painPointsApproved, events: painPointEvents } = approveItemsViaGovernance(
    candidate.audience_pain_points,
    "pain_point",
  );
  const { approved: questionsApproved, events: questionEvents } = approveItemsViaGovernance(
    candidate.audience_questions,
    "question",
  );

  return {
    ...candidate,
    audience_segments: segmentsApproved,
    segment_profiles: profilesApproved,
    audience_insights: insightsApproved,
    audience_needs: needsApproved,
    audience_pain_points: painPointsApproved,
    audience_questions: questionsApproved,
    governance_events: {
      ...segmentEvents,
      ...profileEvents,
      ...insightEvents,
      ...needEvents,
      ...painPointEvents,
      ...questionEvents,
    },
  };
}

/** Transform candidate state → canonical state (requires user approval) */
export async function commitVersion(
  candidate: B03CandidateState,
  nextVersion: string,
  userAuthority: string,
  persistence: B03StatePersistence,
  priorState?: B03CanonicalState,
  deps?: B03Deps,
): Promise<B03CanonicalState> {
  const deps_ = deps || createDefaultB03Deps();
  const now = () => deps_.now?.() || new Date().toISOString();

  // Validate semantic version format
  if (!/^v\d+\.\d+$/.test(nextVersion)) {
    throw new Error(`Invalid version format: ${nextVersion}. Expected v#.#`);
  }

  // Check immutability: this version shouldn't already exist
  const existingVersions = await persistence.listVersions();
  if (existingVersions.includes(nextVersion)) {
    throw new Error(`Version ${nextVersion} already committed (immutable)`);
  }

  // Filter: only DECIDED provenance items become canonical
  const decidedSegments = candidate.audience_segments.filter(
    (s) => s.provenance.type === "DECIDED" && approvalCurrent(candidate, s, s.segment_id, "b03_segment"),
  );
  const decidedProfiles = candidate.segment_profiles.filter(
    (p) => p.provenance.type === "DECIDED" && approvalCurrent(candidate, p, p.profile_id, "b03_profile"),
  );
  const decidedNeeds = candidate.audience_needs.filter(
    (n) => n.provenance.type === "DECIDED" && approvalCurrent(candidate, n, n.need_id, "b03_need"),
  );
  const decidedPainPoints = candidate.audience_pain_points.filter(
    (p) => p.provenance.type === "DECIDED" && approvalCurrent(candidate, p, p.pain_point_id, "b03_pain_point"),
  );
  const decidedQuestions = candidate.audience_questions.filter(
    (q) => q.provenance.type === "DECIDED" && approvalCurrent(candidate, q, q.question_id, "b03_question"),
  );
  const decidedInsights = candidate.audience_insights.filter(
    (i) => i.provenance.type === "DECIDED" && approvalCurrent(candidate, i, i.insight_id, "b03_insight"),
  );

  // Create canonical state
  const canonicalWithoutIdentity: Omit<B03CanonicalState, "identity"> = {
    version: nextVersion,
    created_at: candidate.created_at,
    updated_at: now(),
    user_decision_authority: userAuthority,

    b01_canonical_version: candidate.b01_canonical_version,

    audience_segments: decidedSegments,
    segment_profiles: decidedProfiles,
    audience_insights: decidedInsights,
    audience_needs: decidedNeeds,
    audience_pain_points: decidedPainPoints,
    audience_questions: decidedQuestions,

    audit_trail: [
      ...(priorState?.audit_trail || []),
      {
        version: nextVersion,
        changed_at: now(),
        changed_by: userAuthority,
        summary: `Canonicalized B03 version ${nextVersion}: ${decidedSegments.length} segments, ${decidedProfiles.length} profiles, ${decidedInsights.length} insights`,
      },
    ],

    decisions_made: [
      ...(priorState?.decisions_made || []),
      {
        decision_id: `dec_b03_v${nextVersion}`,
        description: `User approved B03 canonical state version ${nextVersion}`,
        timestamp: now(),
        user_authority: userAuthority,
        rationale: `Committed ${decidedSegments.length} audience segments and ${decidedInsights.length} insights`,
      } as Decision,
    ],

    recommendations_considered: candidate.all_recommendations,

    evidence_refs: candidate.evidence_refs,
    provenance_refs: bindUnboundProvenanceRefs(candidate.provenance_refs, createArtifactBinding(candidate, candidate.candidate_id, "B03_CANDIDATE_STATE", candidate.candidate_id), candidate.evidence_refs.map((e)=>e.id)),

    // Governance events (append-only chain)
    governance_events: candidate.governance_events,

    decision_timestamp: now(),
    cannot_be_modified_until_next_version: true,
  };

  const canonical: B03CanonicalState = {
    ...canonicalWithoutIdentity,
    identity: createCanonicalIdentity({ object_id:`b03:${nextVersion}`, object_type:"b03_canonical_state", version:nextVersion, artifact:canonicalWithoutIdentity, parent_references:candidate.parent_references, created_at:canonicalWithoutIdentity.created_at }),
  };
  // Persist (immutable save)
  await persistence.save(canonical);

  return canonical;
}

/** Load canonical state by version */
export async function loadVersion(
  version: string,
  persistence: B03StatePersistence,
): Promise<B03CanonicalState | null> {
  return persistence.load(version);
}

/** List all committed versions */
export async function listVersions(persistence: B03StatePersistence): Promise<string[]> {
  return persistence.listVersions();
}

/** Get latest version */
export async function getLatestVersion(persistence: B03StatePersistence): Promise<B03CanonicalState | null> {
  return persistence.latest();
}
