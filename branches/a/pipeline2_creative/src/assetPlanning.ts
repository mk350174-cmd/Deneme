// P2.07 Asset Planning — docs/architecture/02_PIPELINE_2_ARCHITECTURE.md
// exact fields. ADAPT of GRAFİK's asset_planning.py Asset dataclass shape
// (asset_type/generation-required concepts), simplified to the architecture
// doc's literal field list.

import { stableAssetRequirementId } from "./ids.js";
import type { AssetRequirement, AssetRole, Reference, Shot } from "./types.js";

export function planAssetRequirement(params: {
  shot: Shot;
  expectedMediaType: string;
  expectedMediaProperties: Record<string, unknown>;
  generationMethod: string;
  references: Reference[];
  required: boolean;
  // Small-improvements addition (C5): both optional, both additive.
  // assetRole populates the separate AssetRequirement.asset_role field only
  // (never expected_media_type — see the doc comment on AssetRole in
  // types.ts). discriminator lets planAssetRequirement be called more than
  // once for the same shot_id/expectedMediaType (e.g. once per asset_role)
  // without id collisions; omitted, it defaults to 0, matching the id every
  // pre-C5 caller already got.
  assetRole?: AssetRole;
  discriminator?: string | number;
}): AssetRequirement {
  return {
    asset_requirement_id: stableAssetRequirementId(
      params.shot.shot_id,
      params.expectedMediaType,
      params.discriminator ?? 0,
    ),
    shot_id: params.shot.shot_id,
    expected_media_type: params.expectedMediaType,
    expected_media_properties: params.expectedMediaProperties,
    generation_method: params.generationMethod,
    reference_lineage: params.references.filter((r) => r.approved).map((r) => r.reference_id),
    required: params.required,
    asset_role: params.assetRole,
  };
}

// Small-improvements addition (C5): a reasoned suggestion, never a
// silently-applied fixed rule — callers see the rationale and decide
// whether to act on it, matching this project's no-silent-decision
// discipline. The heuristic itself (roughly one asset per scene, plus one
// extra per 30s of runtime for pacing/detail cutaways) is a starting point
// for a human planner to adjust, not an authoritative count.
export function estimateAssetCountForVideo(
  videoDurationS: number,
  sceneCount: number,
): { estimated_count: number; rationale: string } {
  if (videoDurationS <= 0 || sceneCount <= 0) {
    return {
      estimated_count: 0,
      rationale: "videoDurationS and sceneCount must both be positive; no estimate can be made from non-positive inputs.",
    };
  }
  const pacingAssets = Math.round(videoDurationS / 30);
  const estimated_count = sceneCount + pacingAssets;
  return {
    estimated_count,
    rationale:
      `Baseline of 1 asset per scene (${sceneCount} scene${sceneCount === 1 ? "" : "s"}) ` +
      `plus roughly 1 additional pacing/detail asset per 30s of runtime ` +
      `(${videoDurationS}s / 30 ≈ ${pacingAssets}). This is a starting-point suggestion for a human planner to adjust, not an applied rule.`,
  };
}
