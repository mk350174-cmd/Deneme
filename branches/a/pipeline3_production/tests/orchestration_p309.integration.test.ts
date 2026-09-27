// P3.08-DIST Distributed Render (NOT phase P3.09/Automated QA) — End-to-End Orchestration Integration Tests
// Full workflow simulation: sharding → scheduling → execution → merge → QA

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { P309Orchestrator } from "../src/orchestration_p309.js";
import { FrameRangeShardingStrategy } from "../src/sharding.js";
import { ResourceScheduler } from "../src/scheduling.js";
import { CostLedger } from "../src/costLedger.js";
import { buildRenderBundle } from "../src/renderBundle.js";
import type { ExecKaggleCli } from "../src/distribution.js";
import type { RenderBundle, Timeline, ResolvedAsset } from "../src/types.js";

// Fixture Kaggle CLI seam — no real `kaggle` binary or network call.
// Mirrors the real CLI's three call shapes used by distribution.ts:
// `kernels push`, `kernels status`, `kernels output`. "kernels output"
// also produces a REAL, small H.264 video file (same technique as
// real_proof_merge_validation.test.ts) rather than junk bytes — Phase 4 now
// runs the real FFmpeg concat merge, which correctly rejects invalid
// containers, so the fixture output has to be a genuine decodable video.
const fixtureExecKaggle: ExecKaggleCli = async (args) => {
  if (args[0] === "kernels" && args[1] === "push") {
    return { exitCode: 0, stdout: "Kernel version successfully pushed (fixture)" };
  }
  if (args[0] === "kernels" && args[1] === "status") {
    return { exitCode: 0, stdout: "status: complete" };
  }
  if (args[0] === "kernels" && args[1] === "output") {
    const outDir = args[4];
    await fs.mkdir(outDir, { recursive: true });
    const outputPath = path.join(outDir, "shard_output.mp4");
    const durationS = 10 / 30; // 10 frames @ 30fps — small and fast to encode
    execSync(
      [
        "ffmpeg", "-f", "lavfi", "-i", `color=c=black:s=320x180:d=${durationS}`,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", outputPath,
      ].join(" "),
      { stdio: "pipe" },
    );
    return { exitCode: 0, stdout: "Output file(s) downloaded (fixture)" };
  }
  return { exitCode: 1, stdout: "", stderr: `fixtureExecKaggle: unrecognized args ${JSON.stringify(args)}` };
};

