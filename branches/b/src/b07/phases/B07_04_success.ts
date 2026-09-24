// B07.04 — Success Metrics

import type { SuccessMetric } from "../types.js";
import type { PerformanceContext } from "./B07_01_registry.js";

export function defineSuccessMetrics(
  context: PerformanceContext,
  kpiIds: string[],
  deps?: { hash?: { stableMetricId: (campaignId: string, metricName: string) => string }; now?: () => string },
): SuccessMetric[] {
  const metrics: SuccessMetric[] = [];
  const stableMetricId =
    deps?.hash?.stableMetricId || ((cid: string, mn: string) => `metric_${cid}_${mn.replace(/\s+/g, "_").toLowerCase()}`);
  const now = deps?.now?.() || new Date().toISOString();

  for (const campaign of context.campaigns) {
    // Campaign-level success metric
    const successMetric: SuccessMetric = {
      metric_id: stableMetricId(campaign.campaign_id, "overall_success"),
      campaign_id: campaign.campaign_id,

      metric_name: `${campaign.campaign_name} Success`,
      description: `Overall success metric for ${campaign.primary_objective}`,

      primary_kpi_id: kpiIds[0] || "primary_kpi",
      supporting_indicators: kpiIds.slice(1, 4),

      success_threshold: 80,
      threshold_unit: "percent",
      threshold_definition: { value: 80, unit: "percent", basis: "DEFAULT", source: "B07 framework default", status: "INFERRED", version: "framework-v1" },

      evidence_refs: [
        {
          id: `ev_metric_${stableMetricId(campaign.campaign_id, "overall_success")}`,
          source: `campaign:${campaign.campaign_id}`,
          status: "INFERRED" as const,
          excerpt: `Success metric for ${campaign.campaign_name}`,
        },
      ],
      provenance: {
        type: "INFERRED" as const,
        decision_authority: `B07_04:defineSuccessMetrics`,
        timestamp: now,
        rationale: `Success metric defined for campaign objective: ${campaign.primary_objective}`,
      },
    };

    metrics.push(successMetric);
  }

  return metrics;
}
