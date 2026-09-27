// AUDIT FIX (P3 final closure pass, §13 corrections 2 & 3) — shared,
// deterministic asset-staging primitives used by BOTH the real Remotion
// render path (asset_file_id -> real file bytes) and the real Kaggle
// delivery path (Production Delivery files -> a real staging directory the
// Kaggle CLI can be pointed at). One shared module, not duplicated logic.
//
// Identity resolution is deterministic and non-heuristic: a delivered
// file's path is exactly `<stagingDir>/<asset_file_id>` — asset_file_id is
// already the Production Delivery contract's own declared identity key
// (asset_delivery_map + GeneratedAssetFile), never a filename/order/
// timestamp guess. Real filesystem I/O (copying a file, writing staging
// content) is behind injectable low-level seams — one real implementation
// each, matching the same "raw I/O seam, no provider abstraction" pattern
// as every other locked-provider module in this pipeline (piper.ts,
// elevenlabs.ts, render.ts, kaggle.ts).

import path from "node:path";

export function resolveAssetFilePath(assetFileId: string, stagingDir: string): string {
  return path.join(stagingDir, assetFileId);
}

// Raw I/O seam: copies one real file from sourcePath to destPath, creating
// destPath's parent directory if needed. One real implementation
// (defaultStageAssetFile); tests substitute only this raw I/O function.
export type StageAssetFile = (sourcePath: string, destPath: string) => Promise<void>;

export const defaultStageAssetFile: StageAssetFile = async (sourcePath, destPath) => {
  const { promises: fs } = await import("node:fs");
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.copyFile(sourcePath, destPath);
};

// Raw I/O seam: writes arbitrary text content to a real file, creating its
// parent directory if needed (used for e.g. dataset-metadata.json).
export type WriteStagingFile = (destPath: string, content: string) => Promise<void>;

export const defaultWriteStagingFile: WriteStagingFile = async (destPath, content) => {
  const { promises: fs } = await import("node:fs");
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, content);
};

// Stages a list of real source file paths into stagingDir, one file per
// entry, named by the file's own basename. Returns the staged destination
// paths in the same order. Used for Kaggle delivery staging (correction 3).
export async function stageFilesToDirectory(
  sourceFiles: string[],
  stagingDir: string,
  stageFile: StageAssetFile = defaultStageAssetFile,
): Promise<string[]> {
  const staged: string[] = [];
  for (const src of sourceFiles) {
    const dest = path.join(stagingDir, path.basename(src));
    await stageFile(src, dest);
    staged.push(dest);
  }
  return staged;
}
