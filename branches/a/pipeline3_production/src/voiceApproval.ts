// Gate A5 — Piper preview approval. Real, code-enforced state transition:
// PIPER_PREVIEW_GENERATED -> (human approval) -> NARRATION_APPROVED_FOR_PRODUCTION.
// This is the gate elevenlabs.ts checks before permitting any production
// voice call (invariant 8).

import { recordGateApproval } from "./gates.js";
import type { GateApprovalRecord, PiperPreviewResult } from "./types.js";

const GATE_A5 = "A5";

// TIER-1 REPAIR T1.3 — NARRATION_APPROVED_FOR_PRODUCTION requires Gate A4's
// PRODUCTION_DELIVERY_RECEIVED to already be on record: production voice
// narration cannot be legitimately approved before the assets it narrates
// over were received. `history` defaults to [] for source compatibility;
// omitting a real A4 record now correctly fails as out-of-order.
export function approvePiperPreview(
  preview: PiperPreviewResult,
  actor: string,
  history: GateApprovalRecord[] = [],
): GateApprovalRecord {
  return recordGateApproval({
    gateId: GATE_A5,
    stateBefore: "PIPER_PREVIEW_GENERATED",
    actor,
    objectVersionBeingApproved: preview.output_path,
    stateAfter: "NARRATION_APPROVED_FOR_PRODUCTION",
    downstreamOperationUnlocked: "P3.05 ElevenLabs production voice call is permitted",
    history,
  });
}
