// UNIFIED FIX B-4 (2026-09-23) — see ../../../../MERGE_REPORT.md "Güncelleme 6".
// B11 provenance refs must be bound to the exact artifact they explain, otherwise
// B12 marks every real branch semantically INVALID.
import { describe, it, expect } from "vitest";
import { runB11, approveCandidate, commitVersion, InMemoryB11Persistence } from "../../src/b11/index.js";
import { validateSubjectBoundProvenance } from "../../src/b00/provenanceRef.js";
import { createArtifactBinding } from "../../src/b00/identity.js";

const b10 = { candidate_id: "cand_b10_unified", version: "v1.0", optimization_proposals: [{ proposal_id: "prop1", target_module: "b05" }], impact_assessments: [] } as any;

describe("B-4: B11 provenance is subject-bound", () => {
  it("every candidate provenance ref passes B00 subject-binding validation", async () => {
    const c = await runB11(b10);
    expect(c.compliance_checks.length).toBeGreaterThan(0);
    expect(c.provenance_refs.length).toBe(c.compliance_rules.length + c.risk_assessments.length + c.compliance_checks.length);
    for (const ref of c.provenance_refs) expect(validateSubjectBoundProvenance(ref).errors).toEqual([]);
    const rule = c.compliance_rules[0]!;
    expect(c.provenance_refs[0]!.subject_content_hash).toBe(createArtifactBinding(rule, rule.rule_id, "B11_COMPLIANCE_RULE", c.candidate_id).object_content_hash);
  });

  it("the canonical state carries bound provenance for the approved items, and never marks a check COMPLIANT", async () => {
    const c = await runB11(b10);
    const s = await commitVersion(await approveCandidate(c, "owner"), "v1.0", "owner", new InMemoryB11Persistence());
    expect(s.provenance_refs.length).toBe(s.compliance_rules.length + s.risk_assessments.length + s.compliance_checks.length);
    for (const ref of s.provenance_refs) expect(validateSubjectBoundProvenance(ref).valid).toBe(true);
    expect(s.provenance_refs.slice(0, s.compliance_rules.length).every((p) => p.type === "DECIDED")).toBe(true);
    expect(s.compliance_checks.map((x) => x.status)).toEqual(c.compliance_checks.map((x) => x.status));
  });
});
