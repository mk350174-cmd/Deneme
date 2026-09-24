// Human gate state model — duplicated from pipeline1_research/src/gates.ts
// (identical generic shape; no cross-package dependency), including the
// TIER-1 T1.3/T1.4 repairs.
// A-Branch Architectural Principle 6: "Human approval is a real state
// transition, enforced in code, not documentation."
//
// TIER-1 REPAIR (T1.3 + T1.4): this module previously minted any
// (gate, state_before, state_after) triple a caller asked for and bound the
// approval to a bare `object_version_being_approved` string. Two
// consequences: illegal/out-of-order transitions were representable, and an
// approved object could be mutated afterwards while keeping its approval.
//
// Now:
//   * every record is checked against the canonical transition table AND
//     the recorded history BEFORE the record is created (gateTransitions.ts)
//   * every record carries object_id / object_type / object_content_hash,
//     so requireApprovedContent can prove the approval still describes the
//     object in hand.

import { GateStateError } from "./errors.js";
import { contentHash } from "./canonicalIdentity.js";
import { assertLegalTransition } from "./gateTransitions.js";
import { stableApprovalRecordId } from "./ids.js";
import type { GateApprovalRecord } from "./types.js";

export function recordGateApproval(params: {
  gateId: string;
  stateBefore: string;
  actor: string;
  objectVersionBeingApproved: string;
  stateAfter: string;
  downstreamOperationUnlocked: string;
  timestamp?: string;
  // --- T1.3/T1.4 additions ---
  objectId?: string;
  objectType?: string;
  /** The object's content, hashed here so the approval binds to it. */
  objectContent?: unknown;
  /** Pre-computed content hash, when the caller already has one. */
  objectContentHash?: string;
  /** Gate history this transition must be legal against. */
  history?: GateApprovalRecord[];
}): GateApprovalRecord {
  if (!params.actor || params.actor.trim().length === 0) {
    throw new GateStateError(params.gateId, "non-empty actor", params.actor);
  }

  // T1.3 — legality is enforced at CREATION time, not only at validation.
  assertLegalTransition({
    gateId: params.gateId,
    stateBefore: params.stateBefore,
    stateAfter: params.stateAfter,
    objectType: params.objectType,
    objectId: params.objectId ?? params.objectVersionBeingApproved,
    history: params.history,
  });

  const object_content_hash =
    params.objectContentHash ??
    (params.objectContent !== undefined ? contentHash(params.objectContent) : undefined);

  return {
    gate_id: params.gateId,
    state_before: params.stateBefore,
    approval_record_id: stableApprovalRecordId(
      params.gateId,
      params.objectVersionBeingApproved,
      params.actor,
    ),
    actor: params.actor,
    timestamp: params.timestamp ?? new Date().toISOString(),
    object_version_being_approved: params.objectVersionBeingApproved,
    state_after: params.stateAfter,
    downstream_operation_unlocked: params.downstreamOperationUnlocked,
    object_id: params.objectId ?? params.objectVersionBeingApproved,
    object_type: params.objectType,
    object_content_hash,
  };
}

// Verifies a gate transition was actually recorded before letting a
// downstream operation proceed — the code-enforcement half of Principle 6.
export function requireGateState(
  gates: GateApprovalRecord[],
  gateId: string,
  requiredStateAfter: string,
): GateApprovalRecord {
  const record = [...gates].reverse().find((g) => g.gate_id === gateId);
  if (!record || record.state_after !== requiredStateAfter) {
    throw new GateStateError(gateId, requiredStateAfter, record?.state_after ?? "NONE");
  }
  return record;
}

/**
 * T1.4 — approval must bind to an immutable artifact.
 *
 * Finds the approval for (gate, state, object) and proves it still
 * describes `objectContent`. An object mutated after approval recomputes to
 * a different content hash and is rejected here, so "approved" cannot be
 * silently inherited by modified content.
 */
export function requireApprovedContent(params: {
  gates: GateApprovalRecord[];
  gateId: string;
  requiredStateAfter: string;
  objectId: string;
  objectContent: unknown;
}): GateApprovalRecord {
  const record = [...params.gates]
    .reverse()
    .find(
      (g) =>
        g.gate_id === params.gateId &&
        g.state_after === params.requiredStateAfter &&
        (g.object_id ?? g.object_version_being_approved) === params.objectId,
    );

  if (!record) {
    throw new GateStateError(
      params.gateId,
      `${params.requiredStateAfter} for object "${params.objectId}"`,
      "no matching approval record",
    );
  }

  if (!record.object_content_hash) {
    throw new GateStateError(
      params.gateId,
      "approval bound to an object content hash",
      "approval record carries no object_content_hash (unbindable legacy approval)",
    );
  }

  const actual = contentHash(params.objectContent);
  if (actual !== record.object_content_hash) {
    throw new GateStateError(
      params.gateId,
      `approved content hash ${record.object_content_hash}`,
      `object content has changed since approval (now ${actual})`,
    );
  }

  return record;
}
