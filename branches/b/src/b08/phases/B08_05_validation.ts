// B08.05 — Analytics Validation

import type { ConflictRecord, Gap } from "../../b00/contracts.js";
import type { AnalyticsContext } from "./B08_01_registry.js";
import type { CompletenessScore } from "../types.js";

export function detectAnalyticsConflicts(context: AnalyticsContext, sourceCount: number, metricCount: number): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];

  if (sourceCount === 0 && context.channels.length > 0) {
    conflicts.push({
      conflict_id: "conf_no_sources",
      description: "No data sources available for channels",
      affected_items: context.channels.map((c) => c.channel_id),
      severity: "high",
    });
  }

  if (metricCount === 0 && context.kpis.length > 0) {
    conflicts.push({
      conflict_id: "conf_no_metrics",
      description: "No metrics defined for KPIs",
      affected_items: context.kpis.map((k) => k.kpi_id),
      severity: "high",
    });
  }

  return conflicts;
}

export function identifyAnalyticsGaps(
  context: AnalyticsContext,
  sourceCount: number,
  metricCount: number,
  workflowCount: number,
): Gap[] {
  const gaps: Gap[] = [];

  if (context.kpis.length === 0) {
    gaps.push({
      gap_id: "gap_kpis",
      description: "No KPIs available; cannot define metrics",
      required_for: "metric_definition",
      priority: "high",
    });
  }

  if (context.channels.length === 0) {
    gaps.push({
      gap_id: "gap_channels",
      description: "No channels available; cannot identify data sources",
      required_for: "source_discovery",
      priority: "high",
    });
  }

  if (sourceCount === 0 && context.channels.length > 0) {
    gaps.push({
      gap_id: "gap_sources",
      description: "No data sources defined; cannot collect metrics",
      required_for: "data_collection",
      priority: "high",
    });
  }

  if (metricCount === 0 && sourceCount > 0) {
    gaps.push({
      gap_id: "gap_metrics",
      description: "No metrics defined; cannot measure KPIs",
      required_for: "measurement",
      priority: "high",
    });
  }

  if (workflowCount === 0 && metricCount > 0) {
    gaps.push({
      gap_id: "gap_workflows",
      description: "No workflows defined; cannot process analytics",
      required_for: "data_processing",
      priority: "medium",
    });
  }

  return gaps;
}

export function calculateAnalyticsCompleteness(
  context: AnalyticsContext,
  sourceCount: number,
  metricCount: number,
  workflowCount: number,
  gaps: Gap[],
): CompletenessScore {
  let score = 0;

  if (context.kpis.length > 0) score += 20;
  if (context.channels.length > 0) score += 20;
  if (sourceCount > 0) score += 20;
  if (metricCount > 0) score += 20;
  if (workflowCount > 0) score += 20;

  const blockingGaps = gaps.filter((g) => g.priority === "high").map((g) => g.gap_id);

  return {
    score: Math.min(score, 100),
    missing_inputs: context.gaps,
    blocking_decisions: blockingGaps,
  };
}
