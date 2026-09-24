// B05.05 — Creative Validation
// Detect conflicts and calculate completeness

import type { CompletenessScore, CreativeAngle, MessagingStrategy, CreativeConstraint } from "../types.js";
import type { ConflictRecord, Gap } from "../../b00/contracts.js";
import type { CreativeContext } from "./B05_01_registry.js";

export function detectCreativeConflicts(
  creativeAngles: CreativeAngle[],
  messagingStrategies: MessagingStrategy[],
  constraints: CreativeConstraint[],
  context: CreativeContext,
): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];

  // Check for missing angles per campaign
  for (const campaign of context.campaigns) {
    const anglesForCampaign = creativeAngles.filter((a) => a.campaign_id === campaign.campaign_id);
    if (anglesForCampaign.length === 0) {
      conflicts.push({
        conflict_id: `conf_${campaign.campaign_id}_no_angles`,
        description: `Campaign "${campaign.campaign_name}" has no creative angles`,
        affected_items: [campaign.campaign_id],
        severity: "medium",
      });
    }
  }

  // Check for messaging coverage
  for (const campaign of context.campaigns) {
    for (const segmentId of campaign.target_segments) {
      const messagingForPair = messagingStrategies.filter(
        (m) => m.campaign_id === campaign.campaign_id && m.segment_id === segmentId,
      );
      if (messagingForPair.length === 0) {
        conflicts.push({
          conflict_id: `conf_${campaign.campaign_id}_${segmentId}_no_messaging`,
          description: `No messaging strategy for campaign "${campaign.campaign_name}" and segment "${segmentId}"`,
          affected_items: [campaign.campaign_id, segmentId],
          severity: "low",
        });
      }
    }
  }

  return conflicts;
}

export function identifyCreativeGaps(
  context: CreativeContext,
  angleCount: number,
  messagingCount: number,
  constraintCount: number,
): Gap[] {
  const gaps: Gap[] = [];

  if (context.brand_positioning === "UNKNOWN") {
    gaps.push({
      gap_id: "gap_brand_positioning",
      description: "Brand positioning undefined; creative direction may lack clarity",
      required_for: "creative_synthesis",
      priority: "high",
    });
  }

  if (context.segments.length === 0) {
    gaps.push({
      gap_id: "gap_segments",
      description: "No audience segments; cannot create tailored messaging",
      required_for: "messaging_synthesis",
      priority: "high",
    });
  }

  if (context.campaigns.length === 0) {
    gaps.push({
      gap_id: "gap_campaigns",
      description: "No campaigns; cannot create creative briefs",
      required_for: "creative_briefs",
      priority: "high",
    });
  }

  if (angleCount === 0 && context.campaigns.length > 0) {
    gaps.push({
      gap_id: "gap_angles",
      description: "No creative angles generated",
      required_for: "creative_synthesis",
      priority: "medium",
    });
  }

  if (messagingCount === 0 && context.segments.length > 0) {
    gaps.push({
      gap_id: "gap_messaging",
      description: "No messaging strategies; unable to tailor for audiences",
      required_for: "messaging_synthesis",
      priority: "medium",
    });
  }

  if (constraintCount === 0) {
    gaps.push({
      gap_id: "gap_constraints",
      description: "No creative constraints defined; brand safety may be at risk",
      required_for: "brand_protection",
      priority: "medium",
    });
  }

  return gaps;
}

export function calculateCreativeCompleteness(
  context: CreativeContext,
  angleCount: number,
  messagingCount: number,
  constraintCount: number,
  gaps: Gap[],
): CompletenessScore {
  let score = 0;

  if (context.brand_positioning !== "UNKNOWN") score += 20;
  if (context.campaigns.length > 0) score += 20;
  if (angleCount > 0) score += 20;
  if (messagingCount > 0) score += 20;
  if (constraintCount > 0) score += 20;

  const blockingGaps = gaps.filter((g) => g.priority === "high").map((g) => g.gap_id);

  return {
    score: Math.min(score, 100),
    missing_inputs: context.gaps,
    blocking_decisions: blockingGaps,
  };
}
