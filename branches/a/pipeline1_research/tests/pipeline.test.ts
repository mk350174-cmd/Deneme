// Golden-example end-to-end test: topic -> P1.01 -> ... -> P1.07 -> Research
// Package, per BUILD_PLAN.md's test ladder ("golden example test") and the
// architecture doc's P1 acceptance criteria.

import { describe, expect, it } from "vitest";
import { GateStateError } from "../src/errors.js";
import { ManualResearchEngine } from "../src/researchEngine.js";
import {
  approvePackage,
  approveScope,
  draftHandoff,
  runP101Input,
  runP102ProposeScope,
  runP103DomainResearch,
  runP104Verification,
  runP105And106Synthesis,
  validateResearchPackage,
  requirePackageApproved,
} from "../src/pipeline.js";
import type { RawFinding } from "../src/researchEngine.js";

const TOPIC = "The Roman Aqueducts";

function buildEngine(): ManualResearchEngine {
  const now = new Date().toISOString();
  const source = (origin: string) => ({
    source_id: "",
    origin,
    source_type: "secondary" as const,
    retrieved_at: now,
    access_method: "manual_entry",
  });

  const findings: Record<string, RawFinding[]> = {
    "the roman aqueducts::facts::construction_history": [
      {
        statement: "The Aqua Appia, Rome's first aqueduct, was completed in 312 BC.",
        dimension: "facts",
        derived_from: "construction_history",
        source: source("https://example.org/frontinus-de-aquaeductu"),
        excerpt_or_pointer: "Frontinus records the Aqua Appia's completion in 312 BC.",
        extraction_method: "manual_entry",
      },
    ],
    "the roman aqueducts::quantitative::total_length": [
      {
        statement: "Rome's aqueduct network eventually exceeded 400 km in total length.",
        dimension: "quantitative",
        derived_from: "total_length",
        source: source("https://example.org/aqueduct-survey"),
        excerpt_or_pointer: "Combined length of the eleven aqueducts exceeds 400 km.",
        extraction_method: "manual_entry",
      },
    ],
    "the roman aqueducts::people::original_architect": [
      {
        statement: "The original architect of the first Aqua Appia is not reliably attested.",
        dimension: "people",
        derived_from: "original_architect",
        source: source("unknown"),
        excerpt_or_pointer: "",
        extraction_method: "manual_entry",
        unresolved_reason: "No surviving primary source names the architect.",
      },
    ],
  };

  // No explicit `verifications` supplied: the facts/quantitative claims
  // exercise ManualResearchEngine's default INFERRED path (evidence
  // present, no independent cross-check supplied), and the architect claim
  // exercises its default UNKNOWN path (no evidence_refs at all).
  return new ManualResearchEngine({ topic: TOPIC, findings });
}

async function runFullPipeline(actor = "user:mk350174") {
  const engine = buildEngine();

  const request = runP101Input({
    topic: TOPIC,
    question: "How was Rome supplied with water in antiquity?",
    constraints: ["focus on engineering, not politics"],
  });

  const proposedScope = runP102ProposeScope(request);
  const { scope: approvedScope, gate: scopeGate } = approveScope(proposedScope, actor);

  const { sources, evidence, claims } = await runP103DomainResearch(engine, approvedScope, [
    { query: "construction_history", dimension: "facts" },
    { query: "total_length", dimension: "quantitative" },
    { query: "original_architect", dimension: "people" },
  ]);

  const { verifications, explanations } = await runP104Verification(engine, claims);
  const { knowledge_package, unresolved_questions, synthesis_metadata } = runP105And106Synthesis(claims, verifications);

  const draft = draftHandoff({
    approvedScope,
    sources,
    evidence,
    claims,
    verifications,
    knowledge_package,
    unresolved_questions,
    gates: [scopeGate],
    handoff_notes: "Golden-example run for P1 acceptance testing.",
  });

  const { handoff } = approvePackage(draft, actor);
  return handoff;
}

