// P2 orchestration — implements P2.01 through P2.11 as one coherent block
// per docs/architecture/02_PIPELINE_2_ARCHITECTURE.md. Each exported
// function corresponds to one stage of the canonical sequence.

import type { CreativeReasoningEngine } from "./creativeReasoningEngine.js";
import { ReverseQAError, TraceabilityError, ValidationError } from "./errors.js";
import { recordGateApproval, requireGateState } from "./gates.js";
import { buildIdentity } from "./canonicalIdentity.js";
import { stablePromptSpecId } from "./ids.js";
import { verifyResearchPackageIntegrity } from "./ingest.js";
import { claimLookup } from "./ingest.js";
import { stableFormatDecisionMatrixId, stableProductionPackageId } from "./ids.js";
import { buildManifestAndIntegrity } from "./manifest.js";
import { GoogleFlowRenderer, InMemoryPromptLibrary, type PromptLibrary } from "./promptArchitecture.js";
import { planAssetRequirement } from "./assetPlanning.js";
import { validateTraceabilityChain } from "./traceability.js";
import { buildVoiceLines, flagPronunciationRisks, verifyVoiceScriptConsistency, voiceScriptFromLines } from "./voiceSpec.js";
import type {
  ArtDirection,
  AssetRequirement,
  AssetRole,
  ContentStructure,
  CreativeStrategy,
  Decision,
  FormatDecision,
  FormatDecisionMatrix,
  GateApprovalRecord,
  MemoryRecord,
  ProductionPackageHandoff,
  PromptSpecification,
  Reference,
  RenderedPromptRecord,
  ResearchPackageHandoffInput,
  Scene,
  Shot,
} from "./types.js";

const GATE_A2 = "A2";
const GATE_A3 = "A3";

// --- P2.01 gate: reference approval ---

export function approveReferences(
  references: Reference[],
  actor: string,
): { references: Reference[]; gate: GateApprovalRecord } {
  const approvedIds = references.map((r) => r.reference_id).sort().join(",");
  const gate = recordGateApproval({
    gateId: GATE_A2,
    stateBefore: "REFERENCES_PROPOSED",
    actor,
    objectVersionBeingApproved: approvedIds || "none",
    stateAfter: "REFERENCES_APPROVED",
    downstreamOperationUnlocked: "P2.02 Content Understanding",
    objectId: approvedIds || "none",
    objectType: "reference_set",
    objectContent: references,
  });
  return { references, gate };
}

// --- P2.02 Content Understanding ---

export async function runP202Understand(
  engine: CreativeReasoningEngine,
  pkg: ResearchPackageHandoffInput,
  references: Reference[],
): Promise<ContentStructure> {
  const contentStructure = await engine.understand(pkg, references);
  const claims = claimLookup(pkg);
  for (const claimId of contentStructure.key_claims_used) {
    if (!claims.has(claimId)) {
      throw new ValidationError(
        "P2.02",
        "contentStructure.key_claims_used",
        `claim_id "${claimId}" was not found in the ingested Research Package — P2 must not repeat/invent research`,
      );
    }
  }
  return contentStructure;
}

// --- P2.03 Creative Strategy ---

export async function runP203Strategize(
  engine: CreativeReasoningEngine,
  contentStructure: ContentStructure,
  userGoals: string[],
  priorApproaches?: MemoryRecord[],
): Promise<CreativeStrategy> {
  return engine.strategize(contentStructure, userGoals, priorApproaches);
}

// --- P2.04 Format (not part of the 5-method engine contract; structures
// caller-supplied input only, never invents a format) ---

export function decideFormat(format: string, constraints: string[]): FormatDecision {
  if (!format || format.trim().length === 0) {
    throw new ValidationError("P2.04", "format", "format is required and cannot be empty");
  }
  return { format: format.trim(), constraints };
}

