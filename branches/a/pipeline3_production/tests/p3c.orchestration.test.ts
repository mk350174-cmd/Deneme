// P3-C Orchestration Bridge Tests
// Validates that P3.09 QA and P3.10 Kaggle are properly orchestrated via pipeline.ts

import { describe, expect, it } from "vitest";
import { runP309QA, runP310Kaggle } from "../src/pipeline.js";
import type { ResolvedAsset, Timeline, RenderManifest, GateApprovalRecord } from "../src/types.js";

describe("P3-C: Orchestration Bridge (P3.09 QA → P3.10 Kaggle)", () => {
  const resolvedAssets: ResolvedAsset[] = [
    {
      asset_requirement_id: "req_1",
      shot_id: "shot_1",
      asset_file_id: "file_1",
      hash: "abcd".repeat(16),
      media_properties: { type: "image" },
    },
  ];

  const timeline: Timeline = {
    fps: 30,
    total_frames: 300,
    entries: [
      {
        shot_id: "shot_1",
        asset_file_id: "file_1",
        start_frame: 0,
        duration_frames: 300,
      },
    ],
  };

  const render: RenderManifest = {
    run_id: "run_1",
    scope: "master",
    target_id: "target_1",
    fps: 30,
    resolution: "1080x1920",
    codec: "h264",
    outputs: [
      {
        path: "output.mp4",
        sha256: "abc123",
        bytes: 1000000,
      },
    ],
    result: "success",
  };

  const gateA7: GateApprovalRecord = {
    gate_id: "A7",
    state_before: "AUTOMATED_QA_COMPLETE",
    approval_record_id: "approval_1",
    actor: "test_actor",
    timestamp: new Date().toISOString(),
    object_version_being_approved: "qa_report_1",
    state_after: "FINAL_QA_APPROVED",
    downstream_operation_unlocked: "P3.10 Kaggle Delivery",
  };

  it("P3.09 runP309QA produces QAReport from assets and render", () => {
    const qaReport = runP309QA({
      targetId: "target_1",
      assetRequirements: [],
      resolvedAssets,
      assetProbes: [],
      timeline,
      render,
      narrationDurationS: 10.0,
      manifest: [],
      integrityHashes: { package_sha256: "test", per_file: {} },
      recomputedPackageSha256: "test",
    });
    expect(qaReport.result).toBeTruthy();
    expect(qaReport.report_id).toBeTruthy();
  });

  it("P3.10 runP310Kaggle accepts params and produces KaggleDeliveryRecord", async () => {
    // Fixture adapter for Kaggle CLI
    const fixtureExecKaggleCli = async (args: string[]) => {
      if (args[0] === "datasets" && args[1] === "files") {
        return { exitCode: 0, stdout: "name,size\noutput.mp4,1000000\n" };
      }
      return { exitCode: 0, stdout: "dataset created (fixture)" };
    };

    const fixtureStageAssetFile = async () => {};
    const fixtureWriteStagingFile = async () => {};

    const kaggleRecord = await runP310Kaggle(
      {
        finalVideoId: "video_1",
        files: ["output.mp4"],
        existingDeliveryRecords: [],
        gates: [gateA7],
      },
      fixtureExecKaggleCli,
      fixtureStageAssetFile,
      fixtureWriteStagingFile,
    );
    expect(kaggleRecord.final_video_id).toBe("video_1");
    expect(kaggleRecord.kaggle_dataset_id).toBeTruthy();
  });

  it("Full orchestration sequence P3.08 → P3.09 → P3.10 integration point", async () => {
    // This validates that QA and Kaggle orchestration wrappers work in sequence
    const qaReport = runP309QA({
      targetId: "target_1",
      assetRequirements: [],
      resolvedAssets,
      assetProbes: [],
      timeline,
      render,
      narrationDurationS: 10.0,
      manifest: [],
      integrityHashes: { package_sha256: "test", per_file: {} },
      recomputedPackageSha256: "test",
    });
    expect(qaReport).toBeDefined();
    expect(qaReport.result).toBeTruthy();

    // Gate A7 approval happens here (outside orchestration wrappers)
    const gateA7Approval: GateApprovalRecord = {
      gate_id: "A7",
      state_before: "AUTOMATED_QA_COMPLETE",
      approval_record_id: "approval_seq",
      actor: "test_actor",
      timestamp: new Date().toISOString(),
      object_version_being_approved: qaReport.report_id,
      state_after: "FINAL_QA_APPROVED",
      downstream_operation_unlocked: "P3.10 Kaggle Delivery",
    };

    const fixtureExecKaggleCli = async (args: string[]) => {
      if (args[0] === "datasets" && args[1] === "files") {
        return { exitCode: 0, stdout: "name,size\noutput.mp4,1000000\n" };
      }
      return { exitCode: 0, stdout: "dataset created (fixture)" };
    };

    const kaggleRecord = await runP310Kaggle(
      {
        finalVideoId: "video_seq",
        files: [render.outputs[0]!.path],
        existingDeliveryRecords: [],
        gates: [gateA7Approval],
      },
      fixtureExecKaggleCli,
      async () => {},
      async () => {},
    );

    expect(kaggleRecord).toBeDefined();
    expect(kaggleRecord.final_video_id).toBe("video_seq");
  });
});
