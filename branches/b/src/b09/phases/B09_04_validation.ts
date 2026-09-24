// B09.04 — Learning Validation

import type { ConflictRecord, Gap } from "../../b00/contracts.js";
import type { CompletenessScore } from "../types.js";

export function detectLearningConflicts(obsCount: number, sigCount: number): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];

  if (obsCount === 0) {
    conflicts.push({
      conflict_id: "conf_no_observations",
      description: "No observations available for learning loop",
      affected_items: [],
      severity: "medium",
    });
  }

  if (sigCount === 0 && obsCount > 0) {
    conflicts.push({
      conflict_id: "conf_no_signals",
      description: "No learning signals generated from observations",
      affected_items: [],
      severity: "medium",
    });
  }

  return conflicts;
}

export function identifyLearningGaps(
  obsCount: number,
  sigCount: number,
  propCount: number,
): Gap[] {
  const gaps: Gap[] = [];

  if (obsCount === 0) {
    gaps.push({
      gap_id: "gap_observations",
      description: "No observations available; cannot generate learning signals",
      required_for: "learning_signals",
      priority: "high",
    });
  }

  if (sigCount === 0 && obsCount > 0) {
    gaps.push({
      gap_id: "gap_signals",
      description: "No signals generated; cannot propose learning actions",
      required_for: "learning_proposals",
      priority: "high",
    });
  }

  if (propCount === 0 && sigCount > 0) {
    gaps.push({
      gap_id: "gap_proposals",
      description: "No proposals generated; learning loop incomplete",
      required_for: "optimization",
      priority: "medium",
    });
  }

  return gaps;
}

export function calculateLearningCompleteness(
  obsCount: number,
  sigCount: number,
  propCount: number,
  gaps: Gap[],
): CompletenessScore {
  let score = 0;

  if (obsCount > 0) score += 25;
  if (sigCount > 0) score += 25;
  if (propCount > 0) score += 50;

  const blockingGaps = gaps.filter((g) => g.priority === "high").map((g) => g.gap_id);

  return {
    score: Math.min(score, 100),
    missing_inputs: [],
    blocking_decisions: blockingGaps,
  };
}
