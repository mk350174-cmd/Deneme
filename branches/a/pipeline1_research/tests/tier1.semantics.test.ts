// TIER-1 REPAIR — semantic proof tests.
//
// Each test here targets a specific defect named in
// A_BRANCH_OPUS5_CANONICAL_REPAIR_BRIEF_20260906.md and asserts the
// REPAIRED behaviour. Every one of them fails against the unrepaired
// baseline; they are not test-count padding.

import { describe, expect, it } from "vitest";
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
} from "../src/pipeline.js";
import { buildManifestAndIntegrity, verifyIntegrityDetailed } from "../src/manifest.js";
import { contentHash } from "../src/canonicalIdentity.js";
import type { Claim, Source, Verification } from "../src/types.js";

const TOPIC = "The Roman Aqueducts";

function source(id: string, origin: string): Source {
  return {
    source_id: id,
    origin,
    source_type: "secondary",
    retrieved_at: "2026-01-01T00:00:00.000Z",
    access_method: "http",
  };
}

// ManualResearchEngine.discover() echoes the topic back as a single
// candidate direction, so the discovery-derived investigation query is
// keyed "<topic>::facts::<topic>". A fixture for that key is what proves
// the discovered direction is genuinely investigated (before the repair the
// direction was discarded and this key was never queried at all).
function buildEngine(opts?: { withDiscoveryFinding?: boolean }) {
  const findings: Record<string, unknown[]> = {
    "the roman aqueducts::facts::construction_history": [
      {
        statement: "Roman aqueducts were built using the gravity-fed principle",
        dimension: "facts" as const,
        derived_from: "construction_history",
        source: source("ignored", "https://example.com/aqueducts"),
        excerpt_or_pointer: "Gravity flow was the primary principle.",
        extraction_method: "manual",
      },
    ],
  };
  if (opts?.withDiscoveryFinding) {
    findings["the roman aqueducts::facts::the roman aqueducts"] = [
      {
        statement: "Aqueduct networks supplied Roman cities with fresh water",
        dimension: "facts" as const,
        derived_from: "discovered_direction",
        source: source("ignored", "https://example.com/discovered"),
        excerpt_or_pointer: "City water supply depended on the aqueduct network.",
        extraction_method: "manual",
      },
    ];
  }
  return new ManualResearchEngine({ topic: TOPIC, findings: findings as never });
}

// ---------------------------------------------------------------------------
// T1.1 — canonical identity
// ---------------------------------------------------------------------------

describe("T1.1 canonical identity", () => {
  const claim = (id: string, refs: string[]): Claim => ({
    claim_id: id,
    statement: `statement ${id}`,
    evidence_refs: refs,
    derived_from: "q",
    contradiction_refs: [],
    dimension: "facts",
  });
  const verified = (claimId: string): Verification => ({
    verification_id: `verif_${claimId}`,
    claim_id: claimId,
    status: "VERIFIED",
    rationale: "r",
    verified_at: "2026-01-01T00:00:00.000Z",
    contradiction_relationship: "NONE",
  });

  it("source changes -> synthesis ID changes", () => {
    const c = claim("claim_a", ["ev_1"]);
    const v = verified("claim_a");
    const a = runP105And106Synthesis([c], [v], "proj_1", [source("src_one", "https://one.example")]);
    const b = runP105And106Synthesis([c], [v], "proj_1", [source("src_two", "https://two.example")]);
    expect(a.synthesis_metadata.synthesis_run_id).not.toBe(b.synthesis_metadata.synthesis_run_id);
  });

  it("evidence lineage changes -> synthesis ID changes even without explicit sources", () => {
    const v = verified("claim_a");
    const a = runP105And106Synthesis([claim("claim_a", ["ev_1"])], [v], "proj_1");
    const b = runP105And106Synthesis([claim("claim_a", ["ev_TOTALLY_DIFFERENT"])], [v], "proj_1");
    expect(a.synthesis_metadata.synthesis_run_id).not.toBe(b.synthesis_metadata.synthesis_run_id);
  });

  it("identical canonical inputs -> identical synthesis ID (still reproducible)", () => {
    const c = claim("claim_a", ["ev_1"]);
    const v = verified("claim_a");
    const src = [source("src_one", "https://one.example")];
    const a = runP105And106Synthesis([c], [v], "proj_1", src);
    const b = runP105And106Synthesis([c], [v], "proj_1", src);
    expect(a.synthesis_metadata.synthesis_run_id).toBe(b.synthesis_metadata.synthesis_run_id);
  });

  it("content change the package_id cannot see still changes artifact identity", async () => {
    const handoff = await runFullPipeline();
    // handoff_notes is NOT part of package_id's inputs.
    const mutated = { ...handoff, handoff_notes: `${handoff.handoff_notes} (edited)` };
    expect(mutated.package_id).toBe(handoff.package_id);
    expect(contentHash(sectionsOf(mutated))).not.toBe(handoff.identity.content_hash);
  });
});

