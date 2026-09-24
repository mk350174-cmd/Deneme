import { describe, expect, it } from "vitest";
import { approvePiperPreview } from "../src/voiceApproval.js";
import { recordGateApproval, requireGateState } from "../src/gates.js";
import { GateStateError } from "../src/errors.js";
import type { PiperPreviewResult } from "../src/types.js";

const preview: PiperPreviewResult = { output_path: "preview.wav", measured_duration_s: 3, target_duration_s: 3, deviation_pct: 0, flagged: false };

// TIER-1 REPAIR T1.3: NARRATION_APPROVED_FOR_PRODUCTION now requires Gate
// A4's PRODUCTION_DELIVERY_RECEIVED on record first.
function approvedA4() {
  return recordGateApproval({
    gateId: "A4",
    stateBefore: "AWAITING_PRODUCTION_DELIVERY",
    actor: "user:mk350174",
    objectVersionBeingApproved: "delivery_v1",
    stateAfter: "PRODUCTION_DELIVERY_RECEIVED",
    downstreamOperationUnlocked: "P3.02",
  });
}

describe("Gate A5 — Piper approval (item 11)", () => {
  it("PIPER_PREVIEW_GENERATED -> NARRATION_APPROVED_FOR_PRODUCTION, full record shape", () => {
    const gate = approvePiperPreview(preview, "user:mk350174", [approvedA4()]);
    expect(gate.gate_id).toBe("A5");
    expect(gate.state_before).toBe("PIPER_PREVIEW_GENERATED");
    expect(gate.state_after).toBe("NARRATION_APPROVED_FOR_PRODUCTION");
    expect(gate.actor).toBe("user:mk350174");
    expect(gate.approval_record_id).toBeTruthy();
    expect(gate.timestamp).toBeTruthy();
    expect(gate.object_version_being_approved).toBe("preview.wav");
    expect(gate.downstream_operation_unlocked).toContain("ElevenLabs");
  });

  it("requires a non-empty actor", () => {
    expect(() => approvePiperPreview(preview, "", [approvedA4()])).toThrow();
  });

  it("requireGateState fails before approval, passes after", () => {
    expect(() => requireGateState([], "A5", "NARRATION_APPROVED_FOR_PRODUCTION")).toThrow(GateStateError);
    const gate = approvePiperPreview(preview, "user:mk350174", [approvedA4()]);
    expect(() => requireGateState([gate], "A5", "NARRATION_APPROVED_FOR_PRODUCTION")).not.toThrow();
  });
});
