// B06.05 — Distribution Validation
// Detect conflicts and calculate completeness

import type { CompletenessScore } from "../types.js";
import type { ConflictRecord, Gap } from "../../b00/contracts.js";
import type { DistributionContext } from "./B06_01_registry.js";

export function detectDistributionConflicts(
  context: DistributionContext,
  selectionsCount: number,
  schedulesCount: number,
): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];

  // Check channel coverage
  if (selectionsCount === 0 && context.campaigns.length > 0) {
    conflicts.push({
      conflict_id: "conf_no_channels",
      description: "No channels selected for campaigns",
      affected_items: context.campaigns.map((c) => c.campaign_id),
      severity: "high",
    });
  }

  // Check scheduling coverage
  if (schedulesCount === 0 && selectionsCount > 0) {
    conflicts.push({
      conflict_id: "conf_no_schedules",
      description: "Channels selected but no schedules defined",
      affected_items: context.campaigns.map((c) => c.campaign_id),
      severity: "medium",
    });
  }

  return conflicts;
}

export function identifyDistributionGaps(
  context: DistributionContext,
  selectionsCount: number,
  schedulesCount: number,
  rulesCount: number,
): Gap[] {
  const gaps: Gap[] = [];

  if (context.campaigns.length === 0) {
    gaps.push({
      gap_id: "gap_campaigns",
      description: "No campaigns; cannot create distribution strategy",
      required_for: "channel_selection",
      priority: "high",
    });
  }

  if (context.channels.length === 0) {
    gaps.push({
      gap_id: "gap_channels",
      description: "No channels available; cannot route content",
      required_for: "distribution_strategy",
      priority: "high",
    });
  }

  if (selectionsCount === 0 && context.campaigns.length > 0) {
    gaps.push({
      gap_id: "gap_selections",
      description: "No channel selections; cannot determine routing",
      required_for: "distribution_strategy",
      priority: "high",
    });
  }

  if (schedulesCount === 0 && selectionsCount > 0) {
    gaps.push({
      gap_id: "gap_schedules",
      description: "No content schedules; cannot optimize timing",
      required_for: "distribution_strategy",
      priority: "medium",
    });
  }

  if (rulesCount === 0 && selectionsCount > 0) {
    gaps.push({
      gap_id: "gap_format_rules",
      description: "No format rules; content specs undefined",
      required_for: "distribution_strategy",
      priority: "medium",
    });
  }

  return gaps;
}

export function calculateDistributionCompleteness(
  context: DistributionContext,
  selectionsCount: number,
  schedulesCount: number,
  rulesCount: number,
  gaps: Gap[],
): CompletenessScore {
  let score = 0;

  if (context.campaigns.length > 0) score += 20;
  if (context.channels.length > 0) score += 20;
  if (selectionsCount > 0) score += 20;
  if (schedulesCount > 0) score += 20;
  if (rulesCount > 0) score += 20;

  const blockingGaps = gaps.filter((g) => g.priority === "high").map((g) => g.gap_id);

  return {
    score: Math.min(score, 100),
    missing_inputs: context.gaps,
    blocking_decisions: blockingGaps,
  };
}
