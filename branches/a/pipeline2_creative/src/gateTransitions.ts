// CANONICAL GATE STATE MACHINE (Tier-1 repair T1.3)
//
// Before this module `recordGateApproval` accepted arbitrary
// (gate_id, state_before, state_after) string triples and validated only
// that `actor` was non-empty. Any transition was constructible, including
// nonsense ones ("A1: BANANA -> SHIPPED") and out-of-order ones
// (PACKAGE_APPROVED recorded before the scope was ever approved).
// Validation happened — if at all — only at the terminal state, which the
// brief correctly calls insufficient.
//
// This table is the single authoritative transition model for the whole
// A-Branch. It is shared by copy (not import) across P1/P2/P3 exactly as
// gates.ts already is, so no cross-package runtime dependency is created.

import { GateStateError } from "./errors.js";

export interface TransitionRule {
  gate_id: string;
  state_before: string;
  state_after: string;
  /** Object class this transition may be applied to. */
  object_type: string;
  /**
   * Gate/state that MUST already appear in the recorded history before this
   * transition is legal. Undefined = this is an entry transition.
   */
  requires?: { gate_id: string; state_after: string };
  downstream_operation_unlocked: string;
}

/**
 * The complete canonical A-Branch transition table.
 *
 * P1 owns A1 (two transitions). P2 owns A2/A3. P3 owns A4/A5/A6/A7. Each
 * pipeline's copy carries the full table so a cross-pipeline prerequisite
 * (e.g. P2's A3 requiring P1's A1) is checkable wherever the history is
 * available, and unknown-gate records are rejected rather than ignored.
 */
