import { describe, it, expect } from "vitest";
import { createCanonicalIdentity, parentReferenceFromIdentity, createArtifactBinding } from "../../src/b00/identity.js";
import { proposeItem, approveItem, canonicalizeItem } from "../../src/b00/governance.js";
import { createBranchState } from "../../src/b12/orchestration.js";
import type { B12UpstreamReader } from "../../src/b12/types.js";
import type { CanonicalIdentity } from "../../src/b00/identity.js";

const modules = ["B01","B02","B03","B04","B05","B06","B07","B08","B09","B10","B11"] as const;
const dependencies: Record<(typeof modules)[number], readonly (typeof modules)[number][]> = {
  B01: [], B02: ["B01"], B03: ["B01"], B04: ["B01","B02","B03"], B05: ["B01","B03","B04"],
  B06: ["B01","B03","B04"], B07: ["B04","B06"], B08: ["B01","B06","B07"], B09: ["B08","B06"], B10: ["B09"], B11: ["B10"],
};

function makeApprovalHistory() {
  const binding = createArtifactBinding({ decision: "Use approved channel role" }, "decision-channel-role", "B01_DECISION", "v1.0");
  const p = proposeItem({ itemId: binding.object_id, history: [], authority: "analyst", timestamp: "2026-09-06T01:00:00Z" });
  const a = approveItem({ itemId: binding.object_id, history: p.history, authority: "user@example.test", timestamp: "2026-09-06T01:01:00Z", artifact: binding, requireArtifactBinding: true });
  return canonicalizeItem({ itemId: binding.object_id, history: a.history, authority: "user@example.test", timestamp: "2026-09-06T01:02:00Z", artifact: binding, requireArtifactBinding: true }).history;
}

function makeState(module: (typeof modules)[number], identities: Partial<Record<(typeof modules)[number], CanonicalIdentity>>, extras: Record<string, unknown> = {}) {
  const lower = module.toLowerCase();
  const created = "2026-09-06T02:00:00Z";
  const base: any = {
    version: "v1.0",
    created_at: created,
    updated_at: created,
    user_decision_authority: "user@example.test",
    audit_trail: [{ version: "v1.0", changed_at: created, changed_by: "user@example.test", summary: `${module} canonical fixture` }],
    decisions_made: [],
    recommendations_considered: [],
    evidence_refs: [],
    provenance_refs: [],
    governance_events: {},
    decision_timestamp: created,
    cannot_be_modified_until_next_version: true,
    ...extras,
  };
  const parentReferences = dependencies[module].map((parent) => parentReferenceFromIdentity(parent, identities[parent]!, "integration_fixture_parent"));
  const identity = createCanonicalIdentity({
    object_id: `${lower}:v1.0:fixture`,
    object_type: `${module}_CANONICAL_STATE`,
    version: "v1.0",
    artifact: base,
    parent_references: parentReferences,
    created_at: created,
  });
  identities[module] = identity;
  return { ...base, identity };
}

