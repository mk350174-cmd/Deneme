// Integration / golden-example test: committed static P1 fixture -> ingest
// -> full P2.01-P2.11 run with ManualCreativeReasoningEngine -> schema-
// complete ProductionPackageHandoff -> both gates passed. This is the
// "verify the P1->P2 handoff compatibility" test, using the fixture instead
// of any dependency on pipeline1_research (see plan "Package layout").

import { describe, expect, it } from "vitest";
import { GateStateError, TraceabilityError, ValidationError } from "../src/errors.js";
import { parseResearchPackage } from "../src/ingest.js";
import { selectReferences, suggestCandidates } from "../src/referenceDiscovery.js";
import { ManualCreativeReasoningEngine, type ManualEngineFixtures } from "../src/creativeReasoningEngine.js";
import { buildPromptSpecId, GoogleFlowRenderer, InMemoryPromptLibrary } from "../src/promptArchitecture.js";
import { recommend, recordHumanDecision } from "../src/aiDirector.js";
import {
  approveArtDirection,
  approveProductionPackage,
  approveReferences,
  decideFormat,
  draftProductionPackage,
  requireProductionPackageApproved,
  runP202Understand,
  runP203Strategize,
  runP206ArtDirection,
  runP207AssetPlanning,
  runP208SceneShotPlanning,
  runP209FlowPromptDirection,
  runP210VoiceSpec,
} from "../src/pipeline.js";
import type { ArtDirection, ContentStructure, CreativeStrategy, Scene, Shot } from "../src/types.js";
import { RESEARCH_PACKAGE_FIXTURE } from "./fixtures/research_package.fixture.js";

function buildFixtures(decisionId: string): ManualEngineFixtures {
  const contentStructure: ContentStructure = {
    central_idea: "Roman aqueduct engineering",
    key_claims_used: ["claim_facts_aquaappia", "claim_quant_length"],
    narrative_material: ["construction_history", "total_length"],
    objective: "educate a general audience on Roman water engineering",
  };
  const creativeStrategy: CreativeStrategy = {
    strategy_id: "strat_aqueducts",
    communication_direction: "documentary, evidence-led",
    narrative_direction: "engineering achievement across centuries",
    creative_priorities: ["clarity", "historical accuracy"],
  };
  const artDirection: ArtDirection = {
    art_direction_id: "art_aqueducts",
    visual_language: "documentary realism, natural light, stone textures",
    checklist: ["Select character reference", "Define camera intention", "Define continuity anchors"],
    decision_ids: [decisionId],
  };
  const scenes: Scene[] = [
    {
      scene_id: "scene_aqueduct_intro",
      purpose: "establish the aqueduct system",
      shots: ["shot_wide_arch", "shot_water_flow"],
      continuity_requirements: ["stone color consistent across shots"],
      narrative_function: "opening",
    },
  ];
  const shots: Shot[] = [
    {
      shot_id: "shot_wide_arch",
      scene_id: "scene_aqueduct_intro",
      purpose: "wide establishing shot of the aqueduct arches",
      duration_intention: "3-4s",
      camera: { angle: "low", movement: "static", lens: "wide", framing: "wide" },
      action: "camera holds on the aqueduct arches against the sky",
      continuity_anchors: ["stone_color"],
      reference_requirements: [],
      asset_type: "VISUAL_IMAGE",
      generation_method: "google_flow",
    },
    {
      shot_id: "shot_water_flow",
      scene_id: "scene_aqueduct_intro",
      purpose: "close-up on flowing water in the channel",
      duration_intention: "2-3s",
      camera: { angle: "eye-level", movement: "slow push-in", lens: "macro", framing: "close_up" },
      action: "water flows steadily through the stone channel",
      continuity_anchors: ["stone_color"],
      reference_requirements: [],
      asset_type: "VISUAL_VIDEO",
      generation_method: "google_flow",
    },
  ];
  const promptSpecsByShotId: ManualEngineFixtures["promptSpecsByShotId"] = {
    shot_wide_arch: {
      prompt_spec_id: buildPromptSpecId("shot_wide_arch", "flow.shot.wide"),
      version: 1,
      subject: "A Roman stone aqueduct with multiple tall arches",
      composition: "low angle, arches filling the frame, symmetrical",
      style: "documentary realism, natural daylight",
      negative_constraints: ["no modern objects", "no people in modern clothing"],
      prompt_family: "flow.shot.wide",
      axis_tags: ["wide", "static"],
      // asset_requirement_id is stamped by runP209FlowPromptDirection from the
      // real AssetRequirement (T1.7); the authored fixture declares the shot.
      traceable_to: { shot_id: "shot_wide_arch", asset_requirement_id: "", decision_id: decisionId },
    },
    shot_water_flow: {
      prompt_spec_id: buildPromptSpecId("shot_water_flow", "flow.shot.closeup"),
      version: 1,
      subject: "Clear water flowing through a carved stone channel",
      composition: "close-up, water filling most of the frame",
      style: "documentary realism, natural daylight",
      camera: "macro lens, slow push-in",
      negative_constraints: ["no modern materials"],
      prompt_family: "flow.shot.closeup",
      axis_tags: ["close_up", "push_in"],
      traceable_to: { shot_id: "shot_water_flow", asset_requirement_id: "", decision_id: decisionId },
    },
  };

  return { contentStructure, creativeStrategy, artDirection, decisionLog: [], scenes, shots, promptSpecsByShotId };
}

