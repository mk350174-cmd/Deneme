import { describe, it, expect } from "vitest";
import {
  proposeItem,
  approveItem,
  rejectItem,
  revokeItem,
  supersedeItem,
  canonicalizeItem,
  validateTransition,
  getCurrentState,
  canCanonicalize,
  GovernanceTransitionError,
  type GovernanceEvent,
} from "../src/b00/governance.js";
import { reconstructProvenanceChain } from "../src/b00/provenanceRef.js";
import { computeFieldDiff } from "../src/b00/auditTrail.js";
import { canonicalHasher } from "../src/b00/hashing.js";

describe("B00 Governance State Machine", () => {
  const AUTH = "user@test.com";
  const T1 = "2026-01-01T00:00:00Z";
  const T2 = "2026-01-02T00:00:00Z";
  const T3 = "2026-01-03T00:00:00Z";
  const T4 = "2026-01-04T00:00:00Z";

  describe("Legal transitions", () => {
    it("PROPOSED -> APPROVED", () => {
      expect(validateTransition("PROPOSED", "APPROVED")).toBe(true);
    });
    it("PROPOSED -> REJECTED", () => {
      expect(validateTransition("PROPOSED", "REJECTED")).toBe(true);
    });
    it("APPROVED -> REVOKED", () => {
      expect(validateTransition("APPROVED", "REVOKED")).toBe(true);
    });
    it("APPROVED -> SUPERSEDED", () => {
      expect(validateTransition("APPROVED", "SUPERSEDED")).toBe(true);
    });
    it("APPROVED -> CANONICAL", () => {
      expect(validateTransition("APPROVED", "CANONICAL")).toBe(true);
    });
    it("REJECTED -> APPROVED (re-approval)", () => {
      expect(validateTransition("REJECTED", "APPROVED")).toBe(true);
    });
    it("REVOKED -> APPROVED (re-approval)", () => {
      expect(validateTransition("REVOKED", "APPROVED")).toBe(true);
    });
    it("undefined -> PROPOSED (initial proposal)", () => {
      expect(validateTransition(undefined, "PROPOSED")).toBe(true);
    });
  });

  describe("Illegal transitions rejected", () => {
    it("CANONICAL -> PROPOSED is illegal", () => {
      expect(validateTransition("CANONICAL", "PROPOSED")).toBe(false);
    });
    it("CANONICAL -> APPROVED is illegal", () => {
      expect(validateTransition("CANONICAL", "APPROVED")).toBe(false);
    });
    it("REJECTED -> CANONICAL is illegal", () => {
      expect(validateTransition("REJECTED", "CANONICAL")).toBe(false);
    });
    it("REVOKED -> CANONICAL is illegal", () => {
      expect(validateTransition("REVOKED", "CANONICAL")).toBe(false);
    });
    it("undefined -> APPROVED is illegal (must propose first)", () => {
      expect(validateTransition(undefined, "APPROVED")).toBe(false);
    });
    it("SUPERSEDED has no legal outgoing transitions", () => {
      expect(validateTransition("SUPERSEDED", "APPROVED")).toBe(false);
      expect(validateTransition("SUPERSEDED", "CANONICAL")).toBe(false);
    });
  });

  describe("End-to-end lifecycle via primitives", () => {
    it("propose -> approve produces correctly linked history", () => {
      let history: GovernanceEvent[] = [];

      const p = proposeItem({ itemId: "item1", history, authority: AUTH, timestamp: T1 });
      history = p.history;
      expect(p.event.state).toBe("PROPOSED");
      expect(p.event.provenance.prior_provenance_id).toBeUndefined();

      const a1 = approveItem({ itemId: "item1", history, authority: AUTH, timestamp: T2 });
      history = a1.history;
      expect(a1.event.state).toBe("APPROVED");
      expect(a1.event.provenance.prior_provenance_id).toBe(p.event.id);
      expect(history.length).toBe(2);
    });

    it("PROPOSED -> REJECTED -> APPROVED: re-approval links to the REJECTED event, not the original PROPOSED", () => {
      let history: GovernanceEvent[] = [];
      const p = proposeItem({ itemId: "item2", history, authority: AUTH, timestamp: T1 });
      history = p.history;

      const rej = rejectItem({ itemId: "item2", history, authority: AUTH, timestamp: T2 });
      history = rej.history;
      expect(rej.event.state).toBe("REJECTED");
      expect(rej.event.provenance.prior_provenance_id).toBe(p.event.id);

      const app = approveItem({ itemId: "item2", history, authority: AUTH, timestamp: T3 });
      history = app.history;
      expect(app.event.state).toBe("APPROVED");
      expect(app.event.provenance.prior_provenance_id).toBe(rej.event.id);
      expect(app.event.provenance.prior_provenance_id).not.toBe(p.event.id);

      expect(getCurrentState(history)).toBe("APPROVED");
      expect(history.length).toBe(3); // full history retained, nothing overwritten
    });

    it("PROPOSED -> APPROVED -> REVOKED -> APPROVED: re-approval links to the REVOKED event", () => {
      let history: GovernanceEvent[] = [];
      const p = proposeItem({ itemId: "item3", history, authority: AUTH, timestamp: T1 });
      history = p.history;
      const app1 = approveItem({ itemId: "item3", history, authority: AUTH, timestamp: T2 });
      history = app1.history;
      const rev = revokeItem({ itemId: "item3", history, authority: AUTH, timestamp: T3 });
      history = rev.history;
      expect(rev.event.state).toBe("REVOKED");
      expect(rev.event.provenance.prior_provenance_id).toBe(app1.event.id);

      const app2 = approveItem({ itemId: "item3", history, authority: AUTH, timestamp: T4 });
      history = app2.history;
      expect(app2.event.provenance.prior_provenance_id).toBe(rev.event.id);
      expect(app2.event.provenance.prior_provenance_id).not.toBe(app1.event.id);
      expect(getCurrentState(history)).toBe("APPROVED");
      expect(history.length).toBe(4);
    });

    it("APPROVED -> CANONICAL is allowed and canCanonicalize reflects readiness", () => {
      let history: GovernanceEvent[] = [];
      history = proposeItem({ itemId: "item4", history, authority: AUTH, timestamp: T1 }).history;
      expect(canCanonicalize(history)).toBe(false);
      history = approveItem({ itemId: "item4", history, authority: AUTH, timestamp: T2 }).history;
      expect(canCanonicalize(history)).toBe(true);
      const canon = canonicalizeItem({ itemId: "item4", history, authority: AUTH, timestamp: T3 });
      expect(canon.event.state).toBe("CANONICAL");
      expect(canon.event.provenance.type).toBe("CANONICAL");
    });

    it("rejecting an APPROVED item throws (reject is only legal from PROPOSED)", () => {
      let history: GovernanceEvent[] = [];
      history = proposeItem({ itemId: "item5", history, authority: AUTH, timestamp: T1 }).history;
      history = approveItem({ itemId: "item5", history, authority: AUTH, timestamp: T2 }).history;
      expect(() =>
        rejectItem({ itemId: "item5", history, authority: AUTH, timestamp: T3 })
      ).toThrow(GovernanceTransitionError);
    });

    it("canonicalizing a REJECTED item throws", () => {
      let history: GovernanceEvent[] = [];
      history = proposeItem({ itemId: "item6", history, authority: AUTH, timestamp: T1 }).history;
      history = rejectItem({ itemId: "item6", history, authority: AUTH, timestamp: T2 }).history;
      expect(() =>
        canonicalizeItem({ itemId: "item6", history, authority: AUTH, timestamp: T3 })
      ).toThrow(GovernanceTransitionError);
    });

    it("canonicalizing a REVOKED item throws", () => {
      let history: GovernanceEvent[] = [];
      history = proposeItem({ itemId: "item7", history, authority: AUTH, timestamp: T1 }).history;
      history = approveItem({ itemId: "item7", history, authority: AUTH, timestamp: T2 }).history;
      history = revokeItem({ itemId: "item7", history, authority: AUTH, timestamp: T3 }).history;
      expect(() =>
        canonicalizeItem({ itemId: "item7", history, authority: AUTH, timestamp: T4 })
      ).toThrow(GovernanceTransitionError);
    });

    it("re-proposing an item that already has history throws", () => {
      let history: GovernanceEvent[] = [];
      history = proposeItem({ itemId: "item8", history, authority: AUTH, timestamp: T1 }).history;
      expect(() =>
        proposeItem({ itemId: "item8", history, authority: AUTH, timestamp: T2 })
      ).toThrow(GovernanceTransitionError);
    });

    it("history is append-only: prior events are never mutated by later calls", () => {
      let history: GovernanceEvent[] = [];
      const p = proposeItem({ itemId: "item9", history, authority: AUTH, timestamp: T1 });
      history = p.history;
      const originalProposedEvent = { ...p.event };
      const app = approveItem({ itemId: "item9", history, authority: AUTH, timestamp: T2 });
      history = app.history;
      expect(history[0]).toEqual(originalProposedEvent);
      expect(history.length).toBe(2);
    });
  });
});