export const CANONICAL_TRANSITIONS: readonly TransitionRule[] = [
  {
    gate_id: "A1",
    state_before: "SCOPE_PROPOSED",
    state_after: "SCOPE_APPROVED",
    object_type: "research_scope",
    downstream_operation_unlocked: "P1.03 Domain Research",
  },
  {
    gate_id: "A1",
    state_before: "PACKAGE_DRAFTED",
    state_after: "PACKAGE_APPROVED",
    object_type: "research_package",
    requires: { gate_id: "A1", state_after: "SCOPE_APPROVED" },
    downstream_operation_unlocked: "Pipeline 2 may consume this Research Package",
  },
  {
    gate_id: "A2",
    state_before: "REFERENCES_PROPOSED",
    state_after: "REFERENCES_APPROVED",
    object_type: "reference_set",
    downstream_operation_unlocked: "P2.02 Content Understanding",
  },
  {
    gate_id: "A2",
    state_before: "ART_DIRECTION_DRAFTED",
    state_after: "ART_DIRECTION_APPROVED",
    object_type: "art_direction",
    requires: { gate_id: "A2", state_after: "REFERENCES_APPROVED" },
    downstream_operation_unlocked: "P2.07 Asset Planning / P2.08 Scene-Shot Planning",
  },
  {
    gate_id: "A3",
    state_before: "PRODUCTION_PACKAGE_DRAFTED",
    state_after: "PRODUCTION_PACKAGE_APPROVED",
    object_type: "production_package",
    requires: { gate_id: "A2", state_after: "ART_DIRECTION_APPROVED" },
    downstream_operation_unlocked:
      "Manual Google Flow stage; Pipeline 3 may consume this Production Package once assets are delivered",
  },
  {
    gate_id: "A4",
    state_before: "AWAITING_PRODUCTION_DELIVERY",
    state_after: "PRODUCTION_DELIVERY_RECEIVED",
    object_type: "production_delivery",
    downstream_operation_unlocked: "P3.02 Asset Validation / P3.03 Asset Matching",
  },
  {
    gate_id: "A4",
    state_before: "PRODUCTION_DELIVERY_REJECTED",
    state_after: "PRODUCTION_DELIVERY_RECEIVED",
    object_type: "production_delivery",
    downstream_operation_unlocked: "P3.02 Asset Validation / P3.03 Asset Matching",
  },
  // CORRECTION (found while wiring P3's test suite against this table):
  // A5/A6 were initially drafted here from the brief's generic description
  // without cross-checking pipeline3_production/src/voiceApproval.ts and
  // pipeline.ts, which already implement these gates with different state
  // names. Per Architectural Principle 2 ("must not silently redefine
  // terminology"), the REAL state names from the existing implementation
  // are canonical here, not the guessed ones.
  {
    gate_id: "A5",
    state_before: "PIPER_PREVIEW_GENERATED",
    state_after: "NARRATION_APPROVED_FOR_PRODUCTION",
    object_type: "narration_preview",
    requires: { gate_id: "A4", state_after: "PRODUCTION_DELIVERY_RECEIVED" },
    downstream_operation_unlocked: "P3.05 Production Voice generation",
  },
  {
    gate_id: "A6",
    state_before: "MATERIAL_AMBIGUITY_DETECTED",
    state_after: "AMBIGUITY_RESOLVED",
    object_type: "production_voice",
    requires: { gate_id: "A5", state_after: "NARRATION_APPROVED_FOR_PRODUCTION" },
    downstream_operation_unlocked: "P3.06 Timing / P3.07 Timeline assembly",
  },
  {
    gate_id: "A7",
    state_before: "AUTOMATED_QA_COMPLETE",
    state_after: "FINAL_QA_APPROVED",
    object_type: "qa_report",
    downstream_operation_unlocked: "P3.10 Kaggle Delivery",
  },
  // --- Rejection / revision transitions ---
  //
  // A human gate is not approve-only: a reviewer may REJECT, after which the
  // object returns to its drafted/proposed state and may be re-approved.
  // These are canonical transitions too, and omitting them would have made
  // the state machine reject legitimate review cycles.
  {
    gate_id: "A1",
    state_before: "SCOPE_PROPOSED",
    state_after: "SCOPE_REJECTED",
    object_type: "research_scope",
    downstream_operation_unlocked: "none — scope returned for revision",
  },
  {
    gate_id: "A1",
    state_before: "SCOPE_APPROVED",
    state_after: "SCOPE_REJECTED",
    object_type: "research_scope",
    downstream_operation_unlocked: "none — approval withdrawn",
  },
  {
    gate_id: "A1",
    state_before: "SCOPE_REJECTED",
    state_after: "SCOPE_PROPOSED",
    object_type: "research_scope",
    downstream_operation_unlocked: "none — revised scope resubmitted",
  },
  {
    gate_id: "A1",
    state_before: "PACKAGE_DRAFTED",
    state_after: "PACKAGE_REJECTED",
    object_type: "research_package",
    downstream_operation_unlocked: "none — package returned for revision",
  },
  {
    gate_id: "A1",
    state_before: "PACKAGE_APPROVED",
    state_after: "PACKAGE_REJECTED",
    object_type: "research_package",
    downstream_operation_unlocked: "none — approval withdrawn",
  },
  {
    gate_id: "A1",
    state_before: "PACKAGE_REJECTED",
    state_after: "PACKAGE_DRAFTED",
    object_type: "research_package",
    downstream_operation_unlocked: "none — revised package redrafted",
  },
  {
    gate_id: "A2",
    state_before: "REFERENCES_PROPOSED",
    state_after: "REFERENCES_REJECTED",
    object_type: "reference_set",
    downstream_operation_unlocked: "none — references returned for revision",
  },
  {
    gate_id: "A2",
    state_before: "REFERENCES_APPROVED",
    state_after: "REFERENCES_REJECTED",
    object_type: "reference_set",
    downstream_operation_unlocked: "none — approval withdrawn",
  },
  {
    gate_id: "A2",
    state_before: "REFERENCES_REJECTED",
    state_after: "REFERENCES_PROPOSED",
    object_type: "reference_set",
    downstream_operation_unlocked: "none — revised references resubmitted",
  },
  {
    gate_id: "A2",
    state_before: "ART_DIRECTION_DRAFTED",
    state_after: "ART_DIRECTION_REJECTED",
    object_type: "art_direction",
    downstream_operation_unlocked: "none — art direction returned for revision",
  },
  {
    gate_id: "A2",
    state_before: "ART_DIRECTION_REJECTED",
    state_after: "ART_DIRECTION_DRAFTED",
    object_type: "art_direction",
    downstream_operation_unlocked: "none — revised art direction redrafted",
  },
  {
    gate_id: "A3",
    state_before: "PRODUCTION_PACKAGE_DRAFTED",
    state_after: "PRODUCTION_PACKAGE_REJECTED",
    object_type: "production_package",
    downstream_operation_unlocked: "none — production package returned for revision",
  },
  {
    gate_id: "A3",
    state_before: "PRODUCTION_PACKAGE_REJECTED",
    state_after: "PRODUCTION_PACKAGE_DRAFTED",
    object_type: "production_package",
    downstream_operation_unlocked: "none — revised production package redrafted",
  },
  {
    gate_id: "A4",
    state_before: "PRODUCTION_DELIVERY_RECEIVED",
    state_after: "PRODUCTION_DELIVERY_REJECTED",
    object_type: "production_delivery",
    downstream_operation_unlocked: "none — approval withdrawn, redelivery required",
  },
  {
    gate_id: "A4",
    state_before: "PRODUCTION_DELIVERY_REJECTED",
    state_after: "AWAITING_PRODUCTION_DELIVERY",
    object_type: "production_delivery",
    downstream_operation_unlocked: "none — awaiting redelivery",
  },
  {
    gate_id: "A5",
    state_before: "NARRATION_APPROVED_FOR_PRODUCTION",
    state_after: "NARRATION_REJECTED",
    object_type: "narration_preview",
    downstream_operation_unlocked: "none — approval withdrawn",
  },
  {
    gate_id: "A5",
    state_before: "NARRATION_REJECTED",
    state_after: "PIPER_PREVIEW_GENERATED",
    object_type: "narration_preview",
    downstream_operation_unlocked: "none — revised preview regenerated",
  },
  {
    gate_id: "A7",
    state_before: "AUTOMATED_QA_COMPLETE",
    state_after: "FINAL_QA_REJECTED",
    object_type: "qa_report",
    downstream_operation_unlocked: "none — returned for re-render / rework",
  },
  // Re-approval directly from a rejected state, after the object was revised.
  {
    gate_id: "A1",
    state_before: "SCOPE_REJECTED",
    state_after: "SCOPE_APPROVED",
    object_type: "research_scope",
    downstream_operation_unlocked: "P1.03 Domain Research",
  },
  {
    gate_id: "A1",
    state_before: "PACKAGE_REJECTED",
    state_after: "PACKAGE_APPROVED",
    object_type: "research_package",
    downstream_operation_unlocked: "Pipeline 2 may consume this Research Package",
  },
  {
    gate_id: "A2",
    state_before: "REFERENCES_REJECTED",
    state_after: "REFERENCES_APPROVED",
    object_type: "reference_set",
    downstream_operation_unlocked: "P2.02 Content Understanding",
  },
  {
    gate_id: "A2",
    state_before: "ART_DIRECTION_REJECTED",
    state_after: "ART_DIRECTION_APPROVED",
    object_type: "art_direction",
    downstream_operation_unlocked: "P2.07 Asset Planning / P2.08 Scene-Shot Planning",
  },
  {
    gate_id: "A3",
    state_before: "PRODUCTION_PACKAGE_REJECTED",
    state_after: "PRODUCTION_PACKAGE_APPROVED",
    object_type: "production_package",
    downstream_operation_unlocked: "Manual Google Flow stage; Pipeline 3 may consume this Production Package once assets are delivered",
  },
  {
    gate_id: "A7",
    state_before: "FINAL_QA_REJECTED",
    state_after: "FINAL_QA_APPROVED",
    object_type: "qa_report",
    downstream_operation_unlocked: "P3.10 Kaggle Delivery",
  },
];

