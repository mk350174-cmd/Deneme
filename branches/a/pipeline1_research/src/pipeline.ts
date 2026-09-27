// P1 orchestration — implements P1.01 through P1.07 as one coherent block
// per docs/architecture/01_PIPELINE_1_ARCHITECTURE.md. Each exported
// function corresponds to one stage of the canonical sequence; runPipeline1
// composes them for the golden-path/tests.

import { ValidationError } from "./errors.js";
import { buildVerificationExplanation } from "./explainability.js";
import { recordGateApproval, requireGateState } from "./gates.js";
import {
  sha256,
  stableAcquisitionAttemptId,
  stableCandidateId,
  stableClaimId,
  stableEvidenceId,
  stableObservationId,
  stablePackageId,
  stableProjectId,
  stableScopeId,
  stableSourceId,
  stableVerificationId,
} from "./ids.js";
import { buildIdentity, contentHash } from "./canonicalIdentity.js";
import { buildManifestAndIntegrity } from "./manifest.js";
import type { ResearchEngine } from "./researchEngine.js";
import { redactSecrets } from "./secretGuard.js";
import { validateResearchPackage } from "./validation.js";
import type {
  AcquisitionAttempt,
  Candidate,
  CandidateLineage,
  Category2Context,
  Claim,
  Evidence,
  GateApprovalRecord,
  KnowledgePackage,
  Observation,
  RequestMode,
  ResearchPackageHandoff,
  ResearchRequest,
  ResearchScope,
  Source,
  SynthesisMetadata,
  TargetContext,
  UserMaterial,
  Verification,
  VerificationExplanation,
} from "./types.js";
import { KNOWLEDGE_DIMENSIONS } from "./types.js";
import { assertClaimHasProvenance } from "./verification.js";

const GATE_A1 = "A1";

// --- P1.01 Input ---

export interface RawResearchInput {
  topic: string;
  question?: string;
  objective?: string;
  constraints?: string[];
  user_provided_material?: string;
  optional_references?: string[]; // Legacy; use user_example_references instead
  // P1.02 Improvement: User-seeded scope discovery. Optional array of example references
  // (YouTube channels, videos, papers, docs) user provides to narrow research universe.
  // When supplied, P1.02 uses these to create controlled scope; when absent, system proposes scope.
  user_example_references?: string[];
  project_seed?: string; // explicit seed for a stable project_id, else derived from topic
  // Category 1: Research intent and context
  request_mode?: RequestMode;
  source_language?: string;
  research_language?: string;
  output_language?: string;
  user_materials?: UserMaterial[];
  target_context?: TargetContext;
}

export function runP101Input(raw: RawResearchInput): ResearchRequest {
  if (!raw.topic || raw.topic.trim().length === 0) {
    throw new ValidationError("P1.01", "topic", "topic is required and cannot be empty");
  }
  const project_id = stableProjectId(raw.project_seed ?? raw.topic);
  return {
    project_id,
    topic: raw.topic.trim(),
    question: raw.question?.trim(),
    objective: raw.objective?.trim(),
    constraints: raw.constraints ?? [],
    user_provided_material: raw.user_provided_material
      ? redactSecrets(raw.user_provided_material)
      : undefined,
    optional_references: raw.optional_references ?? [],
    user_example_references: raw.user_example_references ?? [],
    request_mode: raw.request_mode ?? "STANDARD_RESEARCH",
    source_language: raw.source_language,
    research_language: raw.research_language,
    output_language: raw.output_language,
    user_materials: raw.user_materials,
    target_context: raw.target_context,
  };
}

// --- P1.02 Topic & Source Discovery (scope proposal + freeze) ---

