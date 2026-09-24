// P3.08-DIST Sharding Strategy Tests (NOT phase P3.09/Automated QA)
// Validates frame-range shard boundaries, entry inclusion, and determinism

import { describe, it, expect } from "vitest";
import { FrameRangeShardingStrategy, validateShards } from "../src/sharding.js";
import type { Timeline } from "../src/types.js";

describe("FrameRangeShardingStrategy", () => {
  // Helper: create a minimal timeline with N frames across M entries
  function makeTimeline(totalFrames: number, entriesPerScene: number): Timeline {
    const entries = [];
    let frameCount = 0;
    for (let i = 0; i < entriesPerScene; i++) {
      const frameSize = Math.ceil(totalFrames / entriesPerScene);
      entries.push({
        shot_id: `shot_${i}`,
        asset_file_id: `asset_${i}`,
        start_frame: frameCount,
        duration_frames: frameSize,
      });
      frameCount += frameSize;
    }
    return { fps: 30, total_frames: totalFrames, entries };
  }

  it("produces non-overlapping, contiguous shards covering full timeline", () => {
    const timeline = makeTimeline(3000, 10);
    const strategy = new FrameRangeShardingStrategy();
    const shards = strategy.shardTimeline(timeline, 3);

    // Validate
    const validation = validateShards(shards, timeline);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it("produces correct number of shards", () => {
    const timeline = makeTimeline(3000, 10);
    const strategy = new FrameRangeShardingStrategy();
    const shards = strategy.shardTimeline(timeline, 5);

    expect(shards).toHaveLength(5);
  });

  it("respects entry boundaries (no split entries)", () => {
    const timeline = makeTimeline(3000, 10); // 10 entries
    const strategy = new FrameRangeShardingStrategy();
    const shards = strategy.shardTimeline(timeline, 3);

    // Check that each entry index is complete within a shard
    for (const shard of shards) {
      for (const entryIdx of shard.entry_indices) {
        const entry = timeline.entries[entryIdx];
        expect(entry.start_frame).toBeGreaterThanOrEqual(shard.frame_range.start);
        expect(entry.start_frame + entry.duration_frames).toBeLessThanOrEqual(shard.frame_range.end);
      }
    }
  });

  it("produces deterministic shard IDs", () => {
    const timeline = makeTimeline(3000, 10);
    const strategy = new FrameRangeShardingStrategy();

    const shards1 = strategy.shardTimeline(timeline, 3);
    const shards2 = strategy.shardTimeline(timeline, 3);

    expect(shards1.map((s) => s.shard_id)).toEqual(shards2.map((s) => s.shard_id));
  });

  it("handles single-shard case", () => {
    const timeline = makeTimeline(1000, 5);
    const strategy = new FrameRangeShardingStrategy();
    const shards = strategy.shardTimeline(timeline, 1);

    expect(shards).toHaveLength(1);
    expect(shards[0].frame_range).toEqual({ start: 0, end: timeline.total_frames });
  });

  it("handles tiny shards (many shards, few frames)", () => {
    const timeline = makeTimeline(100, 2); // only 100 frames
    const strategy = new FrameRangeShardingStrategy();
    const shards = strategy.shardTimeline(timeline, 20); // request 20 shards

    const validation = validateShards(shards, timeline);
    expect(validation.valid).toBe(true);
    // Should not produce MORE shards than frames
    expect(shards.length).toBeLessThanOrEqual(timeline.total_frames);
  });
});

describe("Shard Validation", () => {
  it("detects frame gaps", () => {
    const timeline: Timeline = {
      fps: 30,
      total_frames: 1000,
      entries: [
        { shot_id: "shot_1", asset_file_id: "asset_1", start_frame: 0, duration_frames: 100 },
      ],
    };

    // Manually create bad shards (with gap)
    const badShards = [
      {
        shard_id: "shard_1",
        frame_range: { start: 0, end: 400 },
        entry_indices: [0],
        estimated_frames: 400,
        asset_file_ids: ["asset_1"],
      },
      {
        shard_id: "shard_2",
        frame_range: { start: 500, end: 1000 }, // GAP: should start at 400
        entry_indices: [0],
        estimated_frames: 500,
        asset_file_ids: ["asset_1"],
      },
    ];

    const validation = validateShards(badShards, timeline);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("Gap"))).toBe(true);
  });

  it("detects missing coverage at start", () => {
    const timeline: Timeline = {
      fps: 30,
      total_frames: 1000,
      entries: [
        { shot_id: "shot_1", asset_file_id: "asset_1", start_frame: 0, duration_frames: 1000 },
      ],
    };

    const badShards = [
      {
        shard_id: "shard_1",
        frame_range: { start: 100, end: 1000 }, // Should start at 0
        entry_indices: [0],
        estimated_frames: 900,
        asset_file_ids: ["asset_1"],
      },
    ];

    const validation = validateShards(badShards, timeline);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("does not start at frame 0"))).toBe(true);
  });

  it("detects non-unique shard IDs", () => {
    const timeline: Timeline = {
      fps: 30,
      total_frames: 1000,
      entries: [
        { shot_id: "shot_1", asset_file_id: "asset_1", start_frame: 0, duration_frames: 1000 },
      ],
    };

    const badShards = [
      {
        shard_id: "shard_DUPLICATE",
        frame_range: { start: 0, end: 500 },
        entry_indices: [0],
        estimated_frames: 500,
        asset_file_ids: ["asset_1"],
      },
      {
        shard_id: "shard_DUPLICATE", // Duplicate!
        frame_range: { start: 500, end: 1000 },
        entry_indices: [0],
        estimated_frames: 500,
        asset_file_ids: ["asset_1"],
      },
    ];

    const validation = validateShards(badShards, timeline);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("not unique"))).toBe(true);
  });
});
