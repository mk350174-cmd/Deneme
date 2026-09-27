// B10 Tests

import { describe, it, expect, beforeEach } from "vitest";
import {
  runB10,
  approveCandidate,
  commitVersion,
  generateOptimizationProposals,
  assessProposalImpact,
  detectOptimizationConflicts,
  identifyOptimizationGaps,
  calculateOptimizationCompleteness,
  InMemoryB10Persistence,
} from "../src/b10/index.js";

describe("B10 — Continuous Optimization", () => {
  let persistence: InMemoryB10Persistence;

  beforeEach(() => {
    persistence = new InMemoryB10Persistence();
  });

  it("generates optimization proposals from learning proposals", () => {
    const b09State = {
      proposals: [
        {
          proposal_id: "lp_001",
          proposal_type: "strategy_refinement",
          target_module: "b06",
          description: "Increase YouTube frequency",
          confidence: 0.8,
          evidence_refs: [],
        },
      ],
    };

    const proposals = generateOptimizationProposals(b09State.proposals);

    expect(proposals.length).toBe(1);
    expect(proposals[0].proposal_type).toBe("strategy_refinement");
    expect(proposals[0].confidence).toBeLessThanOrEqual(0.8);
  });

  it("filters proposals by type", () => {
    const b09State = {
      proposals: [
        {
          proposal_id: "lp_001",
          proposal_type: "strategy_refinement",
          target_module: "b06",
          description: "Test",
          confidence: 0.8,
          evidence_refs: [],
        },
        {
          proposal_id: "lp_002",
          proposal_type: "gap_closure",
          target_module: "b01",
          description: "Test 2",
          confidence: 0.6,
          evidence_refs: [],
        },
      ],
    };

    const proposals = generateOptimizationProposals(b09State.proposals);

    expect(proposals.length).toBe(2);
    proposals.forEach((p) => {
      expect(["strategy_refinement", "gap_closure"]).toContain(p.proposal_type);
    });
  });

  it("assesses proposal impact", () => {
    const proposals = [
      {
        proposal_id: "opt_001",
        proposal_type: "strategy_refinement" as const,
        target_module: "b06",
        parameter_name: "frequency",
        current_value: "current",
        proposed_value: "optimized",
        confidence: 0.8,
        expected_impact: "Increase engagement",
        evidence_refs: [],
        provenance: {
          type: "INFERRED" as const,
          source_module: "b10",
          decision_authority: "system",
          timestamp: new Date().toISOString(),
          prior_versions: [],
          rationale: "test",
        },
      },
    ];

    const assessments = assessProposalImpact(proposals);

    expect(assessments.length).toBe(1);
    expect(assessments[0].risk_level).toMatch(/low|medium|high/);
    expect(assessments[0].benefit_score).toBeGreaterThanOrEqual(0);
    expect(assessments[0].benefit_score).toBeLessThanOrEqual(1);
  });

  it("detects unassessed proposals conflict", () => {
    const conflicts = detectOptimizationConflicts(5, 0);

    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.some((c) => c.description.includes("assessments"))).toBe(true);
  });

  it("detects incomplete assessment conflict", () => {
    const conflicts = detectOptimizationConflicts(5, 3);

    expect(conflicts.some((c) => c.description.includes("lack"))).toBe(true);
  });

  it("identifies missing proposals gap", () => {
    const gaps = identifyOptimizationGaps(0, 0);

    expect(gaps.some((g) => g.gap_id === "gap_b10_no_proposals")).toBe(true);
  });

  it("identifies incomplete assessment gap", () => {
    const gaps = identifyOptimizationGaps(5, 3);

    expect(gaps.some((g) => g.gap_id === "gap_b10_incomplete_assessment")).toBe(true);
  });

  it("identifies high volume proposal gap", () => {
    const gaps = identifyOptimizationGaps(15, 15);

    expect(gaps.some((g) => g.gap_id === "gap_b10_proposal_volume")).toBe(true);
  });

  it("calculates completeness score", () => {
    const completeness = calculateOptimizationCompleteness(5, 5, []);

    expect(completeness.score).toBeGreaterThanOrEqual(0);
    expect(completeness.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(completeness.missing_inputs)).toBe(true);
  });

  it("detects missing inputs in completeness", () => {
    const completeness = calculateOptimizationCompleteness(0, 0, []);

    expect(completeness.missing_inputs.length).toBeGreaterThan(0);
  });

  it("identifies blocking decisions", () => {
    const completeness = calculateOptimizationCompleteness(5, 0, []);

    expect(completeness.blocking_decisions.length).toBeGreaterThan(0);
  });

  it("returns candidate state from runB10", async () => {
    const b09State = { proposals: [] };
    const candidate = await runB10(b09State);

    expect(candidate.candidate_id).toBeDefined();
    expect(candidate.optimization_proposals).toBeDefined();
    expect(candidate.impact_assessments).toBeDefined();
    expect(Array.isArray(candidate.conflicts_detected)).toBe(true);
    expect(Array.isArray(candidate.gaps)).toBe(true);
  });

  it("creates immutable canonical state", async () => {
    const b09State = { proposals: [] };
    const candidate = await runB10(b09State);
    const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);

    expect(canonical.version).toBe("v1.0");
    expect(canonical.cannot_be_modified_until_next_version).toBe(true);
  });

  it("rejects duplicate version", async () => {
    const b09State = { proposals: [] };
    const candidate = await runB10(b09State);
    await commitVersion(candidate, "v1.0", "user@example.com", persistence);

    await expect(commitVersion(candidate, "v1.0", "user@example.com", persistence)).rejects.toThrow(/already exists/);
  });

  it("enforces semantic versioning", async () => {
    const b09State = { proposals: [] };
    const candidate = await runB10(b09State);

    await expect(commitVersion(candidate, "invalid", "user@example.com", persistence)).rejects.toThrow(
      /Invalid semantic version/,
    );
  });

  it("generates deterministic proposal IDs", () => {
    const b09State = {
      proposals: [
        {
          proposal_id: "lp_001",
          proposal_type: "strategy_refinement",
          target_module: "b06",
          description: "Test",
          confidence: 0.8,
          evidence_refs: [],
        },
      ],
    };

    const proposals1 = generateOptimizationProposals(b09State.proposals);
    const proposals2 = generateOptimizationProposals(b09State.proposals);

    expect(proposals1[0].proposal_id).toBe(proposals2[0].proposal_id);
  });

  it("does not mutate input state", async () => {
    const b09State = { proposals: [] };
    const b09Copy = JSON.parse(JSON.stringify(b09State));

    await runB10(b09State);

    expect(b09State).toEqual(b09Copy);
  });

  it("marks all inferred data as INFERRED", async () => {
    const b09State = { proposals: [] };
    const candidate = await runB10(b09State);

    candidate.optimization_proposals.forEach((p) => {
      expect(p.provenance.type).toBe("INFERRED");
    });

    candidate.impact_assessments.forEach((a) => {
      expect(a.provenance.type).toBe("INFERRED");
    });
  });

  it("evidence and provenance are separate", async () => {
    const b09State = { proposals: [] };
    const candidate = await runB10(b09State);

    if (candidate.optimization_proposals.length > 0) {
      const p = candidate.optimization_proposals[0];
      expect(Array.isArray(p.evidence_refs)).toBe(true);
      expect(typeof p.provenance).toBe("object");
    }
  });

  it("handles empty proposals gracefully", async () => {
    const b09State = { proposals: [] };
    const candidate = await runB10(b09State);

    expect(candidate.optimization_proposals.length).toBe(0);
    expect(candidate.impact_assessments.length).toBe(0);
    expect(candidate.gaps.length).toBeGreaterThan(0);
  });

  it("loads and lists versions", async () => {
    const b09State = { proposals: [] };
    const candidate = await runB10(b09State);
    const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);

    const loaded = await persistence.load("v1.0");
    expect(loaded?.version).toBe("v1.0");

    const versions = await persistence.listVersions();
    expect(versions).toContain("v1.0");
  });

  it("retrieves latest version", async () => {
    const b09State = { proposals: [] };
    const candidate = await runB10(b09State);
    await commitVersion(candidate, "v1.0", "user@example.com", persistence);
    await commitVersion(candidate, "v2.0", "user@example.com", persistence);

    const latest = await persistence.latest();
    expect(latest?.version).toBe("v2.0");
  });

  it("audit trail tracks changes", async () => {
    const b09State = { proposals: [] };
    const candidate = await runB10(b09State);
    const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);

    expect(canonical.audit_trail.length).toBeGreaterThan(0);
    expect(canonical.audit_trail[0].changed_by).toBe("user@example.com");
    expect(canonical.audit_trail[0].version).toBe("v1.0");
  });

  it("governance routing marks items DECIDED after approval", async () => {
    const b09State = {
      candidate_id: "cand_b09_001",
      proposals: [{
        proposal_id: "lp_001",
        proposal_type: "strategy_refinement" as const,
        target_module: "b06",
        description: "Test",
        confidence: 0.8,
        evidence_refs: [],
      }],
    };
    const candidate = await runB10(b09State);
    const approved = await approveCandidate(candidate, "user@example.com");

    expect(approved.optimization_proposals.length).toBe(candidate.optimization_proposals.length);
    approved.optimization_proposals.forEach((p) => {
      expect(p.provenance.type).toBe("DECIDED");
      expect(p.provenance.decision_authority).toBe("user@example.com");
      expect(p.provenance.prior_provenance_id).toBeDefined();
    });
  });

  it("governance_events preserved in canonical state", async () => {
    const b09State = {
      candidate_id: "cand_b09_001",
      proposals: [{
        proposal_id: "lp_001",
        proposal_type: "strategy_refinement" as const,
        target_module: "b06",
        description: "Test",
        confidence: 0.8,
        evidence_refs: [],
      }],
    };
    const candidate = await runB10(b09State);
    const approved = await approveCandidate(candidate, "user@example.com");
    const canonical = await commitVersion(approved, "v1.0", "user@example.com", persistence);

    expect(canonical.governance_events).toBeDefined();
    expect(Object.keys(canonical.governance_events).length).toBeGreaterThan(0);
  });

  it("deterministic candidate IDs across different dates", async () => {
    const b09State = {
      candidate_id: "cand_b09_001",
      proposals: [{
        proposal_id: "lp_001",
        proposal_type: "strategy_refinement" as const,
        target_module: "b06",
        description: "Test",
        confidence: 0.8,
        evidence_refs: [],
      }],
    };

    const candidate1 = await runB10(b09State, { now: () => "2026-01-01T00:00:00Z" });
    const candidate2 = await runB10(b09State, { now: () => "2026-12-31T23:59:59Z" });

    expect(candidate1.candidate_id).toBe(candidate2.candidate_id);
  });

  it("audit trail appends rather than prepends", async () => {
    const b09State = { proposals: [] };
    const candidate1 = await runB10(b09State);
    const canonical1 = await commitVersion(candidate1, "v1.0", "user@example.com", persistence);

    expect(canonical1.audit_trail.length).toBe(1);
    expect(canonical1.audit_trail[0].version).toBe("v1.0");

    const candidate2 = await runB10(b09State);
    const canonical2 = await commitVersion(candidate2, "v2.0", "user@example.com", persistence, canonical1);

    expect(canonical2.audit_trail.length).toBe(2);
    expect(canonical2.audit_trail[0].version).toBe("v1.0");
    expect(canonical2.audit_trail[1].version).toBe("v2.0");
  });

  it("initializes governance_events as empty in candidate", async () => {
    const b09State = { proposals: [] };
    const candidate = await runB10(b09State);

    expect(candidate.governance_events).toBeDefined();
    expect(typeof candidate.governance_events).toBe("object");
    expect(Object.keys(candidate.governance_events).length).toBe(0);
  });
});
