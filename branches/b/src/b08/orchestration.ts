import { externalObservations, externalLineage, externalProvenance } from "./external/context.js";
// B08 Orchestration

import { canonicalHasher } from "../b00/hashing.js";
import { bindUnboundProvenanceRefs } from "../b00/provenanceRef.js";
import { proposeItem, approveItem, type GovernanceTransitionInput, type GovernanceEvent } from "../b00/governance.js";
import { isApprovedForArtifact } from "../b00/governance.js";
import { createCanonicalIdentity, resolveParentReference, createArtifactBinding } from "../b00/identity.js";
import { validateAnalyticsResult } from "./execution.js";
import type { B08CandidateState, B08CanonicalState, B08Deps, B08StatePersistence, DataSourceDefinition, MetricDefinition, AnalyticsWorkflow } from "./types.js";
import type { B01CanonicalState } from "../b00/contracts.js";
import type { B06CandidateState, B06CanonicalState } from "../b06/types.js";
import type { B07CandidateState, B07CanonicalState } from "../b07/types.js";
import { buildAnalyticsContext } from "./phases/B08_01_registry.js";
import { defineDataSources } from "./phases/B08_02_sources.js";
import { defineMetrics } from "./phases/B08_03_metrics.js";
import { defineAnalyticsWorkflows } from "./phases/B08_04_workflows.js";
import {
  detectAnalyticsConflicts,
  identifyAnalyticsGaps,
  calculateAnalyticsCompleteness,
} from "./phases/B08_05_validation.js";

function approvalCurrent(candidate: any, item: unknown, id: string, type: string): boolean {
  return isApprovedForArtifact(candidate.governance_events?.[id] ?? [], createArtifactBinding(item, id, type, candidate.candidate_id));
}

export async function runB08(b07State: B07CandidateState | B07CanonicalState, b06State: B06CandidateState | B06CanonicalState, b01State: B01CanonicalState, deps?: B08Deps): Promise<B08CandidateState> {
  const deps_ = {...createDefaultB08Deps(), ...deps, hash:deps?.hash ?? createDefaultB08Deps().hash};
  const now = () => deps_.now?.() || new Date().toISOString();

  externalObservations(deps_.external_intelligence, []);
  const context = buildAnalyticsContext(b07State, b06State, b01State);
  const sources = defineDataSources(context, deps_);
  const metrics = defineMetrics(context, sources, deps_);
  const workflows = defineAnalyticsWorkflows(context, sources, metrics, deps_);

  const conflicts = detectAnalyticsConflicts(context, sources.length, metrics.length);
  const gaps = identifyAnalyticsGaps(context, sources.length, metrics.length, workflows.length);
  const completeness = calculateAnalyticsCompleteness(context, sources.length, metrics.length, workflows.length, gaps);

  const allEvidence = [
    ...(deps_.external_intelligence?.results.flatMap(r=>r.evidence) ?? []),
    ...sources.flatMap((s: DataSourceDefinition) => s.evidence_refs),
    ...metrics.flatMap((m: MetricDefinition) => m.evidence_refs),
    ...workflows.flatMap((w: AnalyticsWorkflow) => w.evidence_refs),
  ];

  const uniqueEvidence = Array.from(new Map(allEvidence.map((e) => [e.id, e])).values());

  return {
    candidate_id: `cand_${canonicalHasher.stableCandidateId("b08", `${'version' in b07State ? b07State.version : b07State.b04_version}:${sources.length}`)}`,
    parent_references: [resolveParentReference("b01", b01State, "analytics_foundation"), resolveParentReference("b06", b06State, "distribution_input"), resolveParentReference("b07", b07State, "kpi_framework_input"), ...externalLineage(deps_.external_intelligence)],
    external_intelligence: deps_.external_intelligence ? structuredClone(deps_.external_intelligence) : undefined,
    created_at: now(),
    b01_version: b01State?.version,
    b06_version: ('version' in b06State ? b06State.version : b06State.b04_version),
    b07_version: ('version' in b07State ? b07State.version : b07State.b04_version),

    data_sources: sources,
    metrics,
    workflows,
    data_ingestions: [], raw_observations: [], normalized_observations: [], metric_values: [], aggregations: [], analytics_results: [],

    conflicts_detected: conflicts,
    gaps,
    evidence_refs: uniqueEvidence,
    provenance_refs: [
      ...externalProvenance(deps_.external_intelligence),
      ...sources.flatMap((s: DataSourceDefinition) => [s.provenance]),
      ...metrics.flatMap((m: MetricDefinition) => [m.provenance]),
      ...workflows.flatMap((w: AnalyticsWorkflow) => [w.provenance]),
    ],
    governance_events: {},
    all_recommendations: [],
    completeness,
  };
}

