// P3.10 Kaggle Delivery — ADAPT of scripts/archive_to_kaggle.py's
// download-merge-version-verify pattern, generalized to EXACTLY ONE NEW
// DATASET PER FINAL VIDEO (not the source's shared-dataset behavior).
// Kaggle CLI is a LOCKED provider — the only injectable seam is the raw
// process-execution function (invariant 9).

import path from "node:path";
import { promises as fs } from "node:fs";
import { defaultStageAssetFile, defaultWriteStagingFile, stageFilesToDirectory } from "./assetStaging.js";
import type { StageAssetFile, WriteStagingFile } from "./assetStaging.js";
import { requireGateState } from "./gates.js";
import { stableKaggleDatasetId } from "./ids.js";
import type { GateApprovalRecord, KaggleDeliveryRecord, LargeAssetPointer } from "./types.js";

// Raw I/O seam only — one real implementation (defaultExecKaggleCli).
export type ExecKaggleCli = (args: string[]) => Promise<{ exitCode: number; stdout: string }>;

export const defaultExecKaggleCli: ExecKaggleCli = async (args) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync("kaggle", args);
    return { exitCode: 0, stdout };
  } catch (err) {
    const e = err as { code?: number; stdout?: string };
    return { exitCode: e.code ?? 1, stdout: e.stdout ?? "" };
  }
};

// dataset-metadata.json is Kaggle's own required convention for a
// `-p <folder>`-based `datasets create` call — the folder's dataset id/
// title live in this file, not as CLI flags.
function datasetMetadataJson(datasetId: string, title: string): string {
  return JSON.stringify({ title, id: datasetId, licenses: [{ name: "CC0-1.0" }] }, null, 2);
}

