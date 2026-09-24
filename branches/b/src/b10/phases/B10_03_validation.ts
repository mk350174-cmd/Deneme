// B10.03 — Validation: Conflicts, Gaps, Completeness

import { canonicalHasher } from "../../b00/hashing.js";
import type { CompletenessScore } from "../types.js";
import type { ConflictRecord, Gap } from "../../b00/contracts.js";

export function detectOptimizationConflicts(
  proposalCount: number,
  assessmentCount: number,
): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];

  if (proposalCount > 0 && assessmentCount === 0) {
    conflicts.push({
      conflict_id: `conf_${canonicalHasher.stableConflictId("b10", "missing_assessments")}`,
      description: "Optimization proposals exist but impact assessments are missing",
      affected_items: ["b10"],
      severity: "medium",
    });
  }

  if (proposalCount > assessmentCount) {
    conflicts.push({
      conflict_id: `conf_${canonicalHasher.stableConflictId("b10", `assessment_count_${proposalCount}_${assessmentCount}`)}`,
      description: `${proposalCount - assessmentCount} proposals lack impact assessments`,
      affected_items: ["b10"],
      severity: "low",
    });
  }

  return conflicts;
}

export function identifyOptimizationGaps(
  proposalCount: number,
  assessmentCount: number,
): Gap[] {
  const gaps: Gap[] = [];

  if (proposalCount === 0) {
    gaps.push({
      gap_id: "gap_b10_no_proposals",
      description: "No optimization proposals generated from B09 learning loop",
      required_for: "optimization_assessment",
      priority: "medium",
    });
  }

  if (proposalCount > 0 && assessmentCount < proposalCount) {
    gaps.push({
      gap_id: "gap_b10_incomplete_assessment",
      description: "Not all proposals have risk/benefit assessments",
      required_for: "assessment_completion",
      priority: "low",
    });
  }

  if (proposalCount > 10) {
    gaps.push({
      gap_id: "gap_b10_proposal_volume",
      description: `High volume of proposals (${proposalCount}) may indicate strategy instability`,
      required_for: "strategy_review",
      priority: "low",
    });
  }

  return gaps;
}

export function calculateOptimizationCompleteness(
  proposalCount: number,
  assessmentCount: number,
  gaps: Gap[],
): CompletenessScore {
  const maxProposals = 10;
  const proposalScore = Math.min((proposalCount / maxProposals) * 100, 100);
  const assessmentScore = proposalCount > 0 ? (assessmentCount / proposalCount) * 100 : 100;

  const score = Math.round((proposalScore * 0.5 + assessmentScore * 0.5) / 1);

  const missing_inputs: string[] = [];
  if (proposalCount === 0) missing_inputs.push("No proposals from B09");
  if (assessmentCount < proposalCount) missing_inputs.push("Incomplete impact assessments");

  const blocking_decisions: string[] = [];
  if (proposalCount > 0 && assessmentCount === 0) {
    blocking_decisions.push("Must assess proposal impacts before accepting optimizations");
  }

  return {
    score,
    missing_inputs,
    blocking_decisions,
  };
}
