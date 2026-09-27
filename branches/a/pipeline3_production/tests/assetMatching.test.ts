// P3.03 Asset Matching — items 4-8: matching by stable ID/hash, rejection
// of filename-only/timestamp-only matching, wrong/missing asset detection.

import { describe, expect, it } from "vitest";
import { P3Error } from "../src/errors.js";
import { resolveAllAssetRequirements, resolveAssetRequirement } from "../src/assetMatching.js";
import { PRODUCTION_PACKAGE_FIXTURE } from "./fixtures/production_package.fixture.js";
import { PRODUCTION_DELIVERY_FIXTURE } from "./fixtures/production_delivery.fixture.js";

const requirements = PRODUCTION_PACKAGE_FIXTURE.asset_requirements;
const { asset_delivery_map, generated_assets } = PRODUCTION_DELIVERY_FIXTURE;

describe("Asset matching by declared ID + hash + media properties (item 4)", () => {
  it("resolves all requirements via the explicit delivery map", () => {
    const resolved = resolveAllAssetRequirements(requirements, asset_delivery_map, generated_assets);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]?.shot_id).toBe("shot_wide_arch");
    expect(resolved[0]?.asset_file_id).toBe("file_wide_arch_001");
  });
});

describe("rejects filename-only matching (item 5)", () => {
  it("does not match by filename similarity when no delivery-map entry exists — even if the file 'looks right'", () => {
    const req = requirements[0]!;
    const filesWithNoMapEntry = [{ asset_file_id: "shot_wide_arch_final.png", hash: "1234567890abcdef".repeat(4), media_properties: { type: "image" } }];
    expect(() => resolveAssetRequirement(req, [], filesWithNoMapEntry)).toThrow(P3Error);
  });
});

describe("rejects timestamp-only / ordering-only matching (item 6)", () => {
  it("does not match by array order when delivery map entries are absent", () => {
    const req = requirements[1]!; // shot_water_flow
    // Only one generated file exists, positioned first — a naive
    // order-based matcher might wrongly pick it for req[1]; the explicit
    // matcher must refuse since there's no delivery-map entry for it.
    expect(() => resolveAssetRequirement(req, [], generated_assets)).toThrow(P3Error);
  });
});

describe("wrong-asset detection (item 7)", () => {
  it("flags WRONG_ASSET when media properties are incompatible with the requirement", () => {
    const req = requirements[0]!; // expects type: "image"
    const mismatchedMap = [{ asset_requirement_id: req.asset_requirement_id, asset_file_id: "file_wrong_type" }];
    const mismatchedFiles = [{ asset_file_id: "file_wrong_type", hash: "abcdef1234567890".repeat(4), media_properties: { type: "video" } }];
    try {
      resolveAssetRequirement(req, mismatchedMap, mismatchedFiles);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(P3Error);
      expect((err as P3Error).code).toBe("WRONG_ASSET");
      expect((err as P3Error).required_action).toBe("REPLACE_WRONG_ASSET");
    }
  });
});

describe("AUDIT FIX §13.1 — media-type compatibility against P2's REAL output shape", () => {
  it("checks expected_media_type, not the empty expected_media_properties P2 actually produces (regression for the confirmed no-op)", () => {
    // requirements[0] now has expected_media_properties: {} (P2's real
    // default) and expected_media_type: "VISUAL_IMAGE" (P2's real field).
    const req = requirements[0]!;
    expect(req.expected_media_properties).toEqual({});
    expect(req.expected_media_type).toBe("VISUAL_IMAGE");

    // A VIDEO file delivered for this IMAGE requirement must now be
    // rejected — previously this passed silently because the old check
    // only ever looked at expected_media_properties.type, which is always
    // empty on P2's real output.
    const wrongTypeMap = [{ asset_requirement_id: req.asset_requirement_id, asset_file_id: "file_wrong_type" }];
    const wrongTypeFiles = [{ asset_file_id: "file_wrong_type", hash: "1234567890abcdef".repeat(4), media_properties: { type: "video" } }];
    try {
      resolveAssetRequirement(req, wrongTypeMap, wrongTypeFiles);
      throw new Error("expected WRONG_ASSET to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(P3Error);
      expect((err as P3Error).code).toBe("WRONG_ASSET");
    }
  });

  it("correctly accepts a matching-type file under P2's real (empty expected_media_properties) shape", () => {
    const req = requirements[0]!; // VISUAL_IMAGE, expected_media_properties: {}
    const map = [{ asset_requirement_id: req.asset_requirement_id, asset_file_id: "file_right_type" }];
    const files = [{ asset_file_id: "file_right_type", hash: "1234567890abcdef".repeat(4), media_properties: { type: "image" } }];
    const resolved = resolveAssetRequirement(req, map, files);
    expect(resolved.asset_file_id).toBe("file_right_type");
  });
});

describe("missing-asset detection (item 8)", () => {
  it("flags MISSING_ASSET when the delivery map has no entry for a required requirement", () => {
    const req = requirements[0]!;
    try {
      resolveAssetRequirement(req, [], []);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(P3Error);
      expect((err as P3Error).code).toBe("MISSING_ASSET");
      expect((err as P3Error).required_action).toBe("UPLOAD_MISSING_ASSET");
    }
  });

  it("flags MISSING_ASSET when the delivery map points at an unknown asset_file_id (dangling reference, no fallback)", () => {
    const req = requirements[0]!;
    const danglingMap = [{ asset_requirement_id: req.asset_requirement_id, asset_file_id: "file_does_not_exist" }];
    expect(() => resolveAssetRequirement(req, danglingMap, generated_assets)).toThrow(P3Error);
  });

  it("flags ASSET_ERROR for a malformed hash", () => {
    const req = requirements[0]!;
    const map = [{ asset_requirement_id: req.asset_requirement_id, asset_file_id: "file_bad_hash" }];
    const files = [{ asset_file_id: "file_bad_hash", hash: "not-a-real-hash", media_properties: { type: "image" } }];
    try {
      resolveAssetRequirement(req, map, files);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(P3Error);
      expect((err as P3Error).code).toBe("ASSET_ERROR");
      expect((err as P3Error).required_action).toBe("FIX_ASSET");
    }
  });
});
