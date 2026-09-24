// P3.08-DIST — Distributed Render Orchestration (Full 5-Phase Orchestration)
// Coordinates sharding, scheduling, execution, merge, and QA feedback for an
// OPTIONAL distributed variant of P3.08 Render (single-machine Remotion
// render, render.ts, remains the default path).
//
// NAMING: despite the "p309" file/class-name fragment (left over from an
// earlier numbering scheme, kept to avoid an unnecessary breaking rename of
// the public P309Orchestrator class / file names), this module is NOT phase
// P3.09. Phase P3.09 is canonical Automated QA (qa.ts / runP309QA in
// pipeline.ts). This module's own log/kernel-title strings say
// "P3.08-DIST" specifically so runtime output never reads as QA output.

import { StageCache } from "./checkpoint.js";
import { CostLedger } from "./costLedger.js";
import { ResourceScheduler, type AvailableCapacity } from "./scheduling.js";
import { FrameRangeShardingStrategy } from "./sharding.js";
import { FailureRecoveryOrchestrator } from "./recovery.js";
import { mergeShardOutputs, validateShardContinuity } from "./merge.js";
import { FeedbackRouter, shouldReRender, shouldEscalate } from "./feedback.js";
import type { RoutedFeedback } from "./feedback.js";
import { submitKaggleShard, checkKaggleShard, downloadKaggleShard, defaultExecKaggleCli } from "./distribution.js";
import type { ExecKaggleCli } from "./distribution.js";
import { loadP309Identity } from "./p309Config.js";
import type { P309Identity } from "./p309Config.js";
import { buildWorkerPayload } from "./renderBundle.js";
import type {
  RenderBundle,
  RenderManifest,
  ResolvedAsset,
  ShardSpecification,
  ShardAssignment,
  ShardRenderOutput,
  Timeline,
  HumanQAFeedback,
} from "./types.js";

export interface P309DistributedRenderParams {
  timeline: Timeline;
  resolvedAssets: ResolvedAsset[];
  stagingDir: string;
  outputDir: string;
  costLedger: CostLedger;
  // TIER-1 REPAIR T1.8 — required so the distributed path consumes the same
  // canonical render input as the local path.
  renderBundle: RenderBundle;
  checkpointDir?: string;
  shardCount?: number; // defaults to 3
  enableLocalRender?: boolean;
  enableKaggleRender?: boolean;
  // Kaggle/GitHub identity for Phase 3 submission — resolved via
  // p309Config.loadP309Identity() (env vars or this override). Required to
  // reach Phase 3 for real; omitted here only when the caller already set
  // KAGGLE_USERNAME/P309_GITHUB_REPO_URL in the environment.
  identity?: Partial<P309Identity>;
  pollIntervalMs?: number;
}

export class P309Orchestrator {
  public readonly shardingStrategy: FrameRangeShardingStrategy;
  public readonly phase2Scheduler: ResourceScheduler;
  public readonly phase3Recovery: FailureRecoveryOrchestrator;
  public readonly phase5Feedback: FeedbackRouter;
  private readonly cache: StageCache;
  // Real CostLedger (costLedger.ts), not a stand-in that always returns
  // false — its wouldExceedLimit() checks the ledger's actual per-provider
  // quota and overall budget. No budget cap by default (Infinity — never
  // exceeded) unless the caller configures one via the constructor.
  private readonly costLedger: CostLedger;
  private readonly execKaggle: ExecKaggleCli;

  constructor(cacheDir?: string, enableKaggle = true, costLedger?: CostLedger, execKaggle: ExecKaggleCli = defaultExecKaggleCli) {
    this.shardingStrategy = new FrameRangeShardingStrategy();
    this.phase2Scheduler = new ResourceScheduler({ enableLocal: !enableKaggle, enableKaggle });
    this.phase3Recovery = new FailureRecoveryOrchestrator(2);
    this.phase5Feedback = new FeedbackRouter();
    this.cache = new StageCache(cacheDir ? `${cacheDir}/p309_cache.json` : undefined);
    this.costLedger = costLedger ?? new CostLedger(Number.POSITIVE_INFINITY);
    this.execKaggle = execKaggle;
  }

