// P3-A Motion Execution Coordinator Tests
// Governance A: Motion execution is DEFERRED
//
// VALIDATES:
// 1. P3 does NOT invent motion (creative inference removed)
// 2. P3 does NOT default motion values
// 3. P3 does NOT compute motion duration from camera type
// 4. P3 accepts explicit motion_plan IF P2 provides all required fields
// 5. P3 preserves backward compatibility (buildTimeline works without shots parameter)
//
// CRITICAL: P3 EXECUTES explicit motion plans, never INVENTS them.
// Future Governance B (motion execution) requires P2 to produce motion_plan data.

import { describe, expect, it } from "vitest";
import { buildTimeline } from "../src/timeline.js";
import { computeTiming } from "../src/timing.js";
import type { ResolvedAsset, Scene, Shot, TimingResult } from "../src/types.js";

describe("P3-A: Motion Execution Coordinator (Governance A - Deferred)", () => {
  // Fixture: 2-shot scenario where P2 provides explicit motion planning for one shot
  const shotsWithMotionPlan: Shot[] = [
    {
      shot_id: "shot_with_motion",
      scene_id: "scene_1",
      purpose: "Establish setting",
      duration_intention: "5s",
      camera: {
        angle: "low",
        movement: "slow pan",
        lens: "wide",
        framing: "wide",
      },
      action: "camera pans left",
      continuity_anchors: ["arch"],
      reference_requirements: [],
      asset_type: "image",
      generation_method: "google_flow",
      motion_plan: {
        // GOVERNANCE A: All fields must be EXPLICIT from P2 (no P3 inference/defaults)
        camera_movement: "slow pan",
        movement_duration_frames: 105, // explicit from P2 (5s * 30fps * 0.7)
        transition_type: "fade",
        transition_duration_frames: 15,
        easing: "ease_in_out",
      },
    },
    {
      shot_id: "shot_static",
      scene_id: "scene_1",
      purpose: "Close detail",
      duration_intention: "3s",
      camera: {
        angle: "close",
        movement: "static",
        lens: "macro",
        framing: "close_up",
      },
      action: "camera holds",
      continuity_anchors: ["water"],
      reference_requirements: [],
      asset_type: "image",
      generation_method: "google_flow",
      // No motion_plan: P3 will not create motion metadata
    },
  ];

  const scenes: Scene[] = [
    {
      scene_id: "scene_1",
      purpose: "Opening",
      shots: ["shot_with_motion", "shot_static"],
      continuity_requirements: [],
      narrative_function: "Establish",
    },
  ];

  const resolvedAssets: ResolvedAsset[] = [
    {
      asset_requirement_id: "astreq_1",
      shot_id: "shot_with_motion",
      asset_file_id: "file_1",
      hash: "abcd".repeat(16),
      media_properties: { type: "image" },
    },
    {
      asset_requirement_id: "astreq_2",
      shot_id: "shot_static",
      asset_file_id: "file_2",
      hash: "efgh".repeat(16),
      media_properties: { type: "image" },
    },
  ];

  // Test 1: Explicit motion plan transport (no invention, no defaults)
  it("transports P2's explicit motion_plan without modification or invention", () => {
    const timing = computeTiming(shotsWithMotionPlan, 8);
    const timeline = buildTimeline(scenes, timing, resolvedAssets, shotsWithMotionPlan);

    expect(timeline.entries).toHaveLength(2);
    const withMotion = timeline.entries[0];
    expect(withMotion?.shot_id).toBe("shot_with_motion");
    expect(withMotion?.motion).toBeDefined();
    expect(withMotion?.motion?.camera_movement).toBe("slow pan");
    expect(withMotion?.motion?.movement_duration_frames).toBe(105); // explicit from P2
    expect(withMotion?.motion?.transition_type).toBe("fade"); // explicit from P2
    expect(withMotion?.motion?.transition_duration_frames).toBe(15); // explicit from P2
    expect(withMotion?.motion?.easing).toBe("ease_in_out");
  });

  // Test 2: Shots without motion_plan have undefined motion (no invention)
  it("does NOT create motion metadata for shots without motion_plan", () => {
    const timing = computeTiming(shotsWithMotionPlan, 8);
    const timeline = buildTimeline(scenes, timing, resolvedAssets, shotsWithMotionPlan);

    const staticEntry = timeline.entries[1];
    expect(staticEntry?.shot_id).toBe("shot_static");
    expect(staticEntry?.motion).toBeUndefined(); // No invention
  });

  // Test 3: P3 does NOT default transition_type
  it("throws error if motion_plan.transition_type is missing (P3 does not default to 'cut')", () => {
    const shotWithIncompleteMotion: Shot = {
      shot_id: "incomplete",
      scene_id: "scene_1",
      purpose: "Test",
      duration_intention: "5s",
      camera: { angle: "eye", movement: "pan", lens: "standard", framing: "medium" },
      action: "test",
      continuity_anchors: [],
      reference_requirements: [],
      asset_type: "image",
      generation_method: "google_flow",
      motion_plan: {
        camera_movement: "pan",
        movement_duration_frames: 105,
        // MISSING transition_type — P3 must reject this
        transition_duration_frames: 15,
      },
    };

    const testScene: Scene = {
      scene_id: "scene_1",
      purpose: "Test",
      shots: ["incomplete"],
      continuity_requirements: [],
      narrative_function: "Test",
    };

    const testAsset: ResolvedAsset = {
      asset_requirement_id: "astreq_1",
      shot_id: "incomplete",
      asset_file_id: "file_1",
      hash: "test".repeat(16),
      media_properties: {},
    };

    const timing = computeTiming([shotWithIncompleteMotion], 8);
    expect(() => buildTimeline([testScene], timing, [testAsset], [shotWithIncompleteMotion]))
      .toThrow("transition_type is required");
  });

  // Test 4: P3 does NOT default transition_duration_frames
  it("throws error if motion_plan.transition_duration_frames is missing (P3 does not default to 15)", () => {
    const shotWithIncompleteMotion: Shot = {
      shot_id: "incomplete2",
      scene_id: "scene_1",
      purpose: "Test",
      duration_intention: "5s",
      camera: { angle: "eye", movement: "pan", lens: "standard", framing: "medium" },
      action: "test",
      continuity_anchors: [],
      reference_requirements: [],
      asset_type: "image",
      generation_method: "google_flow",
      motion_plan: {
        camera_movement: "pan",
        movement_duration_frames: 105,
        transition_type: "fade",
        // MISSING transition_duration_frames — P3 must reject this
      },
    };

    const testScene: Scene = {
      scene_id: "scene_1",
      purpose: "Test",
      shots: ["incomplete2"],
      continuity_requirements: [],
      narrative_function: "Test",
    };

    const testAsset: ResolvedAsset = {
      asset_requirement_id: "astreq_1",
      shot_id: "incomplete2",
      asset_file_id: "file_1",
      hash: "test".repeat(16),
      media_properties: {},
    };

    const timing = computeTiming([shotWithIncompleteMotion], 8);
    expect(() => buildTimeline([testScene], timing, [testAsset], [shotWithIncompleteMotion]))
      .toThrow("transition_duration_frames is required");
  });

  // Test 5: P3 does NOT compute movement_duration_frames from camera_movement type
  it("throws error if motion_plan.movement_duration_frames is missing (P3 does not compute percentages)", () => {
    const shotWithIncompleteMotion: Shot = {
      shot_id: "incomplete3",
      scene_id: "scene_1",
      purpose: "Test",
      duration_intention: "5s",
      camera: { angle: "eye", movement: "pan", lens: "standard", framing: "medium" },
      action: "test",
      continuity_anchors: [],
      reference_requirements: [],
      asset_type: "image",
      generation_method: "google_flow",
      motion_plan: {
        camera_movement: "pan", // Even though it's "pan", P3 does NOT compute 70% duration
        // MISSING movement_duration_frames — P3 must reject this
        transition_type: "fade",
        transition_duration_frames: 15,
      },
    };

    const testScene: Scene = {
      scene_id: "scene_1",
      purpose: "Test",
      shots: ["incomplete3"],
      continuity_requirements: [],
      narrative_function: "Test",
    };

    const testAsset: ResolvedAsset = {
      asset_requirement_id: "astreq_1",
      shot_id: "incomplete3",
      asset_file_id: "file_1",
      hash: "test".repeat(16),
      media_properties: {},
    };

    const timing = computeTiming([shotWithIncompleteMotion], 8);
    expect(() => buildTimeline([testScene], timing, [testAsset], [shotWithIncompleteMotion]))
      .toThrow("movement_duration_frames is required");
  });

  // Test 6: Motion isolation — no leakage between shots
  it("attaches motion metadata only to shots with complete explicit motion_plan", () => {
    const timing = computeTiming(shotsWithMotionPlan, 8);
    const timeline = buildTimeline(scenes, timing, resolvedAssets, shotsWithMotionPlan);

    expect(timeline.entries[0]?.motion).toBeDefined();
    expect(timeline.entries[1]?.motion).toBeUndefined();
  });

  // Test 7: P3 does not invent motion from camera.movement field
  it("ignores camera.movement field; does not infer motion_plan from it", () => {
    const shotWithCameraMovement: Shot = {
      shot_id: "camera_field_test",
      scene_id: "scene_1",
      purpose: "Test",
      duration_intention: "5s",
      camera: {
        angle: "eye",
        movement: "slow pan", // ← P3 must NOT use this field
        lens: "standard",
        framing: "medium",
      },
      action: "test",
      continuity_anchors: [],
      reference_requirements: [],
      asset_type: "image",
      generation_method: "google_flow",
      // No motion_plan: P3 does NOT synthesize one from camera.movement
    };

    const testScene: Scene = {
      scene_id: "scene_1",
      purpose: "Test",
      shots: ["camera_field_test"],
      continuity_requirements: [],
      narrative_function: "Test",
    };

    const testAsset: ResolvedAsset = {
      asset_requirement_id: "astreq_1",
      shot_id: "camera_field_test",
      asset_file_id: "file_1",
      hash: "test".repeat(16),
      media_properties: {},
    };

    const timing = computeTiming([shotWithCameraMovement], 8);
    const timeline = buildTimeline([testScene], timing, [testAsset], [shotWithCameraMovement]);

    // P3 must NOT create motion metadata even though camera.movement = "slow pan"
    expect(timeline.entries[0]?.motion).toBeUndefined();
  });

  // Test 8: Backward compatibility — buildTimeline works without shots parameter
  it("produces valid timeline without shots parameter (backward compatible)", () => {
    const timing = computeTiming(shotsWithMotionPlan, 8);
    const timeline = buildTimeline(scenes, timing, resolvedAssets);

    expect(timeline.entries).toHaveLength(2);
    expect(timeline.fps).toBe(30);
    expect(timeline.total_frames).toBeGreaterThan(0);
    // All entries exist, but motion will be undefined (no shot data to read motion_plan)
    expect(timeline.entries[0]?.shot_id).toBe("shot_with_motion");
    expect(timeline.entries[0]?.motion).toBeUndefined(); // No motion without shots parameter
  });

  // Test 9: Determinism — repeated runs produce identical metadata
  it("produces identical motion metadata on repeated runs (deterministic)", () => {
    const timing1 = computeTiming(shotsWithMotionPlan, 8);
    const timeline1 = buildTimeline(scenes, timing1, resolvedAssets, shotsWithMotionPlan);

    const timing2 = computeTiming(shotsWithMotionPlan, 8);
    const timeline2 = buildTimeline(scenes, timing2, resolvedAssets, shotsWithMotionPlan);

    expect(JSON.stringify(timeline1.entries[0]?.motion)).toBe(
      JSON.stringify(timeline2.entries[0]?.motion),
    );
  });

  // Test 10: Governance A Status
  it("validates Governance A: P2.08 → P3.07 → P3.08 deferred (no execution yet)", () => {
    // P2 currently provides: NO motion_plan
    // P3.07 currently accepts: explicit motion_plan IF P2 provides it (but doesn't)
    // P3.08 currently: renders static layouts (no motion animation)

    const timing = computeTiming(shotsWithMotionPlan, 8);
    const timeline = buildTimeline(scenes, timing, resolvedAssets, shotsWithMotionPlan);

    // Motion metadata is prepared in timeline...
    const entry = timeline.entries[0];
    expect(entry?.motion).toEqual(
      expect.objectContaining({
        camera_movement: expect.any(String),
        movement_duration_frames: expect.any(Number),
        transition_type: expect.any(String),
        transition_duration_frames: expect.any(Number),
      }),
    );

    // ...but Remotion composition does NOT execute it (P3.08 unchanged)
    // This is intentional Governance A (deferred execution)
  });

  // Test 11: P3 never invents motion — only accepts explicit P2 direction
  it("never invents motion; requires explicit P2 direction for all fields", () => {
    const staticOnlyShots: Shot[] = [
      {
        shot_id: "static",
        scene_id: "scene_1",
        purpose: "Test",
        duration_intention: "5s",
        camera: { angle: "eye", movement: "static", lens: "standard", framing: "medium" },
        action: "static hold",
        continuity_anchors: [],
        reference_requirements: [],
        asset_type: "image",
        generation_method: "google_flow",
        // No motion_plan: P3 must NOT invent one based on narrative intent, visual language, etc.
      },
    ];

    const testScene: Scene = {
      scene_id: "scene_1",
      purpose: "Test",
      shots: ["static"],
      continuity_requirements: [],
      narrative_function: "Test",
    };

    const testAsset: ResolvedAsset = {
      asset_requirement_id: "astreq_1",
      shot_id: "static",
      asset_file_id: "file_1",
      hash: "test".repeat(16),
      media_properties: {},
    };

    const timing = computeTiming(staticOnlyShots, 8);
    const timeline = buildTimeline([testScene], timing, [testAsset], staticOnlyShots);

    // Static shot without explicit motion_plan must have NO motion metadata (never invented)
    expect(timeline.entries[0]?.motion).toBeUndefined();
  });
});
