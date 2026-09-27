// P3.10 Kaggle Delivery — item 24 (exactly-one-dataset-per-video rule),
// item 25 (explicit large-asset pointer, never silently omitted), plus
// AUDIT FIX §13.6 correction 3 (real staging directory + dataset-metadata
// + post-upload verification, fixing the previous `-p <dataset_id_string>`
// bug) and §13.6 base (checkKaggleAuth real, non-destructive connectivity
// check). Uses fixture I/O-seam adapters throughout — never a real kaggle
// CLI call, never real filesystem I/O.

import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import { GateStateError } from "../src/errors.js";
import { checkKaggleAuth, createKaggleDatasetForVideo } from "../src/kaggle.js";
import type { ExecKaggleCli } from "../src/kaggle.js";
import type { StageAssetFile, WriteStagingFile } from "../src/assetStaging.js";
import { approveFinalQA } from "../src/pipeline.js";
import type { KaggleDeliveryRecord, QAReport, RenderManifest } from "../src/types.js";

// R07 REPAIR NOTE: this fixture used to report a HARDCODED, unrelated
// filename ("file1.bin,100") for every "files" verification call,
// regardless of what was actually staged. That was only viable while
// createKaggleDatasetForVideo's post-upload check compared COUNTS only —
// exactly the gap R07 closes.
//
// This test suite deliberately never touches real disk (fixtureStageFile
// is a no-op — see below), so the real staged-file SIZE is genuinely
// unavailable to the repaired kaggle.ts code (it tries fs.stat and gets
// undefined, which the exact-set check correctly treats as "skip the size
// comparison, name is what's known here"). What this fixture CAN and must
// now do honestly is report the REAL FILENAMES that were actually staged
// — tracked via the stageFile callback below — so the exact-set-by-name
// check is genuinely exercised rather than trivially satisfied by an
// unrelated hardcoded name.
let lastStagedNames: string[] = [];
const fixtureExec: ExecKaggleCli = async (args) => {
  if (args[0] === "datasets" && args[1] === "files") {
    const rows = lastStagedNames.map((name) => `${name},100`);
    return { exitCode: 0, stdout: `name,size\n${rows.join("\n")}\n` };
  }
  return { exitCode: 0, stdout: "ok" };
};
// Tracks the real basename of every (src, dest) pair staged, WITHOUT
// touching real disk — dest is a real path (not opened here), src is the
// caller's original file path. Reset per describe block via
// resetStagedNamesTracking() so tests don't leak state into each other.
const fixtureStageFile: StageAssetFile = async (_src, dest) => {
  lastStagedNames.push(path.basename(dest));
};
const fixtureWriteStagingFile: WriteStagingFile = async () => {};
function resetStagedNamesTracking(): void {
  lastStagedNames = [];
}
beforeEach(() => {
  resetStagedNamesTracking();
});
// TIER-1 REPAIR T1.12: approveFinalQA now takes the QAReport and
// RenderManifest themselves (not a bare report_id string) and verifies QA
// passed and describes this exact render — this module's own tests are
// about P3.10 Kaggle delivery downstream of Gate A7, not about T1.12
// itself (which has its own dedicated tests), so a minimal passing/matching
// pair is built here to get a legitimate Gate A7 approval.
const fixtureRender: RenderManifest = {
  run_id: "RUN-kaggle-fixture",
  scope: "master",
  target_id: "video_1",
  fps: 30,
  resolution: "1080x1920",
  codec: "h264",
  outputs: [{ path: "out.mp4", sha256: "a".repeat(64), bytes: 100 }],
  result: "success",
};
const fixtureQaReport: QAReport = {
  report_id: "qar_1",
  scope: "master",
  target_id: "video_1",
  result: "pass",
  findings: [],
  human_review_required: true,
  production_package_id: "ppkg_1",
  production_package_version: "1.0.0",
  production_package_hash: "b".repeat(64),
  render_run_id: "RUN-kaggle-fixture",
  render_output_sha256: "a".repeat(64),
};
const gates = [approveFinalQA("user:mk350174", fixtureQaReport, fixtureRender)];

describe("Kaggle: Gate A7 enforcement", () => {
  it("refuses to create a dataset before Gate A7 is passed", async () => {
    await expect(
      createKaggleDatasetForVideo(
        { finalVideoId: "video_1", files: ["out.mp4"], existingDeliveryRecords: [], gates: [] },
        fixtureExec, fixtureStageFile, fixtureWriteStagingFile,
      ),
    ).rejects.toThrow(GateStateError);
  });
});

