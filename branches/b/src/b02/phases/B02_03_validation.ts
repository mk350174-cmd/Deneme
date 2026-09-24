// B02.03 — Validation & Conflict Detection
// Detect constraint violations, identify gaps, calculate completeness

import type { B01CanonicalState, ConflictRecord, Gap } from "../../b00/contracts.js";
import type { B02StrategicOpportunity, CompletenessScore } from "../types.js";

/** Detect opportunities that conflict with constraints */
export function detectConstraintConflicts(
  b01State: B01CanonicalState,
  opportunities: B02StrategicOpportunity[],
): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];

  if (!b01State.strategic_constraints) {
    return conflicts;
  }

  // Simple conflict detection: if opportunity is not in allowed channels, it conflicts
  const allowedChannelIds = new Set(b01State.channels.map((c) => c.channel_id));

  for (const opportunity of opportunities) {
    if (!allowedChannelIds.has(opportunity.channel_id)) {
      conflicts.push({
        conflict_id: `conf_${opportunity.opportunity_id}_channel_mismatch`,
        description: `Opportunity on unknown channel ${opportunity.channel_id}`,
        affected_items: [opportunity.opportunity_id, opportunity.channel_id],
        severity: "medium",
        resolution: "Verify channel_id against B01.channels",
      });
    }
  }

  return conflicts;
}

/** Identify data gaps that affect opportunity evaluation */
export function identifyGaps(b01State: B01CanonicalState): Gap[] {
  const gaps: Gap[] = [];

  if (!b01State.brand_profile?.positioning) {
    gaps.push({
      gap_id: "gap_brand_positioning",
      description: "Brand positioning not fully defined",
      required_for: "evaluate positioning alignment opportunities",
      priority: "high",
    });
  }

  if (!b01State.editorial_constitution?.rules || b01State.editorial_constitution.rules.length === 0) {
    gaps.push({
      gap_id: "gap_editorial_rules",
      description: "Editorial constitution rules incomplete",
      required_for: "identify editorial constraint satisfaction opportunities",
      priority: "medium",
    });
  }

  if (!b01State.platforms || b01State.platforms.length === 0) {
    gaps.push({
      gap_id: "gap_platform_data",
      description: "Platform capabilities unknown",
      required_for: "identify capability match opportunities",
      priority: "medium",
    });
  }

  if (!b01State.content_territories || b01State.content_territories.length === 0) {
    gaps.push({
      gap_id: "gap_territories",
      description: "Content territories not defined",
      required_for: "identify territory-specific opportunities",
      priority: "low",
    });
  }

  return gaps;
}

/** Calculate completeness of B02 analysis (0-100 scale) */
export function calculateCompleteness(
  b01State: B01CanonicalState,
  opportunityCount: number,
  gaps: Gap[],
): CompletenessScore {
  const criteria = {
    brand_positioning: b01State.brand_profile?.positioning ? 20 : 0,
    editorial_rules: b01State.editorial_constitution?.rules?.length ? 20 : 0,
    platforms: b01State.platforms?.length ? 20 : 0,
    channels: b01State.channels?.length ? 20 : 0,
    opportunities_identified: opportunityCount > 0 ? 20 : 0,
  };

  const score = Object.values(criteria).reduce((a, b) => a + b, 0);

  const missing_inputs: string[] = [];
  if (criteria.brand_positioning === 0) missing_inputs.push("brand_profile.positioning");
  if (criteria.editorial_rules === 0) missing_inputs.push("editorial_constitution.rules");
  if (criteria.platforms === 0) missing_inputs.push("platforms");
  if (criteria.channels === 0) missing_inputs.push("channels");

  const blocking_decisions: string[] = [];
  if (gaps.some((g) => g.priority === "high")) {
    blocking_decisions.push("Resolve high-priority data gaps before finalizing opportunities");
  }
  if (opportunityCount === 0) {
    blocking_decisions.push("Identify at least one strategic opportunity");
  }

  return {
    score,
    missing_inputs,
    blocking_decisions,
  };
}

/** Validate no fabricated opportunity data */
export function validateNoFabrication(opportunities: B02StrategicOpportunity[]): boolean {
  for (const opp of opportunities) {
    // Check: must have evidence and provenance
    if (!opp.supporting_evidence || opp.supporting_evidence.length === 0) {
      console.warn(`Opportunity ${opp.opportunity_id} has no evidence (fabricated?)`);
      return false;
    }

    if (!opp.provenance) {
      console.warn(`Opportunity ${opp.opportunity_id} has no provenance (fabricated?)`);
      return false;
    }

    // Check: strategic_relevance must be in valid range
    if (typeof opp.strategic_relevance !== "number" || opp.strategic_relevance < 0 || opp.strategic_relevance > 1) {
      console.warn(`Opportunity ${opp.opportunity_id} has invalid strategic_relevance`);
      return false;
    }

    // Check: description must come from analysis, not magical
    if (!opp.description || opp.description.length === 0) {
      console.warn(`Opportunity ${opp.opportunity_id} has no description`);
      return false;
    }
  }

  return true;
}