export function runP102ProposeScope(
  request: ResearchRequest,
  params?: { source_type_preferences?: string[]; language_preference?: string; recency_preference?: string },
): ResearchScope {
  // Deterministic, non-fabricating proposal: candidate source families are
  // derived only from what the request/preferences already state, never
  // invented research angles.
  //
  // P1.02 Improvement (P1-A): User-seeded scope discovery. When user_example_references
  // is supplied, it takes precedence to NARROW the research universe to user-guided sources.
  // This is controlled discovery, not expansion — scope contracts, not expands.
  // When empty/undefined, falls back to optional_references (legacy) and constraints.
  const source_type_preferences = params?.source_type_preferences ?? ["primary", "secondary"];

  // Priority: user_example_references (for narrowing) > optional_references (legacy) + constraints
  const userProvidedSources = request.user_example_references ?? [];
  const candidateSourcesFromRequest = userProvidedSources.length > 0
    ? userProvidedSources
    : (request.optional_references ?? []);

  const candidate_source_families = [
    ...candidateSourcesFromRequest,
    ...(request.constraints.length > 0 ? [`constrained_by:${request.constraints.join(",")}`] : []),
  ];

  return {
    scope_id: stableScopeId(request.project_id, request.topic),
    project_id: request.project_id,
    topic: request.topic,
    question: request.question,
    objective: request.objective,
    constraints: request.constraints,
    source_type_preferences,
    language_preference: params?.language_preference,
    recency_preference: params?.recency_preference,
    candidate_source_families,
    state: "SCOPE_PROPOSED",
    request_mode: request.request_mode,
    source_language: request.source_language,
    research_language: request.research_language,
    output_language: request.output_language,
    user_materials: request.user_materials,
    target_context: request.target_context,
  };
}

// Gate A1, transition 1: SCOPE_PROPOSED -> SCOPE_APPROVED. Freezes the scope
// object P1.03 must operate within.
export function approveScope(
  scope: ResearchScope,
  actor: string,
): { scope: ResearchScope; gate: GateApprovalRecord } {
  if (scope.state !== "SCOPE_PROPOSED") {
    throw new ValidationError(
      "P1.02",
      "scope.state",
      `expected SCOPE_PROPOSED, found ${scope.state}`,
    );
  }
  // T1.4 — the approval binds to the scope's exact content. The approved
  // scope object (state SCOPE_APPROVED) is what downstream consumes, so the
  // hash is taken over that final form, not the pre-transition draft.
  const approvedScope: ResearchScope = { ...scope, state: "SCOPE_APPROVED" };
  const gate = recordGateApproval({
    gateId: GATE_A1,
    stateBefore: "SCOPE_PROPOSED",
    actor,
    objectVersionBeingApproved: scope.scope_id,
    stateAfter: "SCOPE_APPROVED",
    downstreamOperationUnlocked: "P1.03 Domain Research",
    objectId: scope.scope_id,
    objectType: "research_scope",
    objectContent: approvedScope,
  });
  return { scope: approvedScope, gate };
}

// --- P1.03 Domain Research ---

export interface DomainResearchResult {
  sources: Source[];
  evidence: Evidence[];
  claims: Claim[];
  // Category 2: Discovery & Acquisition context (optional)
  observations: Observation[];
  acquisition_history: AcquisitionAttempt[];
  // T1.5: canonical lineage objects, carrying the candidate_id that
  // AcquisitionAttempt/Observation FKs resolve against.
  discovery_lineage: CandidateLineage[];
}

