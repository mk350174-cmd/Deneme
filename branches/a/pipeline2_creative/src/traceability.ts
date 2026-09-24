// Asset Traceability (P2 portion) — docs/architecture/02_PIPELINE_2_ARCHITECTURE.md:
// "RESEARCH FACT -> CREATIVE DECISION -> SCENE -> SHOT -> ASSET REQUIREMENT.
// Every arrow is a stable FK. Relationships are never inferred from
// filenames, ordering, prose, or timestamps."
//
// The architecture's canonical Decision object has no scene/shot "target"
// field (deliberately slimmer than Studio's decision.schema.json — see plan
// note on source-to-canonical mapping), so the chain is validated through
// the FKs that DO exist on the canonical models: ContentStructure grounds
// in claim_ids (RESEARCH FACT), ArtDirection.decision_ids grounds Scene/Shot
// production in decisions (CREATIVE DECISION), Shot.scene_id links to Scene
// (bidirectionally, via Scene.shots[]), and AssetRequirement.shot_id links
// to Shot. Every one of those FKs is checked to resolve; a broken link
// throws TraceabilityError naming the exact chain link, never silently
// dropped or guessed.

import { TraceabilityError } from "./errors.js";
import type {
  ArtDirection,
  AssetRequirement,
  ContentStructure,
  Decision,
  PromptSpecification,
  Scene,
  Shot,
} from "./types.js";

