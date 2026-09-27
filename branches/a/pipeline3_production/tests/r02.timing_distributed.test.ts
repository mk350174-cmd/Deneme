// R02 — P3 timing / distributed hardening semantic proof tests.
// Every assertion here targets a specific item in the final repair
// instructions (R02.1 through R02.6) and, where the defect was real, fails
// against the pre-repair code.

import { describe, expect, it } from "vitest";
import { buildTimeline } from "../src/timeline.js";
import type { Scene, ResolvedAsset, TimingResult } from "../src/types.js";

// ---------------------------------------------------------------------------
// R02.1 — timeline FPS must never be hard-coded
// ---------------------------------------------------------------------------

describe("R02.1 timeline fps is real, not hard-coded to 30", () => {
  const scenes: Scene[] = [
    { scene_id: "scene_1", purpose: "p", shots: ["shot_1"], continuity_requirements: [], narrative_function: "n" },
  ];
  const resolvedAssets: ResolvedAsset[] = [
    { asset_requirement_id: "areq_1", shot_id: "shot_1", asset_file_id: "file_1", hash: "1".repeat(64), media_properties: {} },
  ];
  const timing: TimingResult = {
    actual_narration_duration_s: 2,
    intended_total_duration_s: 2,
    shot_timings: [{ shot_id: "shot_1", intended_duration_s: 2, allocated_duration_s: 2 }],
    conflicts: [],
  };

  it.each([24, 30, 60])("at %i fps, Timeline.fps reflects the real value and frame math is correct", (fps) => {
    const timeline = buildTimeline(scenes, timing, resolvedAssets, undefined, fps);
    expect(timeline.fps).toBe(fps);
    // 2 seconds of allocated duration at `fps` frames/sec.
    expect(timeline.entries[0]!.duration_frames).toBe(Math.round(2 * fps));
    expect(timeline.total_frames).toBe(Math.round(2 * fps));
  });

  it("two different fps values for the SAME duration produce genuinely different frame counts", () => {
    const at24 = buildTimeline(scenes, timing, resolvedAssets, undefined, 24);
    const at60 = buildTimeline(scenes, timing, resolvedAssets, undefined, 60);
    // Before the repair, both would have silently computed frames at a
    // hardcoded 30fps regardless of what was requested.
    expect(at24.entries[0]!.duration_frames).not.toBe(at60.entries[0]!.duration_frames);
    expect(at24.fps).toBe(24);
    expect(at60.fps).toBe(60);
  });

  it("omitting fps still defaults to 30 for backward compatibility", () => {
    const timeline = buildTimeline(scenes, timing, resolvedAssets);
    expect(timeline.fps).toBe(30);
  });

  it("rejects a non-positive or non-finite fps rather than silently misbehaving", () => {
    expect(() => buildTimeline(scenes, timing, resolvedAssets, undefined, 0)).toThrow();
    expect(() => buildTimeline(scenes, timing, resolvedAssets, undefined, -30)).toThrow();
    expect(() => buildTimeline(scenes, timing, resolvedAssets, undefined, NaN)).toThrow();
  });
});


// ---------------------------------------------------------------------------
// R02.2 — Final Delivery A7 invariant
// ---------------------------------------------------------------------------

import { assembleFinalDeliveryPackage, mapHumanQaFeedbackToFindings } from "../src/pipeline.js";
import { recordGateApproval } from "../src/gates.js";
import type {
  GateApprovalRecord,
  HumanQAFeedback,
  KaggleDeliveryRecord,
  NarrationRecord,
  ProductionPackageHandoffInput,
  QAReport,
  RenderManifest,
} from "../src/types.js";

function minimalFinalDeliveryParams(gates: GateApprovalRecord[]) {
  const timeline = { fps: 30, total_frames: 30, entries: [] as never[] };
  const timing: TimingResult = {
    actual_narration_duration_s: 1,
    intended_total_duration_s: 1,
    shot_timings: [],
    conflicts: [],
  };
  const render: RenderManifest = {
    run_id: "RUN-r02", scope: "master", target_id: "video_1", fps: 30, resolution: "1080x1920", codec: "h264",
    outputs: [{ path: "out.mp4", sha256: "a".repeat(64), bytes: 10 }], result: "success",
  };
  const qa: QAReport = {
    report_id: "qar_r02", scope: "master", target_id: "video_1", result: "pass", findings: [], human_review_required: true,
    production_package_id: "ppkg_1", production_package_version: "1.0.0", production_package_hash: "b".repeat(64),
    render_run_id: "RUN-r02", render_output_sha256: "a".repeat(64),
  };
  const kaggle: KaggleDeliveryRecord = {
    final_video_id: "video_1", kaggle_dataset_id: "ds_1", kaggle_dataset_url: "https://kaggle.com/x", files: ["out.mp4"],
  } as unknown as KaggleDeliveryRecord;
  const narration: NarrationRecord = {
    piper_preview: { output_path: "p.wav", measured_duration_s: 1, target_duration_s: 1, deviation_pct: 0, flagged: false },
    production_voice: { output_path: "v.wav", provider: "voicebox", duration_s: 1 } as never,
  } as unknown as NarrationRecord;
  const pkg = { project_id: "proj_1", package_id: "ppkg_1" } as unknown as ProductionPackageHandoffInput;
  return { pkg, resolvedAssets: [], narration, timing, timeline, render, qa, kaggle, gates };
}