export async function runP103DomainResearch(
  engine: ResearchEngine,
  approvedScope: ResearchScope,
  queries: Array<{ query: string; dimension: Claim["dimension"] }>,
): Promise<DomainResearchResult> {
  if (approvedScope.state !== "SCOPE_APPROVED") {
    // Enforcement point for "P1.03 owns execution only ... MUST operate
    // within the approved scope object" — never called with an unapproved
    // scope, and out-of-scope directions raised by the engine itself
    // (ScopeViolationError) propagate to the caller unhandled, per the
    // "flagged and returned upstream, never pursued silently" rule.
    throw new ValidationError(
      "P1.03",
      "approvedScope.state",
      `Domain Research requires SCOPE_APPROVED, found ${approvedScope.state}`,
    );
  }

  const sources: Source[] = [];
  const evidence: Evidence[] = [];
  const claims: Claim[] = [];
  const observations: Observation[] = [];
  const acquisition_history: AcquisitionAttempt[] = [];
  const discovery_lineage: CandidateLineage[] = [];
  const seenSourceIds = new Set<string>();
  const seenEvidenceIds = new Set<string>();
  const seenObservationIds = new Set<string>();
  const seenCandidateIds = new Set<string>();
  const candidatesByCandidateId = new Map<string, Candidate>();

  // --- P1.03.A: Discovery Phase ---
  // Call engine.discover() to generate candidate research directions
  const discoveryResults = await engine.discover(approvedScope.topic, approvedScope.constraints);

  // Create Candidate records and discovery lineage from DiscoverResult
  const candidates: Candidate[] = [];
  for (const result of discoveryResults) {
    const candidateId = stableCandidateId(
      approvedScope.topic,
      result.direction,
      result.direction, // Use direction as resource identifier for discovery
    );

    if (!seenCandidateIds.has(candidateId)) {
      const candidate: Candidate = {
        candidate_id: candidateId,
        discovered_at: new Date().toISOString(),
        topic: approvedScope.topic,
        discovery_method: "engine.discover",
        discovery_provider: "research-engine",
        discovery_rationale: result.rationale,
        resource_description: result.direction,
        observable_signals: [],
        acquisition_attempts: [],
        status: "discovered",
        scope_id: approvedScope.scope_id,
      };
      candidates.push(candidate);
      candidatesByCandidateId.set(candidateId, candidate);
      seenCandidateIds.add(candidateId);

      // T1.5(a) — export the canonical lineage object carrying candidate_id,
      // so the FKs on AcquisitionAttempt/Observation resolve inside the
      // handoff instead of dangling. The internal Candidate object itself
      // still never leaves P1.
      discovery_lineage.push({
        candidate_id: candidateId,
        topic: candidate.topic,
        discovery_method: candidate.discovery_method,
        discovery_provider: candidate.discovery_provider,
        discovery_rationale: candidate.discovery_rationale,
        resource_description: candidate.resource_description,
        scope_id: candidate.scope_id,
        status: candidate.status,
      });
    }
  }

  // TIER-1 REPAIR T1.5(b) — "Discovery-generated directions must actually
  // feed the investigation/acquisition path."
  //
  // Previously `combinedQueries = [...queries]` discarded every discovered
  // direction: engine.discover() ran, produced Candidates, and then nothing
  // downstream ever investigated them. Discovery was decorative.
  //
  // Each query now carries the candidate that motivated it. User-supplied
  // queries carry no candidate (they were not discovered); discovery-derived
  // queries carry theirs, which is what the AcquisitionAttempt FK resolves
  // against instead of "whatever candidate happened to be first".
  interface InvestigationQuery {
    query: string;
    dimension: Claim["dimension"];
    candidate_id?: string;
  }
  const combinedQueries: InvestigationQuery[] = [
    ...queries.map((q) => ({ query: q.query, dimension: q.dimension })),
    ...candidates.map((c) => ({
      query: c.resource_description,
      // A discovered direction has no dimension of its own; it inherits the
      // dimension of the first user query, or "facts" when none was given.
      dimension: (queries[0]?.dimension ?? "facts") as Claim["dimension"],
      candidate_id: c.candidate_id,
    })),
  ];

  // --- P1.03.B: Investigation & Acquisition Phase ---
  for (const q of combinedQueries) {
    const requestedAt = new Date().toISOString();
    // TIER-1 REPAIR T1.5(c) — "Do not attach all acquisitions to the first
    // candidate merely as a fallback." A query that came from a discovered
    // direction attaches to THAT candidate. A user-supplied query has no
    // candidate at all, and records candidate_id: undefined rather than
    // inventing one (the old code used the raw query string as a
    // candidate_id, producing a permanently unresolvable FK).
    const candidateIdForAttempt: string | undefined = q.candidate_id;

    try {
      const { findings } = await engine.investigate(approvedScope, q);

      // Record successful investigation attempt
      const completedAt = new Date().toISOString();

      for (const finding of findings) {
        const sourceId = stableSourceId(finding.source.origin, finding.source.source_type);
        const source: Source = { ...finding.source, source_id: sourceId };

        if (!seenSourceIds.has(sourceId)) {
          sources.push(source);
          seenSourceIds.add(sourceId);

          // One attempt record per acquired source. The attempt_id is
          // derived per-source rather than per-query: the previous code
          // computed a single attemptId outside this loop and pushed it once
          // per new source, minting duplicate attempt_ids whenever a query
          // yielded more than one source.
          const attemptId = stableAcquisitionAttemptId(
            candidateIdForAttempt ?? sourceId,
            "research-engine",
            `${requestedAt}::${sourceId}`,
          );
          const attempt: AcquisitionAttempt = {
            attempt_id: attemptId,
            candidate_id: candidateIdForAttempt,
            provider: "research-engine",
            access_method: "investigate",
            requested_at: requestedAt,
            completed_at: completedAt,
            status: "succeeded",
            resolved_source_id: sourceId,
            duration_ms: 0,
          };
          acquisition_history.push(attempt);

          // Record Observation of source acquisition signal
          // Use single timestamp for both ID and observed_at to ensure deterministic identity
          const observedAt = new Date().toISOString();
          const observationId = stableObservationId(sourceId, "acquired", observedAt);
          if (!seenObservationIds.has(observationId)) {
            observations.push({
              observation_id: observationId,
              source_id: sourceId,
              observed_at: observedAt,
              metric_name: "acquired",
              metric_value: 1,
              source_of_observation: "investigate",
              immutable: true,
            });
            seenObservationIds.add(observationId);
          }
        }

        // An empty excerpt/pointer means the engine explicitly found nothing
        // to cite for this finding. No Evidence record is fabricated for it —
        // the resulting Claim carries empty evidence_refs and must be
        // verified as UNKNOWN (enforced in P1.04), never silently backed by
        // a hollow evidence entry.
        const redactedExcerpt = redactSecrets(finding.excerpt_or_pointer);
        const hasRealExcerpt = redactedExcerpt.trim().length > 0;
        const evidenceRefs: string[] = [];
        if (hasRealExcerpt) {
          const evidenceId = stableEvidenceId(sourceId, redactedExcerpt);
          if (!seenEvidenceIds.has(evidenceId)) {
            evidence.push({
              evidence_id: evidenceId,
              source_id: sourceId,
              excerpt_or_pointer: redactedExcerpt,
              retrieved_at: finding.source.retrieved_at,
              extraction_method: finding.extraction_method,
            });
            seenEvidenceIds.add(evidenceId);
          }
          evidenceRefs.push(evidenceId);
        }

        claims.push({
          claim_id: stableClaimId(approvedScope.project_id, finding.dimension, finding.statement),
          statement: redactSecrets(finding.statement),
          evidence_refs: evidenceRefs,
          derived_from: finding.derived_from,
          contradiction_refs: [],
          dimension: finding.dimension,
        });
      }
    } catch (error) {
      // ScopeViolationError should propagate unhandled (contract enforcement)
      if (error instanceof Error && error.name === "ScopeViolationError") {
        throw error;
      }
      // All other errors are recorded as failed acquisition attempts
      const completedAt = new Date().toISOString();
      const attemptId = stableAcquisitionAttemptId(
        candidateIdForAttempt ?? q.query,
        "research-engine",
        requestedAt,
      );
      const failureReason = error instanceof Error ? error.message : "Unknown error";
      const attempt: AcquisitionAttempt = {
        attempt_id: attemptId,
        candidate_id: candidateIdForAttempt,
        provider: "research-engine",
        access_method: "investigate",
        requested_at: requestedAt,
        completed_at: completedAt,
        status: "failed",
        failure_reason: failureReason,
        duration_ms: 0,
      };
      acquisition_history.push(attempt);
    }
  }

  return {
    sources,
    evidence,
    claims,
    observations,
    acquisition_history,
    discovery_lineage,
  };
}

