import { describe, it, expect } from "vitest";
import { canonicalHasher } from "../../src/b00/hashing.js";
import { createArtifactBinding, createCanonicalIdentity, validateCanonicalIdentity } from "../../src/b00/identity.js";
import {
  approveItem,
  canonicalizeItem,
  proposeItem,
  revokeItem,
  GovernanceTransitionError,
  isApprovedForArtifact,
} from "../../src/b00/governance.js";
import { validateEvidenceSemantics } from "../../src/b00/evidence.js";
import { validateEvidenceCollection, validateGovernanceEventMap } from "../../src/b00/validation.js";
import { validateLineageGraph } from "../../src/b00/lineage.js";
import { validateAnalyticsResult, providerExecutionClaim } from "../../src/b08/execution.js";
import { generateLearningObservations, identifyOperationalGaps } from "../../src/b09/phases/B09_01_observations.js";
import { assessProposalImpact } from "../../src/b10/phases/B10_02_impact.js";
import { runComplianceChecks } from "../../src/b11/phases/B11_03_checks.js";
import { validateBranchCompleteness } from "../../src/b12/phases/B12_03_completeness.js";

describe("B-Branch repair adversarial invariants", () => {
  it("uses stable SHA-256 canonical hashing and detects semantic mutation", () => {
    expect(canonicalHasher.hashValue({ z: 1, a: { y: 2, x: 3 } })).toBe(
      canonicalHasher.hashValue({ a: { x: 3, y: 2 }, z: 1 }),
    );
    expect(canonicalHasher.hash("abc")).toHaveLength(64);
    expect(canonicalHasher.hashValue({ v: "abc" })).not.toBe(canonicalHasher.hashValue({ v: "abd" }));

    const artifact = { version: "v1.0", value: 1 };
    const identity = createCanonicalIdentity({
      object_id: "obj1",
      object_type: "TEST",
      version: "v1.0",
      artifact,
      created_at: "2026-09-06T00:00:00Z",
    });
    expect(validateCanonicalIdentity(artifact, identity).valid).toBe(true);
    expect(validateCanonicalIdentity({ ...artifact, value: 2 }, identity).valid).toBe(false);
  });

  it("rejects illegal governance transitions and terminal mutation", () => {
    const proposed = proposeItem({ itemId: "obj2", history: [], authority: "user", timestamp: "2026-09-06T00:00:00Z" });
    expect(() => canonicalizeItem({ itemId: "obj2", history: proposed.history, authority: "user", timestamp: "2026-09-06T00:01:00Z" })).toThrow(GovernanceTransitionError);

    const binding = createArtifactBinding({ value: 1 }, "obj3", "TEST", "v1.0");
    const p = proposeItem({ itemId: "obj3", history: [], authority: "user", timestamp: "2026-09-06T00:00:00Z" });
    const a = approveItem({ itemId: "obj3", history: p.history, authority: "user", timestamp: "2026-09-06T00:01:00Z", artifact: binding, requireArtifactBinding: true });
    const c = canonicalizeItem({ itemId: "obj3", history: a.history, authority: "user", timestamp: "2026-09-06T00:02:00Z", artifact: binding, requireArtifactBinding: true });
    expect(() => revokeItem({ itemId: "obj3", history: c.history, authority: "user", timestamp: "2026-09-06T00:03:00Z" })).toThrow(GovernanceTransitionError);
  });

  it("invalidates an approval when the approved artifact content changes", () => {
    const binding = createArtifactBinding({ value: 1 }, "obj4", "TEST", "v1.0");
    const p = proposeItem({ itemId: "obj4", history: [], authority: "user", timestamp: "2026-09-06T00:00:00Z" });
    const a = approveItem({ itemId: "obj4", history: p.history, authority: "user", timestamp: "2026-09-06T00:01:00Z", artifact: binding, requireArtifactBinding: true });
    const mutated = createArtifactBinding({ value: 2 }, "obj4", "TEST", "v1.0");
    expect(isApprovedForArtifact(a.history, binding)).toBe(true);
    expect(isApprovedForArtifact(a.history, mutated)).toBe(false);
    expect(() => canonicalizeItem({ itemId: "obj4", history: a.history, authority: "user", timestamp: "2026-09-06T00:02:00Z", artifact: mutated, requireArtifactBinding: true })).toThrow(GovernanceTransitionError);
  });

  it("does not allow assertions/defaults/mock evidence to masquerade as VERIFIED", () => {
    const assertion = validateEvidenceSemantics({
      id: "e-user",
      source: "user_input:claim",
      status: "VERIFIED",
      origin: "USER_ASSERTION",
      basis: "ASSERTED",
      source_mode: "REAL",
    });
    expect(assertion.valid).toBe(false);
    expect(assertion.normalized_status).toBe("INFERRED");

    const mock = validateEvidenceSemantics({
      id: "e-mock",
      source: "fixture",
      status: "VERIFIED",
      origin: "MOCK",
      basis: "MOCK",
      source_mode: "MOCK",
      production_eligible: true,
    });
    expect(mock.valid).toBe(false);
    expect(mock.normalized_status).toBe("UNKNOWN");
  });

  it("returns structured validation errors for malformed inputs", () => {
    expect(validateEvidenceCollection(null).issues[0]?.severity).toBe("ERROR");
    expect(validateGovernanceEventMap("bad").issues[0]?.code).toBe("MALFORMED_GOVERNANCE_MAP");
  });

  it("keeps analytics definitions separate from execution and enforces MOCK/REAL firewall", () => {
    const source: any = {
      source_id: "s1", source_name: "YouTube", source_type: "native_platform", api_available: true,
      api_availability_basis: "CATALOG_DEFAULT", real_time: false, execution_state: "DEFINED", source_mode: "UNKNOWN",
      execution_verified: false, evidence_refs: [], provenance: { type: "INFERRED", decision_authority: "B08", timestamp: "2026-09-06T00:00:00Z" },
    };
    expect(providerExecutionClaim(source)).toBe("DEFINED_ONLY");

    const metrics: any[] = [{
      metric_id: "m1", kpi_id: "k1", metric_name: "views", source_id: "s1", aggregation_method: "sum", aggregation_window: "daily",
      data_quality_rules: [], evidence_refs: [], provenance: { type: "INFERRED", decision_authority: "B08", timestamp: "2026-09-06T00:00:00Z" }, definition_state: "DEFINED",
    }];
    const result = validateAnalyticsResult({
      result_id: "r1", metric_id: "m1", value: 10, unit: "count", period_start: "2026-09-01", period_end: "2026-09-02",
      state: "VALIDATED", source_mode: "MOCK", evidence_refs: [{ id: "bad", source: "mock", status: "VERIFIED", origin: "MOCK", basis: "MOCK", source_mode: "REAL" }],
    }, metrics);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "MOCK_REAL_FIREWALL_VIOLATION")).toBe(true);
  });

  it("does not create learning observations from MOCK analytics or config gaps", () => {
    const b08: any = { analytics_results: [{ result_id: "r1", metric_id: "m1", value: 99, unit: "count", period_start: "x", period_end: "y", state: "USABLE", source_mode: "MOCK", evidence_refs: [] }], workflows: [] };
    const b06: any = { distribution_strategies: [] };
    expect(generateLearningObservations(b08, b06)).toHaveLength(0);
    expect(identifyOperationalGaps(b08, b06).some((gap) => gap.gap_id === "opgap_b08_actual_data")).toBe(true);
  });

  it("derives B10 risk/blast radius from the dependency graph, not proposal hash", () => {
    const proposal: any = {
      proposal_id: "p1", proposal_type: "strategy_refinement", target_module: "B04", parameter_name: "owner_selected_change",
      current_state: "UNKNOWN", observed_problem: "problem", hypothesis: "h", proposed_change: "change", expected_effect: "effect",
      required_approval: true, proposal_basis: "LEARNING_SIGNAL", current_value: "UNKNOWN", proposed_value: "change", confidence: 0.7,
      confidence_basis: "SIGNAL_CHAIN", expected_impact: "effect", evidence_refs: [], provenance: { type: "RECOMMENDED", decision_authority: "B10", timestamp: "2026-09-06T00:00:00Z" },
    };
    const a = assessProposalImpact([proposal], { hash: { stableProposalId: () => "x", stableAssessmentId: () => "hash-a" } })[0]!;
    const b = assessProposalImpact([{ ...proposal, proposal_id: "completely-different" }], { hash: { stableProposalId: () => "y", stableAssessmentId: () => "hash-b" } })[0]!;
    expect(a.risk_level).toBe(b.risk_level);
    expect(a.affected_modules).toEqual(b.affected_modules);
    expect(a.affected_modules_basis).toBe("DEPENDENCY_GRAPH");
  });

  it("derives compliance from RULE + SUBJECT + EVIDENCE, not hashes", () => {
    const rule: any = { rule_id: "rule1", rule_category: "legal", description: "Must disclose", scope: ["B10"], required: true, rule_basis: "USER_DEFINED", external_verified: false, evidence_refs: [], provenance: { type: "DECIDED", decision_authority: "user", timestamp: "2026-09-06T00:00:00Z" } };
    const subject: any = { subject_id: "subject1", subject_type: "B10_OPT", subject_version: "v1.0", subject_content_hash: "hash", affected_modules: ["B10"] };
    expect(runComplianceChecks([rule], [subject], { complianceEvidence: [] })[0]?.status).toBe("UNKNOWN");

    const evidence: any = { evidence_ref: { id: "real", source: "review", status: "VERIFIED", origin: "DOCUMENTATION", basis: "OBSERVED", source_mode: "REAL" }, rule_id: "rule1", subject_id: "subject1", subject_type: subject.subject_type, subject_version: subject.subject_version, subject_content_hash: subject.subject_content_hash, assertion: "SATISFIES", rationale: "Reviewed evidence satisfies the rule" };
    const hashA = runComplianceChecks([rule], [subject], { hash: { stableRuleId: () => "a", stableCheckId: () => "a" }, complianceEvidence: [evidence] })[0]!;
    const hashB = runComplianceChecks([rule], [subject], { hash: { stableRuleId: () => "b", stableCheckId: () => "b" }, complianceEvidence: [evidence] })[0]!;
    expect(hashA.status).toBe("COMPLIANT");
    expect(hashB.status).toBe("COMPLIANT");

    const wrongSubject = { ...evidence, subject_id: "other-subject" };
    expect(runComplianceChecks([rule], [subject], { complianceEvidence: [wrongSubject] })[0]?.status).toBe("UNKNOWN");
  });

  it("separates B12 structural completeness from semantic and operational readiness", () => {
    const versions: any[] = ["b01","b02","b03","b04","b05","b06","b07","b08","b09","b10","b11"].map((module) => ({
      module, version: "v1.0", created_at: "x", canonical_state_id: `${module}:v1.0`, object_type: `${module.toUpperCase()}_CANONICAL_STATE`, content_hash: "hash", identity_status: "VERIFIED",
    }));
    const result = validateBranchCompleteness(versions, {
      semantic_validity: "UNKNOWN",
      operational_readiness: "NOT_READY",
      semantic_findings: ["unresolved compliance"],
      operational_findings: ["no real analytics"],
    } as any);
    expect(result.structural_completeness).toBe(100);
    expect(result.semantic_validity).toBe("UNKNOWN");
    expect(result.operational_readiness).toBe("NOT_READY");
  });

  it("rejects wrong parent version/hash lineage", () => {
    const parent = createCanonicalIdentity({ object_id: "p", object_type: "B01_CANONICAL_STATE", version: "v1.0", artifact: { x: 1 }, created_at: "x" });
    const child = createCanonicalIdentity({
      object_id: "c", object_type: "B02_CANONICAL_STATE", version: "v1.0", artifact: { x: 2 }, created_at: "x",
      parent_references: [{ module: "B01", object_id: "p", object_type: "B01_CANONICAL_STATE", version: "v0.9", content_hash: "WRONG" }],
    });
    const result = validateLineageGraph({ B01: parent, B02: child });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "PARENT_IDENTITY_MISMATCH")).toBe(true);
  });
});
