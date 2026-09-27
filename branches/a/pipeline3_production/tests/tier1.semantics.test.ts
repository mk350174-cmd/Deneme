// TIER-1/TIER-2 REPAIR — semantic proof tests for P3.
// Every assertion here fails against the unrepaired baseline.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderTimeline, findMissingRequiredAssets } from "../src/render.js";
import type { ExecRemotionRender } from "../src/render.js";
import {
  buildRenderBundle,
  buildWorkerPayload,
  assertPinnedCodeVersion,
  verifyRenderBundle,
} from "../src/renderBundle.js";
import { validateAssetHashAgainstBytes, validateAssetHash } from "../src/assetValidation.js";
import { P3Error } from "../src/errors.js";
import { resolveAssetFilePath } from "../src/assetStaging.js";
import { sha256Buffer } from "../src/ids.js";
import { verifyProductionPackageIntegrity } from "../src/ingest.js";
import { PRODUCTION_PACKAGE_FIXTURE, sealProductionPackage } from "./fixtures/production_package.fixture.js";
import { HandoffValidationError } from "../src/errors.js";
import type { ResolvedAsset, Timeline } from "../src/types.js";

let workDir: string;
beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "p3-tier1-"));
});
afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

const timeline: Timeline = {
  fps: 30,
  total_frames: 60,
  entries: [
    { shot_id: "shot_1", asset_file_id: "file_1", start_frame: 0, duration_frames: 30 },
    { shot_id: "shot_2", asset_file_id: "file_2", start_frame: 30, duration_frames: 30 },
  ],
};
const resolvedAssets: ResolvedAsset[] = [
  { asset_requirement_id: "areq_1", shot_id: "shot_1", asset_file_id: "file_1", hash: "1".repeat(64), media_properties: {} },
  { asset_requirement_id: "areq_2", shot_id: "shot_2", asset_file_id: "file_2", hash: "2".repeat(64), media_properties: {} },
];

// ---------------------------------------------------------------------------
// T1.11 — render safety for missing required assets
// ---------------------------------------------------------------------------

describe("T1.11 render safety for missing required assets", () => {
  it("findMissingRequiredAssets reports every required asset not on disk", async () => {
    const missing = await findMissingRequiredAssets({
      timeline,
      resolvedAssets,
      stagingDir: workDir,
      // neither file staged
    });
    expect(missing).toHaveLength(2);
  });

  it("production mode hard-fails BEFORE rendering when a required asset is missing", async () => {
    let execCalled = false;
    const exec: ExecRemotionRender = async ({ outputPath }) => {
      execCalled = true;
      await fs.writeFile(outputPath, Buffer.alloc(10, 0x01));
      return { bytes: 10 };
    };
    const manifest = await renderTimeline(
      {
        projectId: "proj_1",
        targetId: "master",
        outputPath: path.join(workDir, "out.mp4"),
        resolution: "1080x1920",
        codec: "h264",
        timeline,
        resolvedAssets,
        stagingDir: workDir,
        // mode defaults to "production"
      },
      exec,
    );
    // Not one frame is rendered — the exec seam is never invoked.
    expect(execCalled).toBe(false);
    expect(manifest.result).toBe("failed");
    expect(manifest.outputs).toHaveLength(0);
  });

  it("staging the required assets lets production mode render normally", async () => {
    await fs.writeFile(resolveAssetFilePath("file_1", workDir), Buffer.alloc(10, 0x01));
    await fs.writeFile(resolveAssetFilePath("file_2", workDir), Buffer.alloc(10, 0x02));
    const exec: ExecRemotionRender = async ({ outputPath }) => {
      await fs.writeFile(outputPath, Buffer.alloc(10, 0x03));
      return { bytes: 10 };
    };
    const manifest = await renderTimeline(
      {
        projectId: "proj_1",
        targetId: "master",
        outputPath: path.join(workDir, "out.mp4"),
        resolution: "1080x1920",
        codec: "h264",
        timeline,
        resolvedAssets,
        stagingDir: workDir,
      },
      exec,
    );
    expect(manifest.result).toBe("success");
  });

  it("development mode still permits a placeholder render with missing assets", async () => {
    const exec: ExecRemotionRender = async ({ outputPath }) => {
      await fs.writeFile(outputPath, Buffer.alloc(10, 0x04));
      return { bytes: 10 };
    };
    const manifest = await renderTimeline(
      {
        projectId: "proj_1",
        targetId: "master",
        outputPath: path.join(workDir, "out.mp4"),
        resolution: "1080x1920",
        codec: "h264",
        timeline,
        resolvedAssets,
        stagingDir: workDir,
        mode: "development",
      },
      exec,
    );
    expect(manifest.result).toBe("success");
  });

  it("an optional (non-required) missing asset does not block a production render", async () => {
    await fs.writeFile(resolveAssetFilePath("file_1", workDir), Buffer.alloc(10, 0x01));
    // file_2 never staged, but is not in requiredRequirementIds.
    const exec: ExecRemotionRender = async ({ outputPath }) => {
      await fs.writeFile(outputPath, Buffer.alloc(10, 0x05));
      return { bytes: 10 };
    };
    const manifest = await renderTimeline(
      {
        projectId: "proj_1",
        targetId: "master",
        outputPath: path.join(workDir, "out.mp4"),
        resolution: "1080x1920",
        codec: "h264",
        timeline,
        resolvedAssets,
        stagingDir: workDir,
        requiredRequirementIds: new Set(["areq_1"]),
      },
      exec,
    );
    expect(manifest.result).toBe("success");
  });
});

