// B08.04 — Analytics Workflow Definition

import type { AnalyticsWorkflow, DataSourceDefinition, MetricDefinition } from "../types.js";
import type { AnalyticsContext } from "./B08_01_registry.js";

export function defineAnalyticsWorkflows(
  context: AnalyticsContext,
  sources: DataSourceDefinition[],
  metrics: MetricDefinition[],
  deps?: { hash?: { stableWorkflowId: (campaignId: string) => string }; now?: () => string },
): AnalyticsWorkflow[] {
  const workflows: AnalyticsWorkflow[] = [];
  const stableWorkflowId = deps?.hash?.stableWorkflowId || ((cid: string) => `workflow_${cid}`);
  const now = deps?.now?.() || new Date().toISOString();

  for (const campaign of context.campaigns) {
    const campaignKpis = context.kpis.filter((k) => k.campaign_id === campaign.campaign_id && metrics.some((m) => m.kpi_id === k.kpi_id));
    const campaignMetrics = metrics.filter((m) => campaignKpis.some((k) => k.kpi_id === m.kpi_id));
    const sourceIds = Array.from(new Set(campaignMetrics.map((m: MetricDefinition) => m.source_id)));

    const workflow: AnalyticsWorkflow = {
      workflow_id: stableWorkflowId(campaign.campaign_id),
      workflow_name: `Analytics Workflow for ${campaign.campaign_name}`,
      source_ids: sourceIds.length > 0 ? sourceIds : sources.map((s) => s.source_id),
      metric_ids: campaignMetrics.map((m: MetricDefinition) => m.metric_id),
      processing_frequency: "daily",
      data_freshness_requirement: "24 hours",
      quality_checks: ["completeness", "consistency", "validity", "uniqueness"],
      execution_state: "DEFINED",

      evidence_refs: [
        {
          id: `ev_workflow_${stableWorkflowId(campaign.campaign_id)}`,
          source: `campaign:${campaign.campaign_id}`,
          status: "INFERRED" as const,
          excerpt: `Analytics workflow for ${campaign.campaign_name}`,
        },
      ],
      provenance: {
        type: "INFERRED" as const,
        decision_authority: "B08_04:defineAnalyticsWorkflows",
        timestamp: now,
        rationale: `Workflow defined for campaign: ${campaign.campaign_name}`,
      },
    };

    workflows.push(workflow);
  }

  return workflows;
}