describe("B00 Provenance Chain Reconstruction", () => {
  it("reconstructs OBSERVED -> APPROVED -> REJECTED -> APPROVED from real linked refs, oldest first", () => {
    const observed = { id: "r1", type: "OBSERVED" as const, decision_authority: "sys", timestamp: "t0" };
    const approved1 = { id: "r2", type: "DECIDED" as const, decision_authority: "u", timestamp: "t1", prior_provenance_id: "r1" };
    const rejected = { id: "r3", type: "DECIDED" as const, decision_authority: "u", timestamp: "t2", prior_provenance_id: "r2" };
    const approved2 = { id: "r4", type: "DECIDED" as const, decision_authority: "u", timestamp: "t3", prior_provenance_id: "r3" };

    const allRefs = [approved2, observed, rejected, approved1]; // deliberately out of order
    const chain = reconstructProvenanceChain("r4", allRefs);

    expect(chain.truncated).toBe(false);
    expect(chain.events.map((e) => e.id)).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("reports truncated when a prior_provenance_id does not resolve, without fabricating a substitute", () => {
    const orphan = { id: "r2", type: "DECIDED" as const, decision_authority: "u", timestamp: "t1", prior_provenance_id: "missing" };
    const chain = reconstructProvenanceChain("r2", [orphan]);
    expect(chain.truncated).toBe(true);
    expect(chain.events.map((e) => e.id)).toEqual(["r2"]);
  });

  it("returns empty when the requested id is not present", () => {
    const chain = reconstructProvenanceChain("nope", []);
    expect(chain.events).toEqual([]);
    expect(chain.truncated).toBe(true);
  });

  it("is deterministic across repeated calls with identical input", () => {
    const a = { id: "x1", type: "OBSERVED" as const, decision_authority: "sys", timestamp: "t0" };
    const b = { id: "x2", type: "DECIDED" as const, decision_authority: "u", timestamp: "t1", prior_provenance_id: "x1" };
    const refs = [b, a];
    const c1 = reconstructProvenanceChain("x2", refs);
    const c2 = reconstructProvenanceChain("x2", refs);
    expect(c1).toEqual(c2);
  });
});

describe("B00 Real Audit Field Diff", () => {
  const opts = { version: "v1.0", decision_authority: "user@test.com", timestamp: "t1", rationale: "test" };

  it("detects an added field", () => {
    const entries = computeFieldDiff({}, { name: "Brand" }, opts);
    expect(entries).toHaveLength(1);
    expect(entries[0].changed_field).toBe("name");
    expect(entries[0].old_value).toBeUndefined();
    expect(entries[0].new_value).toBe("Brand");
  });

  it("detects a changed field", () => {
    const entries = computeFieldDiff({ name: "Old" }, { name: "New" }, opts);
    expect(entries).toHaveLength(1);
    expect(entries[0].old_value).toBe("Old");
    expect(entries[0].new_value).toBe("New");
  });

  it("detects a removed field", () => {
    const entries = computeFieldDiff({ name: "Brand" }, {}, opts);
    expect(entries).toHaveLength(1);
    expect(entries[0].old_value).toBe("Brand");
    expect(entries[0].new_value).toBeUndefined();
  });

  it("produces no entries for a no-op diff", () => {
    const entries = computeFieldDiff({ name: "Brand", count: 3 }, { name: "Brand", count: 3 }, opts);
    expect(entries).toHaveLength(0);
  });

  it("recurses into nested plain objects and produces dot-path field names", () => {
    const before = { brand_profile: { positioning: "Old positioning", mission: "M" } };
    const after = { brand_profile: { positioning: "New positioning", mission: "M" } };
    const entries = computeFieldDiff(before, after, opts);
    expect(entries).toHaveLength(1);
    expect(entries[0].changed_field).toBe("brand_profile.positioning");
    expect(entries[0].old_value).toBe("Old positioning");
    expect(entries[0].new_value).toBe("New positioning");
  });

  it("treats arrays as atomic values (not element-by-element diffed)", () => {
    const entries = computeFieldDiff({ tags: ["a", "b"] }, { tags: ["a", "b", "c"] }, opts);
    expect(entries).toHaveLength(1);
    expect(entries[0].changed_field).toBe("tags");
  });

  it("produces typed AuditEntry objects with all required fields, not a hardcoded generic blob", () => {
    const entries = computeFieldDiff({ x: 1 }, { x: 2 }, opts);
    expect(entries[0]).toMatchObject({
      version: "v1.0",
      decision_authority: "user@test.com",
      timestamp: "t1",
      rationale: "test",
      change_type: "canonical_state_update",
    });
    expect(entries[0].audit_id).toBeTruthy();
    expect(Array.isArray(entries[0].evidence_refs)).toBe(true);
  });
});

describe("B00 Hashing Determinism", () => {
  it("same input produces same hash across repeated calls", () => {
    expect(canonicalHasher.hash("abc")).toBe(canonicalHasher.hash("abc"));
  });

  it("stableCandidateId is deterministic for identical module+signature", () => {
    const id1 = canonicalHasher.stableCandidateId("b01", "v1.0:3");
    const id2 = canonicalHasher.stableCandidateId("b01", "v1.0:3");
    expect(id1).toBe(id2);
  });

  it("stableConflictId is deterministic", () => {
    const id1 = canonicalHasher.stableConflictId("b01", "ch1,ch2");
    const id2 = canonicalHasher.stableConflictId("b01", "ch1,ch2");
    expect(id1).toBe(id2);
  });

  it("stableStateId is deterministic", () => {
    expect(canonicalHasher.stableStateId("b01:v1.0")).toBe(canonicalHasher.stableStateId("b01:v1.0"));
  });

  it("different input produces a different hash (basic non-collision sanity check)", () => {
    expect(canonicalHasher.hash("abc")).not.toBe(canonicalHasher.hash("abd"));
  });

  it("is re-exported from the b00 barrel (b00/index.ts)", async () => {
    const barrel = await import("../src/b00/index.js");
    expect(barrel.canonicalHasher).toBeDefined();
    expect(barrel.canonicalHasher.hash("abc")).toBe(canonicalHasher.hash("abc"));
  });
});
