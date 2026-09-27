// B08.03 — Metric Definition

import type { MetricDefinition, DataSourceDefinition } from "../types.js";
import type { AnalyticsContext } from "./B08_01_registry.js";

export function defineMetrics(
  context: AnalyticsContext,
  sources: DataSourceDefinition[],
  deps?: { hash?: { stableMetricId: (kpiId: string, sourceName: string) => string }; now?: () => string },
): MetricDefinition[] {
  const metrics: MetricDefinition[] = [];
  const stableMetricId =
    deps?.hash?.stableMetricId || ((kpiId: string, sourceName: string) => `metric_${kpiId}_${sourceName.replace(/\s+/g, "_").toLowerCase()}`);
  const now = deps?.now?.() || new Date().toISOString();

  for (const kpi of context.kpis) {
    const matchingSource = sources.find((s) => s.platform_id === kpi.channel_id) || sources[0];

    if (!matchingSource) continue;

    const metric: MetricDefinition = {
      metric_id: stableMetricId(kpi.kpi_id, matchingSource.source_name),
      kpi_id: kpi.kpi_id,
      metric_name: kpi.metric_name,
      source_id: matchingSource.source_id,

      aggregation_method: inferAggregationMethod(kpi.metric_name),
      aggregation_window: "daily",
      data_quality_rules: ["non_negative", "no_gaps", "within_bounds"],
      attribution_window: 30,

      evidence_refs: [
        {
          id: `ev_metric_${stableMetricId(kpi.kpi_id, matchingSource.source_name)}`,
          source: `kpi:${kpi.kpi_id}`,
          status: "INFERRED" as const,
          excerpt: `Metric for ${kpi.metric_name}`,
        },
      ],
      definition_state: "DEFINED",
      provenance: {
        type: "INFERRED" as const,
        decision_authority: "B08_03:defineMetrics",
        timestamp: now,
        rationale: `Metric definition inferred from KPI: ${kpi.metric_name}`,
      },
    };

    metrics.push(metric);
  }

  return metrics;
}

function inferAggregationMethod(metricName: string): "sum" | "average" | "max" | "min" | "count" | "unique_count" {
  const lower = metricName.toLowerCase();
  if (lower.includes("rate") || lower.includes("percentage")) return "average";
  if (lower.includes("growth")) return "sum";
  if (lower.includes("time")) return "average";
  if (lower.includes("count") || lower.includes("viewers")) return "sum";
  return "sum";
}
