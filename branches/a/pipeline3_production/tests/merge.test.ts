// P3.08-DIST Distributed Render (NOT phase P3.09/Automated QA) — Merge & Preview Tests
// Validates frame continuity, FFmpeg orchestration, preview generation

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { validateShardContinuity, mergeShardOutputs, generatePreview, type ExecFfmpeg } from "../src/merge.js";
import type { ShardRenderOutput, PreviewArtifact, ContinuityValidation } from "../src/types.js";

describe("Merge & Preview Generation", () => {
  let workingDir: string;

  beforeEach(async () => {
    workingDir = path.join(
      "/tmp",
      `merge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(workingDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(workingDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("validateShardContinuity", () => {
    it("returns valid for empty shard list", async () => {
      const result = await validateShardContinuity([]);
      expect(result.valid).toBe(true);
    });

    it("returns valid for single shard", async () => {
      const shard: ShardRenderOutput = {
        shard_id: "shard_0",
        frame_range: { start: 0, end: 100 },
        video_file_path: "/tmp/test.mp4",
        sha256: "abc123",
        bytes: 1000,
        duration_s: 3.33,
      };

      const result = await validateShardContinuity([shard]);
      expect(result.valid).toBe(true);
    });

    it("detects frame gaps between shards", async () => {
      const shards: ShardRenderOutput[] = [
        {
          shard_id: "shard_0",
          frame_range: { start: 0, end: 100 },
          video_file_path: "/tmp/test0.mp4",
          sha256: "abc123",
          bytes: 1000,
          duration_s: 3.33,
        },
        {
          shard_id: "shard_1",
          frame_range: { start: 110, end: 200 }, // gap of 10 frames
          video_file_path: "/tmp/test1.mp4",
          sha256: "def456",
          bytes: 1000,
          duration_s: 3.33,
        },
      ];

      const result = await validateShardContinuity(shards);
      expect(result.valid).toBe(false);
      expect(result.gap_frames).toBeDefined();
      expect(result.gap_frames?.length).toBe(10);
      expect(result.message).toContain("gap");
    });

    it("detects frame overlaps between shards", async () => {
      const shards: ShardRenderOutput[] = [
        {
          shard_id: "shard_0",
          frame_range: { start: 0, end: 100 },
          video_file_path: "/tmp/test0.mp4",
          sha256: "abc123",
          bytes: 1000,
          duration_s: 3.33,
        },
        {
          shard_id: "shard_1",
          frame_range: { start: 90, end: 200 }, // 10-frame overlap
          video_file_path: "/tmp/test1.mp4",
          sha256: "def456",
          bytes: 1000,
          duration_s: 3.33,
        },
      ];

      const result = await validateShardContinuity(shards);
      expect(result.valid).toBe(false);
      expect(result.overlap_frames).toBeDefined();
      expect(result.overlap_frames?.length).toBe(10);
    });

    it("validates contiguous shards", async () => {
      const shards: ShardRenderOutput[] = [
        {
          shard_id: "shard_0",
          frame_range: { start: 0, end: 100 },
          video_file_path: "/tmp/test0.mp4",
          sha256: "abc123",
          bytes: 1000,
          duration_s: 3.33,
        },
        {
          shard_id: "shard_1",
          frame_range: { start: 100, end: 200 },
          video_file_path: "/tmp/test1.mp4",
          sha256: "def456",
          bytes: 1000,
          duration_s: 3.33,
        },
        {
          shard_id: "shard_2",
          frame_range: { start: 200, end: 300 },
          video_file_path: "/tmp/test2.mp4",
          sha256: "ghi789",
          bytes: 1000,
          duration_s: 3.33,
        },
      ];

      const result = await validateShardContinuity(shards);
      expect(result.valid).toBe(true);
      expect(result.message).toBe("Frame continuity validated");
    });

    it("handles out-of-order shards (sorts by frame_range.start)", async () => {
      const shards: ShardRenderOutput[] = [
        {
          shard_id: "shard_2",
          frame_range: { start: 200, end: 300 },
          video_file_path: "/tmp/test2.mp4",
          sha256: "ghi789",
          bytes: 1000,
          duration_s: 3.33,
        },
        {
          shard_id: "shard_0",
          frame_range: { start: 0, end: 100 },
          video_file_path: "/tmp/test0.mp4",
          sha256: "abc123",
          bytes: 1000,
          duration_s: 3.33,
        },
        {
          shard_id: "shard_1",
          frame_range: { start: 100, end: 200 },
          video_file_path: "/tmp/test1.mp4",
          sha256: "def456",
          bytes: 1000,
          duration_s: 3.33,
        },
      ];

      const result = await validateShardContinuity(shards);
      expect(result.valid).toBe(true);
    });
  });

  describe("mergeShardOutputs", () => {
    it("throws on empty shard list", async () => {
      await expect(
        mergeShardOutputs({
          shards: [],
          outputPath: path.join(workingDir, "out.mp4"),
          workingDir,
        }),
      ).rejects.toThrow("No shards to merge");
    });

    it("throws on frame continuity validation failure", async () => {
      const shards: ShardRenderOutput[] = [
        {
          shard_id: "shard_0",
          frame_range: { start: 0, end: 100 },
          video_file_path: "/tmp/test0.mp4",
          sha256: "abc123",
          bytes: 1000,
          duration_s: 3.33,
        },
        {
          shard_id: "shard_1",
          frame_range: { start: 110, end: 200 }, // gap
          video_file_path: "/tmp/test1.mp4",
          sha256: "def456",
          bytes: 1000,
          duration_s: 3.33,
        },
      ];

      await expect(
        mergeShardOutputs(
          {
            shards,
            outputPath: path.join(workingDir, "out.mp4"),
            workingDir,
          },
          async () => ({ exitCode: 0, stdout: "" }),
        ),
      ).rejects.toThrow("Frame continuity validation failed");
    });

    it("returns single shard as-is if only one shard (after creating shard file)", async () => {
      const shardPath = path.join(workingDir, "shard_0.mp4");
      await fs.writeFile(shardPath, "fake video data");

      const shard: ShardRenderOutput = {
        shard_id: "shard_0",
        frame_range: { start: 0, end: 100 },
        video_file_path: shardPath,
        sha256: "abc123",
        bytes: 14,
        duration_s: 3.33,
      };

      const result = await mergeShardOutputs(
        {
          shards: [shard],
          outputPath: path.join(workingDir, "out.mp4"),
          workingDir,
        },
        async () => ({ exitCode: 0, stdout: "" }),
      );

      expect(result.shard_id).toBe("shard_0");
      expect(result.frame_range).toEqual({ start: 0, end: 100 });
    });

    it("calls FFmpeg with concat demuxer for multiple shards", async () => {
      const shard0Path = path.join(workingDir, "shard_0.mp4");
      const shard1Path = path.join(workingDir, "shard_1.mp4");
      const outputPath = path.join(workingDir, "merged.mp4");

      await fs.writeFile(shard0Path, "fake video 0");
      await fs.writeFile(shard1Path, "fake video 1");

      const shards: ShardRenderOutput[] = [
        {
          shard_id: "shard_0",
          frame_range: { start: 0, end: 100 },
          video_file_path: shard0Path,
          sha256: "abc123",
          bytes: 11,
          duration_s: 3.33,
        },
        {
          shard_id: "shard_1",
          frame_range: { start: 100, end: 200 },
          video_file_path: shard1Path,
          sha256: "def456",
          bytes: 11,
          duration_s: 3.33,
        },
      ];

      let ffmpegCalled = false;
      const mockExec: ExecFfmpeg = async (args) => {
        ffmpegCalled = true;
        expect(args).toContain("concat");
        expect(args).toContain("-c");
        expect(args).toContain("copy"); // stream copy
        // Create fake output
        await fs.writeFile(outputPath, "fake merged video");
        return { exitCode: 0, stdout: "" };
      };

      const result = await mergeShardOutputs(
        {
          shards,
          outputPath,
          workingDir,
        },
        mockExec,
      );

      expect(ffmpegCalled).toBe(true);
      expect(result.shard_id).toBe("merged");
      expect(result.frame_range).toEqual({ start: 0, end: 200 });
    });

    it("throws on FFmpeg failure", async () => {
      const shard0Path = path.join(workingDir, "shard_0.mp4");
      const shard1Path = path.join(workingDir, "shard_1.mp4");
      await fs.writeFile(shard0Path, "fake video 0");
      await fs.writeFile(shard1Path, "fake video 1");

      const shards: ShardRenderOutput[] = [
        {
          shard_id: "shard_0",
          frame_range: { start: 0, end: 100 },
          video_file_path: shard0Path,
          sha256: "abc123",
          bytes: 11,
          duration_s: 3.33,
        },
        {
          shard_id: "shard_1",
          frame_range: { start: 100, end: 200 },
          video_file_path: shard1Path,
          sha256: "def456",
          bytes: 11,
          duration_s: 3.33,
        },
      ];

      const mockExec: ExecFfmpeg = async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "FFmpeg error: invalid input",
      });

      await expect(
        mergeShardOutputs(
          {
            shards,
            outputPath: path.join(workingDir, "out.mp4"),
            workingDir,
          },
          mockExec,
        ),
      ).rejects.toThrow("FFmpeg concat failed");
    });

    it("generates SHA256 hash for merged output", async () => {
      const shard0Path = path.join(workingDir, "shard_0.mp4");
      const shard1Path = path.join(workingDir, "shard_1.mp4");
      const outputPath = path.join(workingDir, "merged.mp4");

      await fs.writeFile(shard0Path, "test content 0");
      await fs.writeFile(shard1Path, "test content 1");

      const shards: ShardRenderOutput[] = [
        {
          shard_id: "shard_0",
          frame_range: { start: 0, end: 100 },
          video_file_path: shard0Path,
          sha256: "abc123",
          bytes: 14,
          duration_s: 3.33,
        },
        {
          shard_id: "shard_1",
          frame_range: { start: 100, end: 200 },
          video_file_path: shard1Path,
          sha256: "def456",
          bytes: 14,
          duration_s: 3.33,
        },
      ];

      const result = await mergeShardOutputs(
        {
          shards,
          outputPath,
          workingDir,
        },
        async (args) => {
          // Create output file so hash can be computed
          await fs.writeFile(outputPath, "merged video content");
          return { exitCode: 0, stdout: "" };
        },
      );

      expect(result.sha256).toBeDefined();
      expect(result.sha256.length).toBe(64); // SHA256 hex is 64 chars
    });
  });

  describe("generatePreview", () => {
    it("throws if input file does not exist", async () => {
      await expect(
        generatePreview(
          {
            inputPath: "/nonexistent/file.mp4",
            outputPath: path.join(workingDir, "preview.mp4"),
            resolution: "1280x720",
            fps: 3,
            inputFps: 30, // R02.6: real source fps, no longer silently assumed
          },
          async () => ({ exitCode: 1, stdout: "", stderr: "File not found" }),
        ),
      ).rejects.toThrow();
    });

    it("calls FFmpeg with frame subsampling filter", async () => {
      const inputPath = path.join(workingDir, "input.mp4");
      const outputPath = path.join(workingDir, "preview.mp4");

      await fs.writeFile(inputPath, "fake video");

      let ffmpegCalled = false;
      const mockExec: ExecFfmpeg = async (args) => {
        ffmpegCalled = true;
        expect(args).toContain("-vf"); // video filter
        // Check that frame subsampling is in the filter
        const filterIndex = args.indexOf("-vf");
        expect(args[filterIndex + 1]).toContain("select");
        expect(args[filterIndex + 1]).toContain("scale");
        // Create fake output
        await fs.writeFile(outputPath, "fake preview");
        return { exitCode: 0, stdout: "" };
      };

      const result = await generatePreview(
        {
          inputPath,
          outputPath,
          resolution: "1280x720",
          fps: 3,
          inputFps: 30, // R02.6: real source fps, no longer silently assumed
        },
        mockExec,
      );

      expect(ffmpegCalled).toBe(true);
      expect(result.resolution).toBe("1280x720");
      expect(result.fps).toBe(3);
    });

    // R02.6 — the sampling filter must reflect the REAL input fps, not a
    // hardcoded 30fps assumption. At 24fps requesting 3fps output, the
    // correct frameStep is round(24/3) = 8, not the old fixed "10".
    it("computes frame subsampling from the REAL input fps, not a hardcoded 30fps assumption", async () => {
      const inputPath = path.join(workingDir, "input24fps.mp4");
      const outputPath = path.join(workingDir, "preview24fps.mp4");
      await fs.writeFile(inputPath, "fake video");

      let capturedFilter = "";
      const mockExec: ExecFfmpeg = async (args) => {
        const filterIndex = args.indexOf("-vf");
        capturedFilter = args[filterIndex + 1] as string;
        await fs.writeFile(outputPath, "fake preview");
        return { exitCode: 0, stdout: "" };
      };

      await generatePreview(
        { inputPath, outputPath, resolution: "1280x720", fps: 3, inputFps: 24 },
        mockExec,
      );
      // round(24/3) = 8, NOT 10 (which is what the old hardcoded-30fps
      // logic would have produced for this same 24fps source).
      expect(capturedFilter).toContain("mod(n\\,8)");
    });

    it("rejects a non-positive or non-finite inputFps rather than silently misbehaving", async () => {
      const inputPath = path.join(workingDir, "input.mp4");
      await fs.writeFile(inputPath, "fake video");
      await expect(
        generatePreview(
          { inputPath, outputPath: path.join(workingDir, "p.mp4"), resolution: "1280x720", fps: 3, inputFps: 0 },
          async () => ({ exitCode: 0, stdout: "" }),
        ),
      ).rejects.toThrow();
    });

    it("returns PreviewArtifact with correct metadata", async () => {
      const inputPath = path.join(workingDir, "input.mp4");
      const outputPath = path.join(workingDir, "preview.mp4");

      await fs.writeFile(inputPath, "fake video");

      const result = await generatePreview(
        {
          inputPath,
          outputPath,
          resolution: "1280x720",
          fps: 3,
          inputFps: 30,
        },
        async (args) => {
          await fs.writeFile(outputPath, "fake preview data");
          return { exitCode: 0, stdout: "" };
        },
      );

      expect(result.preview_id).toBeDefined();
      expect(result.output_path).toBe(outputPath);
      expect(result.resolution).toBe("1280x720");
      expect(result.fps).toBe(3);
      expect(result.bytes).toBeGreaterThan(0);
      // R02.6: no probe was supplied, so duration is honestly null, never
      // a fabricated measurement (the old behavior always faked 0 here).
      expect(result.duration_s).toBeNull();
    });

    it("R02.6: a supplied probe seam yields a genuinely measured duration_s", async () => {
      const inputPath = path.join(workingDir, "input.mp4");
      const outputPath = path.join(workingDir, "preview.mp4");
      await fs.writeFile(inputPath, "fake video");

      const fixtureProbe = async () => ({ decodable: true, duration_s: 4.2 });
      const result = await generatePreview(
        { inputPath, outputPath, resolution: "1280x720", fps: 3, inputFps: 30 },
        async () => {
          await fs.writeFile(outputPath, "fake preview data");
          return { exitCode: 0, stdout: "" };
        },
        fixtureProbe,
      );
      expect(result.duration_s).toBe(4.2);
    });

    it("R02.6: a probe that fails or reports non-decodable yields null, not a fabricated number", async () => {
      const inputPath = path.join(workingDir, "input.mp4");
      const outputPath = path.join(workingDir, "preview.mp4");
      await fs.writeFile(inputPath, "fake video");

      const failingProbe = async () => ({ decodable: false });
      const result = await generatePreview(
        { inputPath, outputPath, resolution: "1280x720", fps: 3, inputFps: 30 },
        async () => {
          await fs.writeFile(outputPath, "fake preview data");
          return { exitCode: 0, stdout: "" };
        },
        failingProbe,
      );
      expect(result.duration_s).toBeNull();
    });

    it("throws on FFmpeg failure", async () => {
      const inputPath = path.join(workingDir, "input.mp4");
      const outputPath = path.join(workingDir, "preview.mp4");

      await fs.writeFile(inputPath, "fake video");

      const mockExec: ExecFfmpeg = async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "FFmpeg error",
      });

      await expect(
        generatePreview(
          {
            inputPath,
            outputPath,
            resolution: "1280x720",
            fps: 3,
            inputFps: 30,
          },
          mockExec,
        ),
      ).rejects.toThrow("Preview generation failed");
    });
  });
});
