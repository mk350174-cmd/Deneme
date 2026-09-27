import { describe, expect, it } from "vitest";
import { HandoffValidationError } from "../src/errors.js";
import { claimLookup, parseResearchPackage } from "../src/ingest.js";
import { RESEARCH_PACKAGE_FIXTURE } from "./fixtures/research_package.fixture.js";

describe("P1 -> P2 handoff ingestion (contract test)", () => {
  it("accepts the well-formed golden fixture", () => {
    const pkg = parseResearchPackage(RESEARCH_PACKAGE_FIXTURE);
    expect(pkg.package_id).toBe(RESEARCH_PACKAGE_FIXTURE.package_id);
    expect(pkg.claims).toHaveLength(2);
  });

  it("rejects a non-object", () => {
    expect(() => parseResearchPackage("not an object")).toThrow(HandoffValidationError);
    expect(() => parseResearchPackage(null)).toThrow(HandoffValidationError);
  });

  it("rejects a package missing a required field, naming the exact field", () => {
    const malformed = { ...RESEARCH_PACKAGE_FIXTURE } as Record<string, unknown>;
    delete malformed.knowledge_package;
    try {
      parseResearchPackage(malformed);
      throw new Error("expected parseResearchPackage to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HandoffValidationError);
      expect((err as HandoffValidationError).field).toBe("knowledge_package");
    }
  });

  it("rejects a package whose research_scope was never approved", () => {
    const malformed = {
      ...RESEARCH_PACKAGE_FIXTURE,
      research_scope: { ...RESEARCH_PACKAGE_FIXTURE.research_scope, state: "SCOPE_PROPOSED" },
    };
    expect(() => parseResearchPackage(malformed)).toThrow(HandoffValidationError);
  });

  it("claimLookup exposes only claim_id -> {statement, dimension}, never re-derives new claims", () => {
    const pkg = parseResearchPackage(RESEARCH_PACKAGE_FIXTURE);
    const lookup = claimLookup(pkg);
    expect(lookup.size).toBe(2);
    expect(lookup.get("claim_facts_aquaappia")?.dimension).toBe("facts");
  });
});

describe("AUDIT FIX §13.3 — Gate A1 package-approval verification", () => {
  it("accepts the well-formed fixture (has a valid Gate A1 PACKAGE_APPROVED record)", () => {
    expect(() => parseResearchPackage(RESEARCH_PACKAGE_FIXTURE)).not.toThrow();
  });

  it("rejects a package with an empty gates array — scope approval alone is not enough", () => {
    const malformed = { ...RESEARCH_PACKAGE_FIXTURE, gates: [] };
    try {
      parseResearchPackage(malformed);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HandoffValidationError);
      expect((err as HandoffValidationError).field).toBe("gates");
    }
  });

  it("rejects a package whose gates array has no A1/PACKAGE_APPROVED entry", () => {
    const malformed = { ...RESEARCH_PACKAGE_FIXTURE, gates: [{ gate_id: "A1", state_after: "SCOPE_APPROVED" }] };
    expect(() => parseResearchPackage(malformed)).toThrow(HandoffValidationError);
  });

  it("rejects a package missing the gates field entirely", () => {
    const malformed = { ...RESEARCH_PACKAGE_FIXTURE } as Record<string, unknown>;
    delete malformed.gates;
    expect(() => parseResearchPackage(malformed)).toThrow(HandoffValidationError);
  });
});
