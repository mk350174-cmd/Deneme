// P3.08-DIST Resource Scheduling Tests (NOT phase P3.09/Automated QA)
// Validates worker assignment, cost estimation, and capacity probing

import { describe, it, expect } from "vitest";
import { ResourceScheduler } from "../src/scheduling.js";
import type { ShardSpecification } from "../src/types.js";

describe("ResourceScheduler", () => {
  // Helper: create minimal shards
  function makeShards(count: number, framesEach: number): ShardSpecification[] {
    const shards: ShardSpecification[] = [];
    for (let i = 0; i < count; i++) {
      shards.push({
        shard_id: `shard_${i}`,
        frame_range: { start: i * framesEach, end: (i + 1) * framesEach },
        entry_indices: [0],
        estimated_frames: framesEach,
        asset_file_ids: ["asset_0"],
      });
    }
    return shards;
  }

  it("probes available capacity (local CPU always available)", async () => {
    const scheduler = new ResourceScheduler({ enableLocal: true, enableKaggle: false });
    const capacity = await scheduler.probeAvailableCapacity();

    expect(capacity.local_cpu).toBe(true);
    expect(capacity.available_workers.some((w) => w.worker_type === "local_cpu")).toBe(true);
  });

  it("respects enableLocal and enableKaggle flags", async () => {
    const scheduler1 = new ResourceScheduler({ enableLocal: true, enableKaggle: false });
    const capacity1 = await scheduler1.probeAvailableCapacity();
    expect(capacity1.local_cpu).toBe(true);
    expect(capacity1.kaggle_available_notebooks).toBe(0);

    const scheduler2 = new ResourceScheduler({ enableLocal: false, enableKaggle: true });
    const capacity2 = await scheduler2.probeAvailableCapacity();
    expect(capacity2.local_cpu).toBe(false);
    expect(capacity2.kaggle_available_notebooks).toBeGreaterThan(0);
  });

  it("applies safety margin to Kaggle capacity", async () => {
    const scheduler = new ResourceScheduler({ enableKaggle: true, safetyMargin: 0.75 });
    const capacity = await scheduler.probeAvailableCapacity();

    if (capacity.kaggle_available_notebooks > 0) {
      expect(capacity.safe_concurrent_notebooks).toBe(Math.floor(capacity.kaggle_available_notebooks * 0.75));
    }
  });

  it("assigns shards to available workers", async () => {
    const scheduler = new ResourceScheduler({ enableLocal: true, enableKaggle: false });
    const capacity = await scheduler.probeAvailableCapacity();
    const shards = makeShards(5, 1000);

    // Mock cost ledger (no limit exceeded)
    const mockCostLedger = { wouldExceedLimit: () => false };

    const assignments = scheduler.assignShards(shards, capacity, mockCostLedger);

    expect(assignments).toHaveLength(5);
    expect(assignments[0].assigned_worker).toBe("local_cpu");
  });

  it("throws when cost limit exceeded", async () => {
    const scheduler = new ResourceScheduler({ enableKaggle: true });
    const capacity = await scheduler.probeAvailableCapacity();
    const shards = makeShards(10, 10000); // large shards

    // Mock cost ledger (ALWAYS exceeds limit)
    const mockCostLedger = { wouldExceedLimit: () => true };

    expect(() => scheduler.assignShards(shards, capacity, mockCostLedger)).toThrow(/exceed.*cost/i);
  });

  it("estimates render time (single worker, sequential)", async () => {
    const scheduler = new ResourceScheduler({ enableLocal: true });
    const capacity = await scheduler.probeAvailableCapacity();
    const shards = makeShards(3, 1000); // 3x 1000-frame shards

    const mockCostLedger = { wouldExceedLimit: () => false };
    const assignments = scheduler.assignShards(shards, capacity, mockCostLedger);

    const totalTime = scheduler.estimateTotalRenderTimeS(assignments, 1);

    // Local CPU: ~3 FPS, so 1000 frames = 333s per shard, 3 shards = 999s total
    expect(totalTime).toBeGreaterThan(0);
    expect(totalTime).toBeLessThan(1200); // reasonable upper bound
  });

  it("estimates total cost", async () => {
    const scheduler = new ResourceScheduler({ enableLocal: true, enableKaggle: false });
    const capacity = await scheduler.probeAvailableCapacity();
    const shards = makeShards(3, 1000);

    const mockCostLedger = { wouldExceedLimit: () => false };
    const assignments = scheduler.assignShards(shards, capacity, mockCostLedger);

    const totalCost = scheduler.estimateTotalCostUnits(assignments);

    // Local render should have 0 cost (cost_per_hour_units = 0)
    expect(totalCost).toBe(0);
  });

  it("prioritizes shards by size (largest first)", async () => {
    const scheduler = new ResourceScheduler({ enableLocal: true });
    const capacity = await scheduler.probeAvailableCapacity();

    // Create shards in reverse size order
    const shards: ShardSpecification[] = [
      {
        shard_id: "small",
        frame_range: { start: 0, end: 100 },
        entry_indices: [0],
        estimated_frames: 100,
        asset_file_ids: ["asset_0"],
      },
      {
        shard_id: "large",
        frame_range: { start: 100, end: 1000 },
        entry_indices: [0],
        estimated_frames: 900,
        asset_file_ids: ["asset_0"],
      },
    ];

    const mockCostLedger = { wouldExceedLimit: () => false };
    const assignments = scheduler.assignShards(shards, capacity, mockCostLedger);

    // Largest shard should come first in priority
    const largeAssignment = assignments.find((a) => a.shard_id === "large");
    const smallAssignment = assignments.find((a) => a.shard_id === "small");
    expect(largeAssignment!.priority).toBeLessThan(smallAssignment!.priority);
  });

  it("handles empty shard list", async () => {
    const scheduler = new ResourceScheduler({ enableLocal: true });
    const capacity = await scheduler.probeAvailableCapacity();

    const mockCostLedger = { wouldExceedLimit: () => false };
    const assignments = scheduler.assignShards([], capacity, mockCostLedger);

    expect(assignments).toHaveLength(0);
    expect(scheduler.estimateTotalRenderTimeS(assignments, 1)).toBe(0);
    expect(scheduler.estimateTotalCostUnits(assignments)).toBe(0);
  });
});