export async function approveCandidate(
  candidate: B08CandidateState,
  userAuthority: string,
  deps?: B08Deps,
): Promise<B08CandidateState> {
  const deps_ = {...createDefaultB08Deps(), ...deps, hash:deps?.hash ?? createDefaultB08Deps().hash};
  const now = () => deps_.now?.() || new Date().toISOString();

  const governanceEventsBySource: Record<string, GovernanceEvent[]> = {};

  const sourcesWithGovernance: typeof candidate.data_sources = [];
  for (const source of candidate.data_sources) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: source.source_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B08 data source: ${source.source_name} (${source.source_type})`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: source.source_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B08 data source definition: ${source.source_name}`,
      artifact: createArtifactBinding(source, source.source_id, "b08_data_source_definition", candidate.candidate_id), requireArtifactBinding: true, sourceEvidenceRefs: source.evidence_refs.map((e)=>e.id),
    };
    const approvalResult = approveItem(approvalInput);

    governanceEventsBySource[source.source_id] = [
      proposalResult.event,
      approvalResult.event,
    ];

    const sourceWithDecided = {
      ...source,
      provenance: {
        ...source.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id,
      },
    };
    sourcesWithGovernance.push(sourceWithDecided);
  }

  const metricsWithGovernance: typeof candidate.metrics = [];
  const governanceEventsByMetric: Record<string, GovernanceEvent[]> = {};
  for (const metric of candidate.metrics) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: metric.metric_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B08 metric: ${metric.metric_name}`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: metric.metric_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B08 metric definition: ${metric.metric_name}`,
      artifact: createArtifactBinding(metric, metric.metric_id, "b08_metric_definition", candidate.candidate_id), requireArtifactBinding: true, sourceEvidenceRefs: metric.evidence_refs.map((e)=>e.id),
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

  const workflowsWithGovernance: typeof candidate.workflows = [];
  const governanceEventsByWorkflow: Record<string, GovernanceEvent[]> = {};
  for (const workflow of candidate.workflows) {
    const proposalInput: GovernanceTransitionInput = {
      itemId: workflow.workflow_id,
      history: [],
      authority: userAuthority,
      timestamp: now(),
      rationale: `Proposed B08 analytics workflow: ${workflow.workflow_name}`,
    };
    const proposalResult = proposeItem(proposalInput);

    const approvalInput: GovernanceTransitionInput = {
      itemId: workflow.workflow_id,
      history: proposalResult.history,
      authority: userAuthority,
      timestamp: now(),
      rationale: `Approved B08 analytics workflow definition: ${workflow.workflow_name}`,
      artifact: createArtifactBinding(workflow, workflow.workflow_id, "b08_analytics_workflow_definition", candidate.candidate_id), requireArtifactBinding: true, sourceEvidenceRefs: workflow.evidence_refs.map((e)=>e.id),
    };
    const approvalResult = approveItem(approvalInput);
    governanceEventsByWorkflow[workflow.workflow_id] = [proposalResult.event, approvalResult.event];

    const workflowWithDecided = {
      ...workflow,
      provenance: {
        ...workflow.provenance,
        type: "DECIDED" as const,
        decision_authority: userAuthority,
        timestamp: now(),
        prior_provenance_id: approvalResult.event.provenance.id,
      },
    };
    workflowsWithGovernance.push(workflowWithDecided);
  }

  return {
    ...candidate,
    data_sources: sourcesWithGovernance,
    metrics: metricsWithGovernance,
    workflows: workflowsWithGovernance,
    governance_events: { ...governanceEventsBySource, ...governanceEventsByMetric, ...governanceEventsByWorkflow },
  };
}

