// P3.08-DIST Distributed Render — Sharding Strategies
// NOT phase P3.09 (Automated QA, qa.ts) — see the naming note in orchestration_p309.ts.
// Produces ShardSpecification[] from a Timeline. Two production-ready strategies:
// 1. Frame-range: Uniform frame boundaries (production-safe default)
// 2. Scene-based: Natural scene boundaries (optional optimization)
//
// Each shard is independently renderable via Remotion's frameRange parameter.
// Shards are designed for deterministic merging (frame continuity guaranteed
// by algorithm, not assumed).

import { sha256 } from "./ids.js";
import type { ShardSpecification, Timeline } from "./types.js";

// Strategy interface — implementers must produce deterministic, non-overlapping
// shard boundaries covering the full timeline exactly once.
export interface ShardingStrategy {
  shardTimeline(
    timeline: Timeline,
    targetShardCount: number,
    // TIER-2 REPAIR T2.5 — shard identity must cover every input that
    // materially affects the rendered result: the timeline hash ALONE
    // (already used below) does not capture asset content, render config,
    // or code version, so two shards over the SAME frame range but
    // DIFFERENT resolved asset bytes / render settings / code previously
    // hashed identically. When supplied, renderBundleHash is folded into
    // both the shard_id and the returned ShardSpecification.
    renderBundleHash?: string,
  ): ShardSpecification[];
}

// Frame-Range Sharding — PRODUCTION-SAFE DEFAULT
// Divides timeline into roughly-equal frame counts. Does NOT split
// timeline.entries mid-entry (each shard has complete entries only).
// Rationale: Remotion's Sequence component is entry-scoped; splitting
// an entry would create an orphaned frame range with no asset mapping.
export class FrameRangeShardingStrategy implements ShardingStrategy {
  shardTimeline(timeline: Timeline, targetShardCount: number, renderBundleHash?: string): ShardSpecification[] {
    const shards: ShardSpecification[] = [];
    const targetFramesPerShard = Math.ceil(timeline.total_frames / targetShardCount);

    let currentFrameStart = 0;
    let entryIndexStart = 0;

    for (let shardIndex = 0; shardIndex < targetShardCount; shardIndex++) {
      const proposedFrameEnd = Math.min(currentFrameStart + targetFramesPerShard, timeline.total_frames);

      // Collect entries: include any entry that STARTS within [currentFrameStart, proposedFrameEnd).
      // This ensures no entry is split. Shard's actual frame end = last entry's end.
      const entryIndices: number[] = [];
      let actualFrameEnd = currentFrameStart;

      for (let i = entryIndexStart; i < timeline.entries.length; i++) {
        const entry = timeline.entries[i]!; // i < timeline.entries.length, just checked
        const entryEnd = entry.start_frame + entry.duration_frames;

        // Include entry if it starts within [currentFrameStart, proposedFrameEnd)
        if (entry.start_frame >= currentFrameStart && entry.start_frame < proposedFrameEnd) {
          entryIndices.push(i);
          actualFrameEnd = entryEnd;
          entryIndexStart = i + 1;
        } else if (entry.start_frame >= proposedFrameEnd) {
          // Entry starts past our shard boundary; stop
          break;
        }
      }

      // If no entries matched (can happen if next entry starts at/after proposedFrameEnd),
      // include the next entry anyway to avoid gaps
      if (entryIndices.length === 0 && entryIndexStart < timeline.entries.length) {
        const entry = timeline.entries[entryIndexStart]!; // just checked bound
        entryIndices.push(entryIndexStart);
        actualFrameEnd = entry.start_frame + entry.duration_frames;
        entryIndexStart++;
      }

      // Shard frame range is determined by entries (no artificial rounding)
      const frameEnd = Math.max(actualFrameEnd, currentFrameStart + 1);

      // Asset list for resource estimation
      const assetFileIds = entryIndices.map((i) => timeline.entries[i]!.asset_file_id); // i came from valid entry indices above

      const timelineHash = sha256(JSON.stringify(timeline));
      // T2.5 — fold renderBundleHash (covers asset content, render config,
      // and code version — see renderBundle.ts) into shard identity, not
      // just the timeline hash and frame range.
      const shardId = `shard_${sha256(
        `${timelineHash}::${currentFrameStart}::${frameEnd}::${renderBundleHash ?? ""}`,
      ).slice(0, 12)}`;

      shards.push({
        shard_id: shardId,
        frame_range: { start: currentFrameStart, end: frameEnd },
        entry_indices: entryIndices,
        estimated_frames: frameEnd - currentFrameStart,
        asset_file_ids: assetFileIds,
        render_bundle_hash: renderBundleHash,
      });

      currentFrameStart = frameEnd;
      if (currentFrameStart >= timeline.total_frames || entryIndexStart >= timeline.entries.length) break;
    }

    return shards;
  }
}

// Scene-Based Sharding — OPTIONAL OPTIMIZATION
// Divides timeline by scene boundaries (no split within a scene).
// Use when scenes have predictable complexity, or when you want
// human-readable shard boundaries for debugging/QA.
// Falls back to frame-range if scenes are extremely imbalanced.
export class SceneBasedShardingStrategy implements ShardingStrategy {
  shardTimeline(timeline: Timeline, targetShardCount: number, renderBundleHash?: string): ShardSpecification[] {
    // NOT IMPLEMENTED in Phase 1 — intended for future optimization
    // For now, delegate to frame-range as fallback
    return new FrameRangeShardingStrategy().shardTimeline(timeline, targetShardCount, renderBundleHash);
  }
}

// Utility: Validate shard specifications for correctness
export function validateShards(shards: ShardSpecification[], timeline: Timeline): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (shards.length === 0) {
    errors.push("No shards produced");
    return { valid: false, errors };
  }

  // Check frame continuity (no gaps, no overlaps). Non-null: loop bounds
  // guarantee both indices are valid (same reasoning as merge.ts's
  // validateShardContinuity — i and i+1 both in range).
  for (let i = 0; i < shards.length - 1; i++) {
    const current = shards[i]!;
    const next = shards[i + 1]!;
    if (current.frame_range.end !== next.frame_range.start) {
      errors.push(`Gap between shard ${i} (ends ${current.frame_range.end}) and shard ${i + 1} (starts ${next.frame_range.start})`);
    }
  }

  // Check coverage (first starts at 0, last covers all frames). Non-null:
  // `shards.length === 0` already returned above.
  const firstShard = shards[0]!;
  const lastShard = shards[shards.length - 1]!;
  if (firstShard.frame_range.start !== 0) {
    errors.push(`First shard does not start at frame 0 (starts at ${firstShard.frame_range.start})`);
  }
  if (lastShard.frame_range.end !== timeline.total_frames) {
    errors.push(`Last shard does not cover all frames (ends at ${lastShard.frame_range.end}, timeline has ${timeline.total_frames})`);
  }

  // Check shard IDs are unique
  const shardIds = new Set(shards.map((s) => s.shard_id));
  if (shardIds.size !== shards.length) {
    errors.push(`Shard IDs are not unique (${shards.length} shards, ${shardIds.size} unique IDs)`);
  }

  return { valid: errors.length === 0, errors };
}