// --- P1.04 Verification ---

// Small-improvements addition (C1): runP104Verification's own return type
// now carries VerificationExplanation[] alongside verifications, produced
// in the same loop that builds each Verification. This is the wiring that
// makes explanations real rather than a standalone function nobody calls —
// every real P1.04 run produces them automatically for whichever claims
// need one. verifications itself, and the provenance enforcement below,
// are byte-identical to before this change.
export async function runP104Verification(
  engine: ResearchEngine,
  claims: Claim[],
): Promise<{ verifications: Verification[]; explanations: VerificationExplanation[] }> {
  const verifications: Verification[] = [];
  const explanations: VerificationExplanation[] = [];
  for (const claim of claims) {
    const result = await engine.verify(claim, claim.evidence_refs);
    const verification: Verification = {
      verification_id: stableVerificationId(claim.claim_id, result.status),
      claim_id: claim.claim_id,
      status: result.status,
      rationale: result.rationale,
      verified_at: new Date().toISOString(),
      contradiction_relationship: claim.contradiction_refs.length > 0 ? "DIRECT" : "NONE",
      unresolved_reason: result.unresolved_reason,
    };
    // Fail loud: a claim/verification pair that violates the provenance
    // contract never reaches Synthesis.
    assertClaimHasProvenance(claim, verification);
    verifications.push(verification);
    const explanation = buildVerificationExplanation(verification, claim);
    if (explanation) explanations.push(explanation);
  }
  return { verifications, explanations };
}

