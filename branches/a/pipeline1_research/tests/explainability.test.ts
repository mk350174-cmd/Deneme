// C1 (small improvements, P1.04 explainability layer) — pure unit tests for
// buildVerificationExplanation. Purely structuring, no fabrication: given
// the same Claim/Verification fields, output is deterministic and never
// invents content beyond what's already present.

import { describe, expect, it } from "vitest";
import { buildVerificationExplanation } from "../src/explainability.js";
import type { Claim, Verification } from "../src/types.js";

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    claim_id: "claim_1",
    statement: "The Aqua Appia was completed in 312 BC.",
    evidence_refs: [],
    derived_from: "construction_history",
    contradiction_refs: [],
    dimension: "facts",
    ...overrides,
  };
}

function verification(overrides: Partial<Verification> = {}): Verification {
  return {
    verification_id: "verif_1",
    claim_id: "claim_1",
    status: "UNKNOWN",
    rationale: "No independent cross-check supplied.",
    verified_at: new Date().toISOString(),
    contradiction_relationship: "NONE",
    ...overrides,
  };
}

describe("buildVerificationExplanation — VERIFIED needs no explanation", () => {
  it("returns undefined for a VERIFIED verification, even with evidence present", () => {
    const c = claim({ evidence_refs: ["evid_1"] });
    const v = verification({ status: "VERIFIED", rationale: "Corroborated by two independent sources." });
    expect(buildVerificationExplanation(v, c)).toBeUndefined();
  });
});

describe("buildVerificationExplanation — UNKNOWN status", () => {
  it("explains an UNKNOWN claim using only fields already present on the claim/verification", () => {
    const c = claim({ evidence_refs: [], statement: "The original architect is not reliably attested." });
    const v = verification({ status: "UNKNOWN", unresolved_reason: "No surviving primary source names the architect." });

    const explanation = buildVerificationExplanation(v, c);
    expect(explanation).toBeDefined();
    expect(explanation!.verification_id).toBe(v.verification_id);
    expect(explanation!.unknown).toContain(c.statement);
    expect(explanation!.uncertainty_reason).toBe(v.unresolved_reason);
    expect(explanation!.missing_evidence).toContain(c.statement);
    expect(explanation!.follow_up_research_questions.length).toBeGreaterThan(0);
  });

  it("never fabricates content when the claim has no contradiction_refs", () => {
    const c = claim({ contradiction_refs: [] });
    const v = verification({ status: "UNKNOWN", unresolved_reason: "r" });
    expect(buildVerificationExplanation(v, c)!.source_conflicts).toEqual([]);
  });
});

describe("buildVerificationExplanation — INFERRED status", () => {
  it("records the attached evidence as 'known' and the verification rationale, never inventing new evidence", () => {
    const c = claim({ evidence_refs: ["evid_1", "evid_2"] });
    const v = verification({ status: "INFERRED", rationale: "Evidence present but no independent cross-check supplied." });

    const explanation = buildVerificationExplanation(v, c);
    expect(explanation).toBeDefined();
    expect(explanation!.known.some((k) => k.includes("evid_1") && k.includes("evid_2"))).toBe(true);
    expect(explanation!.known.some((k) => k.includes(v.rationale))).toBe(true);
    expect(explanation!.missing_evidence).toEqual([]); // evidence IS present for INFERRED here
    expect(explanation!.unknown).toEqual([]); // nothing marked "unknown" when evidence exists
  });
});

describe("buildVerificationExplanation — source conflicts", () => {
  it("surfaces contradiction_refs as source_conflicts, using the real contradiction_relationship, never invented text", () => {
    const c = claim({ contradiction_refs: ["claim_2", "claim_3"] });
    const v = verification({ status: "INFERRED", contradiction_relationship: "DIRECT" });

    const explanation = buildVerificationExplanation(v, c)!;
    expect(explanation.source_conflicts).toHaveLength(2);
    expect(explanation.source_conflicts.every((s) => s.includes("DIRECT"))).toBe(true);
    expect(explanation.source_conflicts.some((s) => s.includes("claim_2"))).toBe(true);
    expect(explanation.source_conflicts.some((s) => s.includes("claim_3"))).toBe(true);
  });
});
