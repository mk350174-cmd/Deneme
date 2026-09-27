// AUDIT FIX (P3 final closure pass, §13 corrections 2 & 3) — shared
// deterministic asset-staging primitives, used by both the Remotion render
// path and the Kaggle staging path. Fixture-based, no real filesystem I/O.

import { describe, expect, it } from "vitest";
import { resolveAssetFilePath, stageFilesToDirectory } from "../src/assetStaging.js";
import type { StageAssetFile } from "../src/assetStaging.js";

describe("resolveAssetFilePath — deterministic identity resolution, never a heuristic", () => {
  it("resolves to exactly <stagingDir>/<asset_file_id>", () => {
    expect(resolveAssetFilePath("file_wide_arch_001", "/staging/dir")).toBe("/staging/dir/file_wide_arch_001");
  });

  it("is stable across repeated calls with the same inputs", () => {
    expect(resolveAssetFilePath("file_x", "/a/b")).toBe(resolveAssetFilePath("file_x", "/a/b"));
  });

  it("different asset_file_ids resolve to different paths even under the same stagingDir", () => {
    expect(resolveAssetFilePath("file_a", "/dir")).not.toBe(resolveAssetFilePath("file_b", "/dir"));
  });
});

describe("stageFilesToDirectory — real I/O behind an injectable seam", () => {
  it("stages each source file into stagingDir, named by its basename, via the injected seam", async () => {
    const calls: Array<{ sourcePath: string; destPath: string }> = [];
    const fixtureStage: StageAssetFile = async (sourcePath, destPath) => {
      calls.push({ sourcePath, destPath });
    };
    const staged = await stageFilesToDirectory(["/src/a.mp4", "/src/b.png"], "/staging/dir", fixtureStage);
    expect(staged).toEqual(["/staging/dir/a.mp4", "/staging/dir/b.png"]);
    expect(calls).toEqual([
      { sourcePath: "/src/a.mp4", destPath: "/staging/dir/a.mp4" },
      { sourcePath: "/src/b.png", destPath: "/staging/dir/b.png" },
    ]);
  });

  it("an empty source list stages nothing and returns an empty array", async () => {
    const fixtureStage: StageAssetFile = async () => {};
    expect(await stageFilesToDirectory([], "/staging/dir", fixtureStage)).toEqual([]);
  });

  it("propagates a staging failure (e.g. a real missing source file) rather than silently skipping it", async () => {
    const failingStage: StageAssetFile = async () => {
      throw new Error("ENOENT: no such file");
    };
    await expect(stageFilesToDirectory(["/src/missing.mp4"], "/staging/dir", failingStage)).rejects.toThrow(/ENOENT/);
  });
});