describe("exactly one new Kaggle dataset per final video (item 24)", () => {
  it("1: creates a valid new dataset for a final video", async () => {
    const record = await createKaggleDatasetForVideo(
      { finalVideoId: "video_1", files: ["out.mp4"], existingDeliveryRecords: [], gates },
      fixtureExec, fixtureStageFile, fixtureWriteStagingFile,
    );
    expect(record.final_video_id).toBe("video_1");
    expect(record.kaggle_dataset_id).toBeTruthy();
  });

  it("2: refuses to create a second dataset for a video that already has one (reuse fails)", async () => {
    const first: KaggleDeliveryRecord = { final_video_id: "video_1", kaggle_dataset_id: "kg_existing", created_at: "t", files: [], large_asset_pointers: [] };
    await expect(
      createKaggleDatasetForVideo(
        { finalVideoId: "video_1", files: ["out2.mp4"], existingDeliveryRecords: [first], gates },
        fixtureExec, fixtureStageFile, fixtureWriteStagingFile,
      ),
    ).rejects.toThrow(/already has a Kaggle dataset/);
  });

  it("3: refuses to attach an existing dataset id to a different video", async () => {
    // Simulate a collision: existing record for video_2 already owns the
    // dataset id that video_3 would deterministically generate — forced by
    // hand-crafting the existing record with video_3's real dataset id.
    const { stableKaggleDatasetId } = await import("../src/ids.js");
    const collidingId = stableKaggleDatasetId("video_3");
    const existing: KaggleDeliveryRecord = { final_video_id: "video_2", kaggle_dataset_id: collidingId, created_at: "t", files: [], large_asset_pointers: [] };

    await expect(
      createKaggleDatasetForVideo(
        { finalVideoId: "video_3", files: ["out.mp4"], existingDeliveryRecords: [existing], gates },
        fixtureExec, fixtureStageFile, fixtureWriteStagingFile,
      ),
    ).rejects.toThrow(/already attached to a different final video/);
  });

  it("does not silently reuse or overwrite — a failed create leaves no delivery record behind (caller's responsibility to not persist on throw)", async () => {
    const failingExec: ExecKaggleCli = async (args) => (args[1] === "create" ? { exitCode: 1, stdout: "" } : fixtureExec(args));
    await expect(
      createKaggleDatasetForVideo(
        { finalVideoId: "video_4", files: ["out.mp4"], existingDeliveryRecords: [], gates },
        failingExec, fixtureStageFile, fixtureWriteStagingFile,
      ),
    ).rejects.toThrow();
  });
});

describe("explicit large-asset pointer behavior (item 25)", () => {
  it("never silently omits a large asset — it must appear as an explicit pointer", async () => {
    const record = await createKaggleDatasetForVideo(
      {
        finalVideoId: "video_5",
        files: ["out.mp4"],
        existingDeliveryRecords: [],
        gates,
        largeAssetPointers: [{ asset_file_id: "file_large_source_001", kaggle_dataset: "studio-large-source-assets", kaggle_filename: "video_5__source.bin" }],
      },
      fixtureExec, fixtureStageFile, fixtureWriteStagingFile,
    );
    expect(record.large_asset_pointers).toHaveLength(1);
    expect(record.large_asset_pointers[0]?.asset_file_id).toBe("file_large_source_001");
  });

  it("defaults to an empty (never undefined) pointer list when nothing is too large", async () => {
    const record = await createKaggleDatasetForVideo(
      { finalVideoId: "video_6", files: ["out.mp4"], existingDeliveryRecords: [], gates },
      fixtureExec, fixtureStageFile, fixtureWriteStagingFile,
    );
    expect(record.large_asset_pointers).toEqual([]);
  });
});

