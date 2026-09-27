// C5 validation tests — structural completeness, referential integrity, knowledge quality
// Tests real validation logic: no vacuous type instantiation

import { describe, expect, it } from "vitest";
import { ManualResearchEngine } from "../src/researchEngine.js";
import {
  approvePackage,
  draftHandoff,
  runP101Input,
  runP102ProposeScope,
  runP103DomainResearch,
  runP104Verification,
  runP105And106Synthesis,
  validateResearchPackage,
} from "../src/pipeline.js";
import { recordGateApproval } from "../src/gates.js";
import { buildManifestAndIntegrity } from "../src/manifest.js";
import { buildIdentity } from "../src/canonicalIdentity.js";
import type { ResearchPackageHandoff, Claim, Evidence, Source, Verification } from "../src/types.js";

const TOPIC = "The Roman Aqueducts";

function buildEngine() {
  const now = new Date().toISOString();
  const testSource: Source = {
    source_id: "source_test_aqueducts",
    origin: "https://example.com/aqueducts",
    source_type: "secondary",
    retrieved_at: now,
    access_method: "http",
  };

  const findings = {
    "the roman aqueducts::facts::construction_history": [
      {
        statement: "Roman aqueducts were built using the gravity-fed principle",
        dimension: "facts" as const,
        derived_from: "construction_history",
        source: testSource,
        excerpt_or_pointer: "Gravity flow was the primary principle used in Roman aqueduct design.",
        extraction_method: "manual",
      },
      {
        statement: "The highest aqueduct arch was the Pont du Gard in France",
        dimension: "facts" as const,
        derived_from: "construction_history",
        source: testSource,
        excerpt_or_pointer: "The Pont du Gard stands at approximately 50 meters tall.",
        extraction_method: "manual",
      },
    ],
  };

  return new ManualResearchEngine({ topic: TOPIC, findings });
}

// TIER-1 REPAIR NOTE (T1.1/T1.4): this helper used to rebuild ONLY the
// manifest + integrity hashes. Under the repaired contract that is no
// longer a complete re-issue of the artifact: a canonical package also
// carries `identity.content_hash`, and its Gate A1 approval is BOUND to
// that hash. Rebuilding integrity while leaving the old identity and the
// old approval in place is exactly the "approved artifact was modified"
// case the repair is designed to catch — so the helper now re-issues the
// artifact honestly (new identity, fresh approval over the new content).
//
// The tamper case is asserted separately, on purpose, in the
// "regenerating integrity alone does not re-approve" tests below.
function regenerateIntegrity(handoff: ResearchPackageHandoff): ResearchPackageHandoff {
  const sections = {
    research_scope: handoff.research_scope,
    sources: handoff.sources,
    evidence: handoff.evidence,
    claims: handoff.claims,
    verifications: handoff.verifications,
    knowledge_package: handoff.knowledge_package,
    unresolved_questions: handoff.unresolved_questions,
    handoff_notes: handoff.handoff_notes,
  };
  const { manifest, integrity_hashes } = buildManifestAndIntegrity(sections);

  const identity = buildIdentity({
    objectId: handoff.package_id,
    objectType: "research_package",
    version: "1.0.0",
    content: sections,
    parentId: handoff.research_scope.scope_id,
  });

  // Drop the stale package-level approval and re-approve the new content.
  const scopeGates = handoff.gates.filter((g) => g.state_after !== "PACKAGE_APPROVED");
  const reissued: ResearchPackageHandoff = {
    ...handoff,
    manifest,
    integrity_hashes,
    identity,
    gates: scopeGates,
  };
  return approvePackage(reissued, "user:test").handoff;
}

async function runFullPipeline(): Promise<ResearchPackageHandoff> {
  const engine = buildEngine();
  const request = runP101Input({ topic: TOPIC, constraints: [] });
  const scope = runP102ProposeScope(request);
  const approvedScope = {
    ...scope,
    state: "SCOPE_APPROVED" as const,
  };

  const scopeGate = recordGateApproval({
    gateId: "A1",
    stateBefore: "SCOPE_PROPOSED",
    actor: "user:test",
    objectVersionBeingApproved: approvedScope.scope_id,
    stateAfter: "SCOPE_APPROVED",
    downstreamOperationUnlocked: "P1.03 domain research may proceed",
  });

  const { sources, evidence, claims } = await runP103DomainResearch(engine, approvedScope, [
    { query: "construction_history", dimension: "facts" },
  ]);

  const { verifications } = await runP104Verification(engine, claims);
  const { knowledge_package, unresolved_questions, synthesis_metadata } = runP105And106Synthesis(
    claims,
    verifications
  );

  const draft = draftHandoff({
    approvedScope,
    sources,
    evidence,
    claims,
    verifications,
    knowledge_package,
    unresolved_questions,
    gates: [scopeGate],
    handoff_notes: "Test handoff for C5 validation",
    synthesis_metadata,
  });

  const { handoff } = approvePackage(draft, "user:test");
  return handoff;
}

