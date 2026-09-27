import { describe, expect, it } from "vitest";
import { GateStateError } from "../src/errors.js";
import { recordGateApproval, requireGateState } from "../src/gates.js";

describe("gate state model (same shape as P1)", () => {
  it("records a full approval object", () => {
    const record = recordGateApproval({
      gateId: "A2",
      stateBefore: "REFERENCES_PROPOSED",
      actor: "user:mk350174",
      objectVersionBeingApproved: "ref_abc",
      stateAfter: "REFERENCES_APPROVED",
      downstreamOperationUnlocked: "P2.02 Content Understanding",
    });
    expect(record.gate_id).toBe("A2");
    expect(record.state_after).toBe("REFERENCES_APPROVED");
    expect(record.approval_record_id).toMatch(/^appr_/);
  });

  it("refuses to record an approval with no actor", () => {
    expect(() =>
      recordGateApproval({
        gateId: "A2",
        stateBefore: "REFERENCES_PROPOSED",
        actor: "",
        objectVersionBeingApproved: "ref_abc",
        stateAfter: "REFERENCES_APPROVED",
        downstreamOperationUnlocked: "x",
      }),
    ).toThrow();
  });

  it("distinguishes Gate A2's two sub-transitions by state_after, not just gate_id", () => {
    const refsGate = recordGateApproval({
      gateId: "A2",
      stateBefore: "REFERENCES_PROPOSED",
      actor: "user:test",
      objectVersionBeingApproved: "v1",
      stateAfter: "REFERENCES_APPROVED",
      downstreamOperationUnlocked: "x",
    });
    // Only the references transition has happened so far — the art
    // direction transition must not be considered satisfied.
    expect(() => requireGateState([refsGate], "A2", "ART_DIRECTION_APPROVED")).toThrow(GateStateError);
    expect(() => requireGateState([refsGate], "A2", "REFERENCES_APPROVED")).not.toThrow();
  });

  it("AUDIT FIX §A: rejects when gate was approved then later rejected", () => {
    const approved = recordGateApproval({
      gateId: "A2",
      stateBefore: "REFERENCES_PROPOSED",
      actor: "user:mk350174",
      objectVersionBeingApproved: "ref_v1",
      stateAfter: "REFERENCES_APPROVED",
      downstreamOperationUnlocked: "P2.02 can proceed",
    });
    const rejected = recordGateApproval({
      gateId: "A2",
      stateBefore: "REFERENCES_APPROVED",
      actor: "user:reviewer1",
      objectVersionBeingApproved: "ref_v2",
      stateAfter: "REFERENCES_REJECTED",
      downstreamOperationUnlocked: "P2.02 must revise",
    });
    expect(() => requireGateState([approved, rejected], "A2", "REFERENCES_APPROVED")).toThrow(GateStateError);
  });

  it("AUDIT FIX §A: accepts when latest gate state is the required state after re-approval", () => {
    const approved1 = recordGateApproval({
      gateId: "A2",
      stateBefore: "REFERENCES_PROPOSED",
      actor: "user:mk350174",
      objectVersionBeingApproved: "ref_v1",
      stateAfter: "REFERENCES_APPROVED",
      downstreamOperationUnlocked: "P2.02 can proceed",
    });
    const rejected = recordGateApproval({
      gateId: "A2",
      stateBefore: "REFERENCES_APPROVED",
      actor: "user:reviewer1",
      objectVersionBeingApproved: "ref_v2",
      stateAfter: "REFERENCES_REJECTED",
      downstreamOperationUnlocked: "P2.02 must revise",
    });
    const approved2 = recordGateApproval({
      gateId: "A2",
      stateBefore: "REFERENCES_REJECTED",
      actor: "user:mk350174",
      objectVersionBeingApproved: "ref_v3",
      stateAfter: "REFERENCES_APPROVED",
      downstreamOperationUnlocked: "P2.02 can proceed",
    });
    expect(() => requireGateState([approved1, rejected, approved2], "A2", "REFERENCES_APPROVED")).not.toThrow();
  });

  it("AUDIT FIX §A: multiple gates remain independent", () => {
    const gateA1Approved = recordGateApproval({
      gateId: "A1",
      stateBefore: "SCOPE_PROPOSED",
      actor: "user:mk350174",
      objectVersionBeingApproved: "scope_abc",
      stateAfter: "SCOPE_APPROVED",
      downstreamOperationUnlocked: "P1.03 Domain Research",
    });
    const gateA2Rejected = recordGateApproval({
      gateId: "A2",
      stateBefore: "REFERENCES_PROPOSED",
      actor: "user:reviewer1",
      objectVersionBeingApproved: "ref_v1",
      stateAfter: "REFERENCES_REJECTED",
      downstreamOperationUnlocked: "P2.02 must revise",
    });
    const gates = [gateA1Approved, gateA2Rejected];
    expect(() => requireGateState(gates, "A1", "SCOPE_APPROVED")).not.toThrow();
    expect(() => requireGateState(gates, "A2", "REFERENCES_REJECTED")).not.toThrow();
    expect(() => requireGateState(gates, "A2", "REFERENCES_APPROVED")).toThrow(GateStateError);
  });
});