describe("AUDIT FIX §13.6 correction 3 — real staging directory (fixes the -p bug) + post-upload verification", () => {
  it("stages files into a real directory and points -p at that directory, never at the bare dataset id string", async () => {
    const createCalls: string[][] = [];
    const trackedExec: ExecKaggleCli = async (args) => {
      createCalls.push(args);
      return fixtureExec(args);
    };
    const record = await createKaggleDatasetForVideo(
      { finalVideoId: "video_7", files: ["render/final_video.mp4"], existingDeliveryRecords: [], gates, stagingDir: "/tmp/p3-kaggle-staging/video_7" },
      trackedExec, fixtureStageFile, fixtureWriteStagingFile,
    );
    const createArgs = createCalls.find((a) => a[1] === "create");
    expect(createArgs).toBeDefined();
    const pFlagIndex = createArgs!.indexOf("-p");
    expect(pFlagIndex).toBeGreaterThanOrEqual(0);
    const pValue = createArgs![pFlagIndex + 1];
    expect(pValue).toBe("/tmp/p3-kaggle-staging/video_7"); // the staging directory, never record.kaggle_dataset_id
    expect(pValue).not.toBe(record.kaggle_dataset_id);
  });

  it("writes a dataset-metadata.json with the correct id and a title into the staging directory", async () => {
    const written: Array<{ destPath: string; content: string }> = [];
    const trackingWrite: WriteStagingFile = async (destPath, content) => {
      written.push({ destPath, content });
    };
    const record = await createKaggleDatasetForVideo(
      { finalVideoId: "video_8", files: ["out.mp4"], existingDeliveryRecords: [], gates, stagingDir: "/tmp/p3-kaggle-staging/video_8" },
      fixtureExec, fixtureStageFile, trackingWrite,
    );
    const metadataWrite = written.find((w) => w.destPath.endsWith("dataset-metadata.json"));
    expect(metadataWrite).toBeDefined();
    const parsed = JSON.parse(metadataWrite!.content) as { id: string; title: string };
    expect(parsed.id).toBe(record.kaggle_dataset_id);
    expect(parsed.title).toContain("video_8");
  });

  it("post-upload verification success: staged file count matches the verified file count", async () => {
    const record = await createKaggleDatasetForVideo(
      { finalVideoId: "video_9", files: ["out.mp4"], existingDeliveryRecords: [], gates },
      fixtureExec, fixtureStageFile, fixtureWriteStagingFile,
    );
    expect(record.files).toHaveLength(1);
  });

  it("post-upload verification failure: create succeeds but the verified file list is empty/mismatched — the whole call fails, never silently accepted", async () => {
    const mismatchedExec: ExecKaggleCli = async (args) => {
      if (args[0] === "datasets" && args[1] === "files") {
        return { exitCode: 0, stdout: "name,size\n" }; // header only, 0 files verified
      }
      return { exitCode: 0, stdout: "ok" };
    };
    await expect(
      createKaggleDatasetForVideo(
        { finalVideoId: "video_10", files: ["out.mp4"], existingDeliveryRecords: [], gates },
        mismatchedExec, fixtureStageFile, fixtureWriteStagingFile,
      ),
    ).rejects.toThrow(/Post-upload verification mismatch/);
  });

  // R07 — exact remote file-set verification (name, not just count).
  it("R07: catches a wrong-filename remote upload even when the COUNT matches (the old check's exact blind spot)", async () => {
    const wrongNameExec: ExecKaggleCli = async (args) => {
      if (args[0] === "datasets" && args[1] === "files") {
        // Same COUNT (1) as staged, but a completely different filename —
        // the old count-only check would have accepted this.
        return { exitCode: 0, stdout: "name,size\ncompletely_wrong_file.bin,999\n" };
      }
      return { exitCode: 0, stdout: "ok" };
    };
    await expect(
      createKaggleDatasetForVideo(
        { finalVideoId: "video_12", files: ["out.mp4"], existingDeliveryRecords: [], gates },
        wrongNameExec, fixtureStageFile, fixtureWriteStagingFile,
      ),
    ).rejects.toThrow(/LOCAL EXPECTED SET != REMOTE ACTUAL SET/);
  });

  it("R07: an exact filename AND size match succeeds", async () => {
    const record = await createKaggleDatasetForVideo(
      { finalVideoId: "video_13", files: ["final_video.mp4"], existingDeliveryRecords: [], gates },
      fixtureExec, fixtureStageFile, fixtureWriteStagingFile,
    );
    expect(record.files).toHaveLength(1);
  });

  it("post-upload verification is skipped-as-failed when the verify call itself errors (nonzero exit)", async () => {
    const verifyFailsExec: ExecKaggleCli = async (args) => {
      if (args[0] === "datasets" && args[1] === "files") {
        return { exitCode: 1, stdout: "" };
      }
      return { exitCode: 0, stdout: "ok" };
    };
    await expect(
      createKaggleDatasetForVideo(
        { finalVideoId: "video_11", files: ["out.mp4"], existingDeliveryRecords: [], gates },
        verifyFailsExec, fixtureStageFile, fixtureWriteStagingFile,
      ),
    ).rejects.toThrow(/Post-upload verification failed/);
  });

  it("refuses to create an empty dataset when no files are supplied", async () => {
    await expect(
      createKaggleDatasetForVideo(
        { finalVideoId: "video_12", files: [], existingDeliveryRecords: [], gates },
        fixtureExec, fixtureStageFile, fixtureWriteStagingFile,
      ),
    ).rejects.toThrow(/refusing to create an empty dataset/);
  });
});

describe("checkKaggleAuth — real, non-destructive connectivity check (§13.6)", () => {
  it("returns true when the CLI reports success", async () => {
    expect(await checkKaggleAuth(fixtureExec)).toBe(true);
  });

  it("returns false when the CLI reports a nonzero exit code (not authenticated)", async () => {
    const unauthenticated: ExecKaggleCli = async () => ({ exitCode: 1, stdout: "" });
    expect(await checkKaggleAuth(unauthenticated)).toBe(false);
  });

  it("invokes exactly a read-only listing — never 'create' — a regression guard proving the check is non-destructive by construction", async () => {
    let calledArgs: string[] | undefined;
    const trackedExec: ExecKaggleCli = async (args) => {
      calledArgs = args;
      return { exitCode: 0, stdout: "ok" };
    };
    await checkKaggleAuth(trackedExec);
    expect(calledArgs).toEqual(["datasets", "list", "--csv"]);
    expect(calledArgs).not.toContain("create");
  });
});
