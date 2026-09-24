// AUDIT FIX (P3 final closure pass, §13.5) — hermetic tests for the P3
// Remotion composition's pure data-shaping logic (sequence descriptors,
// stable per-shot color, video/image path classification), with NO
// bundler, NO Chrome, NO Remotion runtime — fast and fully deterministic,
// part of the normal `vitest run` suite. This is an ADDITIONAL test to the
// real-asset-resolution requirement (correction 2); it does not by itself
// satisfy §13.5 closure.

import { describe, expect, it } from "vitest";
import { buildSequenceDescriptors, colorForShot, isVideoPath } from "../remotion/compositionHelpers.js";
import type { P3Timeline } from "../remotion/compositionHelpers.js";

const timeline: P3Timeline = {
  fps: 30,
  total_frames: 180,
  entries: [
    { shot_id: "shot_wide_arch", asset_file_id: "file_wide_arch_001", start_frame: 0, duration_frames: 105 },
    { shot_id: "shot_water_flow", asset_file_id: "file_water_flow_001", start_frame: 105, duration_frames: 75 },
  ],
};

describe("buildSequenceDescriptors — Timeline contract pass-through", () => {
  it("produces one sequence descriptor per timeline entry, in order", () => {
    const seqs = buildSequenceDescriptors(timeline);
    expect(seqs).toHaveLength(2);
    expect(seqs.map((s) => s.shot_id)).toEqual(["shot_wide_arch", "shot_water_flow"]);
  });

  it("passes start_frame/duration_frames through unchanged as from/durationInFrames", () => {
    const seqs = buildSequenceDescriptors(timeline);
    expect(seqs[0]?.from).toBe(0);
    expect(seqs[0]?.durationInFrames).toBe(105);
    expect(seqs[1]?.from).toBe(105);
    expect(seqs[1]?.durationInFrames).toBe(75);
  });

  it("never produces a zero-or-negative durationInFrames, even for a degenerate zero-length entry", () => {
    const degenerate: P3Timeline = { fps: 30, total_frames: 0, entries: [{ shot_id: "s1", asset_file_id: "f1", start_frame: 0, duration_frames: 0 }] };
    expect(buildSequenceDescriptors(degenerate)[0]?.durationInFrames).toBe(1);
  });

  it("an empty timeline produces zero sequence descriptors", () => {
    expect(buildSequenceDescriptors({ fps: 30, total_frames: 0, entries: [] })).toHaveLength(0);
  });
});

describe("colorForShot — stable, deterministic per-shot color", () => {
  it("is stable across repeated calls for the same shot_id", () => {
    expect(colorForShot("shot_wide_arch")).toBe(colorForShot("shot_wide_arch"));
  });

  it("differs for different shot_ids (not a constant)", () => {
    expect(colorForShot("shot_wide_arch")).not.toBe(colorForShot("shot_water_flow"));
  });

  it("always returns a well-formed hsl() color string", () => {
    expect(colorForShot("any_shot_id")).toMatch(/^hsl\(\d+, 55%, 40%\)$/);
  });
});

describe("isVideoPath — media-kind classification for the composition's Img vs OffthreadVideo choice", () => {
  it("classifies common video extensions as video", () => {
    expect(isVideoPath("staged/file_water_flow_001.mp4")).toBe(true);
    expect(isVideoPath("staged/x.mov")).toBe(true);
    expect(isVideoPath("staged/x.webm")).toBe(true);
  });

  it("classifies image paths and extensionless paths as not-video", () => {
    expect(isVideoPath("staged/file_wide_arch_001.png")).toBe(false);
    expect(isVideoPath("staged/file_wide_arch_001")).toBe(false); // asset_file_id-as-path convention has no extension
  });
});