  // Phase 1: Job Planning & Sharding
  async phase1Planning(timeline: Timeline, shardCount: number = 3, renderBundleHash?: string): Promise<ShardSpecification[]> {
    const shards = this.shardingStrategy.shardTimeline(timeline, shardCount, renderBundleHash);
    console.log(`[P3.08-DIST Phase 1] Planned ${shards.length} shards from ${timeline.total_frames} frames`);
    return shards;
  }

  // Phase 2: Distribution & Worker Assignment. An explicit costLedger
  // (e.g. P309DistributedRenderParams.costLedger from orchestrateFullWorkflow)
  // overrides the orchestrator's own instance ledger for this call only —
  // both are the real CostLedger class (costLedger.ts), never a placeholder.
  async phase2Assignment(shards: ShardSpecification[], capacity: AvailableCapacity, costLedger?: CostLedger): Promise<ShardAssignment[]> {
    const ledger = costLedger ?? this.costLedger;
    const assignments = this.phase2Scheduler.assignShards(shards, capacity, ledger);
    const totalCost = this.phase2Scheduler.estimateTotalCostUnits(assignments);
    const totalTime = this.phase2Scheduler.estimateTotalRenderTimeS(assignments, 1);
    const workers = capacity.available_workers.length;
    console.log(`[P3.08-DIST Phase 2] Assigned ${assignments.length} shards: ~${totalTime.toFixed(0)}s, cost=${totalCost} units, available workers=${workers}`);
    return assignments;
  }

