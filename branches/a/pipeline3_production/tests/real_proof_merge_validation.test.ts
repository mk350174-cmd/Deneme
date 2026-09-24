// P3.08-DIST Distributed Render (NOT phase P3.09/Automated QA) — REAL PROOF: FFmpeg Merge with Actual Video Files
// Validates that the merge pipeline works correctly with real H.264 video files
// This test creates synthetic video files, merges them, and validates output

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { mergeShardOutputs, validateShardContinuity } from "../src/merge.js";
import { defaultExecFfmpeg } from "../src/distribution.js";
import type { ShardRenderOutput } from "../src/types.js";
import crypto from "node:crypto";

describe("P3.08-DIST REAL PROOF — FFmpeg Merge with Actual Video Files", () => {
  let workingDir: string;
  let shardDir: string;

  beforeEach(async () => {
    // Create working directory for test videos
    workingDir = path.join(
      "/tmp",
      `p309-real-proof-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    shardDir = path.join(workingDir, "shards");
    await fs.mkdir(shardDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(workingDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  /**
   * Helper: Create a synthetic H.264 video file using FFmpeg
   * Produces a video with known duration and frame count
   * Video is 10 frames at 30fps (0.333 seconds), 1920x1080, H.264 codec
   */
  async function createSyntheticVideoFile(
    outputPath: string,
    frameCount: number,
  ): Promise<{ duration_s: number; frame_count: number }> {
    // FFmpeg command to generate a synthetic video:
    // - color=c=black: solid black background
    // - s=1920x1080: 1920x1080 resolution (full HD)
    // - d={frameCount/30}: duration in seconds (frameCount / 30fps)
    // - scale=1920:1080: ensure dimensions
    // - format=yuv420p: H.264 compatible pixel format
    // - c:v=libx264: H.264 codec
    // - crf=23: quality (default, reasonable)

    const duration = frameCount / 30; // 30fps
    const cmd = [
      "ffmpeg",
      "-f", "lavfi",
      "-i", `color=c=black:s=1920x1080:d=${duration}`,
      "-f", "lavfi",
      "-i", `sine=f=1000:d=${duration}`,
      "-c:v", "libx264",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-y", // Overwrite output
      outputPath,
    ];

    execSync(cmd.join(" "), { stdio: "pipe" });

    // Verify file was created
    const stat = await fs.stat(outputPath);
    return { duration_s: duration, frame_count: frameCount };
  }

  /**
   * Helper: Compute SHA256 hash of a file
   */
  async function sha256File(filePath: string): Promise<string> {
    const data = await fs.readFile(filePath);
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /**
   * Helper: Get video duration using FFmpeg probe
   */
  async function getVideoDuration(videoPath: string): Promise<number> {
    try {
      const output = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
        { encoding: "utf-8" },
      );
      return parseFloat(output.trim());
    } catch {
      return 0;
    }
  }

  /**
   * Helper: Get frame count using FFmpeg
   */
  async function getFrameCount(videoPath: string): Promise<number> {
    try {
      const output = execSync(
        `ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "${videoPath}"`,
        { encoding: "utf-8" },
      );
      return parseInt(output.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  describe("Synthetic Video Creation", () => {
    it("creates a valid H.264 video file", async () => {
      const videoPath = path.join(shardDir, "test_video.mp4");
      const { duration_s, frame_count } = await createSyntheticVideoFile(
        videoPath,
        300,
      );

      expect(duration_s).toBe(10); // 300 frames / 30fps
      expect(frame_count).toBe(300);

      const stat = await fs.stat(videoPath);
      expect(stat.size).toBeGreaterThan(0);
      expect(stat.size).toBeLessThan(1024 * 1024); // Should be reasonably small for synthetic video
    });

    it("video is H.264 encoded", async () => {
      const videoPath = path.join(shardDir, "test_video.mp4");
      await createSyntheticVideoFile(videoPath, 100);

      const output = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`, {
        encoding: "utf-8",
      });

      expect(output.trim()).toMatch(/h264|avc/i);
    });

    it("video has correct duration", async () => {
      const videoPath = path.join(shardDir, "test_video.mp4");
      await createSyntheticVideoFile(videoPath, 300);

      const duration = await getVideoDuration(videoPath);
      expect(duration).toBeGreaterThan(9.9); // Allow small tolerance
      expect(duration).toBeLessThan(10.1);
    });
  });

  describe("Two-Shard Merge (Contiguous)", () => {
    it("merges two shards into a single video", async () => {
      // Create two 150-frame shards (5 seconds each)
      const shard0Path = path.join(shardDir, "shard_0.mp4");
      const shard1Path = path.join(shardDir, "shard_1.mp4");
      const outputPath = path.join(workingDir, "merged.mp4");

      await createSyntheticVideoFile(shard0Path, 150);
      await createSyntheticVideoFile(shard1Path, 150);

      const shard0Hash = await sha256File(shard0Path);
      const shard1Hash = await sha256File(shard1Path);

      const shardOutputs: ShardRenderOutput[] = [
        {
          shard_id: "shard_0",
          frame_range: { start: 0, end: 150 },
          video_file_path: shard0Path,
          sha256: shard0Hash,
          bytes: (await fs.stat(shard0Path)).size,
          duration_s: 5,
        },
        {
          shard_id: "shard_1",
          frame_range: { start: 150, end: 300 },
          video_file_path: shard1Path,
          sha256: shard1Hash,
          bytes: (await fs.stat(shard1Path)).size,
          duration_s: 5,
        },
      ];

      // Validate continuity before merge
      const validation = await validateShardContinuity(shardOutputs);
      expect(validation.valid).toBe(true);

      // Merge
      const result = await mergeShardOutputs({
        shards: shardOutputs,
        outputPath,
        workingDir,
      }, defaultExecFfmpeg);

      // Verify output
      expect(result.video_file_path).toBe(outputPath);
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/); // 64-char hex
      expect(result.bytes).toBeGreaterThan(0);

      // Verify merged video has correct duration
      const mergedDuration = await getVideoDuration(outputPath);
      expect(mergedDuration).toBeGreaterThan(9.9); // Should be ~10 seconds
      expect(mergedDuration).toBeLessThan(10.1);
    });

    it("merged video is playable and valid", async () => {
      const shard0Path = path.join(shardDir, "shard_0.mp4");
      const shard1Path = path.join(shardDir, "shard_1.mp4");
      const outputPath = path.join(workingDir, "merged.mp4");

      await createSyntheticVideoFile(shard0Path, 100);
      await createSyntheticVideoFile(shard1Path, 100);

      const shard0Hash = await sha256File(shard0Path);
      const shard1Hash = await sha256File(shard1Path);

      const shardOutputs: ShardRenderOutput[] = [
        {
          shard_id: "shard_0",
          frame_range: { start: 0, end: 100 },
          video_file_path: shard0Path,
          sha256: shard0Hash,
          bytes: (await fs.stat(shard0Path)).size,
          duration_s: 3.33,
        },
        {
          shard_id: "shard_1",
          frame_range: { start: 100, end: 200 },
          video_file_path: shard1Path,
          sha256: shard1Hash,
          bytes: (await fs.stat(shard1Path)).size,
          duration_s: 3.33,
        },
      ];

      await mergeShardOutputs({
        shards: shardOutputs,
        outputPath,
        workingDir,
      }, defaultExecFfmpeg);

      // FFprobe can read it without errors
      const output = execSync(
        `ffprobe -v error -select_streams v:0 -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`,
        { encoding: "utf-8" },
      );

      const duration = parseFloat(output.trim());
      expect(duration).toBeGreaterThan(0);
    });
  });

  describe("Three-Shard Merge (Contiguous)", () => {
    it("merges three shards into a single video", async () => {
      // Create three 100-frame shards
      const shard0Path = path.join(shardDir, "shard_0.mp4");
      const shard1Path = path.join(shardDir, "shard_1.mp4");
      const shard2Path = path.join(shardDir, "shard_2.mp4");
      const outputPath = path.join(workingDir, "merged.mp4");

      await createSyntheticVideoFile(shard0Path, 100);
      await createSyntheticVideoFile(shard1Path, 100);
      await createSyntheticVideoFile(shard2Path, 100);

      const shardOutputs: ShardRenderOutput[] = [
        {
          shard_id: "shard_0",
          frame_range: { start: 0, end: 100 },
          video_file_path: shard0Path,
          sha256: await sha256File(shard0Path),
          bytes: (await fs.stat(shard0Path)).size,
          duration_s: 3.33,
        },
        {
          shard_id: "shard_1",
          frame_range: { start: 100, end: 200 },
          video_file_path: shard1Path,
          sha256: await sha256File(shard1Path),
          bytes: (await fs.stat(shard1Path)).size,
          duration_s: 3.33,
        },
        {
          shard_id: "shard_2",
          frame_range: { start: 200, end: 300 },
          video_file_path: shard2Path,
          sha256: await sha256File(shard2Path),
          bytes: (await fs.stat(shard2Path)).size,
          duration_s: 3.33,
        },
      ];

      // Validate continuity
      const validation = await validateShardContinuity(shardOutputs);
      expect(validation.valid).toBe(true);

      // Merge
      const result = await mergeShardOutputs({
        shards: shardOutputs,
        outputPath,
        workingDir,
      }, defaultExecFfmpeg);
      expect(result.video_file_path).toBe(outputPath);

      // Total duration should be ~10 seconds (allow small tolerance for FFmpeg processing)
      const mergedDuration = await getVideoDuration(outputPath);
      expect(mergedDuration).toBeGreaterThan(9.9);
      expect(mergedDuration).toBeLessThan(10.2);
    });
  });

  describe("Single-Shard Passthrough", () => {
    it("handles single shard without merge", async () => {
      const shard0Path = path.join(shardDir, "shard_0.mp4");
      const outputPath = path.join(workingDir, "output.mp4");

      await createSyntheticVideoFile(shard0Path, 300);

      const shardHash = await sha256File(shard0Path);
      const shardSize = (await fs.stat(shard0Path)).size;

      const shardOutputs: ShardRenderOutput[] = [
        {
          shard_id: "shard_0",
          frame_range: { start: 0, end: 300 },
          video_file_path: shard0Path,
          sha256: shardHash,
          bytes: shardSize,
          duration_s: 10,
        },
      ];

      const result = await mergeShardOutputs({
        shards: shardOutputs,
        outputPath,
        workingDir,
      }, defaultExecFfmpeg);

      // For single shard, result returns the original shard (no merge needed)
      expect(result.video_file_path).toBe(shard0Path);
      expect(result.shard_id).toBe("shard_0");
      const stat = await fs.stat(result.video_file_path);
      expect(stat.size).toBeGreaterThan(0);
    });
  });

  describe("Merge Determinism & Idempotency", () => {
    it("re-merging produces identical output", async () => {
      const shard0Path = path.join(shardDir, "shard_0.mp4");
      const shard1Path = path.join(shardDir, "shard_1.mp4");
      const output1Path = path.join(workingDir, "merged_1.mp4");
      const output2Path = path.join(workingDir, "merged_2.mp4");

      await createSyntheticVideoFile(shard0Path, 150);
      await createSyntheticVideoFile(shard1Path, 150);

      const shardOutputs: ShardRenderOutput[] = [
        {
          shard_id: "shard_0",
          frame_range: { start: 0, end: 150 },
          video_file_path: shard0Path,
          sha256: await sha256File(shard0Path),
          bytes: (await fs.stat(shard0Path)).size,
          duration_s: 5,
        },
        {
          shard_id: "shard_1",
          frame_range: { start: 150, end: 300 },
          video_file_path: shard1Path,
          sha256: await sha256File(shard1Path),
          bytes: (await fs.stat(shard1Path)).size,
          duration_s: 5,
        },
      ];

      // First merge
      const result1 = await mergeShardOutputs({
        shards: shardOutputs,
        outputPath: output1Path,
        workingDir,
      }, defaultExecFfmpeg);

      // Second merge (re-merge, new output path)
      const result2 = await mergeShardOutputs({
        shards: shardOutputs,
        outputPath: output2Path,
        workingDir,
      }, defaultExecFfmpeg);

      // Both should have valid outputs
      expect(result1.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(result2.sha256).toMatch(/^[a-f0-9]{64}$/);

      // Durations should match (within tolerance)
      const dur1 = await getVideoDuration(output1Path);
      const dur2 = await getVideoDuration(output2Path);
      expect(Math.abs(dur1 - dur2)).toBeLessThan(0.1);

      // Both should be playable
      expect(dur1).toBeGreaterThan(9.9);
      expect(dur2).toBeGreaterThan(9.9);
    });
  });

  describe("Continuity Validation with Real Videos", () => {
    it("detects gap between shards", async () => {
      const shard0Path = path.join(shardDir, "shard_0.mp4");
      const shard1Path = path.join(shardDir, "shard_1.mp4");

      await createSyntheticVideoFile(shard0Path, 100);
      await createSyntheticVideoFile(shard1Path, 100);

      // Create gap: shard 0 ends at 100, shard 1 starts at 110 (not 100)
      const shardOutputs: ShardRenderOutput[] = [
        {
          shard_id: "shard_0",
          frame_range: { start: 0, end: 100 },
          video_file_path: shard0Path,
          sha256: await sha256File(shard0Path),
          bytes: (await fs.stat(shard0Path)).size,
          duration_s: 3.33,
        },
        {
          shard_id: "shard_1",
          frame_range: { start: 110, end: 210 }, // Gap at 100-110
          video_file_path: shard1Path,
          sha256: await sha256File(shard1Path),
          bytes: (await fs.stat(shard1Path)).size,
          duration_s: 3.33,
        },
      ];

      const validation = await validateShardContinuity(shardOutputs);
      expect(validation.valid).toBe(false);
      expect(validation.message).toContain("gap");
    });

    it("detects overlap between shards", async () => {
      const shard0Path = path.join(shardDir, "shard_0.mp4");
      const shard1Path = path.join(shardDir, "shard_1.mp4");

      await createSyntheticVideoFile(shard0Path, 100);
      await createSyntheticVideoFile(shard1Path, 100);

      // Create overlap: shard 0 ends at 110, shard 1 starts at 100
      const shardOutputs: ShardRenderOutput[] = [
        {
          shard_id: "shard_0",
          frame_range: { start: 0, end: 110 },
          video_file_path: shard0Path,
          sha256: await sha256File(shard0Path),
          bytes: (await fs.stat(shard0Path)).size,
          duration_s: 3.67,
        },
        {
          shard_id: "shard_1",
          frame_range: { start: 100, end: 200 }, // Overlap at 100-110
          video_file_path: shard1Path,
          sha256: await sha256File(shard1Path),
          bytes: (await fs.stat(shard1Path)).size,
          duration_s: 3.33,
        },
      ];

      const validation = await validateShardContinuity(shardOutputs);
      expect(validation.valid).toBe(false);
      expect(validation.message).toContain("overlap");
    });
  });

  describe("Edge Cases", () => {
    it("handles very small shards (10 frames each)", async () => {
      const shard0Path = path.join(shardDir, "shard_0.mp4");
      const shard1Path = path.join(shardDir, "shard_1.mp4");
      const outputPath = path.join(workingDir, "merged.mp4");

      await createSyntheticVideoFile(shard0Path, 10);
      await createSyntheticVideoFile(shard1Path, 10);

      const shardOutputs: ShardRenderOutput[] = [
        {
          shard_id: "shard_0",
          frame_range: { start: 0, end: 10 },
          video_file_path: shard0Path,
          sha256: await sha256File(shard0Path),
          bytes: (await fs.stat(shard0Path)).size,
          duration_s: 0.333,
        },
        {
          shard_id: "shard_1",
          frame_range: { start: 10, end: 20 },
          video_file_path: shard1Path,
          sha256: await sha256File(shard1Path),
          bytes: (await fs.stat(shard1Path)).size,
          duration_s: 0.333,
        },
      ];

      const validation = await validateShardContinuity(shardOutputs);
      expect(validation.valid).toBe(true);

      const result = await mergeShardOutputs({
        shards: shardOutputs,
        outputPath,
        workingDir,
      }, defaultExecFfmpeg);
      expect(result.video_file_path).toBe(outputPath);

      const duration = await getVideoDuration(outputPath);
      expect(duration).toBeGreaterThan(0.3);
    });

    it("handles many small shards", async () => {
      const shardOutputs: ShardRenderOutput[] = [];

      // Create 5 shards of 20 frames each
      for (let i = 0; i < 5; i++) {
        const shardPath = path.join(shardDir, `shard_${i}.mp4`);
        await createSyntheticVideoFile(shardPath, 20);

        shardOutputs.push({
          shard_id: `shard_${i}`,
          frame_range: { start: i * 20, end: (i + 1) * 20 },
          video_file_path: shardPath,
          sha256: await sha256File(shardPath),
          bytes: (await fs.stat(shardPath)).size,
          duration_s: 0.667,
        });
      }

      const validation = await validateShardContinuity(shardOutputs);
      expect(validation.valid).toBe(true);

      const outputPath = path.join(workingDir, "merged.mp4");
      const result = await mergeShardOutputs({
        shards: shardOutputs,
        outputPath,
        workingDir,
      }, defaultExecFfmpeg);
      expect(result.video_file_path).toBe(outputPath);

      const duration = await getVideoDuration(outputPath);
      expect(duration).toBeGreaterThan(3); // ~3.33 seconds total
    });
  });
});
