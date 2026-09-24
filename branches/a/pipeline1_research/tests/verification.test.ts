import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/errors.js";
import { assertClaimHasProvenance } from "../src/verification.js";
import type { Claim, Verification } from "../src/types.js";

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    claim_id: "claim_1",
    statement: "Test statement",
    evidence_refs: [],
    derived_from: "q1",
    contradiction_refs: [],
    dimension: "facts",
    ...overrides,
  };
}

function verification(overrides: Partial<Verification> = {}): Verification {
  return {
    verification_id: "verif_1",
    claim_id: "claim_1",
    status: "VERIFIED",
    rationale: "test",
    verified_at: new Date().toISOString(),
    contradiction_relationship: "NONE",
    ...overrides,
  };
}

describe("Evidence & Provenance Contract enforcement (contract test)", () => {
  it("accepts a claim with non-empty evidence_refs", () => {
    expect(() =>
      assertClaimHasProvenance(claim({ evidence_refs: ["ev_1"] }), verification()),
    ).not.toThrow();
  });

  it("accepts a claim with no evidence IF status is UNKNOWN with a reason", () => {
    expect(() =>
      assertClaimHasProvenance(
        claim({ evidence_refs: [] }),
        verification({ status: "UNKNOWN", unresolved_reason: "No source located." }),
      ),
    ).not.toThrow();
  });

  it("rejects a claim with no evidence_refs and no UNKNOWN status (silent provenance gap)", () => {
    expect(() =>
      assertClaimHasProvenance(claim({ evidence_refs: [] }), verification({ status: "VERIFIED" })),
    ).toThrow(ValidationError);
  });

  it("rejects UNKNOWN status with no unresolved_reason", () => {
    expect(() =>
      assertClaimHasProvenance(
        claim({ evidence_refs: [] }),
        verification({ status: "UNKNOWN", unresolved_reason: undefined }),
      ),
    ).toThrow(ValidationError);
  });

  it("rejects UNKNOWN status with a blank unresolved_reason", () => {
    expect(() =>
      assertClaimHasProvenance(
        claim({ evidence_refs: [] }),
        verification({ status: "UNKNOWN", unresolved_reason: "   " }),
      ),
    ).toThrow(ValidationError);
  });
});