describe("Pipeline 1 golden-example (P1.01 -> P1.07)", () => {
  it("produces a schema-complete Research Package handoff", async () => {
    const handoff = await runFullPipeline();

    expect(handoff.package_id).toMatch(/^rpkg_/);
    expect(handoff.schema_version).toBe("1.0.0");
    expect(handoff.project_id).toMatch(/^proj_/);
    expect(handoff.research_scope.state).toBe("SCOPE_APPROVED");
    expect(handoff.sources.length).toBeGreaterThan(0);
    expect(handoff.evidence.length).toBeGreaterThan(0);
    expect(handoff.claims.length).toBe(3);
    expect(handoff.verifications.length).toBe(3);
    expect(handoff.knowledge_package.verification_state_schema_version).toBe("v1");
    expect(handoff.manifest.length).toBeGreaterThan(0);
    expect(handoff.integrity_hashes.package_sha256).toBeTruthy();
    expect(handoff.handoff_notes).toContain("Golden-example");
  });

  it("buckets claims into their topical knowledge dimension", async () => {
    const handoff = await runFullPipeline();
    expect(handoff.knowledge_package.facts.length).toBe(1);
    expect(handoff.knowledge_package.quantitative.length).toBe(1);
  });

  // CONTRACT CHANGE (TIER-1 REPAIR T1.6 — canonical UNKNOWN semantics).
  //
  // Before the repair, synthesis filed an UNKNOWN claim into BOTH its
  // topical bucket and unknowns[]. P1's own validator rejected precisely
  // that shape (SILENT_CONVERSION_DETECTED + DUPLICATE_CLAIM_IN_BUCKETS),
  // so every real run containing one UNKNOWN claim produced a package P1
  // itself declared invalid. The canonical rule is now:
  //
  //     UNKNOWN claim -> unknowns[] ONLY, never a topical bucket.
  //
  // The "architect" claim in this fixture is a `people`-dimension claim
  // that verifies UNKNOWN, so `people` is now empty — this assertion is
  // the repaired semantics, not a relaxed expectation.
  it("T1.6: an UNKNOWN claim is filed in unknowns[] only, never in a topical bucket", async () => {
    const handoff = await runFullPipeline();

    const architectClaim = handoff.claims.find((c) => c.statement.includes("architect"))!;
    expect(architectClaim.dimension).toBe("people");

    const verification = handoff.verifications.find((v) => v.claim_id === architectClaim.claim_id);
    expect(verification?.status).toBe("UNKNOWN");

    // filed as unknown ...
    expect(handoff.knowledge_package.unknowns.map((c) => c.claim_id)).toContain(architectClaim.claim_id);
    // ... and NOT silently converted into a verified topical fact
    expect(handoff.knowledge_package.people.map((c) => c.claim_id)).not.toContain(architectClaim.claim_id);
    expect(handoff.knowledge_package.people.length).toBe(0);
  });

  // The synthesizer and the validator must agree. Before the repair this
  // exact package failed P1's own validation.
  it("T1.6: a package containing an UNKNOWN claim validates clean against P1's own validator", async () => {
    const handoff = await runFullPipeline();
    const result = validateResearchPackage(handoff);
    expect(result.errors.filter((e) => e.code === "SILENT_CONVERSION_DETECTED")).toHaveLength(0);
    expect(result.errors.filter((e) => e.code === "DUPLICATE_CLAIM_IN_BUCKETS")).toHaveLength(0);
    expect(result.status).not.toBe("invalid");
  });

  it("routes the unattested claim to unknowns/open_questions instead of fabricating an answer", async () => {
    const handoff = await runFullPipeline();
    const architectClaim = handoff.claims.find((c) => c.statement.includes("architect"));
    expect(architectClaim).toBeDefined();

    const verification = handoff.verifications.find((v) => v.claim_id === architectClaim!.claim_id);
    expect(verification?.status).toBe("UNKNOWN");
    expect(verification?.unresolved_reason).toBeTruthy();

    expect(handoff.knowledge_package.unknowns.map((c) => c.claim_id)).toContain(
      architectClaim!.claim_id,
    );
    expect(handoff.unresolved_questions.some((q) => q.includes("architect"))).toBe(true);
  });

  it("never fabricates a finding for a query the engine has no data for", async () => {
    const engine = buildEngine();
    const request = runP101Input({ topic: TOPIC });
    const { scope } = approveScope(runP102ProposeScope(request), "user:test");

    const { claims } = await runP103DomainResearch(engine, scope, [
      { query: "a_query_with_no_supplied_findings", dimension: "concepts" },
    ]);
    expect(claims).toHaveLength(0); // empty, not invented
  });

  it("is deterministic: re-running with identical input yields the same package_id and claim set", async () => {
    // package_id and claim_ids are derived only from project_id/scope_id/
    // content (ids.ts), so they reproduce exactly across separate runs.
    // integrity_hashes.package_sha256 is intentionally NOT compared here:
    // it covers verification/gate records, which carry real wall-clock
    // timestamps (verified_at, gate timestamp) that legitimately differ
    // between two separately-invoked runs — that is provenance working
    // correctly, not a determinism failure.
    const handoffA = await runFullPipeline();
    const handoffB = await runFullPipeline();
    expect(handoffA.package_id).toBe(handoffB.package_id);
    expect(handoffA.claims.map((c) => c.claim_id).sort()).toEqual(
      handoffB.claims.map((c) => c.claim_id).sort(),
    );
    expect(handoffA.claims.map((c) => c.statement).sort()).toEqual(
      handoffB.claims.map((c) => c.statement).sort(),
    );
  });

  it("enforces Gate A1 in code: package is unusable before approval, usable after", async () => {
    const engine = buildEngine();
    const request = runP101Input({ topic: TOPIC });
    const { scope: approvedScope, gate: scopeGate } = approveScope(
      runP102ProposeScope(request),
      "user:test",
    );
    const { sources, evidence, claims } = await runP103DomainResearch(engine, approvedScope, [
      { query: "construction_history", dimension: "facts" },
    ]);
    const { verifications } = await runP104Verification(engine, claims);
    const { knowledge_package, unresolved_questions, synthesis_metadata } = runP105And106Synthesis(claims, verifications);
    const draft = draftHandoff({
      approvedScope,
      sources,
      evidence,
      claims,
      verifications,
      knowledge_package,
      unresolved_questions,
      gates: [scopeGate],
    });

    expect(() => requirePackageApproved(draft)).toThrow(GateStateError);

    const { handoff } = approvePackage(draft, "user:test");
    expect(() => requirePackageApproved(handoff)).not.toThrow();
  });

  it("C1: a real P1.04 run produces a VerificationExplanation for each non-VERIFIED claim, correlated by verification_id", async () => {
    const engine = buildEngine();
    const request = runP101Input({ topic: TOPIC });
    const { scope: approvedScope } = approveScope(runP102ProposeScope(request), "user:test");
    const { claims } = await runP103DomainResearch(engine, approvedScope, [
      { query: "construction_history", dimension: "facts" }, // -> INFERRED
      { query: "original_architect", dimension: "people" }, // -> UNKNOWN
    ]);

    const { verifications, explanations } = await runP104Verification(engine, claims);

    // Neither fixture claim resolves to VERIFIED (buildEngine's own doc
    // comment: facts/quantitative -> INFERRED, architect -> UNKNOWN), so
    // both should have produced a real explanation — proving explanations
    // are actually generated by a real run, not just definable in isolation.
    expect(verifications).toHaveLength(2);
    expect(explanations).toHaveLength(2);
    for (const verification of verifications) {
      const explanation = explanations.find((e) => e.verification_id === verification.verification_id);
      expect(explanation).toBeDefined();
    }

    const architectVerification = verifications.find((v) => v.status === "UNKNOWN")!;
    const architectExplanation = explanations.find((e) => e.verification_id === architectVerification.verification_id)!;
    expect(architectExplanation.uncertainty_reason).toBe(architectVerification.unresolved_reason);
    expect(architectExplanation.missing_evidence.length).toBeGreaterThan(0);
  });

  // --- P1.05 Category 4: Synthesis Metadata & Determinism ---

  it("C4: synthesis_run_id is deterministic (same inputs → same run_id)", async () => {
    const handoffA = await runFullPipeline();
    const metadataA = (handoffA.knowledge_package as any).synthesis_metadata;

    const handoffB = await runFullPipeline();
    const metadataB = (handoffB.knowledge_package as any).synthesis_metadata;

    // Same inputs → same synthesis_run_id (reproducible identity)
    expect(metadataA?.synthesis_run_id).toBe(metadataB?.synthesis_run_id);
  });

  it("C4: knowledge_package facts are sorted by claim_id (deterministic ordering)", async () => {
    const handoff = await runFullPipeline();
    const factIds = handoff.knowledge_package.facts.map((c) => c.claim_id);

    // Facts should be sorted lexicographically by claim_id
    expect(factIds).toEqual([...factIds].sort());
  });

  it("C4: open_questions are sorted lexicographically (deterministic ordering)", async () => {
    const handoff = await runFullPipeline();
    const questions = handoff.unresolved_questions;

    if (questions.length > 1) {
      expect(questions).toEqual([...questions].sort());
    }
  });
});

