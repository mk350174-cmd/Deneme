// B07.05 — Performance Validation

import type { CompletenessScore } from "../types.js";
import type { ConflictRecord, Gap } from "../../b00/contracts.js";
import type { PerformanceContext } from "./B07_01_registry.js";

export function detectPerformanceConflicts(
  context: PerformanceContext,
  kpiCount: number,
): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];

  if (kpiCount === 0 && context.campaigns.length > 0) {
    conflicts.push({
      conflict_id: "conf_no_kpis",
      description: "No KPIs defined for campaigns",
      affected_items: context.campaigns.map((c) => c.campaign_id),
      severity: "high",
    });
  }

  return conflicts;
}

export function identifyPerformanceGaps(
  context: PerformanceContext,
  kpiCount: number,
  planCount: number,
  metricCount: number,
): Gap[] {
  const gaps: Gap[] = [];

  if (context.campaigns.length === 0) {
    gaps.push({
      gap_id: "gap_campaigns",
      description: "No campaigns; cannot define performance metrics",
      required_for: "kpi_definition",
      priority: "high",
    });
  }

  if (context.channels.length === 0) {
    gaps.push({
      gap_id: "gap_channels",
      description: "No channels in distribution; cannot measure performance",
      required_for: "measurement_plan",
      priority: "high",
    });
  }

  if (kpiCount === 0 && context.campaigns.length > 0) {
    gaps.push({
      gap_id: "gap_kpis",
      description: "No KPIs defined; cannot measure campaign success",
      required_for: "performance_framework",
      priority: "high",
    });
  }

  if (planCount === 0 && kpiCount > 0) {
    gaps.push({
      gap_id: "gap_measurement_plan",
      description: "No measurement plan; cannot track KPIs",
      required_for: "measurement_plan",
      priority: "medium",
    });
  }

  return gaps;
}

export function calculatePerformanceCompleteness(
  context: PerformanceContext,
  kpiCount: number,
  planCount: number,
  metricCount: number,
  gaps: Gap[],
): CompletenessScore {
  let score = 0;

  if (context.campaigns.length > 0) score += 20;
  if (context.channels.length > 0) score += 20;
  if (kpiCount > 0) score += 20;
  if (planCount > 0) score += 20;
  if (metricCount > 0) score += 20;

  const blockingGaps = gaps.filter((g) => g.priority === "high").map((g) => g.gap_id);

  return {
    score: Math.min(score, 100),
    missing_inputs: context.gaps,
    blocking_decisions: blockingGaps,
  };
}
