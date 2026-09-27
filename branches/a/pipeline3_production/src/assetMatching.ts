// P3.03 Asset Matching — the explicit 5-stage chain (correction 1 & the
// user's final contract-correction pass):
//
//   AssetRequirement (real shot_id FK)
//     -> declared asset_delivery_map entry   [IDENTITY]
//     -> asset_file_id
//     -> hash verification                    [INTEGRITY]
//     -> media-property compatibility check    [COMPATIBILITY]
//     -> ResolvedAsset
//
// These are complementary checks, not interchangeable matching mechanisms.
// No filename/order/timestamp/hash-similarity/visual-similarity heuristic
// is ever consulted — a missing or dangling delivery-map entry fails loud
// with a typed P3Error, never a fallback guess.

import { P3Error } from "./errors.js";
import { isWellFormedSha256 } from "./ids.js";
import type { AssetDeliveryMapEntry, AssetRequirement, GeneratedAssetFile, ResolvedAsset } from "./types.js";

// AUDIT FIX (forensic integration audit, §13 item 1): the previous check
// compared requirement.expected_media_properties["type"] against the
// delivered file's type. P2's real AssetRequirement output
// (pipeline2_creative's runP207AssetPlanning) always leaves
// expected_media_properties as {} by default and states the required
// class in expected_media_type instead — so the old check was a permanent
// no-op against P2's actual output, confirmed by re-reading the frozen P2
// source. This maps P2's canonical asset_type vocabulary (A_BRANCH_SPEC
// P2.07) to the media "kind" a delivered file declares, and checks that
// field instead — the field P2 actually populates.
const ASSET_TYPE_MEDIA_KIND: Record<string, string> = {
  VISUAL_IMAGE: "image",
  GRAPHIC: "image",
  REFERENCE: "image",
  VISUAL_VIDEO: "video",
  VOICE: "audio",
  MUSIC: "audio",
  SFX: "audio",
  TEXT: "text",
  DATA: "data",
};

function isMediaCompatible(requirement: AssetRequirement, file: GeneratedAssetFile): boolean {
  // Minimal, non-inventive compatibility check: if the requirement's
  // canonical type maps to a known media kind, the file's declared
  // media_properties.type must agree where both are known. No guessing
  // beyond what both sides declare.
  const expectedKind = ASSET_TYPE_MEDIA_KIND[requirement.expected_media_type];
  const fileKind = file.media_properties?.["type"];
  if (expectedKind !== undefined && fileKind !== undefined && expectedKind !== fileKind) {
    return false;
  }
  return true;
}

export function resolveAssetRequirement(
  requirement: AssetRequirement,
  deliveryMap: AssetDeliveryMapEntry[],
  generatedFiles: GeneratedAssetFile[],
): ResolvedAsset {
  // Stage 1 — IDENTITY: the delivery map is the only source of truth for
  // which file fulfills which requirement.
  const mapEntry = deliveryMap.find((e) => e.asset_requirement_id === requirement.asset_requirement_id);
  if (!mapEntry) {
    if (requirement.required) {
      throw new P3Error({
        code: "MISSING_ASSET",
        field: "asset_delivery_map",
        object_id: requirement.asset_requirement_id,
        reason: "no asset_delivery_map entry declares a file for this required asset requirement",
      });
    }
    throw new P3Error({
      code: "MISSING_ASSET",
      field: "asset_delivery_map",
      object_id: requirement.asset_requirement_id,
      reason: "no asset_delivery_map entry for this (optional) asset requirement",
    });
  }

  // Stage 2 — the declared file must actually exist among generated_assets.
  const file = generatedFiles.find((f) => f.asset_file_id === mapEntry.asset_file_id);
  if (!file) {
    throw new P3Error({
      code: "MISSING_ASSET",
      field: "asset_delivery_map.asset_file_id",
      object_id: mapEntry.asset_file_id,
      reason: `asset_delivery_map for "${requirement.asset_requirement_id}" points at an unknown asset_file_id`,
    });
  }

  // Stage 3 — INTEGRITY: hash must be well-formed.
  if (!isWellFormedSha256(file.hash)) {
    throw new P3Error({
      code: "ASSET_ERROR",
      field: "hash",
      object_id: file.asset_file_id,
      reason: `hash "${file.hash}" is not a well-formed sha256 hex digest`,
    });
  }

  // Stage 4 — COMPATIBILITY: media properties must be consistent with what
  // the requirement expects.
  if (!isMediaCompatible(requirement, file)) {
    throw new P3Error({
      code: "WRONG_ASSET",
      field: "media_properties",
      object_id: file.asset_file_id,
      reason: `media properties of "${file.asset_file_id}" are not compatible with requirement "${requirement.asset_requirement_id}"`,
    });
  }

  // Stage 5 — resolved.
  return {
    asset_requirement_id: requirement.asset_requirement_id,
    shot_id: requirement.shot_id,
    asset_file_id: file.asset_file_id,
    hash: file.hash,
    media_properties: file.media_properties,
  };
}

export function resolveAllAssetRequirements(
  requirements: AssetRequirement[],
  deliveryMap: AssetDeliveryMapEntry[],
  generatedFiles: GeneratedAssetFile[],
): ResolvedAsset[] {
  return requirements.map((req) => resolveAssetRequirement(req, deliveryMap, generatedFiles));
}