  // Phase 3: Sharded Render + Autonomous Recovery
  async phase3Execution(
    shards: ShardSpecification[],
    assignments: ShardAssignment[],
    // TIER-1 REPAIR T1.8 — the immutable render bundle containing the
    // approved timeline, asset manifest and pinned code version. Required
    // (not optional) because a distributed render with no bundle has no
    // canonical input to consume, which was exactly the defect: previously
    // `timeline_json: JSON.stringify({})` stood in for it.
    renderBundle: RenderBundle,
    options?: {
      workingDir?: string;
      identity?: Partial<P309Identity>;
      kaggleTimeout?: number;
      // Real polling interval in production (10s default). Tests inject a
      // small value so a fixture execKaggle doesn't force a real 10s+ wait
      // per shard — this was the root cause of the prior flaky/timing-out
      // integration test (it always shelled out to the real Kaggle CLI with
      // no way to shorten the poll loop).
      pollIntervalMs?: number;
    },
  ): Promise<{ outputs: ShardRenderOutput[]; failedShards: string[] }> {
    const outputs: ShardRenderOutput[] = [];
    const failedShards: string[] = [];
    const workingDir = options?.workingDir || "/tmp/p309_execution";
    const { kaggleUsername, githubRepoUrl } = loadP309Identity(options?.identity);
    const kaggleTimeout = options?.kaggleTimeout || 600000; // 10 minutes
    const pollIntervalMs = options?.pollIntervalMs ?? 10000;

    console.log(`[P3.08-DIST Phase 3] Executing ${assignments.length} shards with real Kaggle submission...`);

    // R02.4 REPAIR — distributed recovery wiring.
    //
    // PROBLEM: this.phase3Recovery (a FailureRecoveryOrchestrator) was
    // constructed in the constructor and never referenced anywhere in this
    // method. Every shard failure — a non-"success" Kaggle status, a
    // download failure, a thrown exception — went straight to
    // `failedShards.push(...)`. The retry/reassign logic in recovery.ts
    // was fully implemented and unit-tested in isolation, but the PRIMARY
    // distributed execution path never called it, so the entire recovery
    // system was dead code from the point of view of a real distributed
    // render.
    //
    // REPAIR: the per-shard submit -> monitor -> download sequence is now
    // wrapped in an executor passed to
    // `this.phase3Recovery.executeShard(shardId, assignment, executor)`.
    // A transient failure (timeout, network blip, OOM) now genuinely gets
    // the recovery matrix's retry/backoff or reassign-then-retry treatment
    // before the shard is counted as failed.
    //
    // DOCUMENTED LIMITATION: `reassign_worker`'s "alternate worker" is a
    // WorkerType (e.g. "local_cpu"), but the Kaggle submission path below
    // does not currently vary its kernel/accelerator selection by worker
    // type — every submission goes to the same Kaggle kernel slug
    // regardless of `assignment.assigned_worker`. A reassignment retry on
    // this path is therefore functionally an additional retry attempt on
    // the same infrastructure, not a genuine move to different hardware.
    // This is a real, honestly-reported gap, not a silent one: it does not
    // reduce the intended benefit for the failure classes recovery.ts
    // actually targets (timeout, transient network, OOM), which benefit
    // from a retry regardless of whether the "worker" nominally changed.
    for (const assignment of assignments) {
      const shard = shards.find((s) => s.shard_id === assignment.shard_id);
      if (!shard) {
        console.error(`[P3.08-DIST Phase 3] Shard ${assignment.shard_id} not found in shards list`);
        failedShards.push(assignment.shard_id);
        continue;
      }

      const executeOnce = async (currentAssignment: ShardAssignment): Promise<ShardRenderOutput> => {
        console.log(`\n[P3.08-DIST Phase 3.${currentAssignment.shard_id}] Submitting to Kaggle...`);
        // Create slug-compatible kernel name (remove "shard_" prefix from shard_id to avoid duplication)
        const shardNum = currentAssignment.shard_id.replace(/^shard_/, "");
        const kernelSlug = `${kaggleUsername}/p309-shard-${shardNum}`;
        // TIER-1 REPAIR T1.8 — the worker receives the REAL approved timeline,
        // asset manifest, render configuration and pinned code version, all
        // derived from renderBundle and verified against its bundle_hash
        // immediately before use. Previously this was
        // `timeline_json: JSON.stringify({})`, so the remote kernel had no
        // canonical input at all (and, per T1.9, cloned unpinned HEAD besides).
        const workerPayload = buildWorkerPayload(renderBundle, {
          shard_id: currentAssignment.shard_id,
          frame_range: shard.frame_range,
        });
        const parameterBundle = {
          shard_id: currentAssignment.shard_id,
          frame_range: shard.frame_range,
          timeline_json: workerPayload.timeline_json,
          asset_manifest: workerPayload.asset_manifest,
          render_config: workerPayload.render_config,
          code_version: workerPayload.code_version,
          bundle_hash: workerPayload.bundle_hash,
          asset_file_ids: shard.asset_file_ids || [],
          output_dataset_id: "p309-shard-outputs",
        };

        // Submit shard to Kaggle
        const submission = await submitKaggleShard(
          {
            assignment: currentAssignment,
            kernelSlug,
            outputDatasetId: "p309-shard-outputs",
            workingDir,
            parameterBundle,
            repoUrl: githubRepoUrl,
          },
          this.execKaggle,
        );

        console.log(`[P3.08-DIST Phase 3.${currentAssignment.shard_id}] Submitted: ${submission.kernel_id} at ${submission.submitted_at}`);

        // Monitor execution with timeout
        const startTime = Date.now();
        let status = "running";
        let attempts = 0;
        const maxAttempts = Math.max(1, Math.ceil(kaggleTimeout / pollIntervalMs));

        while (status === "running" && attempts < maxAttempts) {
          attempts++;
          await new Promise((r) => setTimeout(r, pollIntervalMs));

          const check = await checkKaggleShard(
            {
              kernelSlug,
              shardId: currentAssignment.shard_id,
              workingDir,
            },
            this.execKaggle,
          );

          status = check.status;
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(`[P3.08-DIST Phase 3.${currentAssignment.shard_id}] Status: ${status} (${elapsed}s, attempt ${attempts}/${maxAttempts})`);

          if (check.logs) {
            console.log(`  Logs: ${check.logs.substring(0, 200)}`);
          }
        }

        if (status !== "success") {
          // Error message deliberately contains the literal token
          // "timeout" (not "timed out" — classifyFailure does a plain
          // substring check, and "timed out" does NOT contain "timeout" as
          // a substring) so FailureRecoveryOrchestrator.classifyFailure()
          // classifies a non-success status as a timeout/retry case rather
          // than falling through to the "worker_death" default.
          throw new Error(`Render did not reach success status before timeout: status=${status}`);
        }

        // Download shard output
        console.log(`[P3.08-DIST Phase 3.${currentAssignment.shard_id}] Downloading output...`);
        const shardOutput = await downloadKaggleShard(
          {
            kernelSlug,
            shardId: currentAssignment.shard_id,
            outputDir: `${workingDir}/outputs`,
            frameRange: shard.frame_range,
          },
          this.execKaggle,
        );

        if (!shardOutput) {
          throw new Error(`Failed to retrieve output for shard ${currentAssignment.shard_id} (network/not found)`);
        }

        console.log(`[P3.08-DIST Phase 3.${currentAssignment.shard_id}] ✅ Shard complete: ${shardOutput.video_file_path} (${shardOutput.bytes} bytes)`);
        return shardOutput;
      };

      const recoveryResult = await this.phase3Recovery.executeShard(assignment.shard_id, assignment, executeOnce);

      if (recoveryResult.success && recoveryResult.result) {
        outputs.push(recoveryResult.result);
      } else {
        console.error(
          `[P3.08-DIST Phase 3.${assignment.shard_id}] Exhausted recovery after ${recoveryResult.attempts} attempt(s): ${recoveryResult.lastError?.message}`,
        );
        failedShards.push(assignment.shard_id);
      }
    }

    console.log(`\n[P3.08-DIST Phase 3] Complete: ${outputs.length}/${assignments.length} shards successful`);
    return { outputs, failedShards };
  }

