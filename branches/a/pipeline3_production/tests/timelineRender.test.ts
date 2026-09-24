// P3.07 Timeline / P3.08 Render — item 19 (Remotion timeline contract),
// item 20 (creative-decision immutability: canonical Scene/Shot/Prompt/
// Decision content is unchanged after being passed through timing/timeline/
// render).

import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTimeline } from "../src/timeline.js";
import { computeTiming } from "../src/timing.js";
import { renderTimeline } from "../src/render.js";
import type { ExecRemotionRender } from "../src/render.js";
import type { ResolvedAsset } from "../src/types.js";
import { PRODUCTION_PACKAGE_FIXTURE } from "./fixtures/production_package.fixture.js";

// Real execRender implementations must produce a real file at outputPath —
// render.ts now hashes the file's actual bytes (not run_id/size metadata),
// so a fixture that returns { bytes } without writing anything would fail
// on the readFile step. `fill` lets tests produce distinguishable content.
// TIER-1 REPAIR T1.11 NOTE: production mode (renderTimeline's default) now
// hard-fails before rendering if a required asset is not staged on disk.
// This file tests render.ts's OWN mechanics (manifest shape, hashing,
// codec/resolution plumbing, failure handling) via controllable exec seams
// that never touch real staged files — it is not testing asset-presence
// safety, which has its own dedicated tests in tier1.semantics.test.ts.
// Every call here therefore opts into `mode: "development"` explicitly.
function tmpOutputPath(name: string): string {
  return path.join(os.tmpdir(), `p3-render-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
}
function makeWritingExec(byteCount: number, fill = 0x42): ExecRemotionRender {
  return async ({ outputPath }) => {
    await fs.writeFile(outputPath, Buffer.alloc(byteCount, fill));
    return { bytes: byteCount };
  };
}

// Capturing exec that verifies the frozen ExecRemotionRender seam signature
// contains ONLY the 4 required parameters (timeline, outputPath, resolvedAssets, stagingDir)
// and does NOT receive resolution/codec through the seam interface.
function makeCapturingExec(): [ExecRemotionRender, () => { seenParams: string[] }] {
  let seenParams: string[] = [];
  const exec: ExecRemotionRender = async (params) => {
    seenParams = Object.keys(params);
    await fs.writeFile(params.outputPath, Buffer.alloc(1, 0x01));
    return { bytes: 1 };
  };
  return [exec, () => ({ seenParams })];
}

const resolvedAssets: ResolvedAsset[] = [
  { asset_requirement_id: "astreq_wide_arch", shot_id: "shot_wide_arch", asset_file_id: "file_wide_arch_001", hash: "1234567890abcdef".repeat(4), media_properties: { type: "image" } },
  { asset_requirement_id: "astreq_water_flow", shot_id: "shot_water_flow", asset_file_id: "file_water_flow_001", hash: "abcdef1234567890".repeat(4), media_properties: { type: "video" } },
];

describe("Timeline contract (item 19)", () => {
  it("builds ordered, non-overlapping frame ranges preserving Scene.shots[] order", () => {
    const timing = computeTiming(PRODUCTION_PACKAGE_FIXTURE.shots, 6);
    const timeline = buildTimeline(PRODUCTION_PACKAGE_FIXTURE.scenes, timing, resolvedAssets);

    expect(timeline.entries).toHaveLength(2);
    expect(timeline.entries[0]?.shot_id).toBe("shot_wide_arch");
    expect(timeline.entries[1]?.shot_id).toBe("shot_water_flow");
    expect(timeline.entries[0]?.start_frame).toBe(0);
    expect(timeline.entries[1]?.start_frame).toBe(timeline.entries[0]!.duration_frames);
    expect(timeline.total_frames).toBe(timeline.entries[0]!.duration_frames + timeline.entries[1]!.duration_frames);
  });
});

describe("Render manifest contract (ADAPT of Studio's render_manifest.schema.json)", () => {
  it("produces a render manifest with the expected fields on success", async () => {
    const timing = computeTiming(PRODUCTION_PACKAGE_FIXTURE.shots, 6);
    const timeline = buildTimeline(PRODUCTION_PACKAGE_FIXTURE.scenes, timing, resolvedAssets);
    const outputPath = tmpOutputPath("out.mp4");

    const manifest = await renderTimeline(
      { projectId: "proj_1", targetId: "master", outputPath, resolution: "1080x1920", codec: "h264", timeline, resolvedAssets, stagingDir: "/tmp/p3-staging", mode: "development" },
      makeWritingExec(1024),
    );
    expect(manifest.result).toBe("success");
    expect(manifest.outputs).toHaveLength(1);
    expect(manifest.fps).toBe(timeline.fps);
    expect(manifest.outputs[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reports result: failed when the render seam throws, without inventing an output", async () => {
    const timing = computeTiming(PRODUCTION_PACKAGE_FIXTURE.shots, 6);
    const timeline = buildTimeline(PRODUCTION_PACKAGE_FIXTURE.scenes, timing, resolvedAssets);
    const failingExec: ExecRemotionRender = async () => {
      throw new Error("render crashed");
    };
    const manifest = await renderTimeline(
      { projectId: "proj_1", targetId: "master", outputPath: tmpOutputPath("out-fail.mp4"), resolution: "1080x1920", codec: "h264", timeline, resolvedAssets, stagingDir: "/tmp/p3-staging", mode: "development" },
      failingExec,
    );
    expect(manifest.result).toBe("failed");
    expect(manifest.outputs).toHaveLength(0);
  });

  it("AUDIT FIX §13.5 correction 2: resolvedAssets and stagingDir are threaded through to the render seam unchanged", async () => {
    const timing = computeTiming(PRODUCTION_PACKAGE_FIXTURE.shots, 6);
    const timeline = buildTimeline(PRODUCTION_PACKAGE_FIXTURE.scenes, timing, resolvedAssets);
    let seenResolvedAssets: ResolvedAsset[] | undefined;
    let seenStagingDir: string | undefined;
    const capturingExec: ExecRemotionRender = async (params) => {
      seenResolvedAssets = params.resolvedAssets;
      seenStagingDir = params.stagingDir;
      await fs.writeFile(params.outputPath, Buffer.alloc(1, 0x01));
      return { bytes: 1 };
    };

    await renderTimeline(
      { projectId: "proj_1", targetId: "master", outputPath: tmpOutputPath("out-capture.mp4"), resolution: "1080x1920", codec: "h264", timeline, resolvedAssets, stagingDir: "/tmp/p3-staging", mode: "development" },
      capturingExec,
    );

    expect(seenResolvedAssets).toEqual(resolvedAssets);
    expect(seenStagingDir).toBe("/tmp/p3-staging");
  });

  it("REAL CONTENT HASH: two same-size outputs with different bytes get different sha256 (proves hash is not run_id/size metadata)", async () => {
    const timing = computeTiming(PRODUCTION_PACKAGE_FIXTURE.shots, 6);
    const timeline = buildTimeline(PRODUCTION_PACKAGE_FIXTURE.scenes, timing, resolvedAssets);
    const sameByteCount = 2048;

    const manifestA = await renderTimeline(
      { projectId: "proj_1", targetId: "master", outputPath: tmpOutputPath("content-a.mp4"), resolution: "1080x1920", codec: "h264", timeline, resolvedAssets, stagingDir: "/tmp/p3-staging", mode: "development" },
      makeWritingExec(sameByteCount, 0xaa),
    );
    const manifestB = await renderTimeline(
      { projectId: "proj_1", targetId: "master", outputPath: tmpOutputPath("content-b.mp4"), resolution: "1080x1920", codec: "h264", timeline, resolvedAssets, stagingDir: "/tmp/p3-staging", mode: "development" },
      makeWritingExec(sameByteCount, 0xbb),
    );

    expect(manifestA.outputs[0]?.bytes).toBe(sameByteCount);
    expect(manifestB.outputs[0]?.bytes).toBe(sameByteCount);
    expect(manifestA.outputs[0]?.bytes).toBe(manifestB.outputs[0]?.bytes);
    expect(manifestA.outputs[0]?.sha256).not.toBe(manifestB.outputs[0]?.sha256);
  });

  it("REAL CONTENT HASH: identical file bytes always produce the identical sha256 (deterministic content hash)", async () => {
    const timing = computeTiming(PRODUCTION_PACKAGE_FIXTURE.shots, 6);
    const timeline = buildTimeline(PRODUCTION_PACKAGE_FIXTURE.scenes, timing, resolvedAssets);

    const manifestA = await renderTimeline(
      { projectId: "proj_1", targetId: "master", outputPath: tmpOutputPath("dup-a.mp4"), resolution: "1080x1920", codec: "h264", timeline, resolvedAssets, stagingDir: "/tmp/p3-staging", mode: "development" },
      makeWritingExec(512, 0x77),
    );
    const manifestB = await renderTimeline(
      { projectId: "proj_2", targetId: "master", outputPath: tmpOutputPath("dup-b.mp4"), resolution: "1080x1920", codec: "h264", timeline, resolvedAssets, stagingDir: "/tmp/p3-staging", mode: "development" },
      makeWritingExec(512, 0x77),
    );

    // Different projectId (-> different run_id) but IDENTICAL file bytes must
    // yield the IDENTICAL sha256 — the hash is a function of content only.
    expect(manifestA.run_id).not.toBe(manifestB.run_id);
    expect(manifestA.outputs[0]?.sha256).toBe(manifestB.outputs[0]?.sha256);
  });

  it("AUDIT FIX §C: manifest records the actual codec passed to renderTimeline (frozen seam does not receive it)", async () => {
    const timing = computeTiming(PRODUCTION_PACKAGE_FIXTURE.shots, 6);
    const timeline = buildTimeline(PRODUCTION_PACKAGE_FIXTURE.scenes, timing, resolvedAssets);
    const [exec, getCaptured] = makeCapturingExec();

    const manifest = await renderTimeline(
      { projectId: "proj_1", targetId: "master", outputPath: tmpOutputPath("codec-test.mp4"), resolution: "1080x1920", codec: "h264", timeline, resolvedAssets, stagingDir: "/tmp/p3-staging", mode: "development" },
      exec,
    );

    // Verify the manifest's codec field matches what was passed to renderTimeline.
    expect(manifest.codec).toBe("h264");
    // Verify the frozen seam did NOT receive codec as a parameter (contract preserved).
    const params = getCaptured().seenParams;
    expect(params).toContain("timeline");
    expect(params).toContain("outputPath");
    expect(params).toContain("resolvedAssets");
    expect(params).toContain("stagingDir");
    expect(params).not.toContain("codec");
  });

  it("AUDIT FIX §C: manifest records the actual resolution passed to renderTimeline (frozen seam does not receive it)", async () => {
    const timing = computeTiming(PRODUCTION_PACKAGE_FIXTURE.shots, 6);
    const timeline = buildTimeline(PRODUCTION_PACKAGE_FIXTURE.scenes, timing, resolvedAssets);
    const [exec, getCaptured] = makeCapturingExec();

    const manifest = await renderTimeline(
      { projectId: "proj_1", targetId: "master", outputPath: tmpOutputPath("resolution-test.mp4"), resolution: "1080x1920", codec: "h264", timeline, resolvedAssets, stagingDir: "/tmp/p3-staging", mode: "development" },
      exec,
    );

    // Verify the manifest's resolution field matches what was passed to renderTimeline.
    expect(manifest.resolution).toBe("1080x1920");
    // Verify the frozen seam did NOT receive resolution as a parameter (contract preserved).
    const params = getCaptured().seenParams;
    expect(params).toContain("timeline");
    expect(params).toContain("outputPath");
    expect(params).toContain("resolvedAssets");
    expect(params).toContain("stagingDir");
    expect(params).not.toContain("resolution");
  });

  it("AUDIT FIX §C: manifest codec and resolution remain consistent across success and failure paths", async () => {
    const timing = computeTiming(PRODUCTION_PACKAGE_FIXTURE.shots, 6);
    const timeline = buildTimeline(PRODUCTION_PACKAGE_FIXTURE.scenes, timing, resolvedAssets);

    const failingExec: ExecRemotionRender = async () => {
      throw new Error("render crashed");
    };

    const successManifest = await renderTimeline(
      { projectId: "proj_1", targetId: "master", outputPath: tmpOutputPath("success-config.mp4"), resolution: "2160x3840", codec: "vp9", timeline, resolvedAssets, stagingDir: "/tmp/p3-staging", mode: "development" },
      makeWritingExec(1),
    );

    const failureManifest = await renderTimeline(
      { projectId: "proj_1", targetId: "master", outputPath: tmpOutputPath("failure-config.mp4"), resolution: "2160x3840", codec: "vp9", timeline, resolvedAssets, stagingDir: "/tmp/p3-staging", mode: "development" },
      failingExec,
    );

    // Both success and failure manifests should record the intended codec/resolution.
    expect(successManifest.codec).toBe("vp9");
    expect(successManifest.resolution).toBe("2160x3840");
    expect(failureManifest.codec).toBe("vp9");
    expect(failureManifest.resolution).toBe("2160x3840");
  });

  it("DEFECT C PATH A: contract-preserving mechanism — resolution/codec via env vars (not seam)", async () => {
    // This test verifies that P3.08 frozen seam remains exactly 4 parameters while still
    // supporting render configuration. The mechanism: renderTimeline sets process.env
    // before calling execRender, and defaultExecRemotionRender reads from process.env.
    const timing = computeTiming(PRODUCTION_PACKAGE_FIXTURE.shots, 6);
    const timeline = buildTimeline(PRODUCTION_PACKAGE_FIXTURE.scenes, timing, resolvedAssets);

    // Capture what execRender receives
    let seenEnvResolution: string | undefined;
    let seenEnvCodec: string | undefined;
    let seenParams: string[] = [];

    const captureEnvExec: ExecRemotionRender = async (params) => {
      seenParams = Object.keys(params);
      seenEnvResolution = process.env.REMOTION_RESOLUTION;
      seenEnvCodec = process.env.REMOTION_CODEC;
      await fs.writeFile(params.outputPath, Buffer.alloc(1, 0x01));
      return { bytes: 1 };
    };

    const manifest = await renderTimeline(
      { projectId: "proj_1", targetId: "master", outputPath: tmpOutputPath("env-test.mp4"), resolution: "3840x2160", codec: "av1", timeline, resolvedAssets, stagingDir: "/tmp/p3-staging", mode: "development" },
      captureEnvExec,
    );

    // Verify manifest records the correct values
    expect(manifest.codec).toBe("av1");
    expect(manifest.resolution).toBe("3840x2160");

    // Verify frozen seam signature is preserved (4 params, no resolution/codec)
    expect(seenParams).toEqual(["timeline", "outputPath", "resolvedAssets", "stagingDir"]);
    expect(seenParams).not.toContain("resolution");
    expect(seenParams).not.toContain("codec");

    // Verify environment variables were set during execution
    expect(seenEnvResolution).toBe("3840x2160");
    expect(seenEnvCodec).toBe("av1");
  });
});

describe("Creative-decision immutability (item 20)", () => {
  it("canonical Scene/Shot content is unchanged after timing + timeline + render", async () => {
    const scenesBefore = JSON.stringify(PRODUCTION_PACKAGE_FIXTURE.scenes);
    const shotsBefore = JSON.stringify(PRODUCTION_PACKAGE_FIXTURE.shots);
    const promptsBefore = JSON.stringify(PRODUCTION_PACKAGE_FIXTURE.prompts);
    const decisionsBefore = JSON.stringify(PRODUCTION_PACKAGE_FIXTURE.decision_log);

    const timing = computeTiming(PRODUCTION_PACKAGE_FIXTURE.shots, 6);
    const timeline = buildTimeline(PRODUCTION_PACKAGE_FIXTURE.scenes, timing, resolvedAssets);
    await renderTimeline(
      { projectId: "proj_1", targetId: "master", outputPath: tmpOutputPath("out-immutability.mp4"), resolution: "1080x1920", codec: "h264", timeline, resolvedAssets, stagingDir: "/tmp/p3-staging", mode: "development" },
      makeWritingExec(1),
    );

    expect(JSON.stringify(PRODUCTION_PACKAGE_FIXTURE.scenes)).toBe(scenesBefore);
    expect(JSON.stringify(PRODUCTION_PACKAGE_FIXTURE.shots)).toBe(shotsBefore);
    expect(JSON.stringify(PRODUCTION_PACKAGE_FIXTURE.prompts)).toBe(promptsBefore);
    expect(JSON.stringify(PRODUCTION_PACKAGE_FIXTURE.decision_log)).toBe(decisionsBefore);
  });
});
