import { externalObservations, externalLineage, externalProvenance, eligibleExternalReview } from "../b08/external/context.js";
// B07 — Performance Framework Orchestration

import { canonicalHasher } from "../b00/hashing.js";
import { bindUnboundProvenanceRefs } from "../b00/provenanceRef.js";
import { proposeItem, approveItem, type GovernanceTransitionInput, type GovernanceEvent } from "../b00/governance.js";
import { isApprovedForArtifact } from "../b00/governance.js";
import { createCanonicalIdentity, resolveParentReference, createArtifactBinding } from "../b00/identity.js";
import type { B07CandidateState, B07CanonicalState, B07Deps, B07StatePersistence, KPIDefinition, MeasurementPlan, SuccessMetric } from "./types.js";
import type { B04CandidateState, B04CanonicalState } from "../b04/types.js";
import type { B06CandidateState, B06CanonicalState } from "../b06/types.js";
import { buildPerformanceContext } from "./phases/B07_01_registry.js";
import { defineKPIs } from "./phases/B07_02_kpis.js";
import { createMeasurementPlans } from "./phases/B07_03_measurement.js";
import { defineSuccessMetrics } from "./phases/B07_04_success.js";
import {
  detectPerformanceConflicts,
  identifyPerformanceGaps,
  calculatePerformanceCompleteness,
} from "./phases/B07_05_validation.js";

function approvalCurrent(candidate: any, item: unknown, id: string, type: string): boolean {
  return isApprovedForArtifact(candidate.governance_events?.[id] ?? [], createArtifactBinding(item, id, type, candidate.candidate_id));
}

export async function runB07(
  b04State: B04CandidateState | B04CanonicalState,
  b06State: B06CandidateState | B06CanonicalState,
  deps?: B07Deps,
): Promise<B07CandidateState> {
  const deps_ = {...createDefaultB07Deps(), ...deps, hash:deps?.hash ?? createDefaultB07Deps().hash};
  const now = () => deps_.now?.() || new Date().toISOString();

  const context = buildPerformanceContext(b04State, b06State);

  const kpis = defineKPIs(context, deps_).map(kpi => {
    const reports = externalObservations(deps_.external_intelligence, ["PerformanceObservation"], kpi.channel_id)
      .filter(o=>o.measurement?.metric_id === kpi.kpi_id && o.measurement.unit === kpi.target_unit);
    if (!reports.length) return kpi;
    const reviewed = reports.filter(o=>eligibleExternalReview(o,deps_.external_intelligence!));
    return {...kpi,external_measurements:reports,
      ...(reviewed.length === 1 ? {actual_metric_value:reviewed[0].measurement!.value} : {}),
      evidence_refs:[...kpi.evidence_refs,...reports.flatMap(o=>o.evidence_refs),...reviewed.flatMap(o=>eligibleExternalReview(o,deps_.external_intelligence!)!.evidence_refs)]};
  });
  const plans = createMeasurementPlans(context, kpis.length, deps_);
  const metrics = defineSuccessMetrics(context, kpis.map((k) => k.kpi_id), deps_);

  const conflicts = detectPerformanceConflicts(context, kpis.length);
  const gaps = identifyPerformanceGaps(context, kpis.length, plans.length, metrics.length);
  const completeness = calculatePerformanceCompleteness(context, kpis.length, plans.length, metrics.length, gaps);

  const allEvidence = [
    ...kpis.flatMap((k: KPIDefinition) => k.evidence_refs),
    ...plans.flatMap((p: MeasurementPlan) => p.evidence_refs),
    ...metrics.flatMap((m: SuccessMetric) => m.evidence_refs),
  ];

  const uniqueEvidence = Array.from(new Map(allEvidence.map((e) => [e.id, e])).values());

  return {
    candidate_id: `cand_${canonicalHasher.stableCandidateId("b07", `${'version' in b04State ? b04State.version : b04State.b01_version}:${kpis.length}`)}`,
    parent_references: [resolveParentReference("b04", b04State, "performance_strategy"), resolveParentReference("b06", b06State, "distribution_input"), ...externalLineage(deps_.external_intelligence)],
    framework_state: "DEFINED",
    created_at: now(),
    b04_version: ('candidate_id' in b04State ? b04State.candidate_id : b04State.version),
    b06_version: ('candidate_id' in b06State ? b06State.candidate_id : b06State.version),

    kpi_definitions: kpis,
    measurement_plans: plans,
    success_metrics: metrics,

    conflicts_detected: conflicts,
    gaps,
    evidence_refs: uniqueEvidence,
    provenance_refs: [
      ...externalProvenance(deps_.external_intelligence),
      ...kpis.flatMap((k: KPIDefinition) => [k.provenance]),
      ...plans.flatMap((p: MeasurementPlan) => [p.provenance]),
      ...metrics.flatMap((m: SuccessMetric) => [m.provenance]),
    ],
    governance_events: {},
    all_recommendations: [],
    completeness,
  };
}