// --- P1.05 Synthesis + P1.06 Knowledge Package ---

// Compute deterministic synthesis_run_id from canonical research input.
// Identity: hash(project_id + sorted source_ids + sorted claim_ids + sorted verification_ids)
// No time component; same inputs always produce same run_id (reproducible).
function computeSynthesisRunId(
  projectId: string,
  sourceIds: string[],
  claimIds: string[],
  verificationIds: string[],
): string {
  const canonicalInput = [
    projectId,
    sourceIds.sort().join(","),
    claimIds.sort().join(","),
    verificationIds.sort().join(","),
  ].join("::");

  return `syn_${sha256(canonicalInput).slice(0, 16)}`;
}

export function runP105And106Synthesis(
  claims: Claim[],
  verifications: Verification[],
  projectId?: string,
  // T1.1: the canonical source set this synthesis was derived from. Optional
  // for backwards compatibility with existing call sites; when omitted the
  // evidence_refs cited by the claims are used instead (see below).
  sources?: Source[],
): {
  knowledge_package: KnowledgePackage;
  unresolved_questions: string[];
  synthesis_metadata: SynthesisMetadata;
} {
  const verificationByClaimId = new Map(verifications.map((v) => [v.claim_id, v]));

  // "A claim may not enter Synthesis without a Verification record" —
  // filtered here, not assumed.
  const verifiedClaims = claims.filter((c) => verificationByClaimId.has(c.claim_id));

  const kp: KnowledgePackage = {
    verification_state_schema_version: "v1",
    facts: [],
    concepts: [],
    people: [],
    events: [],
    places: [],
    objects: [],
    processes: [],
    relationships: [],
    chronology: [],
    terminology: [],
    quantitative: [],
    visual: [],
    examples: [],
    interpretations: [],
    contradictions: [],
    unknowns: [],
    open_questions: [],
    production_context: [],
  };

  const unresolved_questions: string[] = [];
  let verifiedCount = 0;
  let inferredCount = 0;
  let unknownCount = 0;
  let contradictionCount = 0;

  for (const claim of verifiedClaims) {
    const verification = verificationByClaimId.get(claim.claim_id)!;

    // Sort nested evidence_refs and contradiction_refs for determinism
    const sortedEvidenceRefs = [...claim.evidence_refs].sort();
    const sortedContradictionRefs = [...claim.contradiction_refs].sort();

    const claimWithSortedRefs: Claim = {
      ...claim,
      evidence_refs: sortedEvidenceRefs,
      contradiction_refs: sortedContradictionRefs,
    };

    // TIER-1 REPAIR T1.6 — CANONICAL UNKNOWN SEMANTICS.
    //
    // Previously this line was unconditional ("always populated regardless
    // of verification status"), which put every UNKNOWN claim into BOTH its
    // topical bucket and unknowns[]. P1's OWN validator
    // (validation.ts::validateKnowledgeQuality) rejects exactly that shape
    // with SILENT_CONVERSION_DETECTED and DUPLICATE_CLAIM_IN_BUCKETS — so
    // any real run containing a single UNKNOWN claim produced a package
    // that P1 itself declared invalid. Empirically reproduced against the
    // unrepaired baseline before this change.
    //
    // The canonical rule, chosen per the brief's recommendation and now
    // enforced identically in synthesis, the validator, the schema comments
    // and the handoff contract:
    //
    //     UNKNOWN claim  ->  unknowns[] ONLY
    //
    // An UNKNOWN claim is never also filed as a verified topical fact.
    // Its subject is still discoverable: unresolved_questions/open_questions
    // carry the statement, and the claim keeps its own `dimension` field.
    if (verification.status !== "UNKNOWN") {
      (kp[claim.dimension] as Claim[]).push(claimWithSortedRefs);
    }

    // Count verification states
    if (verification.status === "VERIFIED") {
      verifiedCount++;
    } else if (verification.status === "INFERRED") {
      inferredCount++;
    } else if (verification.status === "UNKNOWN") {
      unknownCount++;
    }

    // Status-derived buckets, additive (a claim can be both topical and
    // flagged as unknown/contradictory).
    if (verification.status === "UNKNOWN") {
      kp.unknowns.push(claimWithSortedRefs);
      unresolved_questions.push(
        `${claim.statement} (${verification.unresolved_reason ?? "reason not recorded"})`,
      );
    }
    if (claim.contradiction_refs.length > 0) {
      kp.contradictions.push(claimWithSortedRefs);
      contradictionCount++;
    }
  }

  // Apply deterministic ordering: sort all dimension arrays and status buckets by claim_id
  for (const dimension of KNOWLEDGE_DIMENSIONS) {
    const dimArray = kp[dimension] as Claim[];
    if (Array.isArray(dimArray)) {
      dimArray.sort((a, b) => a.claim_id.localeCompare(b.claim_id));
    }
  }

  // Sort open questions lexicographically
  unresolved_questions.sort();
  kp.open_questions = unresolved_questions;

  // TIER-1 REPAIR T1.1 — synthesis identity must actually depend on sources.
  //
  // The previous line was:
  //   const sourceIds = claims.flatMap(c => c.evidence_refs.map(e => e))
  //                           .slice(0,1).map(() => "");  // Placeholder for now
  // which collapses to [""] (or []) for every possible input, so the source
  // component of synthesis_run_id was a constant. Two syntheses over
  // completely different evidence produced an IDENTICAL synthesis_run_id —
  // empirically reproduced against the unrepaired baseline.
  //
  // The identity now uses the real evidence/source lineage. `sources` is
  // accepted by the caller where available; when it is not supplied we fall
  // back to the evidence_refs the claims actually cite, which is still a
  // genuine content-derived signal rather than a constant.
  const sourceIds =
    sources && sources.length > 0
      ? sources.map((s) => s.source_id)
      : Array.from(new Set(claims.flatMap((c) => c.evidence_refs)));
  const claimIds = claims.map((c) => c.claim_id);
  const verificationIds = verifications.map((v) => v.verification_id);
  const synthesisRunId = computeSynthesisRunId(
    projectId || "unknown_project",
    sourceIds,
    claimIds,
    verificationIds,
  );

  // Synthesis timestamp: execution metadata (NOW)
  const synthesisTimestamp = new Date().toISOString();

  // Synthesis metadata: knowledge identity + execution metadata + counts
  const metadata: SynthesisMetadata = {
    synthesis_run_id: synthesisRunId,
    synthesis_timestamp: synthesisTimestamp,
    verified_facts_count: verifiedCount,
    inferred_facts_count: inferredCount,
    unknown_count: unknownCount,
    contradictions_count: contradictionCount,
    total_claims: verifiedClaims.length,
  };

  return { knowledge_package: kp, unresolved_questions, synthesis_metadata: metadata };
}

