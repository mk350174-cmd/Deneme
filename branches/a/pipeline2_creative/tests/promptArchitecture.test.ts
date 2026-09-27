import { describe, expect, it } from "vitest";
import { GoogleFlowRenderer, InMemoryPromptLibrary, buildPromptSpecId, generateIndividualAssetPrompts } from "../src/promptArchitecture.js";
import type { AssetRequirement, ArtDirection, PromptSpecification } from "../src/types.js";

function spec(overrides: Partial<PromptSpecification> = {}): PromptSpecification {
  return {
    prompt_spec_id: buildPromptSpecId("shot_1", "flow.shot.closeup"),
    version: 1,
    subject: "A stone aqueduct arch",
    composition: "Low angle, arch filling the frame",
    style: "Documentary realism",
    negative_constraints: ["no modern objects"],
    prompt_family: "flow.shot.closeup",
    axis_tags: ["close_up", "static"],
    traceable_to: { shot_id: "shot_1", asset_requirement_id: "areq_1", decision_id: "dec_1" },
    ...overrides,
  };
}

describe("Canonical Prompt Architecture (layer separation contract test)", () => {
  it("Layer 2 spec has no field longer than what was supplied — no truncation (GRAFİK's 100-char bug removed)", () => {
    const longSubject = "A".repeat(250);
    const s = spec({ subject: longSubject });
    const renderer = new GoogleFlowRenderer();
    const rendered = renderer.render(s);
    expect(s.subject.length).toBe(250);
    expect(rendered.prompt_text).toContain(longSubject);
  });

  it("rendering does not mutate the stored Layer 2 spec", () => {
    const s = spec();
    const before = JSON.stringify(s);
    const renderer = new GoogleFlowRenderer();
    renderer.render(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("Layer 2 spec is identical regardless of how many times / which providers render it", () => {
    const s = spec();
    const renderer = new GoogleFlowRenderer();
    const r1 = renderer.render(s);
    const r2 = renderer.render(s);
    expect(r1.prompt_text).toBe(r2.prompt_text);
    // The spec itself carries no provider-specific text field.
    expect((s as unknown as Record<string, unknown>).prompt_text).toBeUndefined();
  });

  it("Google Flow prompt text is Layer 4 output only, never the canonical stored prompt", () => {
    const library = new InMemoryPromptLibrary();
    const s = spec();
    library.store(s);
    const stored = library.get(s.prompt_spec_id);
    expect(stored).toEqual(s);
    expect((stored as unknown as Record<string, unknown>).prompt_text).toBeUndefined();
  });

  it("Prompt Library is searchable by family and axis_tags", () => {
    const library = new InMemoryPromptLibrary();
    library.store(spec({ prompt_spec_id: "a", prompt_family: "flow.shot.closeup", axis_tags: ["close_up"] }));
    library.store(spec({ prompt_spec_id: "b", prompt_family: "flow.shot.wide", axis_tags: ["wide", "static"] }));

    expect(library.findByFamily("flow.shot.closeup")).toHaveLength(1);
    expect(library.findByAxisTags(["static"])).toHaveLength(1);
    expect(library.all()).toHaveLength(2);
  });
});

describe("P2-F Improvement: Individual Visual Generation Prompts", () => {
  function artDirection(): ArtDirection {
    return {
      art_direction_id: "art_test",
      visual_language: "documentary realism, natural light, stone textures, muted earth tones",
      checklist: ["Select reference", "Define continuity"],
      decision_ids: ["dec_1"],
    };
  }

  function assetRequirement(overrides: Partial<AssetRequirement> = {}): AssetRequirement {
    return {
      asset_requirement_id: "astreq_1",
      shot_id: "shot_1",
      expected_media_type: "VISUAL_IMAGE",
      expected_media_properties: { resolution: "1080p" },
      generation_method: "google_flow",
      reference_lineage: [],
      required: true,
      ...overrides,
    };
  }

  it("generateIndividualAssetPrompts creates one prompt per asset", () => {
    const assets = [
      assetRequirement({ shot_id: "shot_1", asset_requirement_id: "astreq_1" }),
      assetRequirement({ shot_id: "shot_2", asset_requirement_id: "astreq_2" }),
      assetRequirement({ shot_id: "shot_3", asset_requirement_id: "astreq_3" }),
    ];

    const prompts = generateIndividualAssetPrompts(assets, artDirection(), "dec_fixture_0001");

    expect(prompts).toHaveLength(3);
    expect(prompts.every((p) => p.prompt_spec_id)).toBe(true);
  });

  it("each generated prompt references the art direction visual language", () => {
    const artDir = artDirection();
    const assets = [assetRequirement()];

    const prompts = generateIndividualAssetPrompts(assets, artDir, "dec_fixture_0001");

    expect(prompts[0]!.composition).toContain(artDir.visual_language);
    expect(prompts[0]!.lighting).toContain(artDir.visual_language);
    expect(prompts[0]!.style).toContain(artDir.visual_language);
  });

  it("prompt asset_role becomes axis tag", () => {
    const assets = [assetRequirement({ asset_role: "primary_visual" }), assetRequirement({ asset_role: "transition" })];

    const prompts = generateIndividualAssetPrompts(assets, artDirection(), "dec_fixture_0001");

    expect(prompts[0]!.axis_tags).toContain("primary_visual");
    expect(prompts[1]!.axis_tags).toContain("transition");
  });

  it("prompt_family includes asset_role", () => {
    const assets = [assetRequirement({ asset_role: "detail_insert" })];

    const prompts = generateIndividualAssetPrompts(assets, artDirection(), "dec_fixture_0001");

    expect(prompts[0]!.prompt_family).toContain("detail_insert");
  });

  it("prompt_spec_id is deterministic: same asset produces same id", () => {
    const asset = assetRequirement({ shot_id: "shot_1", asset_role: "primary_visual" });
    const artDir = artDirection();

    const prompt1 = generateIndividualAssetPrompts([asset], artDir, "dec_fixture_0001");
    const prompt2 = generateIndividualAssetPrompts([asset], artDir, "dec_fixture_0001");

    expect(prompt1[0]!.prompt_spec_id).toBe(prompt2[0]!.prompt_spec_id);
  });

  it("different assets with same shot_id get different prompt_spec_ids", () => {
    const assets = [
      assetRequirement({ shot_id: "shot_1", asset_role: "primary_visual" }),
      assetRequirement({ shot_id: "shot_1", asset_role: "transition" }),
    ];

    const prompts = generateIndividualAssetPrompts(assets, artDirection(), "dec_fixture_0001");

    expect(prompts[0]!.prompt_spec_id).not.toBe(prompts[1]!.prompt_spec_id);
  });

  it("continuity checklist becomes continuity field in prompt", () => {
    const artDir = artDirection();
    const assets = [assetRequirement()];

    const prompts = generateIndividualAssetPrompts(assets, artDir, "dec_fixture_0001");

    expect(prompts[0]!.continuity).toContain("Select reference");
    expect(prompts[0]!.continuity).toContain("Define continuity");
  });

  it("expected_media_type becomes axis tag for filtering", () => {
    const assets = [
      assetRequirement({ expected_media_type: "VISUAL_IMAGE" }),
      assetRequirement({ expected_media_type: "VISUAL_VIDEO" }),
    ];

    const prompts = generateIndividualAssetPrompts(assets, artDirection(), "dec_fixture_0001");

    expect(prompts[0]!.axis_tags).toContain("VISUAL_IMAGE");
    expect(prompts[1]!.axis_tags).toContain("VISUAL_VIDEO");
  });

  it("can render individual asset prompts through GoogleFlowRenderer", () => {
    const assets = [assetRequirement()];
    const prompts = generateIndividualAssetPrompts(assets, artDirection(), "dec_fixture_0001");
    const renderer = new GoogleFlowRenderer();

    const rendered = renderer.render(prompts[0]!);

    expect(rendered.prompt_text).toContain("documentary realism");
    expect(rendered.provider).toBe("google_flow");
  });

  it("batch of prompts can be stored in PromptLibrary", () => {
    const assets = [
      assetRequirement({ shot_id: "shot_1", asset_requirement_id: "astreq_1" }),
      assetRequirement({ shot_id: "shot_2", asset_requirement_id: "astreq_2" }),
    ];
    const prompts = generateIndividualAssetPrompts(assets, artDirection(), "dec_fixture_0001");
    const library = new InMemoryPromptLibrary();

    for (const prompt of prompts) {
      library.store(prompt);
    }

    expect(library.all()).toHaveLength(2);
    expect(library.all().every((p) => p.composition)).toBe(true);
  });

  it("quality > batch processing: each asset gets custom prompt, not templated", () => {
    const assets = [
      assetRequirement({ shot_id: "shot_1", asset_requirement_id: "astreq_1", asset_role: "primary_visual" }),
      assetRequirement({ shot_id: "shot_1", asset_requirement_id: "astreq_2", asset_role: "detail_insert" }),
      assetRequirement({ shot_id: "shot_2", asset_requirement_id: "astreq_3", asset_role: "transition" }),
    ];

    const prompts = generateIndividualAssetPrompts(assets, artDirection(), "dec_fixture_0001");

    // Each prompt has unique spec_id (based on shot + role)
    const specIds = prompts.map((p) => p.prompt_spec_id);
    expect(new Set(specIds).size).toBe(3); // All unique

    // All reference art direction (custom per asset, not batch template)
    expect(prompts.every((p) => p.style.includes("documentary realism"))).toBe(true);
  });
});