/**
 * Approve B07 candidate state via B00 governance routing.
 *
 * Routes KPIs, measurement plans, and success metrics through governance state machine:
 *   propose → approve → DECIDED (with governance event linkage)
 *
 * Populates governance_events and marks items DECIDED.
 * Must be called before commitVersion() to establish governance chain.
 */
export async function approveCandidate(
  candidate: B07CandidateState,
  userAuthority: string,
  deps?: B07Deps,
): Promise<B07CandidateState> {
  const deps_ = {...createDefaultB07Deps(), ...deps, hash:deps?.hash ?? createDefaultB07Deps().hash};
  const now = () => deps_.now?.() || new Date().toISOString();

  const governanceEventsByKPI: Record<string, GovernanceEvent[]> = {};

  const kpisWithGovernance: typeof candidate.kpi_definitions = [];
  for (const kpi of candidate.kpi_definitions) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: kpi.kpi_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B07 KPI: ${kpi.metric_name} for ${kpi.campaign_id}`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: kpi.kpi_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B07 KPI: ${kpi.metric_name} for ${kpi.campaign_id}`,
      artifact: createArtifactBinding(kpi, kpi.kpi_id, "b07_kpi_definition", candidate.candidate_id), requireArtifactBinding: true, sourceEvidenceRefs: kpi.evidence_refs.map((e)=>e.id),
    };
    const approvalResult = approveItem(approvalInput);

    governanceEventsByKPI[kpi.kpi_id] = [
      proposalResult.event,
      approvalResult.event,
    ];

    const kpiWithDecided = {
      ...kpi,
      provenance: {
        ...kpi.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id,
      },
    };
    kpisWithGovernance.push(kpiWithDecided);
  }

  const plansWithGovernance: typeof candidate.measurement_plans = [];
  const governanceEventsByPlan: Record<string, GovernanceEvent[]> = {};
  for (const plan of candidate.measurement_plans) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: plan.plan_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B07 measurement plan for ${plan.campaign_id}`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: plan.plan_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B07 measurement plan for ${plan.campaign_id}`,
      artifact: createArtifactBinding(plan, plan.plan_id, "b07_measurement_plan", candidate.candidate_id), requireArtifactBinding: true, sourceEvidenceRefs: plan.evidence_refs.map((e)=>e.id),
    };
    const approvalResult = approveItem(approvalInput);
    governanceEventsByPlan[plan.plan_id] = [proposalResult.event, approvalResult.event];

    const planWithDecided = {
      ...plan,
      provenance: {
        ...plan.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id,
      },
    };
    plansWithGovernance.push(planWithDecided);
  }

  const metricsWithGovernance: typeof candidate.success_metrics = [];
  const governanceEventsByMetric: Record<string, GovernanceEvent[]> = {};
  for (const metric of candidate.success_metrics) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: metric.metric_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B07 success metric: ${metric.metric_name}`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: metric.metric_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B07 success metric: ${metric.metric_name}`,
      artifact: createArtifactBinding(metric, metric.metric_id, "b07_success_metric", candidate.candidate_id), requireArtifactBinding: true, sourceEvidenceRefs: metric.evidence_refs.map((e)=>e.id),
    };
    const approvalResult = approveItem(approvalInput);
    governanceEventsByMetric[metric.metric_id] = [proposalResult.event, approvalResult.event];

    const metricWithDecided = {
      ...metric,
      provenance: {
        ...metric.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id,
      },
    };
    metricsWithGovernance.push(metricWithDecided);
  }

  return {
    ...candidate,
    kpi_definitions: kpisWithGovernance,
    measurement_plans: plansWithGovernance,
    success_metrics: metricsWithGovernance,
    governance_events: { ...governanceEventsByKPI, ...governanceEventsByPlan, ...governanceEventsByMetric },
  };
}

