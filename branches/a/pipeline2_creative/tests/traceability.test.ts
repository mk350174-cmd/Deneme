import { describe, expect, it } from "vitest";
import { TraceabilityError } from "../src/errors.js";
import { validateTraceabilityChain } from "../src/traceability.js";
import type { ArtDirection, AssetRequirement, ContentStructure, Decision, PromptSpecification, Scene, Shot } from "../src/types.js";

function baseChain() {
  const contentStructure: ContentStructure = {
    central_idea: "Roman engineering ingenuity",
    key_claims_used: ["claim_1"],
    narrative_material: [],
    objective: "educate",
  };
  const decision: Decision = {
    decision_id: "dec_1",
    question: "camera_choice",
    options_considered: [{ choice: "static" }],
    recommendation: "static",
    rationale: "r",
    status: "approved",
    approving_actor: "user:mk350174",
    timestamp: new Date().toISOString(),
    precedent_refs: [],
  };
  const artDirection: ArtDirection = {
    art_direction_id: "art_1",
    visual_language: "documentary realism",
    checklist: [],
    decision_ids: ["dec_1"],
  };
  const scene: Scene = {
    scene_id: "scene_1",
    purpose: "establish setting",
    shots: ["shot_1"],
    continuity_requirements: [],
    narrative_function: "opening",
  };
  const shot: Shot = {
    shot_id: "shot_1",
    scene_id: "scene_1",
    purpose: "wide establishing shot",
    duration_intention: "3-4s",
    camera: { angle: "low", movement: "static", lens: "wide", framing: "wide" },
    action: "camera holds on the aqueduct",
    continuity_anchors: [],
    reference_requirements: [],
    asset_type: "VISUAL_IMAGE",
    generation_method: "google_flow",
  };
  const assetRequirement: AssetRequirement = {
    asset_requirement_id: "astreq_1",
    shot_id: "shot_1",
    expected_media_type: "VISUAL_IMAGE",
    expected_media_properties: {},
    generation_method: "google_flow",
    reference_lineage: [],
    required: true,
  };
  const prompt: PromptSpecification = {
    prompt_spec_id: "pspec_1",
    version: 1,
    subject: "aqueduct",
    composition: "wide",
    style: "documentary",
    negative_constraints: [],
    prompt_family: "flow.shot.wide",
    axis_tags: ["wide"],
    traceable_to: { shot_id: "shot_1", asset_requirement_id: "astreq_1", decision_id: "dec_1" },
  };

  return {
    claimIds: new Set(["claim_1"]),
    contentStructure,
    decisions: [decision],
    artDirection,
    scenes: [scene],
    shots: [shot],
    assetRequirements: [assetRequirement],
    prompts: [prompt],
  };
}

describe("Asset Traceability chain (contract test)", () => {
  it("accepts a fully-resolved chain", () => {
    expect(() => validateTraceabilityChain(baseChain())).not.toThrow();
  });

  it("fails loud when a claim_id used in ContentStructure doesn't exist", () => {
    const chain = baseChain();
    chain.claimIds = new Set(["some_other_claim"]);
    expect(() => validateTraceabilityChain(chain)).toThrow(TraceabilityError);
  });

  it("fails loud when ArtDirection references a nonexistent decision_id", () => {
    const chain = baseChain();
    chain.artDirection = { ...chain.artDirection, decision_ids: ["dec_nonexistent"] };
    expect(() => validateTraceabilityChain(chain)).toThrow(TraceabilityError);
  });

  it("fails loud when a shot references a scene_id that doesn't exist (never inferred from ordering)", () => {
    const chain = baseChain();
    chain.shots = [{ ...chain.shots[0]!, scene_id: "scene_nonexistent" }];
    expect(() => validateTraceabilityChain(chain)).toThrow(TraceabilityError);
  });

  it("fails loud when an asset requirement references a shot_id that doesn't exist", () => {
    const chain = baseChain();
    chain.assetRequirements = [{ ...chain.assetRequirements[0]!, shot_id: "shot_nonexistent" }];
    expect(() => validateTraceabilityChain(chain)).toThrow(TraceabilityError);
  });

  it("fails loud when a prompt traces to a shot or decision that doesn't exist", () => {
    const chainShot = baseChain();
    chainShot.prompts = [{ ...chainShot.prompts[0]!, traceable_to: { shot_id: "nope", asset_requirement_id: "astreq_1", decision_id: "dec_1" } }];
    expect(() => validateTraceabilityChain(chainShot)).toThrow(TraceabilityError);

    const chainDecision = baseChain();
    chainDecision.prompts = [{ ...chainDecision.prompts[0]!, traceable_to: { shot_id: "shot_1", asset_requirement_id: "astreq_1", decision_id: "nope" } }];
    expect(() => validateTraceabilityChain(chainDecision)).toThrow(TraceabilityError);
  });
});
