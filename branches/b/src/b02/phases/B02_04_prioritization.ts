// B02.04 — Opportunity Prioritization & Classification
// Rank opportunities by strategic relevance; classify by type

import type { B02StrategicOpportunity, OpportunityClass, OpportunityType, PriorityEntry, B02Deps } from "../types.js";

/** Classify opportunities by type */
export function classifyOpportunities(
  opportunities: B02StrategicOpportunity[],
  deps?: B02Deps,
): OpportunityClass[] {
  const classes = new Map<OpportunityType, B02StrategicOpportunity[]>();

  // Group by opportunity_type
  for (const opp of opportunities) {
    const type = opp.opportunity_type;
    if (!classes.has(type)) {
      classes.set(type, []);
    }
    classes.get(type)!.push(opp);
  }

  // Convert to OpportunityClass array
  const result: OpportunityClass[] = [];
  let classIndex = 0;

  for (const [type, opps] of classes.entries()) {
    const classId = deps?.hash?.stableClassId(`opportunities`, type) || `class_${classIndex}`;
    classIndex++;

    const oppClass: OpportunityClass = {
      class_id: classId,
      type,
      opportunities: opps.map((o) => o.opportunity_id),
      count: opps.length,
      rationale: `Opportunities classified as ${type}: ${opps.length} identified`,
    };

    result.push(oppClass);
  }

  return result;
}

/** Prioritize opportunities by strategic relevance */
export function prioritizeOpportunities(
  opportunities: B02StrategicOpportunity[],
): PriorityEntry[] {
  // Sort by strategic_relevance descending
  const sorted = [...opportunities].sort(
    (a, b) => (b.strategic_relevance || 0) - (a.strategic_relevance || 0),
  );

  // Create priority matrix with ranks
  const matrix: PriorityEntry[] = sorted.map((opp, index) => ({
    rank: index + 1, // 1 = highest priority
    opportunity_id: opp.opportunity_id,
    strategic_relevance: opp.strategic_relevance || 0,
    reasoning: `Relevance score ${(opp.strategic_relevance || 0).toFixed(2)} places this opportunity at rank ${index + 1}`,
  }));

  return matrix;
}

/** Score opportunity by multiple factors */
export function scoreOpportunity(
  opportunity: B02StrategicOpportunity,
  platformPriority: number = 1, // 1-5 scale
): number {
  let score = opportunity.strategic_relevance || 0.5;

  // Adjust by opportunity type
  switch (opportunity.opportunity_type) {
    case "positioning_alignment":
      score *= 1.1; // Slightly higher priority for alignment
      break;
    case "capability_match":
      score *= 1.0; // Neutral
      break;
    case "territory_opportunity":
      score *= 0.9; // Slightly lower
      break;
    case "constraint_satisfaction":
      score *= 0.85; // Lower priority
      break;
    case "format_opportunity":
      score *= 1.15; // Higher priority
      break;
  }

  // Adjust by platform priority (would come from B01 role)
  score *= Math.max(0.5, 2 - platformPriority / 5);

  // Clamp to 0-1
  return Math.min(1, Math.max(0, score));
}

/** Filter opportunities by minimum relevance threshold */
export function filterByRelevance(
  opportunities: B02StrategicOpportunity[],
  minRelevance: number = 0.5,
): B02StrategicOpportunity[] {
  return opportunities.filter((opp) => (opp.strategic_relevance || 0) >= minRelevance);
}

/** Create executive summary of top opportunities */
export function summarizeTopOpportunities(
  opportunities: B02StrategicOpportunity[],
  topN: number = 5,
): Array<{ title: string; type: string; relevance: number }> {
  const sorted = [...opportunities].sort(
    (a, b) => (b.strategic_relevance || 0) - (a.strategic_relevance || 0),
  );

  return sorted.slice(0, topN).map((opp) => ({
    title: opp.title,
    type: opp.opportunity_type,
    relevance: opp.strategic_relevance || 0,
  }));
}