describe("P1.02 Improvement (P1-A): User-Seeded Scope Discovery", () => {
  const TOPIC = "Ancient Roman History";

  it("uses user_example_references to narrow candidate_source_families when provided", () => {
    const userSources = [
      "https://example.org/stanford-ancient-rome",
      "https://youtube.com/@classicalhistory",
      "Tacitus_Histories_primary_source.pdf",
    ];

    const request = runP101Input({
      topic: TOPIC,
      user_example_references: userSources,
    });

    const scope = runP102ProposeScope(request);

    // When user_example_references is provided, they populate candidate_source_families
    expect(scope.candidate_source_families).toContain(userSources[0]);
    expect(scope.candidate_source_families).toContain(userSources[1]);
    expect(scope.candidate_source_families).toContain(userSources[2]);
  });

  it("falls back to optional_references when user_example_references is empty", () => {
    const legacySources = [
      "https://example.org/legacy-source",
    ];

    const request = runP101Input({
      topic: TOPIC,
      optional_references: legacySources,
      user_example_references: [], // explicit empty
    });

    const scope = runP102ProposeScope(request);

    // Should use optional_references when user_example_references is empty
    expect(scope.candidate_source_families).toContain(legacySources[0]);
  });

  it("prefers user_example_references over optional_references when both supplied", () => {
    const userSources = ["https://example.org/user-provided"];
    const legacySources = ["https://example.org/legacy-source"];

    const request = runP101Input({
      topic: TOPIC,
      user_example_references: userSources,
      optional_references: legacySources,
    });

    const scope = runP102ProposeScope(request);

    // user_example_references should take precedence
    expect(scope.candidate_source_families).toContain(userSources[0]);
    expect(scope.candidate_source_families).not.toContain(legacySources[0]);
  });

  it("combines user_example_references with constraints in candidate_source_families", () => {
    const userSources = ["https://example.org/user-provided"];
    const constraints = ["focus on engineering", "primary sources only"];

    const request = runP101Input({
      topic: TOPIC,
      user_example_references: userSources,
      constraints,
    });

    const scope = runP102ProposeScope(request);

    // Both user_example_references and constraints should be present
    expect(scope.candidate_source_families).toContain(userSources[0]);
    expect(scope.candidate_source_families.some((f) => f.includes("focus on engineering"))).toBe(true);
  });

  it("produces consistent scope_id regardless of user_example_references", () => {
    const userSources = ["https://example.org/user-provided"];

    const requestWithoutSeeds = runP101Input({ topic: TOPIC });
    const requestWithSeeds = runP101Input({
      topic: TOPIC,
      user_example_references: userSources,
    });

    const scopeWithout = runP102ProposeScope(requestWithoutSeeds);
    const scopeWith = runP102ProposeScope(requestWithSeeds);

    // scope_id is deterministic based on project_id + topic, not on user_example_references
    expect(scopeWithout.scope_id).toBe(scopeWith.scope_id);
  });

  it("narrows scope when user_example_references is smaller than auto-discovery", () => {
    // Scenario: System would auto-discover 100 sources, but user provides 3 examples
    // After scope approval, P1.03 investigates within this narrower universe
    const userSources = [
      "https://example.org/high-confidence-1",
      "https://example.org/high-confidence-2",
      "https://example.org/high-confidence-3",
    ];

    const request = runP101Input({
      topic: TOPIC,
      user_example_references: userSources,
    });

    const scope = runP102ProposeScope(request);

    // Candidate source families should only contain the 3 user-provided sources
    // (plus constraints if any, but this test has none)
    const onlyUserSources = scope.candidate_source_families.filter((f) => !f.includes("constrained_by"));
    expect(onlyUserSources).toEqual(userSources);
  });
});

