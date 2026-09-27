import { describe, expect, it } from "vitest";
import { GateStateError } from "../src/errors.js";
import { recordGateApproval, requireApprovedContent, requireGateState } from "../src/gates.js";

describe("gate state model", () => {
  it("records a full approval object with all required fields", () => {
    const record = recordGateApproval({
      gateId: "A1",
      stateBefore: "SCOPE_PROPOSED",
      actor: "user:mk350174",
      objectVersionBeingApproved: "scope_abc",
      stateAfter: "SCOPE_APPROVED",
      downstreamOperationUnlocked: "P1.03 Domain Research",
    });
    expect(record.gate_id).toBe("A1");
    expect(record.state_before).toBe("SCOPE_PROPOSED");
    expect(record.state_after).toBe("SCOPE_APPROVED");
    expect(record.actor).toBe("user:mk350174");
    expect(record.approval_record_id).toMatch(/^appr_/);
    expect(record.timestamp).toBeTruthy();
  });

  it("refuses to record an approval with no actor", () => {
    expect(() =>
      recordGateApproval({
        gateId: "A1",
        stateBefore: "SCOPE_PROPOSED",
        actor: "",
        objectVersionBeingApproved: "scope_abc",
        stateAfter: "SCOPE_APPROVED",
        downstreamOperationUnlocked: "P1.03 Domain Research",
      }),
    ).toThrow();
  });

  it("requireGateState passes when the required transition was recorded", () => {
    // TIER-1 REPAIR T1.3: PACKAGE_DRAFTED -> PACKAGE_APPROVED now REQUIRES
    // the scope approval to already be in history, so a legal history is
    // built here rather than a lone package approval out of nowhere.
    const scopeGate = recordGateApproval({
      gateId: "A1",
      stateBefore: "SCOPE_PROPOSED",
      actor: "user:mk350174",
      objectVersionBeingApproved: "scope_abc",
      stateAfter: "SCOPE_APPROVED",
      downstreamOperationUnlocked: "P1.03 Domain Research",
    });
    const record = recordGateApproval({
      gateId: "A1",
      stateBefore: "PACKAGE_DRAFTED",
      actor: "user:mk350174",
      objectVersionBeingApproved: "rpkg_abc",
      stateAfter: "PACKAGE_APPROVED",
      downstreamOperationUnlocked: "P2 may consume this package",
      history: [scopeGate],
    });
    expect(() => requireGateState([scopeGate, record], "A1", "PACKAGE_APPROVED")).not.toThrow();
  });

  it("requireGateState fails loud when the gate was never passed", () => {
    expect(() => requireGateState([], "A1", "PACKAGE_APPROVED")).toThrow(GateStateError);
  });

  // --- TIER-1 REPAIR T1.3: canonical gate state machine ---
  // Before the repair recordGateApproval validated only "actor is non-empty";
  // every assertion below therefore PASSED (i.e. built a bogus record)
  // against the unrepaired baseline.

  it("T1.3: rejects a transition that is not in the canonical table", () => {
    expect(() =>
      recordGateApproval({
        gateId: "A1",
        stateBefore: "BANANA",
        actor: "user:mk350174",
        objectVersionBeingApproved: "scope_abc",
        stateAfter: "SHIPPED",
        downstreamOperationUnlocked: "nonsense",
      }),
    ).toThrow(GateStateError);
  });

  it("T1.3: rejects a real state pair recorded under the wrong gate", () => {
    expect(() =>
      recordGateApproval({
        gateId: "A7", // SCOPE_PROPOSED -> SCOPE_APPROVED belongs to A1
        stateBefore: "SCOPE_PROPOSED",
        actor: "user:mk350174",
        objectVersionBeingApproved: "scope_abc",
        stateAfter: "SCOPE_APPROVED",
        downstreamOperationUnlocked: "wrong gate",
      }),
    ).toThrow(GateStateError);
  });

  it("T1.3: rejects an out-of-order approval (missing prerequisite gate)", () => {
    expect(() =>
      recordGateApproval({
        gateId: "A1",
        stateBefore: "PACKAGE_DRAFTED",
        actor: "user:mk350174",
        objectVersionBeingApproved: "rpkg_abc",
        stateAfter: "PACKAGE_APPROVED",
        downstreamOperationUnlocked: "P2 may consume this package",
        history: [], // no SCOPE_APPROVED recorded
      }),
    ).toThrow(GateStateError);
  });

  it("T1.3: rejects a duplicate approval for the same object", () => {
    const first = recordGateApproval({
      gateId: "A1",
      stateBefore: "SCOPE_PROPOSED",
      actor: "user:mk350174",
      objectVersionBeingApproved: "scope_abc",
      stateAfter: "SCOPE_APPROVED",
      downstreamOperationUnlocked: "P1.03 Domain Research",
    });
    expect(() =>
      recordGateApproval({
        gateId: "A1",
        stateBefore: "SCOPE_PROPOSED",
        actor: "user:someone-else",
        objectVersionBeingApproved: "scope_abc",
        stateAfter: "SCOPE_APPROVED",
        downstreamOperationUnlocked: "P1.03 Domain Research",
        history: [first],
      }),
    ).toThrow(GateStateError);
  });

  it("T1.3: rejects a transition applied to the wrong object_type", () => {
    expect(() =>
      recordGateApproval({
        gateId: "A1",
        stateBefore: "SCOPE_PROPOSED",
        actor: "user:mk350174",
        objectVersionBeingApproved: "scope_abc",
        stateAfter: "SCOPE_APPROVED",
        downstreamOperationUnlocked: "P1.03 Domain Research",
        objectType: "production_package",
      }),
    ).toThrow(GateStateError);
  });

  // --- TIER-1 REPAIR T1.4: approval binds to an immutable artifact ---

  it("T1.4: approval carries the approved object's content hash", () => {
    const record = recordGateApproval({
      gateId: "A1",
      stateBefore: "SCOPE_PROPOSED",
      actor: "user:mk350174",
      objectVersionBeingApproved: "scope_abc",
      stateAfter: "SCOPE_APPROVED",
      downstreamOperationUnlocked: "P1.03 Domain Research",
      objectId: "scope_abc",
      objectType: "research_scope",
      objectContent: { topic: "aqueducts", constraints: [] },
    });
    expect(record.object_id).toBe("scope_abc");
    expect(record.object_type).toBe("research_scope");
    expect(record.object_content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("T1.4: requireApprovedContent accepts the exact approved content", () => {
    const content = { topic: "aqueducts", constraints: [] };
    const record = recordGateApproval({
      gateId: "A1",
      stateBefore: "SCOPE_PROPOSED",
      actor: "user:mk350174",
      objectVersionBeingApproved: "scope_abc",
      stateAfter: "SCOPE_APPROVED",
      downstreamOperationUnlocked: "P1.03 Domain Research",
      objectId: "scope_abc",
      objectType: "research_scope",
      objectContent: content,
    });
    expect(() =>
      requireApprovedContent({
        gates: [record],
        gateId: "A1",
        requiredStateAfter: "SCOPE_APPROVED",
        objectId: "scope_abc",
        objectContent: content,
      }),
    ).not.toThrow();
  });

  it("T1.4: an approved object mutated afterwards no longer verifies", () => {
    const record = recordGateApproval({
      gateId: "A1",
      stateBefore: "SCOPE_PROPOSED",
      actor: "user:mk350174",
      objectVersionBeingApproved: "scope_abc",
      stateAfter: "SCOPE_APPROVED",
      downstreamOperationUnlocked: "P1.03 Domain Research",
      objectId: "scope_abc",
      objectType: "research_scope",
      objectContent: { topic: "aqueducts", constraints: [] },
    });
    expect(() =>
      requireApprovedContent({
        gates: [record],
        gateId: "A1",
        requiredStateAfter: "SCOPE_APPROVED",
        objectId: "scope_abc",
        // one field changed after approval
        objectContent: { topic: "aqueducts", constraints: ["latin-only"] },
      }),
    ).toThrow(GateStateError);
  });

  it("T1.4: key order does not affect content identity", () => {
    const record = recordGateApproval({
      gateId: "A1",
      stateBefore: "SCOPE_PROPOSED",
      actor: "user:mk350174",
      objectVersionBeingApproved: "scope_abc",
      stateAfter: "SCOPE_APPROVED",
      downstreamOperationUnlocked: "P1.03 Domain Research",
      objectId: "scope_abc",
      objectType: "research_scope",
      objectContent: { topic: "aqueducts", constraints: [] },
    });
    expect(() =>
      requireApprovedContent({
        gates: [record],
        gateId: "A1",
        requiredStateAfter: "SCOPE_APPROVED",
        objectId: "scope_abc",
        objectContent: { constraints: [], topic: "aqueducts" },
      }),
    ).not.toThrow();
  });

  it("T1.4: an approval with no content hash is refused as unbindable", () => {
    const legacy = {
      gate_id: "A1",
      state_before: "SCOPE_PROPOSED",
      approval_record_id: "appr_legacy",
      actor: "user:mk350174",
      timestamp: new Date().toISOString(),
      object_version_being_approved: "scope_abc",
      state_after: "SCOPE_APPROVED",
      downstream_operation_unlocked: "P1.03 Domain Research",
    };
    expect(() =>
      requireApprovedContent({
        gates: [legacy],
        gateId: "A1",
        requiredStateAfter: "SCOPE_APPROVED",
        objectId: "scope_abc",
        objectContent: { topic: "aqueducts" },
      }),
    ).toThrow(GateStateError);
  });
});
