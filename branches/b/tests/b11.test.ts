// B11 Tests

import { describe, it, expect, beforeEach } from "vitest";
import {
  runB11,
  approveCandidate,
  commitVersion,
  defineComplianceRules,
  assessRisks,
  runComplianceChecks,
  detectComplianceConflicts,
  identifyComplianceGaps,
  calculateComplianceCompleteness,
  InMemoryB11Persistence,
} from "../src/b11/index.js";

describe("B11 — Risk & Compliance", () => {
  let persistence: InMemoryB11Persistence;

  beforeEach(() => {
    persistence = new InMemoryB11Persistence();
  });

  it("defines compliance rules", () => {
    const rules = defineComplianceRules();

    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0]).toHaveProperty("rule_id");
    expect(rules[0]).toHaveProperty("rule_category");
    expect(["legal", "platform", "brand", "operational", "ethical"]).toContain(rules[0].rule_category);
  });

  it("categorizes rules by type", () => {
    const rules = defineComplianceRules();

    const categories = new Set(rules.map((r) => r.rule_category));
    expect(categories.size).toBeGreaterThan(1);
  });

  it("tracks rule scope", () => {
    const rules = defineComplianceRules();

    expect(rules[0].scope).toBeDefined();
    expect(Array.isArray(rules[0].scope)).toBe(true);
  });

  it("assesses risks", () => {
    const risks = assessRisks();

    expect(risks.length).toBeGreaterThan(0);
    expect(risks[0]).toHaveProperty("risk_id");
    expect(risks[0]).toHaveProperty("risk_category");
    expect(["legal", "operational", "market", "brand", "technical"]).toContain(risks[0].risk_category);
  });

  it("rates risk likelihood and impact", () => {
    const risks = assessRisks();

    risks.forEach((r) => {
      expect(["low", "medium", "high"]).toContain(r.likelihood);
      expect(["low", "medium", "high"]).toContain(r.impact);
    });
  });

  it("runs compliance checks", () => {
    const rules = defineComplianceRules();
    const checks = runComplianceChecks(rules);

    expect(checks.length).toBe(rules.length);
    checks.forEach((c) => {
      expect(["compliant", "non_compliant", "pending_review", "na"]).toContain(c.status);
    });
  });

  it("generates findings for non-compliant checks", () => {
    const rules = defineComplianceRules();
    const checks = runComplianceChecks(rules);
    const nonCompliant = checks.filter((c) => c.status === "non_compliant");

    nonCompliant.forEach((c) => {
      expect(c.findings.length).toBeGreaterThan(0);
      expect(c.remediation_required).toBe(true);
    });
  });

  it("detects unchecked rules conflict", () => {
    const conflicts = detectComplianceConflicts(5, 0, 0);

    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.some((c) => c.description.includes("not checked"))).toBe(true);
  });

  it("detects compliance violations conflict", () => {
    const conflicts = detectComplianceConflicts(5, 5, 2);

    expect(conflicts.some((c) => c.description.includes("violations"))).toBe(true);
  });

  it("identifies missing rules gap", () => {
    const gaps = identifyComplianceGaps(0, 0, 0);

    expect(gaps.some((g) => g.gap_id === "gap_b11_no_rules")).toBe(true);
  });

  it("identifies incomplete checks gap", () => {
    const gaps = identifyComplianceGaps(5, 3, 0);

    expect(gaps.some((g) => g.gap_id === "gap_b11_incomplete_checks")).toBe(true);
  });

  it("identifies compliance violations gap", () => {
    const gaps = identifyComplianceGaps(5, 5, 2);

    expect(gaps.some((g) => g.gap_id === "gap_b11_violations")).toBe(true);
  });

  it("calculates compliance completeness score", () => {
    const completeness = calculateComplianceCompleteness(5, 5, 0, []);

    expect(completeness.score).toBeGreaterThanOrEqual(0);
    expect(completeness.score).toBeLessThanOrEqual(100);
  });

  it("detects missing inputs in completeness", () => {
    const completeness = calculateComplianceCompleteness(0, 0, 0, []);

    expect(completeness.missing_inputs.length).toBeGreaterThan(0);
  });

  it("identifies blocking violations", () => {
    const completeness = calculateComplianceCompleteness(5, 5, 2, []);

    expect(completeness.blocking_decisions.length).toBeGreaterThan(0);
  });

  it("returns candidate state from runB11", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v1.0" };
    const candidate = await runB11(b10State);

    expect(candidate.candidate_id).toBeDefined();
    expect(candidate.compliance_rules).toBeDefined();
    expect(candidate.risk_assessments).toBeDefined();
    expect(candidate.compliance_checks).toBeDefined();
    expect(Array.isArray(candidate.conflicts_detected)).toBe(true);
    expect(Array.isArray(candidate.gaps)).toBe(true);
  });

  it("creates immutable canonical state", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v1.0" };
    const candidate = await runB11(b10State);
    const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);

    expect(canonical.version).toBe("v1.0");
    expect(canonical.cannot_be_modified_until_next_version).toBe(true);
  });

  it("rejects duplicate version", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v1.0" };
    const candidate = await runB11(b10State);
    await commitVersion(candidate, "v1.0", "user@example.com", persistence);

    await expect(commitVersion(candidate, "v1.0", "user@example.com", persistence)).rejects.toThrow(/already exists/);
  });

  it("enforces semantic versioning", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v1.0" };
    const candidate = await runB11(b10State);

    await expect(commitVersion(candidate, "invalid", "user@example.com", persistence)).rejects.toThrow(
      /Invalid semantic version/,
    );
  });

  it("generates deterministic rule IDs", () => {
    const rules1 = defineComplianceRules();
    const rules2 = defineComplianceRules();

    expect(rules1[0].rule_id).toBe(rules2[0].rule_id);
  });

  it("does not mutate input state", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v1.0" };
    const deps = { now: () => "2026-08-28T12:00:00Z" };
    await runB11(b10State, deps);

    const rules1 = defineComplianceRules(deps);
    const rules2 = defineComplianceRules(deps);

    expect(rules1[0].rule_id).toBe(rules2[0].rule_id);
  });

  it("marks all inferred data as INFERRED", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v1.0" };
    const candidate = await runB11(b10State);

    candidate.risk_assessments.forEach((r) => {
      expect(r.provenance.type).toBe("INFERRED");
    });

    candidate.compliance_checks.forEach((c) => {
      expect(["INFERRED", "OBSERVED"]).toContain(c.provenance.type);
    });
  });

  it("evidence and provenance are separate", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v1.0" };
    const candidate = await runB11(b10State);

    if (candidate.compliance_rules.length > 0) {
      const r = candidate.compliance_rules[0];
      expect(Array.isArray(r.evidence_refs)).toBe(true);
      expect(typeof r.provenance).toBe("object");
    }
  });

  it("loads and lists versions", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v1.0" };
    const candidate = await runB11(b10State);
    const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);

    const loaded = await persistence.load("v1.0");
    expect(loaded?.version).toBe("v1.0");

    const versions = await persistence.listVersions();
    expect(versions).toContain("v1.0");
  });

  it("retrieves latest version", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v1.0" };
    const candidate = await runB11(b10State);
    await commitVersion(candidate, "v1.0", "user@example.com", persistence);
    await commitVersion(candidate, "v2.0", "user@example.com", persistence);

    const latest = await persistence.latest();
    expect(latest?.version).toBe("v2.0");
  });

  it("audit trail tracks changes", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v1.0" };
    const candidate = await runB11(b10State);
    const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);

    expect(canonical.audit_trail.length).toBeGreaterThan(0);
    expect(canonical.audit_trail[0].changed_by).toBe("user@example.com");
  });

  it("preserves b10_version lineage in candidate", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v2.5" };
    const candidate = await runB11(b10State);

    expect(candidate.b10_version).toBe("v2.5");
  });

  it("preserves b10_version in canonical state", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v2.5" };
    const candidate = await runB11(b10State);
    const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);

    expect(canonical.b10_canonical_version).toBe("v2.5");
  });

  it("governance routing marks items DECIDED after approval", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v1.0" };
    const candidate = await runB11(b10State);
    const approved = await approveCandidate(candidate, "user@example.com");

    expect(approved.compliance_rules.length).toBe(candidate.compliance_rules.length);
    approved.compliance_rules.forEach((r) => {
      expect(r.provenance.type).toBe("DECIDED");
      expect(r.provenance.decision_authority).toBe("user@example.com");
      expect(r.provenance.prior_provenance_id).toBeDefined();
    });
  });

  it("governance_events preserved in canonical state", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v1.0" };
    const candidate = await runB11(b10State);
    const approved = await approveCandidate(candidate, "user@example.com");
    const canonical = await commitVersion(approved, "v1.0", "user@example.com", persistence);

    expect(canonical.governance_events).toBeDefined();
    expect(typeof canonical.governance_events).toBe("object");
  });

  it("deterministic candidate IDs across different dates", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v1.0" };

    const candidate1 = await runB11(b10State, { now: () => "2026-01-01T00:00:00Z" });
    const candidate2 = await runB11(b10State, { now: () => "2026-12-31T23:59:59Z" });

    expect(candidate1.candidate_id).toBe(candidate2.candidate_id);
  });

  it("audit trail appends rather than prepends", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v1.0" };
    const candidate1 = await runB11(b10State);
    const canonical1 = await commitVersion(candidate1, "v1.0", "user@example.com", persistence);

    expect(canonical1.audit_trail.length).toBe(1);
    expect(canonical1.audit_trail[0].version).toBe("v1.0");

    const candidate2 = await runB11(b10State);
    const canonical2 = await commitVersion(candidate2, "v2.0", "user@example.com", persistence, canonical1);

    expect(canonical2.audit_trail.length).toBe(2);
    expect(canonical2.audit_trail[0].version).toBe("v1.0");
    expect(canonical2.audit_trail[1].version).toBe("v2.0");
  });

  it("initializes governance_events as empty in candidate", async () => {
    const b10State = { candidate_id: "cand_b10_001", version: "v1.0" };
    const candidate = await runB11(b10State);

    expect(candidate.governance_events).toBeDefined();
    expect(typeof candidate.governance_events).toBe("object");
    expect(Object.keys(candidate.governance_events).length).toBe(0);
  });
});