// Small-improvements addition (C4, interactive format reasoning): bridges
// aiDirector.ts's existing advisory flow (analyze -> recommend ->
// recordHumanDecision) into decideFormat, so a format choice goes through
// proposal -> rationale -> alternatives -> trade-offs -> human decision
// instead of being handed to decideFormat as an unexplained final string.
// No new decision-making logic — reuses the already-built, already-tested
// AI Director pattern verbatim; decideFormat itself is untouched.
export function formatDecisionFromApprovedDecision(decision: Decision, constraints: string[]): FormatDecision {
  if (decision.status !== "approved") {
    throw new ValidationError(
      "P2.04",
      "decision.status",
      `a format Decision must be "approved" before it can become a FormatDecision, found "${decision.status}"`,
    );
  }
  return decideFormat(decision.recommendation, constraints);
}

// P2-B: Format Decision Matrix — structured decision logging chain. Captures
// each step from format through production_complexity with rationale at every
// decision point. User reviews matrix before creative lock-in; gate enforced.
export function buildFormatDecisionMatrix(
  formatDecisionId: string,
  format: string,
  constraints: string[],
): FormatDecisionMatrix {
  const matrixId = stableFormatDecisionMatrixId(formatDecisionId, format);

  // Infer decision points from format and constraints for demonstration chain.
  // In production, each point would be driven by upstream creativeStrategy
  // (from P2.03) and explicit user intent. For now, we structure the chain
  // based on format type and constraints, preserving rationale at each step.

  const chain = [
    {
      step: "format",
      input: "CreativeStrategy from P2.03, format request from user/AI Director",
      output: format,
      rationale: "Format choice drives all downstream constraints and asset requirements",
      implications: { affects: "duration, narrative_density, asset_count", final: "" },
    },
    {
      step: "duration",
      input: `format "${format}" + content complexity from P2.02 ContentStructure`,
      output: constraints.includes("under 60s") ? "30-60 seconds" : constraints.includes("under 180s") ? "60-180 seconds" : "variable (constraints guide choice)",
      rationale: "Duration determines visual pacing, shot count, and asset reuse strategy",
      implications: { affects: "narrative_density, shot_density, asset_requirement", final: "" },
    },
    {
      step: "narrative_density",
      input: "Duration + key claims from ContentStructure + audience intent",
      output: constraints.length > 0 ? "moderate to high" : "moderate",
      rationale: "Narrative density determines how many ideas/claims fit per minute",
      implications: { affects: "shot_density, visual_density, voice_requirement", final: "" },
    },
    {
      step: "shot_density",
      input: "Narrative density + visual language from P2.06 ArtDirection",
      output: "derived from narrative_density and format (sparse for documentaries, rapid for montages)",
      rationale: "Shot density determines cut frequency and continuity anchor complexity",
      implications: { affects: "visual_density, motion_density, asset_requirement", final: "" },
    },
    {
      step: "visual_density",
      input: "Shot density + art direction visual language",
      output: "minimal (static, single subject), moderate (multiple subjects), or rich (layered, detailed)",
      rationale: "Visual density drives asset type/count and visual complexity planning",
      implications: { affects: "motion_density, asset_requirement, manual_workload", final: "" },
    },
    {
      step: "motion_density",
      input: "Visual density + format (short-form favors motion, documentaries favor static)",
      output: "static, moderate (smooth transitions), or kinetic (dynamic motion)",
      rationale: "Motion density determines motion graphics requirements and continuity complexity",
      implications: { affects: "asset_requirement, production_complexity", final: "" },
    },
    {
      step: "asset_requirement",
      input: "Shot density + visual density + motion density + format",
      output: "low (simple reuse, few unique assets), moderate, or high (many unique assets)",
      rationale: "Asset requirements drive production timeline, cost, and manual workload",
      implications: { affects: "manual_workload, production_complexity, voice_requirement", final: "" },
    },
    {
      step: "voice_requirement",
      input: "Narrative density + format + key claims to communicate",
      output: "minimal narration, moderate narration (50-70% voice), or heavy narration (>70%)",
      rationale: "Voice requirement determines narration length, pronunciation risk, and timing",
      implications: { affects: "manual_workload, production_complexity", final: "" },
    },
    {
      step: "manual_workload",
      input: "Asset requirement + voice requirement + format",
      output: "low (user provides 1-3 images/videos), moderate (4-8 assets), or high (9+ assets)",
      rationale: "Manual workload is what user must provide (images, silent videos ≤10s); system provides voice, music, SFX, render",
      implications: { affects: "timeline, user effort, production_complexity", final: "" },
    },
    {
      step: "production_complexity",
      input: "All prior steps: format + duration + density (narrative/shot/visual/motion) + asset_requirement + manual_workload",
      output: "simple (straightforward reuse), moderate (multi-step production), or complex (custom motion, many assets, integration challenges)",
      rationale: "Final production complexity informs P3 resource allocation and timeline estimation",
      implications: { affects: "", final: "gates P2.04 user review, unlocks P2.05+ creative development" },
    },
  ];

  return {
    matrix_id: matrixId,
    format_decision_id: formatDecisionId,
    chain,
    is_user_reviewed: false,
  };
}