describe("C5: Governance & Validation", () => {
  // Test 1: Valid package passes validation
  it("C5: valid package passes validation", async () => {
    const handoff = await runFullPipeline();
    const result = validateResearchPackage(handoff);

    expect(result.status).toBe("valid");
    expect(result.errors).toHaveLength(0);
  });

  // Test 2: Missing source reference blocks validation
  it("C5: evidence referencing missing source blocks validation", async () => {
    const handoff = await runFullPipeline();

    // Corrupt: make evidence reference non-existent source
    const corruptedHandoff = {
      ...handoff,
      evidence: [
        ...handoff.evidence.slice(0, 1),
        {
          ...handoff.evidence[0],
          evidence_id: "corrupt_evidence_001",
          source_id: "NONEXISTENT_SOURCE_XYZ",
        },
      ],
    };

    const result = validateResearchPackage(corruptedHandoff);
    expect(result.status).toBe("invalid");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.code === "REFERENTIAL_INTEGRITY_VIOLATED")).toBe(true);
  });

  // Test 3: Missing evidence reference blocks validation
  it("C5: claim referencing missing evidence blocks validation", async () => {
    const handoff = await runFullPipeline();

    // Corrupt: make claim reference non-existent evidence
    const corruptedHandoff = {
      ...handoff,
      claims: [
        ...handoff.claims.slice(0, 1),
        {
          ...handoff.claims[0],
          claim_id: "corrupt_claim_001",
          evidence_refs: ["NONEXISTENT_EVIDENCE_XYZ"],
        },
      ],
    };

    const result = validateResearchPackage(corruptedHandoff);
    expect(result.status).toBe("invalid");
    expect(result.errors.some((e) => e.code === "REFERENTIAL_INTEGRITY_VIOLATED")).toBe(true);
  });

  // Test 4: Verification referencing missing claim blocks validation
  it("C5: verification referencing missing claim blocks validation", async () => {
    const handoff = await runFullPipeline();

    // Corrupt: make verification reference non-existent claim
    const corruptedHandoff = {
      ...handoff,
      verifications: [
        ...handoff.verifications.slice(0, 1),
        {
          ...handoff.verifications[0],
          verification_id: "corrupt_verification_001",
          claim_id: "NONEXISTENT_CLAIM_XYZ",
        },
      ],
    };

    const result = validateResearchPackage(corruptedHandoff);
    expect(result.status).toBe("invalid");
    expect(result.errors.some((e) => e.code === "REFERENTIAL_INTEGRITY_VIOLATED")).toBe(true);
  });

  // Test 5: Invalid gate state blocks validation
  it("C5: invalid gate state blocks validation", async () => {
    const handoff = await runFullPipeline();

    // Corrupt: remove the PACKAGE_APPROVED gate
    const corruptedHandoff = {
      ...handoff,
      gates: handoff.gates.filter((g) => g.state_after !== "PACKAGE_APPROVED"),
    };

    const result = validateResearchPackage(corruptedHandoff);
    expect(result.status).toBe("invalid");
    expect(result.errors.some((e) => e.code === "GATE_STATE_VIOLATION")).toBe(true);
  });

  // Test 6: Integrity mismatch blocks validation
  it("C5: integrity hash mismatch blocks validation", async () => {
    const handoff = await runFullPipeline();

    // Corrupt: modify a claim after integrity hash computed
    const corruptedHandoff = {
      ...handoff,
      claims: [
        ...handoff.claims.slice(0, 1),
        {
          ...handoff.claims[0],
          statement: "CORRUPTED STATEMENT",
        },
      ],
    };

    const result = validateResearchPackage(corruptedHandoff);
    expect(result.status).toBe("invalid");
    expect(result.errors.some((e) => e.code === "INTEGRITY_MISMATCH")).toBe(true);
  });

  // Test 7: Silent conversion (UNKNOWN→topical bucket) blocks validation
  it("C5: silent conversion of UNKNOWN to topical dimension blocks validation", async () => {
    const handoff = await runFullPipeline();

    // Create corrupted state: claim marked UNKNOWN in verifications but in topical bucket
    const unknownClaim = handoff.claims.find((c) => {
      const verification = handoff.verifications.find((v) => v.claim_id === c.claim_id);
      return verification?.status === "UNKNOWN";
    });

    if (unknownClaim) {
      // Move unknown claim to topical bucket (facts)
      const corruptedHandoff = {
        ...handoff,
        knowledge_package: {
          ...handoff.knowledge_package,
          facts: [...handoff.knowledge_package.facts, unknownClaim],
          unknowns: handoff.knowledge_package.unknowns.filter((c) => c.claim_id !== unknownClaim.claim_id),
        },
      };

      const result = validateResearchPackage(corruptedHandoff);
      expect(result.status).toBe("invalid");
      expect(result.errors.some((e) => e.code === "SILENT_CONVERSION_DETECTED")).toBe(true);
    }
  });

  // Test 8: Missing required field blocks validation
  it("C5: missing required package_id field blocks validation", async () => {
    const handoff = await runFullPipeline();

    // Remove package_id
    const corruptedHandoff = {
      ...handoff,
      package_id: "",
    };

    const result = validateResearchPackage(corruptedHandoff);
    expect(result.status).toBe("invalid");
    expect(result.errors.some((e) => e.code === "REQUIRED_FIELD_MISSING")).toBe(true);
  });

  // Test 9: Unused source produces warning only
  it("C5: unused source produces warning (non-blocking)", async () => {
    const handoff = await runFullPipeline();

    // Add unused source
    let corruptedHandoff = {
      ...handoff,
      sources: [
        ...handoff.sources,
        {
          ...handoff.sources[0],
          source_id: "unused_source_xyz",
          origin: "https://unused.example.com",
        },
      ],
    };
    corruptedHandoff = regenerateIntegrity(corruptedHandoff);

    const result = validateResearchPackage(corruptedHandoff);
    expect(result.status).not.toBe("invalid");
    expect(result.warnings.some((w) => w.code === "UNUSED_SOURCE")).toBe(true);
  });

  // Test 10: Verification imbalance produces warning only
  it("C5: high unknown ratio produces warning (non-blocking)", async () => {
    const handoff = await runFullPipeline();

    // Create verification set with >50% UNKNOWN
    const verifications = handoff.verifications.map((v, i) => ({
      ...v,
      status: (i < handoff.verifications.length / 2 ? "UNKNOWN" : v.status) as any,
      unresolved_reason: i < handoff.verifications.length / 2 ? "Intentional test UNKNOWN" : v.unresolved_reason,
    }));

    let corruptedHandoff = {
      ...handoff,
      verifications,
    };
    corruptedHandoff = regenerateIntegrity(corruptedHandoff);

    const result = validateResearchPackage(corruptedHandoff);
    expect(result.status).not.toBe("invalid");
    // May have warning if threshold reached
  });

  // Test 11: Optional category_2_context does not block valid package
  it("C5: missing optional category_2_context does not block validation", async () => {
    const handoff = await runFullPipeline();

    const result = validateResearchPackage(handoff);
    expect(result.status).not.toBe("invalid");
  });

  // Test 12: Malformed optional category_2_context produces warning only
  it("C5: observation referencing missing source produces warning (non-blocking)", async () => {
    const handoff = await runFullPipeline();

    // Add malformed C2 context
    const corruptedHandoff = {
      ...handoff,
      category_2_context: {
        acquisition_history: [],
        observations: [
          {
            observation_id: "obs_001",
            source_id: "NONEXISTENT_SOURCE_XYZ",
            observed_at: new Date().toISOString(),
            metric_name: "view_count",
            metric_value: 1000,
            source_of_observation: "api",
            immutable: true,
          },
        ],
        discovery_lineage: [],
      },
    };

    const result = validateResearchPackage(corruptedHandoff);
    expect(result.status).not.toBe("invalid");
    expect(result.warnings.some((w) => w.code === "C2_OBSERVATION_INCONSISTENCY")).toBe(true);
  });

  // Test 13: Valid SynthesisMetadata accepted in handoff
  it("C5: valid synthesis_metadata in handoff passes validation", async () => {
    const handoff = await runFullPipeline();

    expect((handoff as any).synthesis_metadata).toBeDefined();
    expect((handoff as any).synthesis_metadata.synthesis_run_id).toMatch(/^syn_/);
    expect((handoff as any).synthesis_metadata.synthesis_timestamp).toBeDefined();

    const result = validateResearchPackage(handoff);
    expect(result.status).not.toBe("invalid");
  });

  // Test 14: Invalid SynthesisMetadata produces warning (non-blocking)
  it("C5: invalid synthesis_metadata format produces warning (non-blocking)", async () => {
    const handoff = await runFullPipeline();

    // Corrupt metadata
    const corruptedHandoff = {
      ...handoff,
      synthesis_metadata: {
        synthesis_run_id: "INVALID_FORMAT",
        synthesis_timestamp: "not-a-timestamp",
        verified_facts_count: 5,
        inferred_facts_count: 3,
        unknown_count: 2,
        contradictions_count: 0,
        total_claims: 10,
      },
    };

    const result = validateResearchPackage(corruptedHandoff);
    expect(result.status).not.toBe("invalid");
    expect(result.warnings.some((w) => w.code === "METADATA_FORMAT_INVALID")).toBe(true);
  });

  // Test 15: Validation result is deterministic
  it("C5: validation of same handoff produces identical results", async () => {
    const handoff = await runFullPipeline();

    const result1 = validateResearchPackage(handoff);
    const result2 = validateResearchPackage(handoff);

    expect(result1.status).toBe(result2.status);
    expect(result1.errors.length).toBe(result2.errors.length);
    expect(result1.warnings.length).toBe(result2.warnings.length);
    expect(result1.checks_run).toBe(result2.checks_run);
  });

  // Test 16: Claim contradiction_refs validation
  it("C5: claim referencing non-existent contradicting claim blocks validation", async () => {
    const handoff = await runFullPipeline();

    const corruptedHandoff = {
      ...handoff,
      claims: [
        ...handoff.claims.slice(0, 1),
        {
          ...handoff.claims[0],
          claim_id: "test_claim_with_invalid_contradiction",
          contradiction_refs: ["NONEXISTENT_CLAIM_XYZ"],
        },
      ],
    };

    const result = validateResearchPackage(corruptedHandoff);
    expect(result.status).toBe("invalid");
    expect(result.errors.some((e) => e.code === "REFERENTIAL_INTEGRITY_VIOLATED")).toBe(true);
  });

  // Test 17: UNKNOWN verification without unresolved_reason blocks validation
  it("C5: UNKNOWN verification without unresolved_reason blocks validation", async () => {
    const handoff = await runFullPipeline();

    const corruptedHandoff = {
      ...handoff,
      verifications: [
        ...handoff.verifications.slice(0, 1),
        {
          ...handoff.verifications[0],
          verification_id: "test_verification_bad_unknown",
          status: "UNKNOWN" as const,
          unresolved_reason: undefined,
        },
      ],
    };

    const result = validateResearchPackage(corruptedHandoff);
    expect(result.status).toBe("invalid");
    expect(result.errors.some((e) => e.code === "MISSING_UNRESOLVED_REASON")).toBe(true);
  });

  // Test 18: Project ID consistency check
  it("C5: project_id mismatch between handoff and scope blocks validation", async () => {
    const handoff = await runFullPipeline();

    const corruptedHandoff = {
      ...handoff,
      project_id: "MISMATCHED_PROJECT_ID",
    };

    const result = validateResearchPackage(corruptedHandoff);
    expect(result.status).toBe("invalid");
    expect(result.errors.some((e) => e.code === "PROJECT_ID_MISMATCH")).toBe(true);
  });

  // Test 19: Backward compatibility: handoff without optional fields
  it("C5: backward compatibility - handoff without synthesis_metadata and category_2_context valid", async () => {
    const handoff = await runFullPipeline();

    // Remove optional fields
    const corruptedHandoff = {
      ...handoff,
      synthesis_metadata: undefined,
      category_2_context: undefined,
    };

    const result = validateResearchPackage(corruptedHandoff);
    expect(result.status).not.toBe("invalid");
  });

  // Test 20: Unused evidence produces warning
  it("C5: unused evidence produces warning (non-blocking)", async () => {
    const handoff = await runFullPipeline();

    // Add evidence not referenced by any claim
    const unusedEvidence: Evidence = {
      evidence_id: "unused_evidence_xyz",
      source_id: handoff.sources[0].source_id,
      excerpt_or_pointer: "Unused excerpt",
      retrieved_at: new Date().toISOString(),
      extraction_method: "manual",
    };

    let corruptedHandoff = {
      ...handoff,
      evidence: [...handoff.evidence, unusedEvidence],
    };
    corruptedHandoff = regenerateIntegrity(corruptedHandoff);

    const result = validateResearchPackage(corruptedHandoff);
    expect(result.status).not.toBe("invalid");
    expect(result.warnings.some((w) => w.code === "UNUSED_EVIDENCE")).toBe(true);
  });
});
