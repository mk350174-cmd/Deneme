import { describe, expect, it } from "vitest";
import { recordObservation, selectReferences, suggestCandidates } from "../src/referenceDiscovery.js";

describe("P2.01 Reference Discovery (no-fabrication contract test)", () => {
  it("never invents a candidate: empty seeds produce an empty candidate list", () => {
    expect(suggestCandidates([])).toEqual([]);
  });

  it("only organizes explicitly supplied seeds — output content matches input exactly", () => {
    const candidates = suggestCandidates([
      { label: "Channel A", rationale: "Similar subject matter, high production value." },
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.label).toBe("Channel A");
    expect(candidates[0]?.rationale).toBe("Similar subject matter, high production value.");
  });

  it("selectReferences approves only explicitly listed candidate ids, never all candidates by default", () => {
    const candidates = suggestCandidates([
      { label: "Channel A", rationale: "r1" },
      { label: "Channel B", rationale: "r2" },
    ]);
    const references = selectReferences({
      candidates,
      approvedCandidateIds: [candidates[0]!.candidate_id],
      manuallyAddedSources: [],
    });
    expect(references).toHaveLength(1);
    expect(references[0]?.source).toBe("Channel A");
  });

  it("allows the user to manually add a reference not from any suggested candidate", () => {
    const references = selectReferences({
      candidates: [],
      approvedCandidateIds: [],
      manuallyAddedSources: ["https://example.org/user-supplied-reference"],
    });
    expect(references).toHaveLength(1);
    expect(references[0]?.approved).toBe(true);
  });

  it("recordObservation only structures caller-supplied content, redacting secrets", () => {
    const [reference] = selectReferences({ candidates: [], approvedCandidateIds: [], manuallyAddedSources: ["https://example.org/ref"] });
    const observation = recordObservation(reference!, "pacing", "Fast cuts, 1.5s average shot length. token=ghp_1234567890abcdef1234");
    expect(observation.content).toContain("[REDACTED]");
    expect(observation.content).not.toContain("ghp_1234567890abcdef1234");
    expect(observation.reference_id).toBe(reference!.reference_id);
  });
});

describe("P2.01 Improvement (P2-A): User-Seeded Reference Discovery", () => {
  it("includes user_candidate_references in the final reference set", () => {
    const userReferences: typeof import("../src/types.js").Reference[] = [
      { reference_id: "ref_user_1", source: "https://example.org/user-channel-1", approved: true },
      { reference_id: "ref_user_2", source: "https://example.org/user-video", approved: true },
    ];

    const references = selectReferences({
      candidates: [],
      approvedCandidateIds: [],
      manuallyAddedSources: [],
      user_candidate_references: userReferences,
    });

    expect(references).toHaveLength(2);
    expect(references.map((r) => r.reference_id)).toContain("ref_user_1");
    expect(references.map((r) => r.reference_id)).toContain("ref_user_2");
  });

  it("combines user_candidate_references with system-suggested approved candidates", () => {
    const userReferences: typeof import("../src/types.js").Reference[] = [
      { reference_id: "ref_user_1", source: "https://example.org/user-ref", approved: true },
    ];

    const systemCandidates = suggestCandidates([
      { label: "System Channel A", rationale: "System suggestion 1" },
      { label: "System Channel B", rationale: "System suggestion 2" },
    ]);

    const references = selectReferences({
      candidates: systemCandidates,
      approvedCandidateIds: [systemCandidates[0]!.candidate_id], // Only approve first
      manuallyAddedSources: [],
      user_candidate_references: userReferences,
    });

    // Should have 2: 1 user reference + 1 approved system candidate
    expect(references).toHaveLength(2);
    expect(references[0]?.reference_id).toBe("ref_user_1"); // User ref comes first
    expect(references[1]?.source).toBe("System Channel A"); // Only approved system candidate
  });

  it("merges user_candidate_references with manually-added sources", () => {
    const userReferences: typeof import("../src/types.js").Reference[] = [
      { reference_id: "ref_user_1", source: "https://example.org/user-ref", approved: true },
    ];

    const references = selectReferences({
      candidates: [],
      approvedCandidateIds: [],
      manuallyAddedSources: ["https://example.org/manual-1", "https://example.org/manual-2"],
      user_candidate_references: userReferences,
    });

    // Should have 3: 1 user reference + 2 manual sources
    expect(references).toHaveLength(3);
    expect(references[0]?.reference_id).toBe("ref_user_1"); // User ref first
    expect(references.slice(1).every((r) => r.approved)).toBe(true); // Manual sources are approved
  });

  it("preserves backward compatibility when user_candidate_references is not supplied", () => {
    const candidates = suggestCandidates([
      { label: "Channel A", rationale: "r1" },
      { label: "Channel B", rationale: "r2" },
    ]);

    const referenceWithout = selectReferences({
      candidates,
      approvedCandidateIds: [candidates[0]!.candidate_id],
      manuallyAddedSources: ["https://example.org/manual"],
    });

    const referenceWith = selectReferences({
      candidates,
      approvedCandidateIds: [candidates[0]!.candidate_id],
      manuallyAddedSources: ["https://example.org/manual"],
      user_candidate_references: undefined,
    });

    // Both should produce identical results
    expect(referenceWithout).toHaveLength(referenceWith.length);
    expect(referenceWithout.map((r) => r.source)).toEqual(referenceWith.map((r) => r.source));
  });

  it("allows empty user_candidate_references array (no references, only system/manual)", () => {
    const candidates = suggestCandidates([{ label: "System Channel", rationale: "r1" }]);

    const references = selectReferences({
      candidates,
      approvedCandidateIds: [candidates[0]!.candidate_id],
      manuallyAddedSources: [],
      user_candidate_references: [], // Explicitly empty
    });

    // Should have 1: only the approved system candidate (empty user refs don't add anything)
    expect(references).toHaveLength(1);
    expect(references[0]?.source).toBe("System Channel");
  });

  it("user_candidate_references maintain their original reference_id and approved status", () => {
    const userReferences: typeof import("../src/types.js").Reference[] = [
      { reference_id: "ref_custom_id_123", source: "https://example.org/user", approved: false },
    ];

    const references = selectReferences({
      candidates: [],
      approvedCandidateIds: [],
      manuallyAddedSources: [],
      user_candidate_references: userReferences,
    });

    expect(references[0]?.reference_id).toBe("ref_custom_id_123");
    expect(references[0]?.approved).toBe(false); // Preserves original approved status
  });
});