export async function commitVersion(
  candidate: B07CandidateState,
  nextVersion: string,
  userAuthority: string,
  persistence: B07StatePersistence,
  priorState?: B07CanonicalState,
  deps?: B07Deps,
): Promise<B07CanonicalState> {
  const deps_ = {...createDefaultB07Deps(), ...deps, hash:deps?.hash ?? createDefaultB07Deps().hash};
  const now = () => deps_.now?.() || new Date().toISOString();

  if (!/^v\d+\.\d+$/.test(nextVersion)) {
    throw new Error(`Invalid semantic version format: ${nextVersion}. Expected v#.#`);
  }

  const existing = await persistence.load(nextVersion);
  if (existing) {
    throw new Error(`Version ${nextVersion} already exists (immutable)`);
  }

  const canonicalKPIs = candidate.kpi_definitions.filter(
    (k) => k.provenance.type === "DECIDED" && approvalCurrent(candidate, k, k.kpi_id, "b07_kpi_definition"),
  );

  const newAuditEntries = buildAuditEntries(candidate, priorState, userAuthority, deps_);
  const auditTrail = [...(priorState?.audit_trail || []), ...newAuditEntries];

  const canonicalWithoutIdentity: Omit<B07CanonicalState, "identity"> = {
    framework_state: "DEFINED",
    version: nextVersion,
    created_at: now(),
    updated_at: now(),
    user_decision_authority: userAuthority,
    b04_canonical_version: candidate.b04_version,
    b06_canonical_version: candidate.b06_version,
    kpi_definitions: canonicalKPIs,
    measurement_plans: candidate.measurement_plans.filter((p) => p.provenance.type === "DECIDED" && approvalCurrent(candidate, p, p.plan_id, "b07_measurement_plan")),
    success_metrics: candidate.success_metrics.filter((m) => m.provenance.type === "DECIDED" && approvalCurrent(candidate, m, m.metric_id, "b07_success_metric")),
    audit_trail: auditTrail,
    decisions_made: [],
    recommendations_considered: candidate.all_recommendations,
    evidence_refs: candidate.evidence_refs,
    provenance_refs: bindUnboundProvenanceRefs(candidate.provenance_refs, createArtifactBinding(candidate, candidate.candidate_id, "B07_CANDIDATE_STATE", candidate.candidate_id), candidate.evidence_refs.map((e)=>e.id)),
    governance_events: candidate.governance_events,
    decision_timestamp: now(),
    cannot_be_modified_until_next_version: true,
  };

  const canonical:B07CanonicalState={...canonicalWithoutIdentity,identity:createCanonicalIdentity({object_id:`b07:${nextVersion}`,object_type:"b07_canonical_state",version:nextVersion,artifact:canonicalWithoutIdentity,parent_references:candidate.parent_references,created_at:canonicalWithoutIdentity.created_at})};
  await persistence.save(canonical);
  return canonical;
}

export async function loadVersion(
  version: string,
  persistence: B07StatePersistence,
): Promise<B07CanonicalState | null> {
  return persistence.load(version);
}

export async function listVersions(persistence: B07StatePersistence): Promise<string[]> {
  return persistence.listVersions();
}

export async function getLatestVersion(
  persistence: B07StatePersistence,
): Promise<B07CanonicalState | null> {
  return persistence.latest();
}

/**
 * Build audit trail entries for this version
 */
function buildAuditEntries(
  candidate: B07CandidateState,
  priorState: B07CanonicalState | undefined,
  authority: string,
  deps?: B07Deps,
): Array<{ version: string; changed_at: string; changed_by: string; summary: string }> {
  const deps_ = {...createDefaultB07Deps(), ...deps, hash:deps?.hash ?? createDefaultB07Deps().hash};
  const now = () => deps_.now?.() || new Date().toISOString();

  if (!priorState) {
    return [
      {
        version: "v1.0",
        changed_at: now(),
        changed_by: authority,
        summary: `Initial B07 performance metrics: ${candidate.kpi_definitions.length} KPIs`,
      },
    ];
  }

  return [
    {
      version: incrementVersion(priorState.version),
      changed_at: now(),
      changed_by: authority,
      summary: `B07 performance metrics updated: ${priorState.kpi_definitions.length} → ${candidate.kpi_definitions.length} KPIs`,
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

function createDefaultB07Deps(): B07Deps {
  return {
    hash: {
      stableKPIId: (campaignId: string, metricName: string) =>
        `kpi_${canonicalHasher.hash(`${campaignId}:${metricName}`)}`,
      stablePlanId: (campaignId: string) =>
        `plan_${canonicalHasher.hash(campaignId)}`,
      stableMetricId: (campaignId: string, metricName: string) =>
        `metric_${canonicalHasher.hash(`${campaignId}:${metricName}`)}`,
    },
    now: () => new Date().toISOString(),
  };
}