  // Phase 4: Merge + Validation + Preview
  async phase4Merge(
    outputs: ShardRenderOutput[],
    outputDir: string,
    timeline: Timeline,
  ): Promise<{ manifest: RenderManifest; preview: string | null }> {
    if (outputs.length === 0) {
      return {
        manifest: {
          run_id: `P309-${Date.now()}`,
          scope: "master",
          target_id: "distributed",
          fps: timeline.fps,
          resolution: "1080x1920",
          codec: "h264",
          outputs: [],
          result: "failed",
        },
        preview: null,
      };
    }

    // Validate continuity against the shards' REAL frame ranges (populated
    // by downloadKaggleShard from the shard spec — see distribution.ts).
    const validation = await validateShardContinuity(outputs);
    if (!validation.valid) {
      throw new Error(`Shard merge continuity failed: ${validation.message}`);
    }
    console.log(`[P3.08-DIST Phase 4] Continuity validated: ${validation.message}`);

    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    await fs.mkdir(outputDir, { recursive: true });
    const mergedOutputPath = path.join(outputDir, `distributed_render_${Date.now()}.mp4`);

    // Real FFmpeg concat merge (mergeShardOutputs) — not a placeholder
    // manifest built from the unmerged per-shard list. Its own sha256/bytes
    // come from the actual merged file, same real-content-hash discipline
    // as P3.08's render.ts.
    // T2.6 — pass the real timeline fps through instead of relying on
    // mergeShardOutputs' 30fps default.
    const merged = await mergeShardOutputs({ shards: outputs, outputPath: mergedOutputPath, workingDir: outputDir, fps: timeline.fps });

    const manifest: RenderManifest = {
      run_id: `P309-${Date.now()}`,
      scope: "master",
      target_id: "distributed",
      fps: timeline.fps,
      resolution: "1080x1920",
      codec: "h264",
      outputs: [{ path: merged.video_file_path, sha256: merged.sha256, bytes: merged.bytes }],
      result: "success",
    };

    // NOTE: low-bandwidth preview generation (generatePreview in merge.ts)
    // is implemented and unit-tested but not yet wired into this
    // orchestration path — preview is intentionally null rather than a
    // fabricated path string. See FULL_PIPELINE_CANONICAL_MANIFEST.md /
    // P3.08-DIST status notes.
    return { manifest, preview: null };
  }