// Gate checkpoint: user reviews the format decision matrix before creative
// lock-in. Once approved, no silent progression; matrix is locked as canonical.
export function approveFormatDecisionMatrix(
  matrix: FormatDecisionMatrix,
  actor: string,
  notes?: string,
): FormatDecisionMatrix {
  if (matrix.is_user_reviewed) {
    throw new ValidationError(
      "P2.04",
      "matrix.is_user_reviewed",
      `Format Decision Matrix "${matrix.matrix_id}" has already been reviewed by ${matrix.review_actor} at ${matrix.review_timestamp}`,
    );
  }
  return {
    ...matrix,
    is_user_reviewed: true,
    review_timestamp: new Date().toISOString(),
    review_actor: actor,
    notes,
  };
}

// --- P2.05 Manual Creative/Reference Research: see referenceDiscovery.ts
// recordObservation() — collaborative, question-led, no fabrication. ---

// --- P2.06 Art Direction (+ Gate A2 second transition) ---

export async function runP206ArtDirection(
  engine: CreativeReasoningEngine,
  strategy: CreativeStrategy,
  references: Reference[],
  memory: MemoryRecord[],
): Promise<{ artDirection: ArtDirection; decisionLog: Decision[] }> {
  return engine.directArt(strategy, references, memory);
}

export function approveArtDirection(
  artDirection: ArtDirection,
  actor: string,
  // T1.3: the recorded history this transition must be legal against.
  // ART_DIRECTION_APPROVED requires REFERENCES_APPROVED first.
  history: GateApprovalRecord[] = [],
): { artDirection: ArtDirection; gate: GateApprovalRecord } {
  const gate = recordGateApproval({
    gateId: GATE_A2,
    stateBefore: "ART_DIRECTION_DRAFTED",
    actor,
    objectVersionBeingApproved: artDirection.art_direction_id,
    stateAfter: "ART_DIRECTION_APPROVED",
    downstreamOperationUnlocked: "P2.07 Asset Planning / P2.08 Scene-Shot Planning",
    objectId: artDirection.art_direction_id,
    objectType: "art_direction",
    objectContent: artDirection,
    history,
  });
  return { artDirection, gate };
}

// --- P2.07 Asset Planning: one AssetRequirement per shot, derived from the
// shot's own asset_type/generation_method fields (already produced by
// planSceneShot) — grounded, never invented. ---

