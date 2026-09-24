// P3.08-DIST Distributed Render (NOT phase P3.09/Automated QA) — distribution.ts unit tests.
// Proves three real fixes (P3-A branch remediation, "12 düzeltme"):
//   1. buildKernelMetadata sets enable_internet: true (render_shard.py
//      requires git clone + npm install, both of which need network access;
//      enable_internet: false would make every real Kaggle run fail).
//   2. submitKaggleShard interpolates a caller-supplied repoUrl into the
//      generated kernel script instead of a hardcoded personal fork URL.
//   3. downloadKaggleShard returns the shard's REAL frame_range (from the
//      shard spec) and a REAL probed duration_s (from the downloaded file),
//      not the previous hardcoded { start: 0, end: 0 } / 0 placeholders.

import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildKernelMetadata,
  submitKaggleShard,
  downloadKaggleShard,
} from "../src/distribution.js";
import type { ExecKaggleCli } from "../src/distribution.js";
import type { MediaProbe } from "../src/assetValidation.js";
import type { ShardAssignment } from "../src/types.js";

function tmpDir(name: string): Promise<string> {
  const dir = path.join(os.tmpdir(), `distribution-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  return fs.mkdir(dir, { recursive: true }).then(() => dir);
}

describe("buildKernelMetadata", () => {
  it("enables internet access — render_shard.py clones a repo and runs npm install, both of which require it", () => {
    const metadata = buildKernelMetadata("someuser/some-kernel", "Some Title");
    expect(metadata.enable_internet).toBe(true);
  });
});

describe("submitKaggleShard — repoUrl is caller-supplied, not hardcoded", () => {
  const assignment: ShardAssignment = {
    shard_id: "shard_test1",
    assigned_worker: "kaggle_cpu_4core",
    estimated_duration_s: 10,
    cost_estimate_units: 1,
    priority: 0,
    retry_count: 0,
  };

  it("embeds the caller's repoUrl into the generated kernel script, not a fixed personal fork", async () => {
    let capturedKernelDir: string | undefined;
    const capturingExecKaggle: ExecKaggleCli = async (args) => {
      // args: ["kernels", "push", "-p", kernelDir, "--timeout", "54000"]
      capturedKernelDir = args[3];
      return { exitCode: 0, stdout: "pushed (fixture)" };
    };

    const workingDir = await tmpDir("submit-a");
    await submitKaggleShard(
      {
        assignment,
        kernelSlug: "test-user/p309-shard-test1",
        outputDatasetId: "p309-shard-outputs",
        workingDir,
        // TIER-1 REPAIR T1.8/T1.9 NOTE: submitKaggleShard now refuses a
        // placeholder timeline ("{}") and requires a pinned code_version —
        // this test is about repoUrl plumbing, not about T1.8/T1.9
        // themselves (those have their own dedicated tests), so it supplies
        // the minimum real values needed to get past the guard.
        parameterBundle: {
          shard_id: "shard_test1",
          frame_range: { start: 0, end: 100 },
          timeline_json: JSON.stringify({ fps: 30, total_frames: 100, entries: [] }),
          code_version: { kind: "git_commit" as const, value: "a".repeat(40) },
          asset_file_ids: [],
          output_dataset_id: "p309-shard-outputs",
        },
        repoUrl: "https://github.com/some-other-org/some-other-fork.git",
      },
      capturingExecKaggle,
    );

    expect(capturedKernelDir).toBeDefined();
    const pythonSource = await fs.readFile(path.join(capturedKernelDir!, "render_shard.py"), "utf-8");
    expect(pythonSource).toContain("https://github.com/some-other-org/some-other-fork.git");
    expect(pythonSource).not.toContain("mk350174-cmd/youtube");
  });

  it("a different repoUrl produces a different embedded clone target (proves it is not a constant)", async () => {
    const capturedDirs: string[] = [];
    const capturingExecKaggle: ExecKaggleCli = async (args) => {
      capturedDirs.push(args[3]);
      return { exitCode: 0, stdout: "pushed (fixture)" };
    };
    const workingDir = await tmpDir("submit-b");
    const paramsBase = {
      assignment,
      kernelSlug: "test-user/p309-shard-test1",
      outputDatasetId: "p309-shard-outputs",
      workingDir,
      parameterBundle: {
        shard_id: "shard_test1",
        frame_range: { start: 0, end: 100 },
        timeline_json: JSON.stringify({ fps: 30, total_frames: 100, entries: [] }),
        code_version: { kind: "git_commit" as const, value: "b".repeat(40) },
        asset_file_ids: [],
        output_dataset_id: "p309-shard-outputs",
      },
    };

    await submitKaggleShard({ ...paramsBase, repoUrl: "https://github.com/org-a/repo-a.git" }, capturingExecKaggle);
    const sourceA = await fs.readFile(path.join(capturedDirs[0], "render_shard.py"), "utf-8");

    await submitKaggleShard({ ...paramsBase, repoUrl: "https://github.com/org-b/repo-b.git" }, capturingExecKaggle);
    const sourceB = await fs.readFile(path.join(capturedDirs[1], "render_shard.py"), "utf-8");

    expect(sourceA).toContain("org-a/repo-a");
    expect(sourceB).toContain("org-b/repo-b");
    expect(sourceA).not.toContain("org-b/repo-b");
  });
});

describe("downloadKaggleShard — real frame_range and probed duration (not placeholders)", () => {
  const fixtureExecKaggleWithOutput = (fileName = "shard_output.mp4"): ExecKaggleCli => async (args) => {
    // args: ["kernels", "output", kernelSlug, "-p", shardDir]
    const shardDir = args[4];
    await fs.mkdir(shardDir, { recursive: true });
    await fs.writeFile(path.join(shardDir, fileName), Buffer.alloc(4096, 0x22));
    return { exitCode: 0, stdout: "downloaded (fixture)" };
  };

  it("returns the REAL frame_range supplied by the caller — not the old hardcoded {start:0, end:0}", async () => {
    const outputDir = await tmpDir("download-frame-range");
    const fixtureProbe: MediaProbe = async () => ({ decodable: true, duration_s: 3.33 });

    const result = await downloadKaggleShard(
      { kernelSlug: "u/k", shardId: "shard_xyz", outputDir, frameRange: { start: 150, end: 300 } },
      fixtureExecKaggleWithOutput(),
      fixtureProbe,
    );

    expect(result).not.toBeNull();
    expect(result!.frame_range).toEqual({ start: 150, end: 300 });
    expect(result!.frame_range).not.toEqual({ start: 0, end: 0 });
  });

  it("returns the REAL probed duration_s from the downloaded file — not the old hardcoded 0", async () => {
    const outputDir = await tmpDir("download-duration");
    const fixtureProbe: MediaProbe = async () => ({ decodable: true, duration_s: 12.5 });

    const result = await downloadKaggleShard(
      { kernelSlug: "u/k", shardId: "shard_dur", outputDir, frameRange: { start: 0, end: 300 } },
      fixtureExecKaggleWithOutput(),
      fixtureProbe,
    );

    expect(result!.duration_s).toBe(12.5);
  });

  it("probe is called with the actual downloaded file path (measurement is real, not derived arithmetically)", async () => {
    const outputDir = await tmpDir("download-probe-path");
    let probedPath: string | undefined;
    const capturingProbe: MediaProbe = async (assetFileId) => {
      probedPath = assetFileId;
      return { decodable: true, duration_s: 7 };
    };

    await downloadKaggleShard(
      { kernelSlug: "u/k", shardId: "shard_probe", outputDir, frameRange: { start: 0, end: 210 } },
      fixtureExecKaggleWithOutput(),
      capturingProbe,
    );

    expect(probedPath).toBeDefined();
    expect(probedPath).toContain("shard_probe");
    expect(probedPath).toContain(outputDir);
  });

  it("two different shards with different frame ranges get different frame_range in their outputs (not a shared constant)", async () => {
    const outputDir = await tmpDir("download-two-shards");
    const fixtureProbe: MediaProbe = async () => ({ decodable: true, duration_s: 1 });

    const resultA = await downloadKaggleShard(
      { kernelSlug: "u/k", shardId: "shard_a", outputDir, frameRange: { start: 0, end: 100 } },
      fixtureExecKaggleWithOutput(),
      fixtureProbe,
    );
    const resultB = await downloadKaggleShard(
      { kernelSlug: "u/k", shardId: "shard_b", outputDir, frameRange: { start: 100, end: 250 } },
      fixtureExecKaggleWithOutput(),
      fixtureProbe,
    );

    expect(resultA!.frame_range).toEqual({ start: 0, end: 100 });
    expect(resultB!.frame_range).toEqual({ start: 100, end: 250 });
  });
});
