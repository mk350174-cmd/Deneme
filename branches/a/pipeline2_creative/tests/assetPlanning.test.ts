import { describe, expect, it } from "vitest";
import { estimateAssetCountForVideo, planAssetRequirement } from "../src/assetPlanning.js";
import { runP207AssetPlanning } from "../src/pipeline.js";
import type { Reference, Shot } from "../src/types.js";

const shot: Shot = {
  shot_id: "shot_1",
  scene_id: "scene_1",
  purpose: "establishing shot",
  duration_intention: "3-4s",
  camera: { angle: "low", movement: "static", lens: "wide", framing: "wide" },
  action: "hold on the aqueduct",
  continuity_anchors: [],
  reference_requirements: [],
  asset_type: "VISUAL_IMAGE",
  generation_method: "google_flow",
};

describe("P2.07 Asset Planning (exact architecture fields)", () => {
  it("derives asset_requirement fields from the shot's own asset_type/generation_method", () => {
    const references: Reference[] = [{ reference_id: "ref_1", source: "x", approved: true }, { reference_id: "ref_2", source: "y", approved: false }];
    const req = planAssetRequirement({
      shot,
      expectedMediaType: shot.asset_type,
      expectedMediaProperties: { aspect_ratio: "9:16" },
      generationMethod: shot.generation_method,
      references,
      required: true,
    });
    expect(req.shot_id).toBe("shot_1");
    expect(req.expected_media_type).toBe("VISUAL_IMAGE");
    expect(req.reference_lineage).toEqual(["ref_1"]); // only approved references
    expect(req.required).toBe(true);
  });

  it("is deterministic for the same shot/media type", () => {
    const a = planAssetRequirement({ shot, expectedMediaType: "VISUAL_IMAGE", expectedMediaProperties: {}, generationMethod: "x", references: [], required: true });
    const b = planAssetRequirement({ shot, expectedMediaType: "VISUAL_IMAGE", expectedMediaProperties: {}, generationMethod: "x", references: [], required: true });
    expect(a.asset_requirement_id).toBe(b.asset_requirement_id);
  });
});

describe("C5 — advanced asset planning (small improvements)", () => {
  it("two assets on the same shot with the same expected_media_type but different asset_role get distinct asset_requirement_ids", () => {
    const primary = planAssetRequirement({
      shot,
      expectedMediaType: "VISUAL_IMAGE",
      expectedMediaProperties: {},
      generationMethod: "google_flow",
      references: [],
      required: true,
      assetRole: "primary_visual",
      discriminator: 0,
    });
    const detail = planAssetRequirement({
      shot,
      expectedMediaType: "VISUAL_IMAGE",
      expectedMediaProperties: {},
      generationMethod: "google_flow",
      references: [],
      required: true,
      assetRole: "detail_insert",
      discriminator: 1,
    });
    expect(primary.asset_requirement_id).not.toBe(detail.asset_requirement_id);
    expect(primary.asset_role).toBe("primary_visual");
    expect(detail.asset_role).toBe("detail_insert");
    // expected_media_type carries only the P3-recognized media kind, never the role.
    expect(primary.expected_media_type).toBe("VISUAL_IMAGE");
    expect(detail.expected_media_type).toBe("VISUAL_IMAGE");
  });

  it("omitting assetRole/discriminator leaves asset_role undefined and reproduces the pre-C5 default-discriminator id", () => {
    const req = planAssetRequirement({
      shot,
      expectedMediaType: "VISUAL_IMAGE",
      expectedMediaProperties: {},
      generationMethod: "x",
      references: [],
      required: true,
    });
    expect(req.asset_role).toBeUndefined();
    const reqWithExplicitZero = planAssetRequirement({
      shot,
      expectedMediaType: "VISUAL_IMAGE",
      expectedMediaProperties: {},
      generationMethod: "x",
      references: [],
      required: true,
      discriminator: 0,
    });
    expect(req.asset_requirement_id).toBe(reqWithExplicitZero.asset_requirement_id);
  });

  it("estimateAssetCountForVideo returns a rationale string, not just a bare number", () => {
    const result = estimateAssetCountForVideo(90, 3);
    expect(result.estimated_count).toBeGreaterThan(0);
    expect(typeof result.rationale).toBe("string");
    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it("estimateAssetCountForVideo refuses to guess from non-positive inputs", () => {
    const result = estimateAssetCountForVideo(0, 3);
    expect(result.estimated_count).toBe(0);
    expect(result.rationale).toMatch(/positive/);
  });

  it("runP207AssetPlanning's default path (no assetPlansByShotId) stays 1-requirement-per-shot, byte-identical to pre-C5 behavior", () => {
    const requirements = runP207AssetPlanning([shot], []);
    expect(requirements).toHaveLength(1);
    expect(requirements[0]?.asset_role).toBeUndefined();
    expect(requirements[0]?.expected_media_type).toBe("VISUAL_IMAGE");
  });

  it("runP207AssetPlanning's optional richer path plans multiple AssetRequirements for one shot, each with a distinct asset_role and id", () => {
    const requirements = runP207AssetPlanning([shot], [], {}, {
      shot_1: [
        { role: "primary_visual", mediaType: "VISUAL_IMAGE", mediaProperties: {} },
        { role: "detail_insert", mediaType: "VISUAL_IMAGE", mediaProperties: {} },
      ],
    });
    expect(requirements).toHaveLength(2);
    expect(requirements.map((r) => r.asset_role)).toEqual(["primary_visual", "detail_insert"]);
    const ids = new Set(requirements.map((r) => r.asset_requirement_id));
    expect(ids.size).toBe(2);
    // Every requirement still traces back to the same shot.
    for (const r of requirements) expect(r.shot_id).toBe("shot_1");
  });
});