export async function runFullPipeline(actor = "user:mk350174") {
  const pkg = parseResearchPackage(RESEARCH_PACKAGE_FIXTURE);

  // P2.01 Reference Discovery — Gate A2 transition 1
  const candidates = suggestCandidates([
    { label: "Ancient Engineering Explained", rationale: "Comparable documentary format and pacing." },
  ]);
  const references = selectReferences({
    candidates,
    approvedCandidateIds: [candidates[0]!.candidate_id],
    manuallyAddedSources: [],
  });
  const { gate: referencesGate } = approveReferences(references, actor);

  // AI Director produces one approved Decision, which grounds Art Direction.
  const recommended = recommend({
    question: "camera_choice",
    targetId: "shot_wide_arch",
    optionsConsidered: [{ choice: "static" }, { choice: "slow push-in" }],
    recommendation: "static",
    rationale: "Establishing shots benefit from a stable frame.",
  });
  const decision = recordHumanDecision(recommended, actor, "approved");

  const engine = new ManualCreativeReasoningEngine(buildFixtures(decision.decision_id));

  // P2.02 - P2.03
  const contentStructure = await runP202Understand(engine, pkg, references);
  const creativeStrategy = await runP203Strategize(engine, contentStructure, ["educate", "engage"]);

  // P2.04
  const format = decideFormat("vertical_short_video", ["under 60s"]);

  // P2.06 — Gate A2 transition 2
  const { artDirection } = await runP206ArtDirection(engine, creativeStrategy, references, []);
  // TIER-1 REPAIR T1.3: ART_DIRECTION_APPROVED is legal only after
  // REFERENCES_APPROVED is on record, so the history is passed in. Before
  // the repair the gates could be recorded in any order.
  const { gate: artDirectionGate } = approveArtDirection(artDirection, actor, [referencesGate]);

  // P2.08, P2.07, P2.09
  const { scenes, shots } = await runP208SceneShotPlanning(engine, creativeStrategy, artDirection);
  const assetRequirements = runP207AssetPlanning(shots, references);
  const library = new InMemoryPromptLibrary();
  const prompts = await runP209FlowPromptDirection(engine, shots, artDirection, assetRequirements, library, new GoogleFlowRenderer());

  // P2.10
  const { voice_script, pronunciation_flags } = runP210VoiceSpec([
    { text: "The Aqua Appia, Rome's first aqueduct, was completed in 312 BC.", claim_id: "claim_facts_aquaappia" },
    { text: "The network eventually exceeded 400 km in total length.", claim_id: "claim_quant_length" },
  ]);

  // P2.11 — draft + Gate A3
  const draft = draftProductionPackage({
    pkg,
    contentStructure,
    decisionLog: [decision],
    artDirection,
    scenes,
    shots,
    assetRequirements,
    prompts,
    voiceScript: voice_script,
    pronunciationFlags: pronunciation_flags,
    gates: [referencesGate, artDirectionGate],
  });

  return { pkg, draft, actor, format };
}