// --- P1.07 Handoff ---

export function draftHandoff(params: {
  approvedScope: ResearchScope;
  sources: Source[];
  evidence: Evidence[];
  claims: Claim[];
  verifications: Verification[];
  knowledge_package: KnowledgePackage;
  unresolved_questions: string[];
  gates: GateApprovalRecord[];
  handoff_notes?: string;
  // Optional Category 4 metadata: synthesis run identity and execution metadata
  synthesis_metadata?: SynthesisMetadata;
  // Optional Category 2 context: discovery/acquisition lineage and observations
  observations?: Observation[];
  acquisition_history?: AcquisitionAttempt[];
  discovery_lineage?: CandidateLineage[];
}): ResearchPackageHandoff {
  if (params.approvedScope.state !== "SCOPE_APPROVED") {
    throw new ValidationError("P1.07", "approvedScope.state", "cannot hand off an unapproved scope");
  }
  const claimIdsKey = params.claims.map((c) => c.claim_id).sort().join(",");
  const package_id = stablePackageId(
    params.approvedScope.project_id,
    params.approvedScope.scope_id,
    claimIdsKey,
  );

  const sections = {
    research_scope: params.approvedScope,
    sources: params.sources,
    evidence: params.evidence,
    claims: params.claims,
    verifications: params.verifications,
    knowledge_package: params.knowledge_package,
    unresolved_questions: params.unresolved_questions,
    handoff_notes: params.handoff_notes ?? "",
  };
  const { manifest, integrity_hashes } = buildManifestAndIntegrity(sections);

  // T1.1 — canonical content identity over EVERY content section, so a
  // change to handoff_notes / verifications / knowledge_package (none of
  // which affect package_id) still changes the artifact's identity and
  // therefore invalidates any approval bound to the previous hash.
  const identity = buildIdentity({
    objectId: package_id,
    objectType: "research_package",
    version: "1.0.0",
    content: sections,
    parentId: params.approvedScope.scope_id,
  });

  // Build optional category_2_context (Category 2: Discovery & Acquisition)
  // when observations or acquisition_history are provided
  const category_2_context: Category2Context | undefined =
    params.observations?.length || params.acquisition_history?.length || params.discovery_lineage?.length
      ? {
          acquisition_history: params.acquisition_history ?? [],
          observations: params.observations ?? [],
          discovery_lineage: params.discovery_lineage ?? [],
        }
      : undefined;

  // R01.1 — category_2_context gets its own P1-internal integrity hash
  // (see the classification decision documented on IntegrityHashes.
  // category_2_context_sha256 in types.ts). Computed the same
  // canonicalize-then-sha256 way as every other section, deliberately
  // OUTSIDE the shared 8-section package hash.
  const category_2_context_sha256 = category_2_context
    ? contentHash(category_2_context)
    : undefined;

  return {
    package_id,
    schema_version: "1.0.0",
    identity,
    project_id: params.approvedScope.project_id,
    manifest,
    integrity_hashes: category_2_context_sha256
      ? { ...integrity_hashes, category_2_context_sha256 }
      : integrity_hashes,
    research_scope: params.approvedScope,
    sources: params.sources,
    evidence: params.evidence,
    claims: params.claims,
    verifications: params.verifications,
    knowledge_package: params.knowledge_package,
    unresolved_questions: params.unresolved_questions,
    handoff_notes: params.handoff_notes ?? "",
    gates: params.gates,
    // Optional Category 4 metadata
    synthesis_metadata: params.synthesis_metadata,
    // Optional Category 2 context (Candidate[] NOT exported)
    category_2_context,
  };
}