// Small-improvements addition (C5): an optional richer-planning path. When
// assetPlansByShotId is omitted (or has no entry for a given shot), that
// shot's planning is byte-identical to pre-C5 behavior — one
// AssetRequirement, derived straight from the shot's own asset_type. When a
// shot has an entry, one AssetRequirement is planned per listed role
// instead, each with its own discriminator (its index in the array) so ids
// don't collide, and each carrying the given AssetRole in the separate
// asset_role field (expected_media_type still only ever comes from
// mediaType, never from the role — see the AssetRole doc comment in
// types.ts).
export function runP207AssetPlanning(
  shots: Shot[],
  references: Reference[],
  expectedMediaPropertiesByShotId: Record<string, Record<string, unknown>> = {},
  assetPlansByShotId?: Record<string, Array<{ role: AssetRole; mediaType: string; mediaProperties: Record<string, unknown> }>>,
): AssetRequirement[] {
  return shots.flatMap((shot) => {
    const plans = assetPlansByShotId?.[shot.shot_id];
    if (!plans || plans.length === 0) {
      return [
        planAssetRequirement({
          shot,
          expectedMediaType: shot.asset_type,
          expectedMediaProperties: expectedMediaPropertiesByShotId[shot.shot_id] ?? {},
          generationMethod: shot.generation_method,
          references,
          required: true,
        }),
      ];
    }
    return plans.map((plan, index) =>
      planAssetRequirement({
        shot,
        expectedMediaType: plan.mediaType,
        expectedMediaProperties: plan.mediaProperties,
        generationMethod: shot.generation_method,
        references,
        required: true,
        assetRole: plan.role,
        discriminator: index,
      }),
    );
  });
}

// --- P2.08 Scene/Shot Planning ---

export async function runP208SceneShotPlanning(
  engine: CreativeReasoningEngine,
  strategy: CreativeStrategy,
  artDirection: ArtDirection,
): Promise<{ scenes: Scene[]; shots: Shot[] }> {
  return engine.planSceneShot(strategy, artDirection);
}

// --- P2.09 Flow Prompt Direction ---

// TIER-1 REPAIR T1.7 — the canonical chain is
//     Shot -> AssetRequirement -> PromptSpecification -> Delivered Asset.
//
// P2.09 previously produced exactly ONE prompt per SHOT, and the prompt's
// traceable_to carried no asset_requirement_id at all. Two consequences:
//   * a shot with several AssetRequirements (the normal C5 multi-role case)
//     got one prompt covering all of them, with no way to say which;
//   * P3 could never prove which delivered asset satisfied which
//     requirement, because no link existed to prove it with.
//
// Prompts are now produced PER ASSET REQUIREMENT. The engine still authors
// the creative content per shot (it is the creative authority and is not
// second-guessed here); this function only stamps the canonical lineage and
// gives each requirement's prompt its own identity. A requirement whose
// shot the engine has no prompt for still fails loud, as before.
export async function runP209FlowPromptDirection(
  engine: CreativeReasoningEngine,
  shots: Shot[],
  artDirection: ArtDirection,
  assetRequirements: AssetRequirement[],
  library: PromptLibrary = new InMemoryPromptLibrary(),
  renderer = new GoogleFlowRenderer(),
): Promise<RenderedPromptRecord[]> {
  const records: RenderedPromptRecord[] = [];
  const requirementsByShot = new Map<string, AssetRequirement[]>();
  for (const req of assetRequirements) {
    if (!requirementsByShot.has(req.shot_id)) requirementsByShot.set(req.shot_id, []);
    requirementsByShot.get(req.shot_id)!.push(req);
  }

  for (const shot of shots) {
    const requirements = requirementsByShot.get(shot.shot_id) ?? [];
    if (requirements.length === 0) {
      // T2.2 coverage is enforced in traceability.ts; failing here too keeps
      // the failure close to the cause rather than surfacing later as a
      // confusing missing-prompt error.
      throw new TraceabilityError(
        "SHOT -> ASSET REQUIREMENT",
        shot.shot_id,
        "cannot author prompts for a shot with no AssetRequirement",
      );
    }

    const authored: PromptSpecification = await engine.writeFlowPrompt(shot, artDirection, library);

    for (const requirement of requirements) {
      const spec: PromptSpecification = {
        ...authored,
        // Per-requirement identity: one prompt per requirement, never a
        // shared id that silently collides across a shot's requirements.
        prompt_spec_id:
          requirements.length === 1
            ? authored.prompt_spec_id
            : stablePromptSpecId(requirement.asset_requirement_id, authored.prompt_family),
        traceable_to: {
          shot_id: shot.shot_id,
          asset_requirement_id: requirement.asset_requirement_id,
          decision_id: authored.traceable_to.decision_id,
        },
      };
      library.store(spec);
      records.push({ spec, rendered: renderer.render(spec) });
    }
  }
  return records;
}