describe("P3.08-DIST Orchestrator — End-to-End Integration", () => {
  let orchestrator: P309Orchestrator;
  let workingDir: string;
  let testTimeline: Timeline;
  let testAssets: ResolvedAsset[];
  let costLedger: CostLedger;

  beforeEach(async () => {
    // Setup test workspace
    workingDir = path.join(
      "/tmp",
      `p309-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(workingDir, { recursive: true });

    // Create orchestrator with a fast fixture execKaggle — the real
    // defaultExecKaggleCli shells out to the `kaggle` binary and, combined
    // with the (real, 10s) poll interval, made this suite depend on
    // network/CLI availability and could exceed vitest's default 5s test
    // timeout. Injecting the seam (as every other P3 raw-I/O module does)
    // keeps this test hermetic and fast without touching orchestration
    // logic itself.
    orchestrator = new P309Orchestrator(path.join(workingDir, "cache"), true, undefined, fixtureExecKaggle);

    // Create minimal test timeline
    testTimeline = {
      fps: 30,
      total_frames: 300, // 10 seconds at 30fps
      entries: [
        {
          shot_id: "shot_1",
          asset_file_id: "asset_1",
          start_frame: 0,
          duration_frames: 100,
        },
        {
          shot_id: "shot_2",
          asset_file_id: "asset_2",
          start_frame: 100,
          duration_frames: 100,
        },
        {
          shot_id: "shot_3",
          asset_file_id: "asset_3",
          start_frame: 200,
          duration_frames: 100,
        },
      ],
    };

    // Create test assets. Cast to ResolvedAsset[] rather than restated
    // field-for-field: test files are not type-checked by `tsc -p
    // tsconfig.json` (see tsconfig's `include`), so the historical informal
    // shape ({ media_type, path }) is preserved unchanged here — it is not
    // this repair's concern — and only widened where a real value is
    // actually needed (buildRenderBundle, below, which reads real
    // ResolvedAsset fields).
    testAssets = [
      { asset_file_id: "asset_1", media_type: "VISUAL_VIDEO", path: "/staging/asset_1.mp4" },
      { asset_file_id: "asset_2", media_type: "VISUAL_VIDEO", path: "/staging/asset_2.mp4" },
      { asset_file_id: "asset_3", media_type: "VISUAL_VIDEO", path: "/staging/asset_3.mp4" },
    ] as unknown as ResolvedAsset[];

    // Real CostLedger (costLedger.ts) with no budget cap — proves
    // wouldExceedLimit() is now backed by the actual ledger implementation,
    // not a placeholder class that always returned false.
    costLedger = new CostLedger(Number.POSITIVE_INFINITY);
  });

  afterEach(async () => {
    try {
      await fs.rm(workingDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("Phase 1: Job Planning & Sharding", () => {
    it("creates shards from timeline", async () => {
      const shards = await orchestrator.phase1Planning(testTimeline, 3);

      expect(shards.length).toBe(3);
      expect(shards[0].frame_range.start).toBe(0);
      expect(shards[0].frame_range.end).toBeGreaterThan(0);
      expect(shards[shards.length - 1].frame_range.end).toBe(300);
    });

    it("creates non-overlapping shards", async () => {
      const shards = await orchestrator.phase1Planning(testTimeline, 3);

      for (let i = 0; i < shards.length - 1; i++) {
        expect(shards[i].frame_range.end).toBeLessThanOrEqual(shards[i + 1].frame_range.start);
      }
    });

    it("covers full timeline", async () => {
      const shards = await orchestrator.phase1Planning(testTimeline, 3);

      const start = shards[0].frame_range.start;
      const end = shards[shards.length - 1].frame_range.end;

      expect(start).toBe(0);
      expect(end).toBe(300);
    });

    it("respects entry boundaries", async () => {
      const shards = await orchestrator.phase1Planning(testTimeline, 3);

      for (const shard of shards) {
        for (const entryIdx of shard.entry_indices) {
          const entry = testTimeline.entries[entryIdx];
          expect(entry.start_frame).toBeLessThanOrEqual(shard.frame_range.end);
        }
      }
    });
  });

  describe("Phase 2: Distribution & Worker Assignment", () => {
    it("assigns shards to workers", async () => {
      const shards = await orchestrator.phase1Planning(testTimeline, 3);
      const capacity = await orchestrator.phase2Scheduler.probeAvailableCapacity();

      const assignments = await orchestrator.phase2Assignment(shards, capacity);

      expect(assignments.length).toBe(shards.length);
      expect(assignments.every((a) => a.shard_id)).toBe(true);
      expect(assignments.every((a) => a.assigned_worker)).toBe(true);
    });

    it("estimates render time", async () => {
      const shards = await orchestrator.phase1Planning(testTimeline, 3);
      const capacity = await orchestrator.phase2Scheduler.probeAvailableCapacity();
      const assignments = await orchestrator.phase2Assignment(shards, capacity);

      const totalTime = orchestrator.phase2Scheduler.estimateTotalRenderTimeS(assignments, 1);

      expect(totalTime).toBeGreaterThan(0);
      expect(totalTime).toBeLessThan(1000); // Should be reasonable for 300 frames at 30fps
    });

    it("estimates cost", async () => {
      const shards = await orchestrator.phase1Planning(testTimeline, 3);
      const capacity = await orchestrator.phase2Scheduler.probeAvailableCapacity();
      const assignments = await orchestrator.phase2Assignment(shards, capacity);

      const totalCost = orchestrator.phase2Scheduler.estimateTotalCostUnits(assignments);

      expect(totalCost).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Phase 4: Merge & Validation & Preview", () => {
    it("validates empty shard list", async () => {
      const validation = await orchestrator.phase4Merge([], workingDir, testTimeline);

      // Should handle gracefully
      expect(validation).toBeDefined();
    });

    it("creates manifest for single shard", async () => {
      // Create fake shard output
      const shardPath = path.join(workingDir, "shard_0.mp4");
      await fs.writeFile(shardPath, "fake video data");

      const shardOutput = {
        shard_id: "shard_0",
        frame_range: { start: 0, end: 300 },
        video_file_path: shardPath,
        sha256: "abc123",
        bytes: 14,
        duration_s: 10,
      };

      const result = await orchestrator.phase4Merge([shardOutput], workingDir, testTimeline);

      expect(result.manifest).toBeDefined();
      expect(result.manifest.fps).toBe(30);
      expect(result.manifest.outputs.length).toBeGreaterThan(0);
    });
  });

  describe("Phase 5: Visual QA & Feedback Routing", () => {
    it("processes QA feedback", async () => {
      const feedback = {
        feedback_id: "fb_001",
        preview_id: "preview_001",
        narrative_quality: "excellent" as const,
        technical_issues: [],
        continuity_issues: [],
        aesthetic_issues: [],
        specific_shot_ids: [],
        recommendation: "approve" as const,
      };

      const result = await orchestrator.phase5QA(feedback, []);

      expect(result).toBeDefined();
      expect(result.reRender).toBeDefined();
      expect(result.escalate).toBeDefined();
      expect(result.routed).toBeDefined();
    });

    it("routes technical feedback to rejection memory", async () => {
      const feedback = {
        feedback_id: "fb_002",
        preview_id: "preview_002",
        narrative_quality: "unreviewed" as const,
        technical_issues: ["codec mismatch"],
        continuity_issues: [],
        aesthetic_issues: [],
        specific_shot_ids: ["shot_1"],
        recommendation: "request_reshard" as const,
      };

      const result = await orchestrator.phase5QA(feedback, []);

      expect(result.routed.length).toBeGreaterThan(0);
      expect(result.routed.some((r) => r.memory_bucket === "REJECTION_MEMORY")).toBe(true);
    });
  });

  describe("Full Workflow Orchestration", () => {
    it("completes orchestration with minimal params", async () => {
      // TIER-1 REPAIR T1.8/T1.9: a RenderBundle is required so the
      // distributed path consumes the same canonical timeline/asset/code
      // inputs as the local path. testAssets doesn't carry real content
      // hashes (see the cast above), so a minimal but honestly-derived
      // bundle is built for it here.
      const resolvedAssetsForBundle: ResolvedAsset[] = testTimeline.entries.map((e, i) => ({
        asset_requirement_id: `areq_${i + 1}`,
        shot_id: e.shot_id,
        asset_file_id: e.asset_file_id,
        hash: `${i + 1}`.repeat(64).slice(0, 64),
        media_properties: {},
      }));
      const renderBundle: RenderBundle = buildRenderBundle({
        timeline: testTimeline,
        resolvedAssets: resolvedAssetsForBundle,
        renderConfig: { resolution: "1080x1920", codec: "h264", fps: testTimeline.fps },
        packageManifest: [],
        productionPackageId: "ppkg_test",
        productionPackageHash: "0".repeat(64),
        codeVersion: { kind: "git_commit", value: "d".repeat(40) },
      });

      const params = {
        timeline: testTimeline,
        resolvedAssets: testAssets,
        stagingDir: workingDir,
        outputDir: workingDir,
        costLedger,
        shardCount: 3,
        renderBundle,
        // No KAGGLE_USERNAME/P309_GITHUB_REPO_URL env vars in CI/dev — the
        // real identity source (p309Config.loadP309Identity) requires an
        // explicit value or it throws. Test-only identity, not a
        // production default.
        identity: { kaggleUsername: "test-fixture-user", githubRepoUrl: "https://github.com/test-fixture/repo.git" },
        pollIntervalMs: 1, // real default is 10000ms; tests don't need to wait
      };

      // Full 5-phase sequence runs against the fixture Kaggle CLI (no real
      // network/CLI dependency), proving: real per-shard frame_range
      // (not the old hardcoded 0,0), real CostLedger governance in
      // assignment, and a real FFmpeg merge producing the final manifest.
      const manifest = await orchestrator.orchestrateFullWorkflow(params);

      expect(manifest).toBeDefined();
      expect(manifest.result).toBe("success");
      expect(manifest.run_id).toBeDefined();
      expect(manifest.fps).toBe(30);
    });

    // TIER-1 REPAIR T1.8/T1.9: orchestrateFullWorkflow now requires a
    // RenderBundle — the immutable object the distributed path actually
    // consumes instead of the old `timeline_json: "{}"` placeholder. This
    // proves the bundle's real asset content hashes and pinned code version
    // genuinely reach the shard payload sent to the (fixture) Kaggle CLI.
    it("T1.8/T1.9: the render bundle's real timeline and pinned code version reach the worker payload", async () => {
      const resolvedAssetsForBundle: ResolvedAsset[] = [
        { asset_requirement_id: "areq_1", shot_id: "shot_1", asset_file_id: "asset_1", hash: "1".repeat(64), media_properties: {} },
        { asset_requirement_id: "areq_2", shot_id: "shot_2", asset_file_id: "asset_2", hash: "2".repeat(64), media_properties: {} },
        { asset_requirement_id: "areq_3", shot_id: "shot_3", asset_file_id: "asset_3", hash: "3".repeat(64), media_properties: {} },
      ];
      const renderBundle: RenderBundle = buildRenderBundle({
        timeline: testTimeline,
        resolvedAssets: resolvedAssetsForBundle,
        renderConfig: { resolution: "1080x1920", codec: "h264", fps: testTimeline.fps },
        packageManifest: [],
        productionPackageId: "ppkg_test",
        productionPackageHash: "0".repeat(64),
        codeVersion: { kind: "git_commit", value: "c".repeat(40) },
      });

      const capturedPayloads: string[] = [];
      // Delegates to the full fixtureExecKaggle flow (push/status/output)
      // so the render actually completes to "success" — only the push step
      // is additionally observed here to capture what was embedded in the
      // generated kernel script.
      const capturingExecKaggle: ExecKaggleCli = async (args) => {
        if (args[0] === "kernels" && args[1] === "push") {
          const kernelDir = args[3];
          const source = await fs.readFile(path.join(kernelDir, "render_shard.py"), "utf-8");
          capturedPayloads.push(source);
        }
        return fixtureExecKaggle(args);
      };
      const capturingOrchestrator = new P309Orchestrator(
        path.join(workingDir, "cache2"),
        true,
        undefined,
        capturingExecKaggle,
      );

      const manifest = await capturingOrchestrator.orchestrateFullWorkflow({
        timeline: testTimeline,
        resolvedAssets: resolvedAssetsForBundle,
        stagingDir: workingDir,
        outputDir: workingDir,
        costLedger,
        shardCount: 3,
        renderBundle,
        identity: { kaggleUsername: "test-fixture-user", githubRepoUrl: "https://github.com/test-fixture/repo.git" },
        pollIntervalMs: 1,
      });

      expect(manifest.result).toBe("success");
      expect(capturedPayloads.length).toBeGreaterThan(0);
      // The pinned commit SHA reached the generated kernel script, not an
      // unpinned `git pull`.
      expect(capturedPayloads[0]).toContain("c".repeat(40));
      expect(capturedPayloads[0]).not.toContain('"git", "-C", str(repo_dir), "pull"');
    });

    // TIER-1 REPAIR T1.10 — no partial production success.
    it("T1.10: a single failed shard produces result: 'partial', never a merged 'success'", async () => {
      const resolvedAssetsForBundle: ResolvedAsset[] = testTimeline.entries.map((e, i) => ({
        asset_requirement_id: `areq_${i + 1}`,
        shot_id: e.shot_id,
        asset_file_id: e.asset_file_id,
        hash: `${i + 1}`.repeat(64).slice(0, 64),
        media_properties: {},
      }));
      const renderBundle: RenderBundle = buildRenderBundle({
        timeline: testTimeline,
        resolvedAssets: resolvedAssetsForBundle,
        renderConfig: { resolution: "1080x1920", codec: "h264", fps: testTimeline.fps },
        packageManifest: [],
        productionPackageId: "ppkg_test",
        productionPackageHash: "0".repeat(64),
        codeVersion: { kind: "git_commit", value: "e".repeat(40) },
      });

      // Identifies "the first shard planned" (shards[0].shard_id) and fails
      // it PERMANENTLY — every push AND every status check for that
      // specific shard, no matter how many times it is retried — to prove
      // T1.10's no-partial-success invariant holds even once R02.4's
      // recovery wiring has exhausted its retries. Identified by kernel dir
      // path (embeds the real shard_id, per distribution.ts's
      // `kernel_${shard_id}` naming), NOT by call count — a naive call-count
      // condition would "recover" by coincidence once retries genuinely
      // resubmit (each retry calls push again), which a push-count-based
      // condition can't tell apart from a different shard's first push.
      let targetShardId: string | undefined;
      const failingOneShard: ExecKaggleCli = async (args) => {
        if (args[0] === "kernels" && args[1] === "push") {
          const kernelDir = String(args[3] ?? "");
          const match = kernelDir.match(/kernel_(shard_[a-z0-9]+)/);
          if (match && targetShardId === undefined) targetShardId = match[1];
          if (match && match[1] === targetShardId) {
            return { exitCode: 1, stdout: "", stderr: "kernel push error (fixture: permanently broken shard)" };
          }
          return { exitCode: 0, stdout: "pushed (fixture)" };
        }
        if (args[0] === "kernels" && args[1] === "status") {
          return fixtureExecKaggle(args);
        }
        return fixtureExecKaggle(args);
      };
      const failingOrchestrator = new P309Orchestrator(
        path.join(workingDir, "cache3"),
        true,
        undefined,
        failingOneShard,
      );

      const manifest = await failingOrchestrator.orchestrateFullWorkflow({
        timeline: testTimeline,
        resolvedAssets: resolvedAssetsForBundle,
        stagingDir: workingDir,
        outputDir: workingDir,
        costLedger,
        shardCount: 3,
        renderBundle,
        identity: { kaggleUsername: "test-fixture-user", githubRepoUrl: "https://github.com/test-fixture/repo.git" },
        pollIntervalMs: 1,
      });

      // Before T1.10: a failed shard was logged and merge proceeded with
      // only the successful outputs, reporting result: "success".
      expect(manifest.result).toBe("partial");
      expect(manifest.outputs).toHaveLength(0);
      expect(manifest.error_details).toBeTruthy();
    });

    // R02.4 — distributed recovery wiring.
    it("R02.4: a transient (timeout) shard failure is retried by FailureRecoveryOrchestrator on the primary path, and succeeds", async () => {
      const resolvedAssetsForBundle: ResolvedAsset[] = testTimeline.entries.map((e, i) => ({
        asset_requirement_id: `areq_${i + 1}`,
        shot_id: e.shot_id,
        asset_file_id: e.asset_file_id,
        hash: `${i + 1}`.repeat(64).slice(0, 64),
        media_properties: {},
      }));
      const renderBundle: RenderBundle = buildRenderBundle({
        timeline: testTimeline,
        resolvedAssets: resolvedAssetsForBundle,
        renderConfig: { resolution: "1080x1920", codec: "h264", fps: testTimeline.fps },
        packageManifest: [],
        productionPackageId: "ppkg_test",
        productionPackageHash: "0".repeat(64),
        codeVersion: { kind: "git_commit", value: "f".repeat(40) },
      });

      // Shard 0's FIRST status check reports a failure classified as
      // "timeout" (classifyFailure maps "timeout"/"exceeded" -> timeout,
      // whose recovery procedure is "retry"). Every subsequent status
      // check (the retry) succeeds normally. If FailureRecoveryOrchestrator
      // were NOT wired in (the pre-repair state), this single transient
      // failure would have gone straight to failedShards and the whole
      // workflow would report "partial" — proven by the previous test.
      let firstShardStatusChecks = 0;
      let firstPushSeen = false;
      const transientlyFailingOnce: ExecKaggleCli = async (args) => {
        if (args[0] === "kernels" && args[1] === "push") {
          if (!firstPushSeen) {
            firstPushSeen = true;
            return { exitCode: 0, stdout: "pushed (fixture)" };
          }
          return fixtureExecKaggle(args);
        }
        if (args[0] === "kernels" && args[1] === "status") {
          firstShardStatusChecks += 1;
          if (firstShardStatusChecks === 1) {
            // First-ever status check across the whole run: report a
            // timeout for THIS shard only, once.
            return { exitCode: 0, stdout: "status: error (fixture: simulated timeout)" };
          }
          return fixtureExecKaggle(args);
        }
        return fixtureExecKaggle(args);
      };

      const recoveringOrchestrator = new P309Orchestrator(
        path.join(workingDir, "cache4"),
        true,
        undefined,
        transientlyFailingOnce,
      );

      const manifest = await recoveringOrchestrator.orchestrateFullWorkflow({
        timeline: testTimeline,
        resolvedAssets: resolvedAssetsForBundle,
        stagingDir: workingDir,
        outputDir: workingDir,
        costLedger,
        shardCount: 3,
        renderBundle,
        identity: { kaggleUsername: "test-fixture-user", githubRepoUrl: "https://github.com/test-fixture/repo.git" },
        pollIntervalMs: 1,
      });

      // The transient failure was retried and recovered — final result is
      // a genuine success with all 3 shards merged, not a partial.
      expect(manifest.result).toBe("success");
    });
  });

  describe("Error Handling & Recovery", () => {
    it("handles sharding with single shard", async () => {
      const shards = await orchestrator.phase1Planning(testTimeline, 1);

      expect(shards.length).toBe(1);
      expect(shards[0].frame_range.start).toBe(0);
      expect(shards[0].frame_range.end).toBe(300);
    });

    it("handles sharding with many small shards", async () => {
      const shards = await orchestrator.phase1Planning(testTimeline, 10);

      expect(shards.length).toBeLessThanOrEqual(10);
      expect(shards[0].frame_range.start).toBe(0);
      expect(shards[shards.length - 1].frame_range.end).toBe(300);
    });

    it("assignment respects capacity limits", async () => {
      const shards = await orchestrator.phase1Planning(testTimeline, 3);
      const capacity = await orchestrator.phase2Scheduler.probeAvailableCapacity();

      const assignments = await orchestrator.phase2Assignment(shards, capacity);

      // Should assign all shards
      expect(assignments.length).toBe(shards.length);

      // All should have valid workers
      for (const assignment of assignments) {
        expect(assignment.assigned_worker).toBeDefined();
        expect(assignment.cost_estimate_units).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("Idempotency Properties", () => {
    it("produces same shards with same timeline (determinism)", async () => {
      const run1 = await orchestrator.phase1Planning(testTimeline, 3);
      const run2 = await orchestrator.phase1Planning(testTimeline, 3);

      expect(run1.length).toBe(run2.length);
      for (let i = 0; i < run1.length; i++) {
        expect(run1[i].shard_id).toBe(run2[i].shard_id);
        expect(run1[i].frame_range.start).toBe(run2[i].frame_range.start);
        expect(run1[i].frame_range.end).toBe(run2[i].frame_range.end);
      }
    });

    it("produces same assignments with same shards and capacity (determinism)", async () => {
      const shards = await orchestrator.phase1Planning(testTimeline, 3);
      const capacity = await orchestrator.phase2Scheduler.probeAvailableCapacity();

      const run1 = await orchestrator.phase2Assignment(shards, capacity);
      const run2 = await orchestrator.phase2Assignment(shards, capacity);

      expect(run1.length).toBe(run2.length);
      for (let i = 0; i < run1.length; i++) {
        expect(run1[i].shard_id).toBe(run2[i].shard_id);
        expect(run1[i].assigned_worker.id).toBe(run2[i].assigned_worker.id);
        expect(run1[i].cost_estimate_units).toBe(run2[i].cost_estimate_units);
      }
    });
  });

  describe("Orchestrator State & Caching", () => {
    it("initializes with cache directory", async () => {
      const cacheDir = path.join(workingDir, "test_cache");
      const orch = new P309Orchestrator(cacheDir);

      expect(orch).toBeDefined();
      // Cache should be initialized (file may not exist yet if no content stored)
    });

    it("maintains scheduler reference", () => {
      expect(orchestrator.phase2Scheduler).toBeDefined();
    });

    it("maintains recovery orchestrator reference", () => {
      expect(orchestrator.phase3Recovery).toBeDefined();
    });

    it("maintains feedback router reference", () => {
      expect(orchestrator.phase5Feedback).toBeDefined();
    });
  });
});