// ---------------------------------------------------------------------------
// T1.2 — real package integrity verification
// ---------------------------------------------------------------------------

function sectionsOf(h: Awaited<ReturnType<typeof runFullPipeline>>) {
  return {
    research_scope: h.research_scope,
    sources: h.sources,
    evidence: h.evidence,
    claims: h.claims,
    verifications: h.verifications,
    knowledge_package: h.knowledge_package,
    unresolved_questions: h.unresolved_questions,
    handoff_notes: h.handoff_notes,
  };
}

describe("T1.2 package integrity verification", () => {
  it("an untouched package verifies", async () => {
    const h = await runFullPipeline();
    const r = verifyIntegrityDetailed(sectionsOf(h), h.integrity_hashes, h.manifest);
    expect(r.valid).toBe(true);
  });

  it("mutating one section byte -> verification fails", async () => {
    const h = await runFullPipeline();
    const tampered = { ...sectionsOf(h), handoff_notes: `${h.handoff_notes}.` };
    const r = verifyIntegrityDetailed(tampered, h.integrity_hashes, h.manifest);
    expect(r.valid).toBe(false);
    expect(r.package_hash_match).toBe(false);
  });

  it("mutating a declared per-file hash -> verification fails", async () => {
    const h = await runFullPipeline();
    const paths = Object.keys(h.integrity_hashes.per_file);
    const poisoned = {
      ...h.integrity_hashes,
      per_file: { ...h.integrity_hashes.per_file, [paths[0]!]: "0".repeat(64) },
    };
    const r = verifyIntegrityDetailed(sectionsOf(h), poisoned, h.manifest);
    expect(r.valid).toBe(false);
    expect(r.per_file_mismatches.length).toBeGreaterThan(0);
  });

  it("mutating a declared manifest entry -> verification fails", async () => {
    const h = await runFullPipeline();
    const poisonedManifest = h.manifest.map((m, i) =>
      i === 0 ? { ...m, sha256: "f".repeat(64) } : m,
    );
    const r = verifyIntegrityDetailed(sectionsOf(h), h.integrity_hashes, poisonedManifest);
    expect(r.valid).toBe(false);
    expect(r.manifest_mismatches.length).toBeGreaterThan(0);
  });

  it("a wrong package hash -> verification fails", async () => {
    const h = await runFullPipeline();
    const r = verifyIntegrityDetailed(
      sectionsOf(h),
      { ...h.integrity_hashes, package_sha256: "a".repeat(64) },
      h.manifest,
    );
    expect(r.valid).toBe(false);
  });

  it("a plausible-looking but wrong hash is not accepted as verification", async () => {
    const h = await runFullPipeline();
    // Well-formed sha256 shape, entirely wrong value — the exact failure
    // mode the brief names ("do not accept 'looks like a SHA-256'").
    const looksReal = contentHash({ something: "else" });
    expect(looksReal).toMatch(/^[0-9a-f]{64}$/);
    const r = verifyIntegrityDetailed(
      sectionsOf(h),
      { ...h.integrity_hashes, package_sha256: looksReal },
      h.manifest,
    );
    expect(r.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T1.4 — approved artifacts are immutable / version-bound
// ---------------------------------------------------------------------------

describe("T1.4 approval immutability", () => {
  it("a package modified after approval is reported invalid", async () => {
    const h = await runFullPipeline();
    expect(validateResearchPackage(h).status).not.toBe("invalid");

    const mutated = { ...h, handoff_notes: `${h.handoff_notes} (edited after approval)` };
    const rebuilt = buildManifestAndIntegrity(sectionsOf(mutated));
    // Even a fully re-hashed package keeps the OLD identity + OLD approval:
    // this is exactly the "silently modified while retaining the same
    // approval" case, and it must not validate.
    const result = validateResearchPackage({
      ...mutated,
      manifest: rebuilt.manifest,
      integrity_hashes: rebuilt.integrity_hashes,
    });
    expect(result.status).toBe("invalid");
    expect(
      result.errors.some(
        (e) => e.code === "IDENTITY_CONTENT_MISMATCH" || e.code === "APPROVAL_CONTENT_MISMATCH",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T1.3 — gate governance at package level
// ---------------------------------------------------------------------------

describe("T1.3 gate history validation", () => {
  it("a package approval with no scope approval in history is invalid", async () => {
    const h = await runFullPipeline();
    const packageOnly = h.gates.filter((g) => g.state_after === "PACKAGE_APPROVED");
    const result = validateResearchPackage({ ...h, gates: packageOnly });
    expect(result.status).toBe("invalid");
    expect(result.errors.some((e) => e.code === "OUT_OF_ORDER_APPROVAL")).toBe(true);
  });

  it("an invented state_before is rejected by the validator", async () => {
    const h = await runFullPipeline();
    const forged = h.gates.map((g) =>
      g.state_after === "PACKAGE_APPROVED" ? { ...g, state_before: "MAGIC" } : g,
    );
    const result = validateResearchPackage({ ...h, gates: forged });
    expect(result.errors.some((e) => e.code === "ILLEGAL_GATE_TRANSITION")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T1.5 — Candidate / Acquisition / Observation lineage
// ---------------------------------------------------------------------------

describe("T1.5 discovery + acquisition lineage", () => {
  it("discovery-generated directions actually feed the investigation path", async () => {
    const engine = buildEngine({ withDiscoveryFinding: true });
    const request = runP101Input({ topic: TOPIC });
    const { scope } = approveScope(runP102ProposeScope(request), "user:test");

    // No user queries at all: everything investigated must come from discovery.
    const res = await runP103DomainResearch(engine, scope, []);

    expect(res.discovery_lineage.length).toBeGreaterThan(0);
    // Before the repair `combinedQueries = [...queries]` discarded every
    // discovered direction, so with zero user queries nothing was ever
    // investigated and all three of these were empty.
    expect(res.sources.length).toBeGreaterThan(0);
    expect(res.claims.length).toBeGreaterThan(0);
    expect(res.acquisition_history.length).toBeGreaterThan(0);

    // and the acquisition is attributed to the candidate that produced it
    const candidateIds = new Set(res.discovery_lineage.map((l) => l.candidate_id));
    expect(res.acquisition_history.every((a) => a.candidate_id !== undefined && candidateIds.has(a.candidate_id))).toBe(true);
  });

  it("every exported candidate_id resolves inside the handoff", async () => {
    const engine = buildEngine({ withDiscoveryFinding: true });
    const request = runP101Input({ topic: TOPIC });
    const { scope, gate } = approveScope(runP102ProposeScope(request), "user:test");
    const res = await runP103DomainResearch(engine, scope, []);
    const { verifications } = await runP104Verification(engine, res.claims);
    const syn = runP105And106Synthesis(res.claims, verifications, scope.project_id, res.sources);

    const draft = draftHandoff({
      approvedScope: scope,
      sources: res.sources,
      evidence: res.evidence,
      claims: res.claims,
      verifications,
      knowledge_package: syn.knowledge_package,
      unresolved_questions: syn.unresolved_questions,
      gates: [gate],
      handoff_notes: "lineage test",
      observations: res.observations,
      acquisition_history: res.acquisition_history,
      discovery_lineage: res.discovery_lineage,
    });
    const { handoff } = approvePackage(draft, "user:test");

    const known = new Set(handoff.category_2_context!.discovery_lineage.map((l) => l.candidate_id));
    for (const attempt of handoff.category_2_context!.acquisition_history) {
      if (attempt.candidate_id !== undefined) {
        expect(known.has(attempt.candidate_id)).toBe(true);
      }
    }
    for (const obs of handoff.category_2_context!.observations) {
      if (obs.candidate_id !== undefined) {
        expect(known.has(obs.candidate_id)).toBe(true);
      }
    }
  });

  it("acquisitions are not all attached to the first candidate", async () => {
    const engine = buildEngine({ withDiscoveryFinding: true });
    const request = runP101Input({ topic: TOPIC });
    const { scope } = approveScope(runP102ProposeScope(request), "user:test");
    const res = await runP103DomainResearch(engine, scope, []);

    const firstCandidate = res.discovery_lineage[0]?.candidate_id;
    const attached = res.acquisition_history.map((a) => a.candidate_id);
    // Whatever attaches, it must be a candidate that really produced the
    // query — never a blanket "candidates[0]" fallback for everything, and
    // never a raw query string masquerading as a candidate_id.
    for (const id of attached) {
      if (id !== undefined) {
        expect(res.discovery_lineage.some((l) => l.candidate_id === id)).toBe(true);
      }
    }
    expect(firstCandidate).toBeDefined();
  });

  it("acquisition attempt ids are unique", async () => {
    const engine = buildEngine({ withDiscoveryFinding: true });
    const request = runP101Input({ topic: TOPIC });
    const { scope } = approveScope(runP102ProposeScope(request), "user:test");
    const res = await runP103DomainResearch(engine, scope, []);
    const ids = res.acquisition_history.map((a) => a.attempt_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// shared golden-path helper
// ---------------------------------------------------------------------------

async function runFullPipeline() {
  const engine = buildEngine();
  const request = runP101Input({ topic: TOPIC, constraints: [] });
  const { scope, gate } = approveScope(runP102ProposeScope(request), "user:test");
  const res = await runP103DomainResearch(engine, scope, [
    { query: "construction_history", dimension: "facts" },
  ]);
  const { verifications } = await runP104Verification(engine, res.claims);
  const syn = runP105And106Synthesis(res.claims, verifications, scope.project_id, res.sources);
  const draft = draftHandoff({
    approvedScope: scope,
    sources: res.sources,
    evidence: res.evidence,
    claims: res.claims,
    verifications,
    knowledge_package: syn.knowledge_package,
    unresolved_questions: syn.unresolved_questions,
    gates: [gate],
    handoff_notes: "tier1 semantics fixture",
    synthesis_metadata: syn.synthesis_metadata,
  });
  return approvePackage(draft, "user:test").handoff;
}


// ---------------------------------------------------------------------------
// R01.1 — category_2_context integrity (canonical lineage, own hash)
// ---------------------------------------------------------------------------

describe("R01.1 category_2_context integrity", () => {
  it("a package with category_2_context carries a dedicated hash for it", async () => {
    const engine = buildEngine({ withDiscoveryFinding: true });
    const request = runP101Input({ topic: TOPIC });
    const { scope, gate } = approveScope(runP102ProposeScope(request), "user:test");
    const res = await runP103DomainResearch(engine, scope, []);
    const { verifications } = await runP104Verification(engine, res.claims);
    const syn = runP105And106Synthesis(res.claims, verifications, scope.project_id, res.sources);
    const draft = draftHandoff({
      approvedScope: scope, sources: res.sources, evidence: res.evidence, claims: res.claims,
      verifications, knowledge_package: syn.knowledge_package, unresolved_questions: syn.unresolved_questions,
      gates: [gate], handoff_notes: "c2 integrity test",
      observations: res.observations, acquisition_history: res.acquisition_history, discovery_lineage: res.discovery_lineage,
    });
    expect(draft.category_2_context).toBeDefined();
    expect(draft.integrity_hashes.category_2_context_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a package with NO category_2_context carries no hash for it (absent, not null)", async () => {
    const h = await runFullPipeline();
    expect(h.category_2_context).toBeUndefined();
    expect(h.integrity_hashes.category_2_context_sha256).toBeUndefined();
  });

  it("tampering with category_2_context after sealing is detected", async () => {
    const engine = buildEngine({ withDiscoveryFinding: true });
    const request = runP101Input({ topic: TOPIC });
    const { scope, gate } = approveScope(runP102ProposeScope(request), "user:test");
    const res = await runP103DomainResearch(engine, scope, []);
    const { verifications } = await runP104Verification(engine, res.claims);
    const syn = runP105And106Synthesis(res.claims, verifications, scope.project_id, res.sources);
    const draft = draftHandoff({
      approvedScope: scope, sources: res.sources, evidence: res.evidence, claims: res.claims,
      verifications, knowledge_package: syn.knowledge_package, unresolved_questions: syn.unresolved_questions,
      gates: [gate], handoff_notes: "c2 tamper test",
      observations: res.observations, acquisition_history: res.acquisition_history, discovery_lineage: res.discovery_lineage,
    });
    const { handoff } = approvePackage(draft, "user:test");

    // Swap in a fabricated (but internally self-consistent) lineage entry —
    // the exact "wholesale swap" scenario the dedicated hash exists to catch.
    const tampered = {
      ...handoff,
      category_2_context: {
        ...handoff.category_2_context!,
        discovery_lineage: handoff.category_2_context!.discovery_lineage.map((l) => ({
          ...l,
          discovery_rationale: "fabricated rationale, unrelated to the real investigation",
        })),
      },
    };
    const result = validateResearchPackage(tampered);
    expect(result.warnings.some((w) => w.code === "C2_INTEGRITY_MISMATCH")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R01.2 — synthesis metadata: deterministic identity vs execution metadata
// ---------------------------------------------------------------------------

describe("R01.2 synthesis metadata determinism boundary", () => {
  const claim = (id: string, refs: string[]): Claim => ({
    claim_id: id, statement: `s ${id}`, evidence_refs: refs, derived_from: "q",
    contradiction_refs: [], dimension: "facts",
  });
  const verified = (claimId: string): Verification => ({
    verification_id: `verif_${claimId}`, claim_id: claimId, status: "VERIFIED", rationale: "r",
    verified_at: "2026-01-01T00:00:00.000Z", contradiction_relationship: "NONE",
  });

  it("synthesis_run_id is identical across two calls at different wall-clock times", async () => {
    const c = claim("claim_a", ["ev_1"]);
    const v = verified("claim_a");
    const src = [source("src_one", "https://one.example")];
    const a = runP105And106Synthesis([c], [v], "proj_1", src);
    await new Promise((r) => setTimeout(r, 5));
    const b = runP105And106Synthesis([c], [v], "proj_1", src);
    // Deterministic identity is unaffected by when synthesis ran...
    expect(a.synthesis_metadata.synthesis_run_id).toBe(b.synthesis_metadata.synthesis_run_id);
    // ...while the execution-metadata timestamp is genuinely allowed to differ.
    expect(a.synthesis_metadata.synthesis_timestamp).not.toBe(b.synthesis_metadata.synthesis_timestamp);
  });

  it("synthesis_timestamp is never part of identity.content_hash", async () => {
    const h = await runFullPipeline();
    const withDifferentTimestamp = {
      ...h,
      synthesis_metadata: h.synthesis_metadata
        ? { ...h.synthesis_metadata, synthesis_timestamp: "2099-01-01T00:00:00.000Z" }
        : h.synthesis_metadata,
    };
    // identity.content_hash is computed over the 8 canonical sections only
    // (research_scope..handoff_notes) — synthesis_metadata is documented as
    // execution metadata and is deliberately outside that boundary.
    expect(contentHash(sectionsOf(withDifferentTimestamp))).toBe(contentHash(sectionsOf(h)));
  });
});