// --- P2.10 Voice + Production Spec ---

export function runP210VoiceSpec(
  narrationLines: Array<{ text: string; claim_id?: string }>,
): {
  voice_script: string;
  pronunciation_flags: ReturnType<typeof flagPronunciationRisks>;
  // T2.4 — structured lineage alongside the flattened script.
  voice_lines: ReturnType<typeof buildVoiceLines>;
} {
  // R01.3 — voice_lines is built FIRST and voice_script is DERIVED from it
  // (voiceScriptFromLines), never computed in parallel from the same raw
  // input. This makes the two structurally incapable of disagreeing when
  // constructed through this function; verifyVoiceScriptConsistency (used
  // in draftProductionPackage) catches any OTHER construction path.
  const voice_lines = buildVoiceLines(narrationLines);
  return {
    voice_script: voiceScriptFromLines(voice_lines),
    pronunciation_flags: flagPronunciationRisks(narrationLines),
    voice_lines,
  };
}

// --- P2.11 Reverse QA + Production Package ---

export function draftProductionPackage(params: {
  pkg: ResearchPackageHandoffInput;
  contentStructure: ContentStructure;
  decisionLog: Decision[];
  artDirection: ArtDirection;
  scenes: Scene[];
  shots: Shot[];
  assetRequirements: AssetRequirement[];
  prompts: RenderedPromptRecord[];
  voiceScript: string;
  pronunciationFlags: ReturnType<typeof flagPronunciationRisks>;
  // T2.4 — structured claim/line lineage. Optional for callers that have not
  // adopted it yet; every canonical caller now supplies it via runP210VoiceSpec.
  voiceLines?: ReturnType<typeof buildVoiceLines>;
  gates: GateApprovalRecord[];
}): ProductionPackageHandoff {
  // Upstream identity check: this production package must trace back to
  // exactly the Research Package it was built from — a mismatch here is a
  // reverse-QA finding, reported, never silently repaired.
  if (!params.pkg.package_id) {
    throw new ReverseQAError(["ingested Research Package has no package_id"]);
  }

  // TIER-1 REPAIR T1.2 — re-verify the upstream Research Package at the
  // moment the Production Package is sealed, and RECORD the verified hash.
  // Previously only `research_package_ref` (a name) was carried forward, so
  // nothing downstream could tell which version of the Research Package
  // this was built from, and a package mutated between ingest and draft was
  // undetectable.
  const upstream = verifyResearchPackageIntegrity(
    params.pkg as unknown as Record<string, unknown>,
  );

  const claimIds = new Set(params.pkg.claims.map((c) => c.claim_id));

  // T2.4 — every VoiceLine.claim_id that IS supplied must resolve, exactly
  // like every other FK in this chain. A line with no claim_id is fine (not
  // every sentence narrates a specific claim); a line pointing at a claim
  // that doesn't exist is the same class of defect as a dangling shot_id.
  const voiceLines = params.voiceLines ?? [];
  for (const line of voiceLines) {
    if (line.claim_id && !claimIds.has(line.claim_id)) {
      throw new TraceabilityError("VOICE LINE", line.claim_id, `voice line "${line.line_id}" references a claim_id not found in the ingested Research Package`);
    }
  }

  // R01.3 — hard invariant: voice_script must be exactly what voice_lines
  // derives to, regardless of how the caller assembled either one. This
  // catches drift from ANY construction path, not just runP210VoiceSpec's
  // own (which is now structurally incapable of drifting — see voiceSpec.ts).
  if (voiceLines.length > 0) {
    const consistency = verifyVoiceScriptConsistency(params.voiceScript, voiceLines);
    if (!consistency.valid) {
      throw new TraceabilityError(
        "VOICE SCRIPT",
        "voice_script",
        `voice_script does not match the ordered text of voice_lines — they have drifted apart. ` +
          `Expected the script derived from voice_lines; got a different string.`,
      );
    }
  }

  // Backwards chain check: Prompt -> Shot -> Scene -> Asset Plan ->
  // Art Direction -> ... -> Research. Throws a structured, named error on
  // the first broken link — no automatic repair, substitution, or silent
  // decision.
  validateTraceabilityChain({
    claimIds,
    contentStructure: params.contentStructure,
    decisions: params.decisionLog,
    artDirection: params.artDirection,
    scenes: params.scenes,
    shots: params.shots,
    assetRequirements: params.assetRequirements,
    prompts: params.prompts.map((p) => p.spec),
  });

  const shotIdsKey = params.shots.map((s) => s.shot_id).sort().join(",");
  const package_id = stableProductionPackageId(params.pkg.project_id, params.pkg.package_id, shotIdsKey);

  const sections = {
    scenes: params.scenes,
    shots: params.shots,
    asset_requirements: params.assetRequirements,
    prompts: params.prompts,
    decision_log: params.decisionLog,
    voice_script: params.voiceScript,
    pronunciation_flags: params.pronunciationFlags,
    voice_lines: voiceLines,
  };
  const { manifest, integrity_hashes } = buildManifestAndIntegrity(sections);

  // T1.1 — canonical content identity, parented to the exact upstream
  // Research Package content hash we just verified.
  const identity = buildIdentity({
    objectId: package_id,
    objectType: "production_package",
    version: "1.0.0",
    content: sections,
    parentId: params.pkg.package_id,
    parentContentHash: upstream.package_sha256,
  });

  return {
    package_id,
    production_package_version: "1.0.0",
    identity,
    project_id: params.pkg.project_id,
    research_package_ref: params.pkg.package_id,
    research_package_content_hash: upstream.package_sha256,
    scenes: params.scenes,
    shots: params.shots,
    asset_requirements: params.assetRequirements,
    prompts: params.prompts,
    decision_log: params.decisionLog,
    voice_script: params.voiceScript,
    pronunciation_flags: params.pronunciationFlags,
    voice_lines: voiceLines,
    user_approval_state: params.gates,
    manifest,
    integrity_hashes,
  };
}