describe("Category 1: Research Intent & Context", () => {
  const TOPIC = "Climate Change Mitigation";

  describe("request_mode", () => {
    it("P1.01 default: request_mode defaults to STANDARD_RESEARCH when omitted", () => {
      const request = runP101Input({ topic: TOPIC });
      expect(request.request_mode).toBe("STANDARD_RESEARCH");
    });

    it("P1.01 explicit: request_mode CONCEPT_RESEARCH is preserved", () => {
      const request = runP101Input({ topic: TOPIC, request_mode: "CONCEPT_RESEARCH" });
      expect(request.request_mode).toBe("CONCEPT_RESEARCH");
    });

    it("P1.01 explicit: request_mode REFERENCE_ANALYSIS is preserved", () => {
      const request = runP101Input({ topic: TOPIC, request_mode: "REFERENCE_ANALYSIS" });
      expect(request.request_mode).toBe("REFERENCE_ANALYSIS");
    });

    it("P1.01 explicit: request_mode UPDATE_RESEARCH is preserved", () => {
      const request = runP101Input({ topic: TOPIC, request_mode: "UPDATE_RESEARCH" });
      expect(request.request_mode).toBe("UPDATE_RESEARCH");
    });

    it("P1.02: request_mode flows through to scope unchanged", () => {
      const request = runP101Input({ topic: TOPIC, request_mode: "CONCEPT_RESEARCH" });
      const scope = runP102ProposeScope(request);
      expect(scope.request_mode).toBe("CONCEPT_RESEARCH");
    });
  });

  describe("language context", () => {
    it("P1.01: language context (source_language, research_language, output_language) is preserved", () => {
      const request = runP101Input({
        topic: TOPIC,
        source_language: "en",
        research_language: "en",
        output_language: "tr",
      });
      expect(request.source_language).toBe("en");
      expect(request.research_language).toBe("en");
      expect(request.output_language).toBe("tr");
    });

    it("P1.02: language context flows through to scope unchanged", () => {
      const request = runP101Input({
        topic: TOPIC,
        source_language: "en",
        research_language: "en",
        output_language: "tr",
      });
      const scope = runP102ProposeScope(request);
      expect(scope.source_language).toBe("en");
      expect(scope.research_language).toBe("en");
      expect(scope.output_language).toBe("tr");
    });
  });

  describe("user_materials", () => {
    it("P1.01: user_materials with modality is preserved", () => {
      const materials = [
        { modality: "text" as const, content: "User provided context text" },
        { modality: "image" as const, content: "reference_image.jpg" },
      ];
      const request = runP101Input({ topic: TOPIC, user_materials: materials });
      expect(request.user_materials).toEqual(materials);
    });

    it("P1.02: user_materials flow through to scope unchanged", () => {
      const materials = [
        { modality: "video" as const, content: "sample_video.mp4" },
      ];
      const request = runP101Input({ topic: TOPIC, user_materials: materials });
      const scope = runP102ProposeScope(request);
      expect(scope.user_materials).toEqual(materials);
    });
  });

  describe("target_context", () => {
    it("P1.01: target_context is preserved", () => {
      const targetCtx = {
        channel: "youtube",
        project: "climate-doc-2026",
        editorial_destination: "main-channel",
      };
      const request = runP101Input({ topic: TOPIC, target_context: targetCtx });
      expect(request.target_context).toEqual(targetCtx);
    });

    it("P1.02: target_context flows through to scope unchanged", () => {
      const targetCtx = {
        type: "channel",
        channel: "climate-science",
      };
      const request = runP101Input({ topic: TOPIC, target_context: targetCtx });
      const scope = runP102ProposeScope(request);
      expect(scope.target_context).toEqual(targetCtx);
    });
  });

  describe("backward compatibility & determinism", () => {
    it("backward compatibility: request without Category 1 fields still produces valid scope", () => {
      const request = runP101Input({
        topic: TOPIC,
        question: "How can we reduce carbon emissions?",
        constraints: ["focus on technology"],
      });
      const scope = runP102ProposeScope(request);

      // Should have defaults for Category 1 fields
      expect(scope.request_mode).toBe("STANDARD_RESEARCH");
      expect(scope.source_language).toBeUndefined();
      expect(scope.research_language).toBeUndefined();
      expect(scope.output_language).toBeUndefined();
      expect(scope.user_materials).toBeUndefined();
      expect(scope.target_context).toBeUndefined();

      // Should have all existing fields intact
      expect(scope.topic).toBe(TOPIC);
      expect(scope.constraints).toEqual(["focus on technology"]);
      expect(scope.state).toBe("SCOPE_PROPOSED");
    });

    it("determinism: Category 1 fields do NOT affect scope_id generation", () => {
      const baseRequest = runP101Input({ topic: TOPIC });
      const withCategory1 = runP101Input({
        topic: TOPIC,
        request_mode: "CONCEPT_RESEARCH",
        source_language: "en",
        research_language: "en",
        output_language: "tr",
        user_materials: [{ modality: "text", content: "test" }],
        target_context: { channel: "youtube" },
      });

      const baseScope = runP102ProposeScope(baseRequest);
      const withCategory1Scope = runP102ProposeScope(withCategory1);

      // scope_id must be identical (determinism preserved)
      expect(baseScope.scope_id).toBe(withCategory1Scope.scope_id);

      // But Category 1 fields differ
      expect(baseScope.request_mode).not.toBe(withCategory1Scope.request_mode);
      expect(baseScope.target_context).not.toEqual(withCategory1Scope.target_context);
    });
  });
});

