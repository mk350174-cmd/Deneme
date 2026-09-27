// AI Director — docs/architecture/02_PIPELINE_2_ARCHITECTURE.md "AI
// Director". Strictly advisory: PLAN -> ANALYZE -> IDENTIFY GAPS/RISKS ->
// PROPOSE OPTIONS -> RECOMMEND -> HUMAN DECISION -> RECORD DECISION.
//
// Code-level enforcement of "must not automatically approve its own
// recommendation": recommend() can only ever produce status "recommended".
// The ONLY function that can move a Decision to approved/rejected/modified
// is recordHumanDecision(), and it requires a non-empty actor (same guard
// pattern as gates.ts's recordGateApproval) — there is no code path from
// recommend() directly to "approved".

import { stableDecisionId } from "./ids.js";
import type { Decision, DecisionOption, DecisionStatus } from "./types.js";

export interface DirectorAnalysis {
  gaps: string[];
  risks: string[];
}

// PLAN -> ANALYZE -> IDENTIFY GAPS/RISKS: inspects caller-supplied plan
// notes for stated gaps/risks. Never infers a gap/risk the caller didn't
// state — an empty input yields an empty analysis.
export function analyze(planNotes: { statedGaps?: string[]; statedRisks?: string[] }): DirectorAnalysis {
  return {
    gaps: planNotes.statedGaps ?? [],
    risks: planNotes.statedRisks ?? [],
  };
}

// PROPOSE OPTIONS -> RECOMMEND: produces a Decision in status "recommended"
// only. approving_actor is intentionally left unset here.
export function recommend(params: {
  question: string;
  targetId: string;
  optionsConsidered: DecisionOption[];
  recommendation: string;
  rationale: string;
  precedentRefs?: string[];
}): Decision {
  if (!params.optionsConsidered.some((o) => o.choice === params.recommendation)) {
    throw new Error(
      `recommend(): recommendation "${params.recommendation}" must be one of optionsConsidered`,
    );
  }
  return {
    decision_id: stableDecisionId(params.question, params.targetId),
    question: params.question,
    options_considered: params.optionsConsidered,
    recommendation: params.recommendation,
    rationale: params.rationale,
    status: "recommended",
    timestamp: new Date().toISOString(),
    precedent_refs: params.precedentRefs ?? [],
    // approving_actor deliberately omitted: recommendation != approval.
  };
}

// HUMAN DECISION -> RECORD DECISION: the only function that can transition
// a Decision out of "recommended". Requires a human actor.
// R01.4 REPAIR — "modified" decision semantics.
//
// PROBLEM: `outcome === "modified" && modifiedChoice ? modifiedChoice :
// decision.recommendation` silently fell back to the ORIGINAL
// recommendation whenever outcome was "modified" but modifiedChoice was
// omitted or falsy — recording status: "modified" on a Decision whose
// recommendation never actually changed. Nothing distinguished that
// silent no-op from a genuine modification; a reader of the final
// `Decision` object would have to notice the coincidence themselves.
//
// REPAIR: "modified" now REQUIRES a real modified choice — a non-empty
// string genuinely different from the current recommendation. There is no
// silent no-op interpretation; if the human reviewer didn't actually
// change anything, the correct outcome to record is "approved", not
// "modified".
export function recordHumanDecision(
  decision: Decision,
  actor: string,
  outcome: "approved" | "rejected" | "modified",
  modifiedChoice?: string,
): Decision {
  if (!actor || actor.trim().length === 0) {
    throw new Error(`recordHumanDecision(): a non-empty actor is required to record "${outcome}"`);
  }
  if (decision.status === "approved" || decision.status === "rejected") {
    throw new Error(
      `recordHumanDecision(): decision "${decision.decision_id}" is already "${decision.status}" ` +
        `— use supersedeDecision() to record a new decision instead of re-recording this one.`,
    );
  }
  if (outcome === "modified") {
    if (!modifiedChoice || modifiedChoice.trim().length === 0) {
      throw new Error(
        `recordHumanDecision(): outcome "modified" requires a non-empty modifiedChoice — ` +
          `"modified" with no actual change is not a valid recording (R01.4). Use "approved" instead ` +
          `if the recommendation was accepted as-is.`,
      );
    }
    if (modifiedChoice === decision.recommendation) {
      throw new Error(
        `recordHumanDecision(): modifiedChoice "${modifiedChoice}" is identical to the current ` +
          `recommendation — that is not a modification (R01.4). Use "approved" instead.`,
      );
    }
  }
  const status: DecisionStatus = outcome;
  return {
    ...decision,
    status,
    recommendation: outcome === "modified" ? modifiedChoice! : decision.recommendation,
    approving_actor: actor,
    timestamp: new Date().toISOString(),
  };
}

// Marks a prior decision as superseded by a new one — the only other
// allowed status transition, also actor-gated.
export function supersedeDecision(oldDecision: Decision, newDecisionId: string, actor: string): Decision {
  if (!actor || actor.trim().length === 0) {
    throw new Error("supersedeDecision(): a non-empty actor is required");
  }
  return { ...oldDecision, status: "superseded", approving_actor: actor, timestamp: new Date().toISOString(), precedent_refs: [...oldDecision.precedent_refs, newDecisionId] };
}