// Gate A1, transition 2: PACKAGE_DRAFTED -> PACKAGE_APPROVED. Unlocks P2.
export function approvePackage(
  handoff: ResearchPackageHandoff,
  actor: string,
): { handoff: ResearchPackageHandoff; gate: GateApprovalRecord } {
  // T1.3 — `history` makes this transition legal ONLY if Gate A1's scope
  // approval was actually recorded first, and rejects a second package
  // approval for the same object. Previously any order was accepted and
  // only the terminal state was ever inspected.
  // T1.4 — the approval binds to identity.content_hash, so mutating the
  // package afterwards invalidates it (requireApprovedContent).
  const gate = recordGateApproval({
    gateId: GATE_A1,
    stateBefore: "PACKAGE_DRAFTED",
    actor,
    objectVersionBeingApproved: handoff.package_id,
    stateAfter: "PACKAGE_APPROVED",
    downstreamOperationUnlocked: "Pipeline 2 may consume this Research Package",
    objectId: handoff.package_id,
    objectType: "research_package",
    objectContentHash: handoff.identity.content_hash,
    history: handoff.gates,
  });
  return { handoff: { ...handoff, gates: [...handoff.gates, gate] }, gate };
}

// Confirms Gate A1 was actually passed (both transitions) before a package
// is treated as ready for P2 — the code-enforcement half of "human approval
// is a real state transition."
export function requirePackageApproved(handoff: ResearchPackageHandoff): void {
  requireGateState(handoff.gates, GATE_A1, "PACKAGE_APPROVED");
}

// --- P1.07+ Category 5: Governance & Validation ---

// Validates handoff structural completeness, referential integrity, and safety
// for A→B boundary. Throws ValidationError if blocking conditions detected;
// returns ValidationResult with errors/warnings for all conditions.
export { validateResearchPackage } from "./validation.js";

export { KNOWLEDGE_DIMENSIONS };