describe("B00 -> B12 repair integration fixture", () => {
  it("preserves exact version/hash lineage, approvals, uncertainty, decisions, conflict and unresolved compliance", async () => {
    const identities: Partial<Record<(typeof modules)[number], CanonicalIdentity>> = {};
    const approvalHistory = makeApprovalHistory();
    const approvedProvenance = approvalHistory.at(-1)!.provenance;

    const states: Record<string, any> = {};
    states.b01 = makeState("B01", identities, {
      conflicts: [{ conflict_id: "fixture-conflict", description: "Two strategic inputs disagree", affected_items: ["territory-a","territory-b"], severity: "medium" }],
      decisions_made: [{ decision_id: "fixture-user-decision", description: "User selected the canonical channel role", timestamp: "2026-09-06T01:01:00Z", user_authority: "user@example.test", rationale: "Explicit test decision" }],
      governance_events: { "decision-channel-role": approvalHistory },
      provenance_refs: [approvedProvenance],
    });
    states.b02 = makeState("B02", identities);
    states.b03 = makeState("B03", identities, {
      evidence_refs: [{ id: "fixture-uncertain-audience", source: "user_input:audience_claim", status: "UNKNOWN", origin: "USER_ASSERTION", basis: "ASSERTED", source_mode: "UNKNOWN" }],
    });
    states.b04 = makeState("B04", identities);
    states.b05 = makeState("B05", identities);
    states.b06 = makeState("B06", identities);
    states.b07 = makeState("B07", identities);
    states.b08 = makeState("B08", identities, {
      analytics_results: [{ result_id: "fixture-real-result", metric_id: "views", value: 42, unit: "count", period_start: "2026-09-01", period_end: "2026-09-02", state: "VALIDATED", source_mode: "REAL", evidence_refs: [{ id: "fixture-provider-evidence", source: "provider:test-fixture", status: "VERIFIED", origin: "PROVIDER_DATA", basis: "OBSERVED", source_mode: "REAL", production_eligible: true }] }],
      evidence_refs: [{ id: "fixture-provider-evidence", source: "provider:test-fixture", status: "VERIFIED", origin: "PROVIDER_DATA", basis: "OBSERVED", source_mode: "REAL", production_eligible: true }],
    });
    states.b09 = makeState("B09", identities, {
      recommendations_considered: [{ recommendation_id: "fixture-rec", source_agent: "B09", proposal: "Investigate observed change", timestamp: "2026-09-06T02:00:00Z", adopted: false, rationale_if_rejected: "Insufficient causal evidence" }],
    });
    states.b10 = makeState("B10", identities);
    states.b11 = makeState("B11", identities, {
      compliance_checks: [{ check_id: "fixture-unresolved-compliance", compliance_rule_id: "rule-1", subject: { subject_id: "subject-1", subject_type: "B10_PROPOSAL", subject_version: "v1.0", subject_content_hash: identities.B10!.content_hash, affected_modules: ["B10"] }, status: "UNKNOWN", check_basis: "NO_EVIDENCE", findings: ["External compliance evidence not supplied"], finding_review_state: "UNREVIEWED", remediation_required: false, evidence_refs: [], provenance: { type: "INFERRED", decision_authority: "B11", timestamp: "2026-09-06T02:00:00Z", rationale: "No evidence means UNKNOWN" } }],
    });

    const reader: any = {};
    for (const module of Object.keys(states)) {
      reader[module] = {
        load: async (version: string) => version === "v1.0" ? states[module] : null,
        save: async () => {}, listVersions: async () => ["v1.0"], latest: async () => states[module],
      };
    }

    const branch = await createBranchState("v1.0","v1.0","v1.0","v1.0","v1.0","v1.0","v1.0","v1.0","v1.0","v1.0","v1.0", { upstreamReader: reader as B12UpstreamReader, now: () => "2026-09-06T03:00:00Z" });

    expect(branch.module_versions).toHaveLength(11);
    expect(branch.module_versions.every((version) => version.identity_status === "VERIFIED")).toBe(true);
    expect(branch.completeness_summary.structural_completeness).toBe(100);
    expect(branch.completeness_summary.structural_status).toBe("COMPLETE");
    expect(branch.completeness_summary.semantic_validity).toBe("UNKNOWN");
    expect(branch.completeness_summary.operational_readiness).toBe("NOT_READY");
    expect(branch.completeness_summary.semantic_findings.some((finding) => finding.includes("B11 compliance validity is unresolved"))).toBe(true);
    expect(branch.decisions_made.some((decision) => decision.decision_id === "fixture-user-decision")).toBe(true);
    expect(branch.recommendations_considered.some((recommendation) => recommendation.recommendation_id === "fixture-rec")).toBe(true);
    expect(branch.governance_events["decision-channel-role"]?.at(-1)?.state).toBe("CANONICAL");
    expect(states.b01.conflicts).toHaveLength(1);
    expect(branch.evidence_refs.some((ref) => ref.id === "fixture-uncertain-audience" && ref.status === "UNKNOWN")).toBe(true);
  });
});