export async function commitVersion(
  candidate: B08CandidateState,
  nextVersion: string,
  userAuthority: string,
  persistence: B08StatePersistence,
  priorState?: B08CanonicalState,
  deps?: B08Deps,
): Promise<B08CanonicalState> {
  const deps_ = {...createDefaultB08Deps(), ...deps, hash:deps?.hash ?? createDefaultB08Deps().hash};
  const now = () => deps_.now?.() || new Date().toISOString();
  if (!/^v\d+\.\d+$/.test(nextVersion)) {
    throw new Error(`Invalid semantic version format: ${nextVersion}. Expected v#.#`);
  }

  const existing = await persistence.load(nextVersion);
  if (existing) {
    throw new Error(`Version ${nextVersion} already exists (immutable)`);
  }

  for (const result of candidate.analytics_results) {
    const validation = validateAnalyticsResult(result, candidate.metrics);
    if (!validation.valid) {
      throw new Error(`Invalid B08 analytics result ${result.result_id}: ${validation.issues.filter((issue) => issue.severity === "ERROR").map((issue) => issue.code).join(",")}`);
    }
  }

  const newAuditEntries = buildAuditEntries(candidate, priorState, userAuthority, deps_);
  const auditTrail = [...(priorState?.audit_trail || []), ...newAuditEntries];

  externalObservations(candidate.external_intelligence, []);
  const canonicalWithoutIdentity: Omit<B08CanonicalState, "identity"> = {
    version: nextVersion,
    created_at: now(),
    updated_at: now(),
    user_decision_authority: userAuthority,
    b01_canonical_version: candidate.b01_version,
    b06_canonical_version: candidate.b06_version,
    b07_canonical_version: candidate.b07_version,
    data_sources: candidate.data_sources.filter((x)=>x.provenance.type === "DECIDED" && approvalCurrent(candidate, x, x.source_id, "b08_data_source_definition")),
    metrics: candidate.metrics.filter((x)=>x.provenance.type === "DECIDED" && approvalCurrent(candidate, x, x.metric_id, "b08_metric_definition")),
    workflows: candidate.workflows.filter((x)=>x.provenance.type === "DECIDED" && approvalCurrent(candidate, x, x.workflow_id, "b08_analytics_workflow_definition")),
    data_ingestions: candidate.data_ingestions, raw_observations: candidate.raw_observations, normalized_observations: candidate.normalized_observations, metric_values: candidate.metric_values, aggregations: candidate.aggregations, analytics_results: candidate.analytics_results,
    external_intelligence: candidate.external_intelligence ? structuredClone(candidate.external_intelligence) : undefined,
    audit_trail: auditTrail,
    decisions_made: [],
    recommendations_considered: candidate.all_recommendations,
    evidence_refs: candidate.evidence_refs,
    provenance_refs: bindUnboundProvenanceRefs(candidate.provenance_refs, createArtifactBinding(candidate, candidate.candidate_id, "B08_CANDIDATE_STATE", candidate.candidate_id), candidate.evidence_refs.map((e)=>e.id)),
    governance_events: candidate.governance_events,
    decision_timestamp: now(),
    cannot_be_modified_until_next_version: true,
  };

  const canonical:B08CanonicalState={...canonicalWithoutIdentity,identity:createCanonicalIdentity({object_id:`b08:${nextVersion}`,object_type:"b08_canonical_state",version:nextVersion,artifact:canonicalWithoutIdentity,parent_references:candidate.parent_references,created_at:canonicalWithoutIdentity.created_at})};
  await persistence.save(canonical);
  return canonical;
}

export async function loadVersion(version: string, persistence: B08StatePersistence): Promise<B08CanonicalState | null> {
  return persistence.load(version);
}

export async function listVersions(persistence: B08StatePersistence): Promise<string[]> {
  return persistence.listVersions();
}

export async function getLatestVersion(persistence: B08StatePersistence): Promise<B08CanonicalState | null> {
  return persistence.latest();
}

function buildAuditEntries(
  candidate: B08CandidateState,
  priorState: B08CanonicalState | undefined,
  authority: string,
  deps?: B08Deps,
): Array<{ version: string; changed_at: string; changed_by: string; summary: string }> {
  const deps_ = {...createDefaultB08Deps(), ...deps, hash:deps?.hash ?? createDefaultB08Deps().hash};
  const now = () => deps_.now?.() || new Date().toISOString();

  if (!priorState) {
    return [
      {
        version: "v1.0",
        changed_at: now(),
        changed_by: authority,
        summary: `Initial B08 analytics infrastructure: ${candidate.data_sources.length} data sources, ${candidate.metrics.length} metrics`,
      },
    ];
  }

  return [
    {
      version: incrementVersion(priorState.version),
      changed_at: now(),
      changed_by: authority,
      summary: `B08 analytics updated: ${priorState.data_sources.length} → ${candidate.data_sources.length} sources, ${priorState.metrics.length} → ${candidate.metrics.length} metrics`,
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

function createDefaultB08Deps(): B08Deps {
  return {
    hash: {
      stableSourceId: (sourceType: string, platformId: string) =>
        `src_${canonicalHasher.hash(`${sourceType}:${platformId}`)}`,
      stableMetricId: (kpiId: string, sourceName: string) =>
        `metric_${canonicalHasher.hash(`${kpiId}:${sourceName}`)}`,
      stableWorkflowId: (campaignId: string) => `workflow_${canonicalHasher.hash(campaignId)}`,
    },
    now: () => new Date().toISOString(),
  };
}