export function findTransition(
  gateId: string,
  stateBefore: string,
  stateAfter: string,
): TransitionRule | undefined {
  return CANONICAL_TRANSITIONS.find(
    (t) => t.gate_id === gateId && t.state_before === stateBefore && t.state_after === stateAfter,
  );
}

/** Minimal shape this module needs from a recorded gate. */
export interface RecordedTransition {
  gate_id: string;
  state_before: string;
  state_after: string;
  object_id?: string;
  approval_record_id?: string;
}

/**
 * Enforces a transition AT CREATION TIME (the brief's core T1.3
 * requirement), against the canonical table and the recorded history.
 *
 * Checks, in order:
 *   1. the (gate, before, after) triple is a legal canonical transition
 *   2. the declared object_type matches the transition's object class
 *   3. any required prerequisite gate/state already exists in history
 *   4. the transition has not already been recorded for this exact object
 *      (out-of-order / duplicate approval)
 */
export function assertLegalTransition(params: {
  gateId: string;
  stateBefore: string;
  stateAfter: string;
  objectType?: string;
  objectId?: string;
  history?: RecordedTransition[];
}): TransitionRule {
  const rule = findTransition(params.gateId, params.stateBefore, params.stateAfter);
  if (!rule) {
    throw new GateStateError(
      params.gateId,
      `a canonical transition from "${params.stateBefore}"`,
      `illegal transition "${params.stateBefore}" -> "${params.stateAfter}" for gate "${params.gateId}"`,
    );
  }

  if (params.objectType !== undefined && params.objectType !== rule.object_type) {
    throw new GateStateError(
      params.gateId,
      `object_type "${rule.object_type}"`,
      `object_type "${params.objectType}"`,
    );
  }

  const history = params.history ?? [];

  if (rule.requires) {
    const satisfied = history.some(
      (h) => h.gate_id === rule.requires!.gate_id && h.state_after === rule.requires!.state_after,
    );
    if (!satisfied) {
      throw new GateStateError(
        params.gateId,
        `prerequisite ${rule.requires.gate_id}:${rule.requires.state_after} recorded first`,
        "prerequisite gate transition is missing (out-of-order approval)",
      );
    }
  }

  // A duplicate is a SECOND approval into the same state for the same object
  // with no intervening rejection. A legitimate review cycle
  // (APPROVED -> REJECTED -> ... -> APPROVED) is NOT a duplicate: only the
  // history since the most recent rejection of this gate is considered.
  const lastRejectionIndex = history.reduce(
    (acc, h, i) => (h.gate_id === params.gateId && h.state_after.endsWith("_REJECTED") ? i : acc),
    -1,
  );
  const relevantHistory = history.slice(lastRejectionIndex + 1);
  const duplicate = relevantHistory.some(
    (h) =>
      h.gate_id === params.gateId &&
      h.state_after === params.stateAfter &&
      (params.objectId === undefined || h.object_id === undefined || h.object_id === params.objectId),
  );
  if (duplicate) {
    throw new GateStateError(
      params.gateId,
      `transition to "${params.stateAfter}" recorded at most once per object`,
      "duplicate approval for an already-approved object",
    );
  }

  return rule;
}
