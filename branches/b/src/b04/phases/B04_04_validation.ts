// B04.04 — Strategic Validation
// Detect conflicts, identify gaps, calculate completeness

import type { CompletenessScore } from "../types.js";
import type { CampaignStrategy, StrategicPriority } from "../types.js";
import type { B01CanonicalState, ConflictRecord, Gap } from "../../b00/contracts.js";
import type { StrategyContext } from "./B04_01_registry.js";

export function detectStrategyConflicts(
  b01State: B01CanonicalState,
  campaigns: CampaignStrategy[],
  priorities: StrategicPriority[],
): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];

  const b01Territories = new Set(b01State.content_territories?.map((t) => t.territory_id) || []);

  // Detect missing territories in B01 when campaigns need them
  if (b01Territories.size === 0 && campaigns.length > 0) {
    const campaignsNeedingTerritories = campaigns.filter((c) => c.territories.length > 0);
    if (campaignsNeedingTerritories.length > 0) {
      conflicts.push({
        conflict_id: "conf_missing_territories",
        description: "B01 has no territories defined; campaigns cannot be geo-scoped",
        affected_items: campaignsNeedingTerritories.map((c) => c.campaign_id),
        severity: "high",
      });
    }
  }

  for (const campaign of campaigns) {
    for (const territory of campaign.territories) {
      if (!b01Territories.has(territory)) {
        conflicts.push({
          conflict_id: `conf_${campaign.campaign_id}_${territory}`,
          description: `Campaign "${campaign.campaign_name}" references territory "${territory}" not in B01 territories`,
          affected_items: [campaign.campaign_id],
          severity: "high",
        });
      }
    }
  }

  for (const priority of priorities) {
    if (priority.blocks?.includes(priority.priority_id)) {
      conflicts.push({
        conflict_id: `conf_${priority.priority_id}_circular`,
        description: `Priority "${priority.description}" blocks itself`,
        affected_items: [priority.priority_id],
        severity: "high",
      });
    }
  }

  return conflicts;
}

export function identifyStrategicGaps(
  context: StrategyContext,
  campaignCount: number,
  priorityCount: number,
): Gap[] {
  const gaps: Gap[] = [];

  if (context.brand_profile.positioning === "UNKNOWN") {
    gaps.push({
      gap_id: "gap_brand_positioning",
      description: "Brand positioning undefined; strategy may lack clarity",
      required_for: "campaign_strategy",
      priority: "high",
    });
  }

  if (context.opportunities.length === 0) {
    gaps.push({
      gap_id: "gap_opportunities",
      description: "No strategic opportunities identified; cannot create campaigns",
      required_for: "campaign_creation",
      priority: "high",
    });
  }

  if (context.segments.length === 0) {
    gaps.push({
      gap_id: "gap_segments",
      description: "No audience segments; cannot target campaigns",
      required_for: "campaign_targeting",
      priority: "high",
    });
  }

  if (context.territories.length === 0) {
    gaps.push({
      gap_id: "gap_territories",
      description: "No content territories defined; campaigns lack geographic scope",
      required_for: "territorial_planning",
      priority: "high",
    });
  }

  if (campaignCount === 0) {
    gaps.push({
      gap_id: "gap_campaigns",
      description: "No campaigns generated; review opportunities and segments",
      required_for: "strategic_planning",
      priority: "high",
    });
  }

  if (priorityCount === 0 && campaignCount > 0) {
    gaps.push({
      gap_id: "gap_priorities",
      description: "No priority ranking; all campaigns have equal weight",
      required_for: "priority_selection",
      priority: "medium",
    });
  }

  return gaps;
}

export function calculateStrategyCompleteness(
  context: StrategyContext,
  campaignCount: number,
  priorityCount: number,
  gaps: Gap[],
): CompletenessScore {
  let score = 0;

  if (context.brand_profile.positioning !== "UNKNOWN") score += 20;
  if (context.opportunities.length > 0) score += 20;
  if (context.segments.length > 0) score += 20;
  if (campaignCount > 0) score += 20;
  if (priorityCount > 0) score += 20;

  const blockingGaps = gaps.filter((g) => g.priority === "high").map((g) => g.gap_id);

  return {
    score: Math.min(score, 100),
    missing_inputs: context.gaps,
    blocking_decisions: blockingGaps,
  };
}