  // Phase 5: Visual QA + Feedback Routing
  async phase5QA(
    feedback: HumanQAFeedback,
    failedShards: string[],
  ): Promise<{ reRender: boolean; escalate: boolean; routed: RoutedFeedback[] }> {
    const routed = this.phase5Feedback.routeFeedback(feedback);
    const reRender = shouldReRender(feedback);
    const escalate = shouldEscalate(feedback);

    console.log(`[P3.08-DIST Phase 5] Feedback: reRender=${reRender}, escalate=${escalate}, routed=${routed.length} items`);

    return { reRender, escalate, routed };
  }

  // Optional: coordinate full 5-phase workflow
  //
  // TIER-1 REPAIR T1.10 — no partial production success.
  //
  // PROBLEM: when some shards failed, the previous code logged a
  // console.warn and proceeded straight to phase4Merge with only the
  // SUCCESSFUL outputs. phase4Merge has no way to know shards were missing
  // — it merges what it was given and returns result: "success". A
  // 3-shard render where 1 shard failed silently produced a shorter,
  // incomplete video reported as a successful final delivery.
  //
  // REPAIR: `expected shards == successful shards` is now required before
  // any merge is attempted. A shortfall is reported as result: "partial"
  // (RenderManifest already models this state) with no merge attempted and
  // no output claimed — never silently presented as a successful render.
  async orchestrateFullWorkflow(params: P309DistributedRenderParams): Promise<RenderManifest> {
    const shardCount = params.shardCount || 3;

    // Phase 1
    const shards = await this.phase1Planning(params.timeline, shardCount, params.renderBundle.bundle_hash);

    // Phase 2
    const capacity = await this.phase2Scheduler.probeAvailableCapacity();
    const assignments = await this.phase2Assignment(shards, capacity, params.costLedger);

    // Phase 3
    const { outputs, failedShards } = await this.phase3Execution(shards, assignments, params.renderBundle, {
      workingDir: params.stagingDir,
      identity: params.identity,
      pollIntervalMs: params.pollIntervalMs,
    });

    if (failedShards.length > 0) {
      // T1.10: a shard shortfall is a FINAL failure, not a smaller success.
      // No merge is attempted — merging partial output and calling it
      // "success" is exactly the defect being repaired.
      console.error(
        `[P3.08-DIST] ${failedShards.length}/${shards.length} shard(s) failed — ` +
          `expected ${shards.length}, got ${outputs.length}. No merge will be attempted; ` +
          `this render cannot be a successful final delivery (T1.10).`,
      );
      return {
        run_id: `P309-${Date.now()}`,
        scope: "master",
        target_id: "distributed",
        fps: params.timeline.fps,
        resolution: "1080x1920",
        codec: "h264",
        outputs: [],
        result: "partial",
        error_details: `${failedShards.length}/${shards.length} shard(s) failed: ${failedShards.join(", ")}`,
      };
    }

    if (outputs.length !== shards.length) {
      // Defensive: a mismatch that isn't reflected in failedShards is still
      // a shortfall and must not merge.
      return {
        run_id: `P309-${Date.now()}`,
        scope: "master",
        target_id: "distributed",
        fps: params.timeline.fps,
        resolution: "1080x1920",
        codec: "h264",
        outputs: [],
        result: "partial",
        error_details: `expected ${shards.length} shard outputs, got ${outputs.length}`,
      };
    }

    // Phase 4 — only reached when expected shards === successful shards.
    const { manifest } = await this.phase4Merge(outputs, params.outputDir, params.timeline);

    console.log(`[P3.08-DIST] Workflow complete: ${manifest.outputs.length} outputs, result=${manifest.result}`);

    return manifest;
  }
}
