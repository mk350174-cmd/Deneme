// P3.07 Timeline — builds ordered, timed entries from ShotTiming +
// canonical Scene/Shot data + resolved assets, strictly read-only over that
// canonical data (never mutates Scene/Shot/Prompt/Decision content).
// P3-A: Motion Execution Coordinator — normalizes explicit motion planning
// from P2 into executable timeline metadata. P3 EXECUTES motion plans,
// never INVENTS motion not specified by P2.

import type { ResolvedAsset, Scene, Shot, Timeline, TimelineEntry, TimingResult, MotionMetadata } from "./types.js";

// R02.1 REPAIR — timeline FPS must never be hard-coded.
//
// PROBLEM: `const FPS = 30` was a MODULE-LEVEL constant used to compute
// EVERY entry's duration_frames (`Math.round(allocated_duration_s * FPS)`)
// and stamped directly onto the returned Timeline.fps. The Timeline type
// already HAS an `fps` field — implying it should vary — but this function
// always produced exactly 30 regardless of the actual render
// configuration. A render genuinely targeting 24fps or 60fps got frame
// counts computed as if it were 30fps, corrupting every duration in the
// timeline.
//
// REPAIR: buildTimeline/runP307Timeline now take the real fps as an
// explicit parameter (defaulting to 30 for existing callers that
// legitimately want 30fps, not as a silent fallback masking a missing
// value). Duration-to-frame conversion uses this parameter everywhere; the
// previous merge-side FPS repair (T2.6, pipeline3_production/src/merge.ts)
// remains untouched and still receives the same value downstream via
// orchestration_p309.ts's `timeline.fps`.
const DEFAULT_FPS = 30; // matches Studio's remotion_template default; only used when the caller supplies no explicit fps

/**
 * P3-A: Validate and normalize P2's EXPLICIT motion planning into timeline metadata.
 * Returns undefined if the shot has no motion plan from P2.
 * CRITICAL: Never invents motion specs; only validates & transports explicit P2 direction.
 * Motion execution is DEFERRED (Governance A). P3 does not create creative motion values.
 */
function normalizeMotionMetadata(
  shot: Shot,
  durationFrames: number,
): MotionMetadata | undefined {
  // Only proceed if P2 provided explicit motion planning
  if (!shot.motion_plan) {
    return undefined;
  }

  const { camera_movement, transition_type, easing, movement_duration_frames, transition_duration_frames } = shot.motion_plan;

  // Governance A: REQUIRE explicit values from P2. Do NOT invent.
  // This ensures the future Governance B motion flow has all required data.
  if (!camera_movement) {
    throw new Error("P3-A: motion_plan.camera_movement is required if motion_plan is provided (deferred to future P2 motion planning)");
  }
  if (movement_duration_frames === undefined) {
    throw new Error("P3-A: motion_plan.movement_duration_frames is required; P3 does not compute it (deferred to P2)");
  }
  if (!transition_type) {
    throw new Error("P3-A: motion_plan.transition_type is required; P3 does not default it (deferred to P2)");
  }
  if (transition_duration_frames === undefined) {
    throw new Error("P3-A: motion_plan.transition_duration_frames is required; P3 does not default it (deferred to P2)");
  }

  // Transport P2's explicit motion plan unchanged
  return {
    camera_movement,
    movement_duration_frames,
    transition_type,
    transition_duration_frames,
    easing, // optional
  };
}

// REMOVED: computeMovementDurationFrames() — P3 no longer computes motion duration.
// Governance A: motion execution is deferred. P2.08 must provide explicit
// movement_duration_frames if/when motion planning is implemented (Governance B).
// This function was performing creative inference (pan=70%, push=50%, etc.)
// which violates the canonical principle "P2 decides, P3 executes."

export function buildTimeline(
  scenes: readonly Scene[],
  timing: TimingResult,
  resolvedAssets: readonly ResolvedAsset[],
  shots?: readonly Shot[], // P3-A: optional for motion execution (if P2 provided motion plans)
  // R02.1 — the canonical render fps. Defaults to DEFAULT_FPS (30) for
  // backward compatibility with existing callers that genuinely want
  // 30fps; a caller targeting a different fps must now pass it explicitly
  // rather than silently getting 30fps frame math regardless of intent.
  fps: number = DEFAULT_FPS,
): Timeline {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`buildTimeline: fps must be a positive finite number, got ${fps}`);
  }
  const timingByShotId = new Map(timing.shot_timings.map((t) => [t.shot_id, t]));
  const assetByShotId = new Map(resolvedAssets.map((a) => [a.shot_id, a]));
  const shotsByShotId = shots ? new Map(shots.map((s) => [s.shot_id, s])) : new Map();

  const entries: TimelineEntry[] = [];
  let frameCursor = 0;

  // Scene/shot ordering is preserved exactly as declared in the canonical
  // Scene.shots[] arrays — never reordered.
  for (const scene of scenes) {
    for (const shotId of scene.shots) {
      const shotTiming = timingByShotId.get(shotId);
      const asset = assetByShotId.get(shotId);
      if (!shotTiming || !asset) continue; // absence is reported upstream (Asset Matching / Timing), not invented here
      const durationFrames = Math.max(1, Math.round(shotTiming.allocated_duration_s * fps));

      const entry: TimelineEntry = {
        shot_id: shotId,
        asset_file_id: asset.asset_file_id,
        start_frame: frameCursor,
        duration_frames: durationFrames,
      };

      // P3-A: Normalize explicit P2 motion planning if provided
      if (shots) {
        const shot = shotsByShotId.get(shotId);
        if (shot) {
          const motion = normalizeMotionMetadata(shot, durationFrames);
          if (motion) {
            entry.motion = motion;
          }
        }
      }

      entries.push(entry);
      frameCursor += durationFrames;
    }
  }

  return { fps, total_frames: frameCursor, entries };
}