export function validateTraceabilityChain(params: {
  claimIds: Set<string>;
  contentStructure: ContentStructure;
  decisions: Decision[];
  artDirection: ArtDirection;
  scenes: Scene[];
  shots: Shot[];
  assetRequirements: AssetRequirement[];
  prompts: PromptSpecification[];
}): void {
  // RESEARCH FACT -> CREATIVE DECISION (via ContentStructure grounding)
  for (const claimId of params.contentStructure.key_claims_used) {
    if (!params.claimIds.has(claimId)) {
      throw new TraceabilityError("RESEARCH FACT", claimId, "claim_id not found in the ingested Research Package");
    }
  }

  const decisionIds = new Set(params.decisions.map((d) => d.decision_id));
  for (const decisionId of params.artDirection.decision_ids) {
    if (!decisionIds.has(decisionId)) {
      throw new TraceabilityError("CREATIVE DECISION", decisionId, "decision_id not found in the decision log");
    }
  }

  // CREATIVE DECISION -> SCENE: at least one grounding decision must exist
  // before any scene is produced from this art direction.
  if (params.scenes.length > 0 && params.artDirection.decision_ids.length === 0) {
    throw new TraceabilityError(
      "CREATIVE DECISION -> SCENE",
      params.artDirection.art_direction_id,
      "scenes were planned from an art direction with no grounding decisions",
    );
  }

  // SCENE -> SHOT (bidirectional FK consistency)
  const sceneIds = new Set(params.scenes.map((s) => s.scene_id));
  const shotIds = new Set(params.shots.map((s) => s.shot_id));
  for (const shot of params.shots) {
    if (!sceneIds.has(shot.scene_id)) {
      throw new TraceabilityError("SCENE", shot.scene_id, `referenced by shot "${shot.shot_id}" but not found`);
    }
  }
  for (const scene of params.scenes) {
    for (const shotId of scene.shots) {
      if (!shotIds.has(shotId)) {
        throw new TraceabilityError("SHOT", shotId, `referenced by scene "${scene.scene_id}" but not found`);
      }
    }
  }

  // TIER-2 REPAIR T2.1 — Scene <-> Shot EXACT EQUALITY.
  //
  // AUDIT FINDING PARTIALLY CORRECTED: the brief says "validate both
  // directions"; both directions were in fact already validated above.
  // The real gap is that each direction only checked that the referenced id
  // RESOLVES, never that the two sides AGREE. Both of these passed before:
  //   * a shot with scene_id "S1" that S1.shots never lists
  //   * a shot listed in S1.shots whose own scene_id is "S2"
  // Exact set equality per scene is now required.
  const shotsByScene = new Map<string, Set<string>>();
  for (const shot of params.shots) {
    if (!shotsByScene.has(shot.scene_id)) shotsByScene.set(shot.scene_id, new Set());
    shotsByScene.get(shot.scene_id)!.add(shot.shot_id);
  }
  for (const scene of params.scenes) {
    const declared = new Set(scene.shots);
    const actual = shotsByScene.get(scene.scene_id) ?? new Set<string>();
    for (const shotId of declared) {
      if (!actual.has(shotId)) {
        throw new TraceabilityError(
          "SCENE <-> SHOT",
          scene.scene_id,
          `scene lists shot "${shotId}" but that shot's scene_id points elsewhere`,
        );
      }
    }
    for (const shotId of actual) {
      if (!declared.has(shotId)) {
        throw new TraceabilityError(
          "SCENE <-> SHOT",
          scene.scene_id,
          `shot "${shotId}" claims this scene but the scene does not list it in shots[]`,
        );
      }
    }
  }

  // SHOT -> ASSET REQUIREMENT
  for (const req of params.assetRequirements) {
    if (!shotIds.has(req.shot_id)) {
      throw new TraceabilityError(
        "ASSET REQUIREMENT",
        req.asset_requirement_id,
        `references shot "${req.shot_id}" which was not found`,
      );
    }
  }

  // TIER-2 REPAIR T2.2 — Shot -> AssetRequirement COVERAGE.
  //
  // Only the reverse direction (does the requirement's shot exist?) was
  // checked, so a shot with NO asset plan at all passed traceability and
  // reached P3 as a silently unplanned shot. Array-length equality is
  // explicitly not used; every shot must be covered by id.
  const plannedShotIds = new Set(params.assetRequirements.map((r) => r.shot_id));
  for (const shot of params.shots) {
    if (!plannedShotIds.has(shot.shot_id)) {
      throw new TraceabilityError(
        "SHOT -> ASSET REQUIREMENT",
        shot.shot_id,
        "shot has no AssetRequirement; it would reach P3 with nothing planned to fill it",
      );
    }
  }

  // Prompt traceable_to (shot_id, asset_requirement_id, decision_id) — the
  // Prompt Architecture's own FK back into this same chain.
  //
  // TIER-1 REPAIR T1.7: asset_requirement_id is new and must resolve, and
  // must belong to the same shot the prompt claims. Without it the canonical
  // chain Shot -> AssetRequirement -> PromptSpecification -> Asset had a
  // missing link and P3 could not prove which asset satisfied which
  // requirement.
  const requirementById = new Map(params.assetRequirements.map((r) => [r.asset_requirement_id, r]));
  for (const prompt of params.prompts) {
    const requirement = requirementById.get(prompt.traceable_to.asset_requirement_id);
    if (!requirement) {
      throw new TraceabilityError(
        "PROMPT -> ASSET REQUIREMENT",
        prompt.traceable_to.asset_requirement_id,
        `prompt "${prompt.prompt_spec_id}" traces to an asset requirement that was not found`,
      );
    }
    if (requirement.shot_id !== prompt.traceable_to.shot_id) {
      throw new TraceabilityError(
        "PROMPT -> ASSET REQUIREMENT",
        prompt.traceable_to.asset_requirement_id,
        `prompt "${prompt.prompt_spec_id}" claims shot "${prompt.traceable_to.shot_id}" but its ` +
          `asset requirement belongs to shot "${requirement.shot_id}"`,
      );
    }
    if (!shotIds.has(prompt.traceable_to.shot_id)) {
      throw new TraceabilityError(
        "PROMPT -> SHOT",
        prompt.traceable_to.shot_id,
        `prompt "${prompt.prompt_spec_id}" traces to a shot that was not found`,
      );
    }
    if (!decisionIds.has(prompt.traceable_to.decision_id)) {
      throw new TraceabilityError(
        "PROMPT -> DECISION",
        prompt.traceable_to.decision_id,
        `prompt "${prompt.prompt_spec_id}" traces to a decision that was not found`,
      );
    }
  }
}