describe("R02.2 Final Delivery requires Gate A7", () => {
  it("refuses to assemble a final delivery package with no gates at all", () => {
    expect(() => assembleFinalDeliveryPackage(minimalFinalDeliveryParams([]))).toThrow();
  });

  it("refuses to assemble when A7 was never recorded, even with other gates present", () => {
    const someOtherGate = recordGateApproval({
      gateId: "A4", stateBefore: "AWAITING_PRODUCTION_DELIVERY", actor: "user:x",
      objectVersionBeingApproved: "d1", stateAfter: "PRODUCTION_DELIVERY_RECEIVED",
      downstreamOperationUnlocked: "x",
    });
    expect(() => assembleFinalDeliveryPackage(minimalFinalDeliveryParams([someOtherGate]))).toThrow();
  });

  it("succeeds once Gate A7 FINAL_QA_APPROVED is genuinely on record", () => {
    const gateA7 = recordGateApproval({
      gateId: "A7", stateBefore: "AUTOMATED_QA_COMPLETE", actor: "user:x",
      objectVersionBeingApproved: "qar_r02", stateAfter: "FINAL_QA_APPROVED",
      downstreamOperationUnlocked: "P3.10",
    });
    const result = assembleFinalDeliveryPackage(minimalFinalDeliveryParams([gateA7]));
    expect(result.final_delivery_package_id).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// R02.3 — human QA representation
// ---------------------------------------------------------------------------

describe("R02.3 human QA findings are not silently discarded", () => {
  const gateA7 = recordGateApproval({
    gateId: "A7", stateBefore: "AUTOMATED_QA_COMPLETE", actor: "user:x",
    objectVersionBeingApproved: "qar_r02", stateAfter: "FINAL_QA_APPROVED",
    downstreamOperationUnlocked: "P3.10",
  });

  it("with no human review at all, human_qa is honestly null", () => {
    const result = assembleFinalDeliveryPackage(minimalFinalDeliveryParams([gateA7]));
    expect(result.human_qa).toBeNull();
  });

  it("linear-path HumanQAFindings (recordHumanQAFindings) reach the final package unmodified", () => {
    const params = minimalFinalDeliveryParams([gateA7]);
    const result = assembleFinalDeliveryPackage({
      ...params,
      humanQa: { narrative_quality: "excellent", continuity: "consistent", notes: ["looks great"] },
    });
    expect(result.human_qa).toEqual({ narrative_quality: "excellent", continuity: "consistent", notes: ["looks great"] });
  });

  it("distributed-path HumanQAFeedback is mapped into the final package, not discarded", () => {
    const feedback: HumanQAFeedback = {
      feedback_id: "fb_1", preview_id: "prev_1", narrative_quality: "good",
      continuity_issues: ["minor jump cut at shot_2"], aesthetic_issues: [], technical_issues: ["slight audio pop"],
      specific_shot_ids: ["shot_2"], timestamp_markers: [{ frame: 90, note: "jump cut here" }],
      recommendation: "approve",
    };
    const params = minimalFinalDeliveryParams([gateA7]);
    const result = assembleFinalDeliveryPackage({ ...params, humanQaFeedback: feedback });
    expect(result.human_qa).not.toBeNull();
    expect(result.human_qa!.narrative_quality).toBe("good");
    expect(result.human_qa!.continuity).toContain("minor jump cut at shot_2");
    expect(result.human_qa!.notes.join(" ")).toContain("slight audio pop");
    expect(result.human_qa!.notes.join(" ")).toContain("frame 90");
  });

  it("mapHumanQaFeedbackToFindings is a pure, directly-testable mapping", () => {
    const feedback: HumanQAFeedback = {
      feedback_id: "fb_2", preview_id: "prev_2", narrative_quality: "unreviewed",
      continuity_issues: [], aesthetic_issues: [], technical_issues: [], specific_shot_ids: [],
      timestamp_markers: [], recommendation: "escalate",
    };
    const findings = mapHumanQaFeedbackToFindings(feedback);
    // "unreviewed" is not a real narrative-quality verdict — must not be
    // fabricated into one.
    expect(findings.narrative_quality).toBeUndefined();
    expect(findings.notes.join(" ")).toContain("recommendation: escalate");
  });
});