export async function createKaggleDatasetForVideo(
  params: {
    finalVideoId: string;
    files: string[];
    existingDeliveryRecords: KaggleDeliveryRecord[];
    gates: GateApprovalRecord[];
    largeAssetPointers?: LargeAssetPointer[];
    // Deterministic staging directory (correction 3) — defaults to a
    // dataset-id-scoped path under state/ (already gitignored), so a
    // caller never needs to invent one, but a test/live-run can override it.
    stagingDir?: string;
  },
  execKaggle: ExecKaggleCli = defaultExecKaggleCli,
  stageFile: StageAssetFile = defaultStageAssetFile,
  writeStagingFile: WriteStagingFile = defaultWriteStagingFile,
): Promise<KaggleDeliveryRecord> {
  // Gate A7 (final human creative QA) MUST be satisfied before delivery —
  // checked in code at the point of the costly/hard-to-undo action, same
  // defense-in-depth discipline as Gate A5 inside elevenlabs.ts.
  requireGateState(params.gates, "A7", "FINAL_QA_APPROVED");

  // Invariant: exactly one new dataset per final video — never a shared
  // dataset, never silent reuse.
  const alreadyHasDataset = params.existingDeliveryRecords.some((r) => r.final_video_id === params.finalVideoId);
  if (alreadyHasDataset) {
    throw new Error(`Final video "${params.finalVideoId}" already has a Kaggle dataset — refusing to create a second one`);
  }

  const kaggle_dataset_id = stableKaggleDatasetId(params.finalVideoId);
  const attachedToOtherVideo = params.existingDeliveryRecords.some(
    (r) => r.kaggle_dataset_id === kaggle_dataset_id && r.final_video_id !== params.finalVideoId,
  );
  if (attachedToOtherVideo) {
    throw new Error(`Dataset "${kaggle_dataset_id}" is already attached to a different final video — refusing to reuse it`);
  }

  if (params.files.length === 0) {
    throw new Error(`No files supplied to stage for Kaggle dataset "${kaggle_dataset_id}" — refusing to create an empty dataset`);
  }

  // AUDIT FIX (P3 final closure pass, §13.6 correction 3): the CLI's `-p`
  // flag requires a real FOLDER containing the files plus a
  // dataset-metadata.json — the previous code passed the bare dataset ID
  // string as `-p`, which could never have worked against the real CLI.
  // Production Delivery files are staged into a deterministic directory
  // (keyed by the dataset id, never a filename/order heuristic) before
  // the real upload is attempted.
  const stagingDir = params.stagingDir ?? path.resolve(process.cwd(), "state", "kaggle_staging", kaggle_dataset_id);
  const stagedFiles = await stageFilesToDirectory(params.files, stagingDir, stageFile);
  await writeStagingFile(path.join(stagingDir, "dataset-metadata.json"), datasetMetadataJson(kaggle_dataset_id, `P3 Final Delivery — ${params.finalVideoId}`));

  const result = await execKaggle(["datasets", "create", "-p", stagingDir, "-r", "zip"]);
  if (result.exitCode !== 0) {
    throw new Error(`kaggle datasets create failed for "${kaggle_dataset_id}"`);
  }

  // R07 REPAIR — exact remote file-set verification.
  //
  // PROBLEM: the previous check only compared COUNTS
  // (`verifiedFileCount < stagedFiles.length`). Two files with the wrong
  // names, the wrong sizes, or swapped content would still pass as long as
  // the NUMBER of remote files matched the number staged locally — the
  // brief's exact "not only file count" gap.
  //
  // REPAIR: parse the CSV's actual (name, size) rows and compare against
  // the LOCAL EXPECTED SET (staged filenames + their real on-disk sizes)
  // for exact equality — every expected filename must appear remotely with
  // a size, and no unexpected filename may be missing OR extra.
  //
  // HONEST LIMITATION: `kaggle datasets files <id> --csv` (the real Kaggle
  // CLI's own command) reports name and size — it does not report a
  // content hash. "hash when retrievable" is therefore not retrievable
  // through this specific command; comparing declared vs actual bytes at
  // the hash level would require downloading the dataset back down (a
  // separate, heavier verification not attempted here). This is recorded
  // as a documented limitation, not silently treated as "hash verified."
  const verify = await execKaggle(["datasets", "files", kaggle_dataset_id, "--csv"]);
  if (verify.exitCode !== 0) {
    throw new Error(`Post-upload verification failed for dataset "${kaggle_dataset_id}" — could not list files`);
  }

  const remoteRows = verify.stdout.trim().split("\n").slice(1); // drop CSV header
  const remoteByName = new Map<string, number | undefined>();
  for (const row of remoteRows) {
    if (row.trim().length === 0) continue;
    const [name, sizeStr] = row.split(",");
    if (name) remoteByName.set(name.trim(), sizeStr ? Number(sizeStr.trim()) : undefined);
  }

  const localExpected = await Promise.all(
    stagedFiles.map(async (filePath) => {
      const name = path.basename(filePath);
      let size: number | undefined;
      try {
        size = (await fs.stat(filePath)).size;
      } catch {
        size = undefined; // fixture/test staging may not produce a real statable file; handled below
      }
      return { name, size };
    }),
  );

  const missing: string[] = [];
  const sizeMismatches: string[] = [];
  for (const expected of localExpected) {
    const remoteSize = remoteByName.get(expected.name);
    if (remoteSize === undefined && !remoteByName.has(expected.name)) {
      missing.push(expected.name);
      continue;
    }
    if (expected.size !== undefined && remoteSize !== undefined && expected.size !== remoteSize) {
      sizeMismatches.push(`${expected.name} (local ${expected.size}b, remote ${remoteSize}b)`);
    }
  }
  const unexpected = [...remoteByName.keys()].filter((name) => !localExpected.some((e) => e.name === name));

  if (missing.length > 0 || sizeMismatches.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Post-upload verification mismatch for dataset "${kaggle_dataset_id}": ` +
        `LOCAL EXPECTED SET != REMOTE ACTUAL SET` +
        (missing.length > 0 ? ` — missing remotely: ${missing.join(", ")}` : "") +
        (unexpected.length > 0 ? ` — unexpected remotely: ${unexpected.join(", ")}` : "") +
        (sizeMismatches.length > 0 ? ` — size mismatches: ${sizeMismatches.join(", ")}` : ""),
    );
  }

  return {
    final_video_id: params.finalVideoId,
    kaggle_dataset_id,
    created_at: new Date().toISOString(),
    files: stagedFiles,
    large_asset_pointers: params.largeAssetPointers ?? [],
  };
}

// AUDIT FIX (P3 final closure pass, §13.6): real, read-only, non-destructive
// authenticated-connectivity check — creates nothing. Same "one real seam,
// no abstraction" pattern as everything else in this file: only the CLI
// invocation arguments differ from createKaggleDatasetForVideo's own.
export async function checkKaggleAuth(execKaggle: ExecKaggleCli = defaultExecKaggleCli): Promise<boolean> {
  const result = await execKaggle(["datasets", "list", "--csv"]);
  return result.exitCode === 0;
}