// Gate A3: Google Flow preparation approval. Unlocks the manual Flow stage
// (and, once assets are delivered, P3).
export function approveProductionPackage(
  handoff: ProductionPackageHandoff,
  actor: string,
): { handoff: ProductionPackageHandoff; gate: GateApprovalRecord } {
  const gate = recordGateApproval({
    gateId: GATE_A3,
    stateBefore: "PRODUCTION_PACKAGE_DRAFTED",
    actor,
    objectVersionBeingApproved: handoff.package_id,
    stateAfter: "PRODUCTION_PACKAGE_APPROVED",
    downstreamOperationUnlocked:
      "Manual Google Flow stage; Pipeline 3 may consume this Production Package once assets are delivered",
    // T1.3 — legal only after Gate A2 art direction approval is on record.
    // T1.4 — bound to this package's exact content hash.
    objectId: handoff.package_id,
    objectType: "production_package",
    objectContentHash: handoff.identity.content_hash,
    history: handoff.user_approval_state,
  });
  return { handoff: { ...handoff, user_approval_state: [...handoff.user_approval_state, gate] }, gate };
}

export function requireProductionPackageApproved(handoff: ProductionPackageHandoff): void {
  requireGateState(handoff.user_approval_state, GATE_A3, "PRODUCTION_PACKAGE_APPROVED");
}