describe("Pipeline 2 golden-example (P2.01 -> P2.11, fixture-driven)", () => {
  it("produces a schema-complete ProductionPackageHandoff (P2->P3 handoff completeness test)", async () => {
    const { draft, pkg } = await runFullPipeline();

    expect(draft.package_id).toMatch(/^ppkg_/);
    expect(draft.production_package_version).toBe("1.0.0");
    expect(draft.project_id).toBe(pkg.project_id);
    expect(draft.research_package_ref).toBe(pkg.package_id);
    expect(draft.scenes.length).toBeGreaterThan(0);
    expect(draft.shots.length).toBeGreaterThan(0);
    expect(draft.asset_requirements.length).toBe(draft.shots.length);
    expect(draft.prompts.length).toBe(draft.shots.length);
    expect(draft.decision_log.length).toBeGreaterThan(0);
    expect(draft.voice_script.length).toBeGreaterThan(0);
    expect(draft.pronunciation_flags.length).toBeGreaterThan(0);
    expect(draft.user_approval_state.length).toBe(2); // both Gate A2 transitions so far
    expect(draft.manifest.length).toBeGreaterThan(0);
    expect(draft.integrity_hashes.package_sha256).toBeTruthy();
  });

  it("enforces Gate A3 in code: package unusable before approval, usable after", async () => {
    const { draft, actor } = await runFullPipeline();
    expect(() => requireProductionPackageApproved(draft)).toThrow(GateStateError);

    const { handoff } = approveProductionPackage(draft, actor);
    expect(() => requireProductionPackageApproved(handoff)).not.toThrow();
    expect(handoff.user_approval_state).toHaveLength(3); // 2x Gate A2 + Gate A3
  });

  it("P2.11 Reverse QA stops on a broken traceability link — no automatic repair", async () => {
    const pkg = parseResearchPackage(RESEARCH_PACKAGE_FIXTURE);
    const recommended = recommend({
      question: "camera_choice",
      targetId: "shot_wide_arch",
      optionsConsidered: [{ choice: "static" }],
      recommendation: "static",
      rationale: "r",
    });
    const decision = recordHumanDecision(recommended, "user:mk350174", "approved");
    const fixtures = buildFixtures(decision.decision_id);
    const engine = new ManualCreativeReasoningEngine(fixtures);

    const contentStructure = await runP202Understand(engine, pkg, []);
    const creativeStrategy = await runP203Strategize(engine, contentStructure, []);
    const { artDirection } = await runP206ArtDirection(engine, creativeStrategy, [], []);
    const { scenes, shots } = await runP208SceneShotPlanning(engine, creativeStrategy, artDirection);
    const assetRequirements = runP207AssetPlanning(shots, []);
    const prompts = await runP209FlowPromptDirection(engine, shots, artDirection, assetRequirements);
    const { voice_script, pronunciation_flags } = runP210VoiceSpec([{ text: "no risky tokens here" }]);

    // Deliberately break the chain: an art direction whose decision_ids
    // point at a decision that isn't in the decision_log.
    const brokenArtDirection = { ...artDirection, decision_ids: ["dec_does_not_exist"] };

    expect(() =>
      draftProductionPackage({
        pkg,
        contentStructure,
        decisionLog: [decision],
        artDirection: brokenArtDirection,
        scenes,
        shots,
        assetRequirements,
        prompts,
        voiceScript: voice_script,
        pronunciationFlags: pronunciation_flags,
        gates: [],
      }),
    ).toThrow(TraceabilityError);
  });

  it("P2.02 refuses a claim_id not present in the ingested Research Package (never repeats/invents research)", async () => {
    const pkg = parseResearchPackage(RESEARCH_PACKAGE_FIXTURE);
    const fixtures = buildFixtures("dec_x");
    fixtures.contentStructure = { ...fixtures.contentStructure, key_claims_used: ["claim_not_in_package"] };
    const engine = new ManualCreativeReasoningEngine(fixtures);

    await expect(runP202Understand(engine, pkg, [])).rejects.toThrow(ValidationError);
  });

  it("is deterministic: re-running yields the same production package_id and shot/scene id sets", async () => {
    const runA = await runFullPipeline();
    const runB = await runFullPipeline();
    expect(runA.draft.package_id).toBe(runB.draft.package_id);
    expect(runA.draft.shots.map((s) => s.shot_id).sort()).toEqual(runB.draft.shots.map((s) => s.shot_id).sort());
    expect(runA.draft.scenes.map((s) => s.scene_id).sort()).toEqual(runB.draft.scenes.map((s) => s.scene_id).sort());
  });
});