describe("P1 Category 2: Discovery & Acquisition (C2)", () => {
  const TOPIC = "Time-lapse Photography";

  it("records discovery lineage from engine.discover() and exports in category_2_context", async () => {
    const engine = new ManualResearchEngine({
      topic: TOPIC,
      findings: {
        "time-lapse photography::concepts::optical_principles": [
          {
            statement: "Time-lapse compression requires consistent frame intervals.",
            dimension: "concepts",
            derived_from: "optical_principles",
            source: {
              source_id: "",
              origin: "https://example.org/optics",
              source_type: "secondary",
              retrieved_at: new Date().toISOString(),
              access_method: "manual_entry",
            },
            excerpt_or_pointer: "Frame interval consistency.",
            extraction_method: "manual_entry",
          },
        ],
      },
    });

    const request = runP101Input({ topic: TOPIC });
    const { scope: approvedScope, gate: scopeGate } = approveScope(
      runP102ProposeScope(request),
      "user:test",
    );

    const { sources, evidence, claims, observations, acquisition_history, discovery_lineage } =
      await runP103DomainResearch(engine, approvedScope, [
        { query: "optical_principles", dimension: "concepts" },
      ]);

    const { verifications } = await runP104Verification(engine, claims);
    const { knowledge_package, unresolved_questions, synthesis_metadata } = runP105And106Synthesis(claims, verifications);

    // Key C2 verification: Pass Category 2 data to draftHandoff
    const draft = draftHandoff({
      approvedScope,
      sources,
      evidence,
      claims,
      verifications,
      knowledge_package,
      unresolved_questions,
      gates: [scopeGate],
      // Category 2 optional fields:
      observations,
      acquisition_history,
      discovery_lineage,
    });

    // Verify category_2_context is populated
    expect(draft.category_2_context).toBeDefined();
    expect(draft.category_2_context?.discovery_lineage.length).toBeGreaterThan(0);
    expect(draft.category_2_context?.discovery_lineage[0].topic).toBe(TOPIC);
    expect(draft.category_2_context?.discovery_lineage[0].discovery_provider).toBe("research-engine");

    // Verify backward compatibility: 14 frozen fields intact
    expect(draft.package_id).toMatch(/^rpkg_/);
    expect(draft.schema_version).toBe("1.0.0");
    expect(draft.project_id).toMatch(/^proj_/);
  });

  it("exports acquisition_history when sources are acquired", async () => {
    const engine = new ManualResearchEngine({
      topic: TOPIC,
      findings: {
        "time-lapse photography::concepts::optical_principles": [
          {
            statement: "Frame intervals matter.",
            dimension: "concepts",
            derived_from: "optical_principles",
            source: {
              source_id: "",
              origin: "https://example.org/optics",
              source_type: "secondary",
              retrieved_at: new Date().toISOString(),
              access_method: "manual_entry",
            },
            excerpt_or_pointer: "Frame data.",
            extraction_method: "manual_entry",
          },
        ],
      },
    });

    const request = runP101Input({ topic: TOPIC });
    const { scope: approvedScope, gate: scopeGate } = approveScope(
      runP102ProposeScope(request),
      "user:test",
    );

    const { sources, evidence, claims, acquisition_history } = await runP103DomainResearch(
      engine,
      approvedScope,
      [{ query: "optical_principles", dimension: "concepts" }],
    );

    expect(acquisition_history.length).toBeGreaterThan(0);

    const { verifications } = await runP104Verification(engine, claims);
    const { knowledge_package, unresolved_questions, synthesis_metadata } = runP105And106Synthesis(claims, verifications);

    const draft = draftHandoff({
      approvedScope,
      sources,
      evidence,
      claims,
      verifications,
      knowledge_package,
      unresolved_questions,
      gates: [scopeGate],
      acquisition_history,
    });

    // Verify acquisition_history is captured in handoff
    expect(draft.category_2_context).toBeDefined();
    expect(draft.category_2_context?.acquisition_history.length).toBeGreaterThan(0);
    const attempt = draft.category_2_context?.acquisition_history[0];
    expect(attempt?.status).toBe("succeeded");
    expect(attempt?.resolved_source_id).toBeDefined();
    expect(attempt?.provider).toBe("research-engine");
  });

  it("records observations when sources are acquired", async () => {
    const engine = new ManualResearchEngine({
      topic: TOPIC,
      findings: {
        "time-lapse photography::concepts::optical_principles": [
          {
            statement: "Frame intervals matter.",
            dimension: "concepts",
            derived_from: "optical_principles",
            source: {
              source_id: "",
              origin: "https://example.org/optics",
              source_type: "secondary",
              retrieved_at: new Date().toISOString(),
              access_method: "manual_entry",
            },
            excerpt_or_pointer: "Frame data.",
            extraction_method: "manual_entry",
          },
        ],
      },
    });

    const request = runP101Input({ topic: TOPIC });
    const { scope: approvedScope, gate: scopeGate } = approveScope(
      runP102ProposeScope(request),
      "user:test",
    );

    const { sources, evidence, claims, observations } = await runP103DomainResearch(
      engine,
      approvedScope,
      [{ query: "optical_principles", dimension: "concepts" }],
    );

    expect(observations.length).toBeGreaterThan(0);

    const { verifications } = await runP104Verification(engine, claims);
    const { knowledge_package, unresolved_questions, synthesis_metadata } = runP105And106Synthesis(claims, verifications);

    const draft = draftHandoff({
      approvedScope,
      sources,
      evidence,
      claims,
      verifications,
      knowledge_package,
      unresolved_questions,
      gates: [scopeGate],
      observations,
    });

    // Verify observations are captured in handoff
    expect(draft.category_2_context).toBeDefined();
    expect(draft.category_2_context?.observations.length).toBeGreaterThan(0);
    const obs = draft.category_2_context?.observations[0];
    expect(obs?.metric_name).toBe("acquired");
    expect(obs?.source_id).toBeDefined();
    expect(obs?.immutable).toBe(true);
  });

  it("observation determinism: same timestamp produces same observation_id", async () => {
    // Direct ID function test: same inputs produce same ID
    const { stableObservationId } = await import("../src/ids.js");

    const timestamp = "2026-09-03T10:00:00.000Z";
    const sourceId = "src_test123";
    const metric = "views";

    const id1 = stableObservationId(sourceId, metric, timestamp);
    const id2 = stableObservationId(sourceId, metric, timestamp);

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^obs_/);
  });

  it("observation determinism: different timestamps produce different observation_ids", async () => {
    const { stableObservationId } = await import("../src/ids.js");

    const sourceId = "src_test123";
    const metric = "views";
    const timestamp1 = "2026-08-01T10:00:00.000Z";
    const timestamp2 = "2026-09-01T10:00:00.000Z";

    const id1 = stableObservationId(sourceId, metric, timestamp1);
    const id2 = stableObservationId(sourceId, metric, timestamp2);

    expect(id1).not.toBe(id2);
  });

  it("observation temporal scenario: coexisting observations at different times", async () => {
    const engine = new ManualResearchEngine({
      topic: TOPIC,
      findings: {
        "time-lapse photography::quantitative::frame_rate": [
          {
            statement: "Common frame rates: 24, 30, 60 fps.",
            dimension: "quantitative",
            derived_from: "frame_rate",
            source: {
              source_id: "",
              origin: "https://example.org/fps-standards",
              source_type: "secondary",
              retrieved_at: new Date().toISOString(),
              access_method: "manual_entry",
            },
            excerpt_or_pointer: "Frame rate standards.",
            extraction_method: "manual_entry",
          },
        ],
      },
    });

    const request = runP101Input({ topic: TOPIC });
    const { scope: approvedScope } = approveScope(
      runP102ProposeScope(request),
      "user:test",
    );

    const { observations } = await runP103DomainResearch(
      engine,
      approvedScope,
      [{ query: "frame_rate", dimension: "quantitative" }],
    );

    // When sources are acquired, observations are recorded
    expect(observations.length).toBeGreaterThan(0);

    // All observations should be immutable snapshots
    for (const obs of observations) {
      expect(obs.immutable).toBe(true);
      expect(obs.observed_at).toBeDefined();
      // observation_id should match the consistent timestamp
      expect(obs.observation_id).toMatch(/^obs_/);
    }
  });

  it("category_2_context is optional: backward compatible handoff without C2 data", async () => {
    const engine = new ManualResearchEngine({
      topic: TOPIC,
      findings: {},
    });

    const request = runP101Input({ topic: TOPIC });
    const { scope: approvedScope, gate: scopeGate } = approveScope(
      runP102ProposeScope(request),
      "user:test",
    );

    const { sources, evidence, claims } = await runP103DomainResearch(engine, approvedScope, []);
    const { verifications } = await runP104Verification(engine, claims);
    const { knowledge_package, unresolved_questions, synthesis_metadata } = runP105And106Synthesis(claims, verifications);

    // Don't pass C2 optional fields
    const draft = draftHandoff({
      approvedScope,
      sources,
      evidence,
      claims,
      verifications,
      knowledge_package,
      unresolved_questions,
      gates: [scopeGate],
    });

    // category_2_context should be undefined when no C2 data provided
    expect(draft.category_2_context).toBeUndefined();

    // But the 14 frozen fields should still work
    expect(draft.package_id).toMatch(/^rpkg_/);
    expect(draft.schema_version).toBe("1.0.0");
  });

  it("Candidate[] is not exported in handoff", async () => {
    const engine = new ManualResearchEngine({
      topic: TOPIC,
      findings: {
        [TOPIC + "::concepts::optical_principles"]: [
          {
            statement: "Frame intervals matter.",
            dimension: "concepts",
            derived_from: "optical_principles",
            source: {
              source_id: "",
              origin: "https://example.org/optics",
              source_type: "secondary",
              retrieved_at: new Date().toISOString(),
              access_method: "manual_entry",
            },
            excerpt_or_pointer: "Frame data.",
            extraction_method: "manual_entry",
          },
        ],
      },
    });

    const request = runP101Input({ topic: TOPIC });
    const { scope: approvedScope, gate: scopeGate } = approveScope(
      runP102ProposeScope(request),
      "user:test",
    );

    const { sources, evidence, claims, discovery_lineage } = await runP103DomainResearch(
      engine,
      approvedScope,
      [{ query: "optical_principles", dimension: "concepts" }],
    );

    const { verifications } = await runP104Verification(engine, claims);
    const { knowledge_package, unresolved_questions, synthesis_metadata } = runP105And106Synthesis(claims, verifications);

    const draft = draftHandoff({
      approvedScope,
      sources,
      evidence,
      claims,
      verifications,
      knowledge_package,
      unresolved_questions,
      gates: [scopeGate],
      discovery_lineage,
    });

    // Candidate[] must NOT be accessible from handoff
    // @ts-expect-error — candidates should not exist on handoff
    expect(draft.candidates).toBeUndefined();

    // But discovery_lineage (which describes how candidates were found) IS accessible
    expect(draft.category_2_context?.discovery_lineage).toBeDefined();
  });
});
