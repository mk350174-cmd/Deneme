// P3-B Orchestration Bridge Tests
// Validates that P3.06 → P3.07 → P3.08 production sequence is properly wired.

import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runP306Timing, runP307Timeline, runP308Render } from "../src/pipeline.js";
import type { ExecRemotionRender } from "../src/render.js";
import type { ResolvedAsset, Scene, Shot } from "../src/types.js";

function tmpOutputPath(name: string): string {
  return path.join(os.tmpdir(), `p3b-render-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
}

describe("P3-B: Orchestration Bridge (P3.06 → P3.07 → P3.08)", () => {
  const shots: Shot[] = [
    {
      shot_id: "shot_1",
      scene_id: "scene_1",
      purpose: "Test",
      duration_intention: "3s",
      camera: { angle: "wide", movement: "static", lens: "standard", framing: "full" },
      action: "test action",
      continuity_anchors: [],
      reference_requirements: [],
      asset_type: "image",
      generation_method: "test",
    },
    {
      shot_id: "shot_2",
      scene_id: "scene_1",
      purpose: "Test",
      duration_intention: "2s",
      camera: { angle: "close", movement: "static", lens: "standard", framing: "close_up" },
      action: "test action",
      continuity_anchors: [],
      reference_requirements: [],
      asset_type: "image",
      generation_method: "test",
    },
  ];

  const scenes: Scene[] = [
    {
      scene_id: "scene_1",
      purpose: "Test Scene",
      shots: ["shot_1", "shot_2"],
      continuity_requirements: [],
      narrative_function: "Test",
    },
  ];

  const resolvedAssets: ResolvedAsset[] = [
    {
      asset_requirement_id: "req_1",
      shot_id: "shot_1",
      asset_file_id: "file_1",
      hash: "abcd".repeat(16),
      media_properties: { type: "image" },
    },
    {
      asset_requirement_id: "req_2",
      shot_id: "shot_2",
      asset_file_id: "file_2",
      hash: "efgh".repeat(16),
      media_properties: { type: "image" },
    },
  ];

  const fixtureExecRemotionRender: ExecRemotionRender = async ({ outputPath }) => {
    await fs.writeFile(outputPath, Buffer.alloc(4_200_000, 0x42));
    return { bytes: 4_200_000 };
  };

  it("P3.06 runP306Timing produces TimingResult from shots and narration duration", () => {
    const timing = runP306Timing(shots, 5.0); // 5 second narration
    expect(timing.actual_narration_duration_s).toBe(5.0);
    expect(timing.intended_total_duration_s).toBeCloseTo(5.0, 1); // 3s + 2s
    expect(timing.shot_timings).toHaveLength(2);
    expect(timing.shot_timings[0]?.shot_id).toBe("shot_1");
    expect(timing.shot_timings[1]?.shot_id).toBe("shot_2");
  });

  it("P3.07 runP307Timeline produces Timeline from scenes, timing, and assets", () => {
    const timing = runP306Timing(shots, 5.0);
    const timeline = runP307Timeline(scenes, timing, resolvedAssets, shots);
    expect(timeline.fps).toBe(30);
    expect(timeline.entries).toHaveLength(2);
    expect(timeline.entries[0]?.shot_id).toBe("shot_1");
    expect(timeline.entries[0]?.asset_file_id).toBe("file_1");
    expect(timeline.entries[0]?.duration_frames).toBeGreaterThan(0);
    expect(timeline.entries[1]?.shot_id).toBe("shot_2");
    expect(timeline.entries[1]?.asset_file_id).toBe("file_2");
  });

  it("P3.07 preserves Governance A: motion undefined when shots have no motion_plan", () => {
    const timing = runP306Timing(shots, 5.0);
    const timeline = runP307Timeline(scenes, timing, resolvedAssets, shots);
    // Current P2 provides NO motion_plan, so timeline.entries should have undefined motion
    expect(timeline.entries[0]?.motion).toBeUndefined();
    expect(timeline.entries[1]?.motion).toBeUndefined();
  });

  it("P3.08 runP308Render accepts Timeline and produces RenderManifest", async () => {
    const timing = runP306Timing(shots, 5.0);
    const timeline = runP307Timeline(scenes, timing, resolvedAssets, shots);
    const render = await runP308Render(
      {
        projectId: "test-project",
        targetId: "test-target",
        outputPath: tmpOutputPath("test.mp4"),
        resolution: "1080x1920",
        codec: "h264",
        timeline,
        resolvedAssets,
        stagingDir: "/tmp/test-p3b",
        mode: "development" as const,
      },
      fixtureExecRemotionRender,
    );
    expect(render.result).toBe("success");
    expect(render.run_id).toBeTruthy();
  });

  it("Full orchestration sequence P3.06 → P3.07 → P3.08 works end-to-end", async () => {
    // P3.06
    const timing = runP306Timing(shots, 5.0);
    expect(timing).toBeDefined();
    expect(timing.shot_timings).toHaveLength(2);

    // P3.07
    const timeline = runP307Timeline(scenes, timing, resolvedAssets, shots);
    expect(timeline).toBeDefined();
    expect(timeline.entries).toHaveLength(2);
    expect(timeline.total_frames).toBeGreaterThan(0);

    // P3.08
    const render = await runP308Render(
      {
        projectId: "test-project",
        targetId: "test-target",
        outputPath: tmpOutputPath("test.mp4"),
        resolution: "1080x1920",
        codec: "h264",
        timeline,
        resolvedAssets,
        stagingDir: "/tmp/test-p3b",
        mode: "development" as const,
      },
      fixtureExecRemotionRender,
    );
    expect(render).toBeDefined();
    expect(render.result).toBe("success");
  });

  it("Governance A remains enforced: P3.07 rejects incomplete motion_plan", () => {
    const scenesWithMotion: Scene[] = [
      {
        scene_id: "scene_1",
        purpose: "Test Scene",
        shots: ["shot_motion"],
        continuity_requirements: [],
        narrative_function: "Test",
      },
    ];

    const assetsForMotion: ResolvedAsset[] = [
      {
        asset_requirement_id: "req_motion",
        shot_id: "shot_motion",
        asset_file_id: "file_motion",
        hash: "ijkl".repeat(16),
        media_properties: { type: "image" },
      },
    ];

    const shotsWithIncompleteMotion: Shot[] = [
      {
        shot_id: "shot_motion",
        scene_id: "scene_1",
        purpose: "Test",
        duration_intention: "3s",
        camera: { angle: "wide", movement: "static", lens: "standard", framing: "full" },
        action: "test",
        continuity_anchors: [],
        reference_requirements: [],
        asset_type: "image",
        generation_method: "test",
        motion_plan: {
          camera_movement: "pan",
          movement_duration_frames: 100,
          transition_type: "fade",
          // MISSING transition_duration_frames — should throw
        } as any,
      },
    ];

    const timing = runP306Timing(shotsWithIncompleteMotion, 3.0);
    expect(() =>
      runP307Timeline(scenesWithMotion, timing, assetsForMotion, shotsWithIncompleteMotion),
    ).toThrow("transition_duration_frames is required");
  });
});
