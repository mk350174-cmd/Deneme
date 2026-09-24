// Contract test for the P1.02/P1.03 boundary: "P1.03 MUST operate within
// the approved scope object ... An out-of-scope direction must be flagged
// and returned upstream, never pursued silently."

import { describe, expect, it } from "vitest";
import { ScopeViolationError } from "../src/errors.js";
import { ManualResearchEngine } from "../src/researchEngine.js";
import { approveScope, runP101Input, runP102ProposeScope, runP103DomainResearch } from "../src/pipeline.js";
import { ValidationError } from "../src/errors.js";

describe("P1.02 / P1.03 scope boundary (contract test)", () => {
  it("refuses to run Domain Research against a scope that was never approved", async () => {
    const request = runP101Input({ topic: "Roman aqueducts" });
    const proposedScope = runP102ProposeScope(request);
    const engine = new ManualResearchEngine({ topic: "Roman aqueducts" });

    await expect(
      runP103DomainResearch(engine, proposedScope, [{ query: "construction", dimension: "facts" }]),
    ).rejects.toThrow(ValidationError);
  });

  it("flags (does not silently execute) a query against a differently-scoped engine", async () => {
    const request = runP101Input({ topic: "Roman aqueducts" });
    const { scope: approvedScope } = approveScope(runP102ProposeScope(request), "user:test");

    // Engine bound to a different topic than the approved scope — simulates
    // an attempt to broaden/redirect research beyond what P1.02 approved.
    const engine = new ManualResearchEngine({ topic: "Byzantine mosaics" });

    await expect(
      runP103DomainResearch(engine, approvedScope, [{ query: "construction", dimension: "facts" }]),
    ).rejects.toThrow(ScopeViolationError);
  });

  it("permits investigation once scope matches and is approved", async () => {
    const request = runP101Input({ topic: "Roman aqueducts" });
    const { scope: approvedScope } = approveScope(runP102ProposeScope(request), "user:test");
    const engine = new ManualResearchEngine({
      topic: "Roman aqueducts",
      findings: {
        "roman aqueducts::facts::construction": [
          {
            statement: "The Aqua Appia was completed in 312 BC.",
            dimension: "facts",
            derived_from: "construction",
            source: {
              source_id: "",
              origin: "https://example.org/aqua-appia",
              source_type: "secondary",
              retrieved_at: new Date().toISOString(),
              access_method: "manual_entry",
            },
            excerpt_or_pointer: "Completed 312 BC per Frontinus.",
            extraction_method: "manual_entry",
          },
        ],
      },
    });

    const result = await runP103DomainResearch(engine, approvedScope, [
      { query: "construction", dimension: "facts" },
    ]);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.statement).toContain("Aqua Appia");
  });
});
