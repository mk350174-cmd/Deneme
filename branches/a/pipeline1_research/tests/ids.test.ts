import { describe, expect, it } from "vitest";
import { stableClaimId, stableProjectId, stableScopeId } from "../src/ids.js";

describe("deterministic ids", () => {
  it("produces the same project_id for the same seed", () => {
    expect(stableProjectId("Roman aqueducts")).toBe(stableProjectId("Roman aqueducts"));
  });

  it("is case/whitespace insensitive", () => {
    expect(stableProjectId("Roman Aqueducts")).toBe(stableProjectId("  roman aqueducts  "));
  });

  it("produces different ids for different seeds", () => {
    expect(stableProjectId("Roman aqueducts")).not.toBe(stableProjectId("Byzantine mosaics"));
  });

  it("scope id depends on both project and topic", () => {
    const a = stableScopeId("proj_1", "topic a");
    const b = stableScopeId("proj_1", "topic b");
    const c = stableScopeId("proj_2", "topic a");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("claim id is stable and reproducible for identical inputs", () => {
    const id1 = stableClaimId("proj_1", "facts", "The aqueduct was built in 19 BC.");
    const id2 = stableClaimId("proj_1", "facts", "The aqueduct was built in 19 BC.");
    expect(id1).toBe(id2);
  });
});
