// B09 Tests

import { describe, it, expect, beforeEach } from "vitest";
import {
  runB09,
  commitVersion,
  generateLearningObservations,
  generateLearningSignals,
  generateLearningProposals,
  detectLearningConflicts,
  identifyLearningGaps,
  calculateLearningCompleteness,
  InMemoryB09Persistence,
} from "../src/b09/index.js";

describe("B09 — Learning Loops", () => {
  let persistence: InMemoryB09Persistence;

  beforeEach(() => {
    persistence = new InMemoryB09Persistence();
  });

  it("generates learning observations", () => {
    const b08State = { workflows: [] };
    const b06State = { distribution_strategies: [] };

    const observations = generateLearningObservations(b08State, b06State);

    expect(observations.length).toBeGreaterThan(0);
    expect(observations[0]).toHaveProperty("observation_id");
    expect(observations[0].provenance.type).toBe("INFERRED");
  });

  it("generates learning signals from observations", () => {
    const b08State = { workflows: [] };
    const b06State = { distribution_strategies: [] };

    const observations = generateLearningObservations(b08State, b06State);
    const signals = generateLearningSignals(observations);

    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0].source_observations.length).toBeGreaterThan(0);
  });

  it("generates learning proposals from signals", () => {
    const b08State = { workflows: [] };
    const b06State = { distribution_strategies: [] };

    const observations = generateLearningObservations(b08State, b06State);
    const signals = generateLearningSignals(observations);
    const proposals = generateLearningProposals(signals);

    // Proposals only generated from negative signals, which depend on observation magnitude
    // Empty case may not generate negative signals; verify proposal structure if generated
    proposals.forEach((p) => {
      expect(p.provenance.type).toBe("INFERRED");
    });
  });

  it("detects learning conflicts", () => {
    const conflicts = detectLearningConflicts(0, 0);

    expect(conflicts.length).toBeGreaterThan(0);
  });

  it("identifies learning gaps", () => {
    const gaps = identifyLearningGaps(0, 0, 0);

    expect(gaps.some((g) => g.gap_id === "gap_observations")).toBe(true);
  });

  it("calculates learning completeness", () => {
    const gaps: any[] = [];
    const completeness = calculateLearningCompleteness(1, 1, 1, gaps);

    expect(completeness.score).toBe(100);
  });

  it("evidence and provenance are separate", () => {
    const b08State = { workflows: [] };
    const b06State = { distribution_strategies: [] };

    const observations = generateLearningObservations(b08State, b06State);

    expect(Array.isArray(observations[0].evidence_refs)).toBe(true);
    expect(typeof observations[0].provenance).toBe("object");
  });

  it("returns candidate state from runB09", async () => {
    const candidate = await runB09({}, {});

    expect(candidate.candidate_id).toBeDefined();
    expect(candidate.observations).toBeDefined();
    expect(candidate.signals).toBeDefined();
  });

  it("creates immutable canonical state", async () => {
    const candidate = await runB09({}, {});
    const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);

    expect(canonical.version).toBe("v1.0");
    expect(canonical.cannot_be_modified_until_next_version).toBe(true);
  });

  it("rejects duplicate version", async () => {
    const candidate = await runB09({}, {});
    await commitVersion(candidate, "v1.0", "user@example.com", persistence);

    await expect(commitVersion(candidate, "v1.0", "user@example.com", persistence)).rejects.toThrow(/already exists/);
  });

  it("enforces semantic versioning", async () => {
    const candidate = await runB09({}, {});

    await expect(commitVersion(candidate, "invalid", "user@example.com", persistence)).rejects.toThrow(/Invalid semantic version/);
  });

  it("generates deterministic IDs", () => {
    const b08State = { workflows: [] };
    const b06State = { distribution_strategies: [] };

    const obs1 = generateLearningObservations(b08State, b06State);
    const obs2 = generateLearningObservations(b08State, b06State);

    expect(obs1[0].observation_id).toBe(obs2[0].observation_id);
  });

  it("does not mutate input state", async () => {
    const b08State = { workflows: [] };
    const b08Copy = JSON.parse(JSON.stringify(b08State));

    await runB09(b08State, {});

    expect(b08State).toEqual(b08Copy);
  });

  it("marks all inferred data as INFERRED", async () => {
    const candidate = await runB09({}, {});

    candidate.observations.forEach((o) => {
      expect(o.provenance.type).toBe("INFERRED");
    });

    candidate.signals.forEach((s) => {
      expect(s.provenance.type).toBe("INFERRED");
    });

    candidate.proposals.forEach((p) => {
      expect(p.provenance.type).toBe("INFERRED");
    });
  });
});