// ---------------------------------------------------------------------------
// T1.2 — real per-file asset integrity (byte-level)
// ---------------------------------------------------------------------------

describe("T1.2 real asset byte-hash verification", () => {
  it("accepts an asset whose declared hash matches its real staged bytes", async () => {
    const bytes = Buffer.from("hello world");
    const filePath = resolveAssetFilePath("file_x", workDir);
    await fs.writeFile(filePath, bytes);
    const asset = { asset_file_id: "file_x", hash: sha256Buffer(bytes), media_properties: {} };
    await expect(validateAssetHashAgainstBytes(asset, workDir)).resolves.not.toThrow();
  });

  it("rejects an asset whose declared hash does not match its real staged bytes", async () => {
    const filePath = resolveAssetFilePath("file_y", workDir);
    await fs.writeFile(filePath, Buffer.from("actual content"));
    // Well-formed-looking hash for DIFFERENT content — the exact "looks
    // like a SHA-256" gap the brief names.
    const wrongButWellFormed = sha256Buffer(Buffer.from("declared content"));
    const asset = { asset_file_id: "file_y", hash: wrongButWellFormed, media_properties: {} };
    await expect(validateAssetHashAgainstBytes(asset, workDir)).rejects.toThrow(P3Error);
  });

  it("validateAssetHash alone (shape-only) is insufficient — passes even for wrong content", () => {
    // Documents exactly what the OLD check covered and why it needed T1.2:
    // shape-only validation cannot catch a hash/content mismatch.
    const wrongButWellFormed = sha256Buffer(Buffer.from("declared content"));
    expect(() => validateAssetHash({ asset_file_id: "file_y", hash: wrongButWellFormed, media_properties: {} })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T1.2 — P2 -> P3 production package integrity
// ---------------------------------------------------------------------------

describe("T1.2 P2 -> P3 production package integrity", () => {
  it("accepts a genuinely sealed Production Package", () => {
    expect(() => verifyProductionPackageIntegrity(PRODUCTION_PACKAGE_FIXTURE)).not.toThrow();
  });

  it("rejects a package mutated after P2 sealed it, even with a well-formed-looking hash", () => {
    const tampered = { ...PRODUCTION_PACKAGE_FIXTURE, voice_script: "a completely different narration" };
    expect(tampered.integrity_hashes.package_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(() => verifyProductionPackageIntegrity(tampered)).toThrow(HandoffValidationError);
  });

  it("re-sealing after a legitimate edit verifies again", () => {
    const edited = sealProductionPackage({
      ...PRODUCTION_PACKAGE_FIXTURE,
      voice_script: "legitimately revised narration",
    } as unknown as Record<string, unknown>);
    expect(() => verifyProductionPackageIntegrity(edited as never)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T1.8 — immutable render bundle
// ---------------------------------------------------------------------------

describe("T1.8 immutable render bundle", () => {
  function bundleParams() {
    return {
      timeline,
      resolvedAssets,
      renderConfig: { resolution: "1080x1920", codec: "h264", fps: 30 },
      packageManifest: [],
      productionPackageId: "ppkg_1",
      productionPackageHash: "0".repeat(64),
      codeVersion: { kind: "git_commit" as const, value: "a".repeat(40) },
    };
  }

  it("bundle_hash changes when the timeline changes", () => {
    const a = buildRenderBundle(bundleParams());
    const b = buildRenderBundle({ ...bundleParams(), timeline: { ...timeline, total_frames: 999 } });
    expect(a.bundle_hash).not.toBe(b.bundle_hash);
  });

  it("bundle_hash changes when an asset's content hash changes", () => {
    const a = buildRenderBundle(bundleParams());
    const changedAssets = resolvedAssets.map((r, i) => (i === 0 ? { ...r, hash: "9".repeat(64) } : r));
    const b = buildRenderBundle({ ...bundleParams(), resolvedAssets: changedAssets });
    expect(a.bundle_hash).not.toBe(b.bundle_hash);
  });

  it("bundle_hash changes when the code version changes", () => {
    const a = buildRenderBundle(bundleParams());
    const b = buildRenderBundle({ ...bundleParams(), codeVersion: { kind: "git_commit", value: "b".repeat(40) } });
    expect(a.bundle_hash).not.toBe(b.bundle_hash);
  });

  it("a timeline entry referencing an asset outside the bundle is refused", () => {
    const badTimeline: Timeline = {
      fps: 30,
      total_frames: 30,
      entries: [{ shot_id: "shot_x", asset_file_id: "file_not_in_manifest", start_frame: 0, duration_frames: 30 }],
    };
    expect(() => buildRenderBundle({ ...bundleParams(), timeline: badTimeline })).toThrow(P3Error);
  });

  it("verifyRenderBundle detects post-seal mutation", () => {
    const bundle = buildRenderBundle(bundleParams());
    const tampered = { ...bundle, render_config: { ...bundle.render_config, fps: 60 } };
    expect(verifyRenderBundle(tampered).valid).toBe(false);
  });

  it("buildWorkerPayload carries the REAL timeline, never an empty placeholder", () => {
    const bundle = buildRenderBundle(bundleParams());
    const payload = buildWorkerPayload(bundle, { shard_id: "shard_1", frame_range: { start: 0, end: 30 } });
    expect(payload.timeline_json).not.toBe("{}");
    expect(JSON.parse(payload.timeline_json)).toEqual(timeline);
    expect(payload.code_version.value).toBe("a".repeat(40));
  });

  it("buildWorkerPayload refuses a bundle that was mutated after sealing", () => {
    const bundle = buildRenderBundle(bundleParams());
    const tampered = { ...bundle, timeline: { ...bundle.timeline, total_frames: 1 } };
    expect(() => buildWorkerPayload(tampered, { shard_id: "shard_1", frame_range: { start: 0, end: 30 } })).toThrow(P3Error);
  });
});

// ---------------------------------------------------------------------------
// T1.9 — production code pinning
// ---------------------------------------------------------------------------

describe("T1.9 production code pinning", () => {
  it("accepts a full 40-hex commit SHA", () => {
    expect(() => assertPinnedCodeVersion({ kind: "git_commit", value: "a".repeat(40) })).not.toThrow();
  });

  it("rejects a branch name", () => {
    expect(() => assertPinnedCodeVersion({ kind: "git_commit", value: "main" })).toThrow(P3Error);
  });

  it("rejects HEAD", () => {
    expect(() => assertPinnedCodeVersion({ kind: "git_commit", value: "HEAD" })).toThrow(P3Error);
  });

  it("rejects a short/abbreviated SHA", () => {
    expect(() => assertPinnedCodeVersion({ kind: "git_commit", value: "abc1234" })).toThrow(P3Error);
  });

  it("accepts a release digest of sufficient length", () => {
    expect(() =>
      assertPinnedCodeVersion({ kind: "release_digest", value: "sha256:" + "a".repeat(64) }),
    ).not.toThrow();
  });
});


// ---------------------------------------------------------------------------
// R02.5 — worker asset binding proof
// ---------------------------------------------------------------------------

import { verifyRenderBundleAssetBinding, assertRenderBundleAssetBinding } from "../src/renderBundle.js";

describe("R02.5 worker asset binding: asset_file_id -> exact file -> SHA-256 match", () => {
  function bundleFor(assets: ResolvedAsset[]) {
    return buildRenderBundle({
      timeline,
      resolvedAssets: assets,
      renderConfig: { resolution: "1080x1920", codec: "h264", fps: 30 },
      packageManifest: [],
      productionPackageId: "ppkg_1",
      productionPackageHash: "0".repeat(64),
      codeVersion: { kind: "git_commit", value: "a".repeat(40) },
    });
  }

  it("verifies clean when every staged file's real bytes match the declared hash", async () => {
    const bytes1 = Buffer.from("real content for file_1");
    const bytes2 = Buffer.from("real content for file_2");
    await fs.writeFile(resolveAssetFilePath("file_1", workDir), bytes1);
    await fs.writeFile(resolveAssetFilePath("file_2", workDir), bytes2);
    const bundle = bundleFor([
      { asset_requirement_id: "areq_1", shot_id: "shot_1", asset_file_id: "file_1", hash: sha256Buffer(bytes1), media_properties: {} },
      { asset_requirement_id: "areq_2", shot_id: "shot_2", asset_file_id: "file_2", hash: sha256Buffer(bytes2), media_properties: {} },
    ]);
    const result = await verifyRenderBundleAssetBinding(bundle, workDir);
    expect(result.valid).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it("catches a staged file whose real bytes do NOT match the declared hash (swapped/corrupted file)", async () => {
    const realBytes = Buffer.from("the actual correct content");
    const wrongBytes = Buffer.from("a completely different, wrong file");
    // File on disk has WRONG content relative to what the bundle declares.
    // Both file_1 and file_2 must be covered (the shared `timeline` fixture
    // references both shots) — only file_1 is deliberately wrong.
    await fs.writeFile(resolveAssetFilePath("file_1", workDir), wrongBytes);
    await fs.writeFile(resolveAssetFilePath("file_2", workDir), Buffer.from("file_2 correct content"));
    const bundle = bundleFor([
      { asset_requirement_id: "areq_1", shot_id: "shot_1", asset_file_id: "file_1", hash: sha256Buffer(realBytes), media_properties: {} },
      { asset_requirement_id: "areq_2", shot_id: "shot_2", asset_file_id: "file_2", hash: sha256Buffer(Buffer.from("file_2 correct content")), media_properties: {} },
    ]);
    const result = await verifyRenderBundleAssetBinding(bundle, workDir);
    expect(result.valid).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]!.asset_file_id).toBe("file_1");
  });

  it("catches a missing (never staged) file distinctly from a mismatched one", async () => {
    await fs.writeFile(resolveAssetFilePath("file_2", workDir), Buffer.from("file_2 present and correct"));
    const bundle = bundleFor([
      { asset_requirement_id: "areq_1", shot_id: "shot_1", asset_file_id: "file_1", hash: "1".repeat(64), media_properties: {} },
      { asset_requirement_id: "areq_2", shot_id: "shot_2", asset_file_id: "file_2", hash: sha256Buffer(Buffer.from("file_2 present and correct")), media_properties: {} },
    ]);
    const result = await verifyRenderBundleAssetBinding(bundle, workDir);
    expect(result.valid).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]!.actual_hash).toBe("<unreadable>");
  });

  it("assertRenderBundleAssetBinding throws (hard gate) on any mismatch", async () => {
    const wrongBytes = Buffer.from("wrong");
    await fs.writeFile(resolveAssetFilePath("file_1", workDir), wrongBytes);
    await fs.writeFile(resolveAssetFilePath("file_2", workDir), Buffer.from("file_2 correct"));
    const bundle = bundleFor([
      { asset_requirement_id: "areq_1", shot_id: "shot_1", asset_file_id: "file_1", hash: "f".repeat(64), media_properties: {} },
      { asset_requirement_id: "areq_2", shot_id: "shot_2", asset_file_id: "file_2", hash: sha256Buffer(Buffer.from("file_2 correct")), media_properties: {} },
    ]);
    await expect(assertRenderBundleAssetBinding(bundle, workDir)).rejects.toThrow(P3Error);
  });

  it("integration: renderTimeline itself refuses to render when asset binding fails (full chain: asset_file_id -> file -> SHA-256 -> render gate)", async () => {
    // Both required assets are STAGED (so T1.11's presence check passes)
    // but one has been swapped for the wrong content.
    await fs.writeFile(resolveAssetFilePath("file_1", workDir), Buffer.from("wrong content"));
    await fs.writeFile(resolveAssetFilePath("file_2", workDir), Buffer.from("real content for file_2"));
    const bundle = bundleFor([
      { asset_requirement_id: "areq_1", shot_id: "shot_1", asset_file_id: "file_1", hash: sha256Buffer(Buffer.from("expected correct content")), media_properties: {} },
      { asset_requirement_id: "areq_2", shot_id: "shot_2", asset_file_id: "file_2", hash: sha256Buffer(Buffer.from("real content for file_2")), media_properties: {} },
    ]);
    let execCalled = false;
    const exec: ExecRemotionRender = async ({ outputPath }) => {
      execCalled = true;
      await fs.writeFile(outputPath, Buffer.alloc(10, 1));
      return { bytes: 10 };
    };
    const manifest = await renderTimeline(
      {
        projectId: "proj_1", targetId: "master", outputPath: path.join(workDir, "out.mp4"),
        resolution: "1080x1920", codec: "h264", timeline, resolvedAssets, stagingDir: workDir,
        renderBundle: bundle,
      },
      exec,
    );
    expect(execCalled).toBe(false);
    expect(manifest.result).toBe("failed");
    expect(manifest.error_details).toContain("worker binding verification");
  });
});
