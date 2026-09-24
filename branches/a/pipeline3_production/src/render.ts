// P3.08 Render — ADAPT of Studio's render_manifest.schema.json field names.
// Remotion is a LOCKED provider — the only injectable seam is the raw
// process-execution function (invariant 9), never a swappable
// "RenderProvider"/"RenderEngine". Remotion executes the approved timeline
// only; it never invents creative decisions, reinterprets shot intent,
// chooses replacement assets, or rewrites P2 decisions — this module only
// consumes the canonical Timeline + resolved assets it is given.
//
// AUDIT FIX (P3 final closure pass, §13.5 + correction 2): the previous
// default seam shelled to `npx remotion render src/index.ts
// StudioComposition` — src/index.ts is the library's own plain barrel
// export (not a Remotion entry with registerRoot()), and no
// "StudioComposition" ever existed. The real default now bundles and
// renders the actual canonical composition at remotion/index.tsx (id
// "P3Timeline") via @remotion/bundler + @remotion/renderer's programmatic
// API, resolving each entry's asset_file_id to a REAL staged file path
// (correction 2) via assetStaging.ts's resolveAssetFilePath — never a
// filename/order/timestamp heuristic.

import { resolveAssetFilePath } from "./assetStaging.js";
import { sha256Buffer, stableRenderRunId } from "./ids.js";
import { verifyRenderBundleAssetBinding } from "./renderBundle.js";
import type { RenderBundle, RenderManifest, RenderOutput, ResolvedAsset, Timeline } from "./types.js";

// Raw I/O seam only — one real implementation (defaultExecRemotionRender).
// resolvedAssets + stagingDir are what let the real implementation resolve
// asset_file_id -> actual file bytes (correction 2) — the seam itself stays
// a single raw function, not a provider abstraction.
export type ExecRemotionRender = (params: {
  timeline: Timeline;
  outputPath: string;
  resolvedAssets: ResolvedAsset[];
  stagingDir: string;
}) => Promise<{ bytes: number }>;

export const defaultExecRemotionRender: ExecRemotionRender = async ({ timeline, outputPath, resolvedAssets, stagingDir }) => {
  const { bundle } = await import("@remotion/bundler");
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { promises: fs, existsSync } = await import("node:fs");

  // Resolution and codec are passed via environment variables, set by renderTimeline.
  // This keeps the frozen ExecRemotionRender seam (P3.08) at exactly 4 parameters,
  // while still allowing the default implementation to access render configuration.
  const resolution = process.env.REMOTION_RESOLUTION || "1080x1920";
  const codec = process.env.REMOTION_CODEC || "h264";

  // asset_file_id -> {path, is_video} — present only when the staged file
  // genuinely exists, checked here (in Node, at render time) rather than
  // assumed, so a not-yet-delivered asset renders as a placeholder instead
  // of a broken reference. is_video comes from media_properties.type, the
  // authoritative signal (asset_file_id itself is extensionless).
  //
  // NOTE (discovered via a real render smoke test): a bare absolute
  // filesystem path, and even a file:// URL, are BOTH rejected by Chrome
  // when the page itself is served over http:// by Remotion's bundle
  // server ("Not allowed to load local resource"). Remotion's documented
  // fix is bundle()'s `publicDir` option, which serves stagingDir's
  // contents through the SAME http origin — the composition then resolves
  // each id via Remotion's own staticFile() helper, never a raw path.
  const assetPaths: Record<string, { path: string; is_video: boolean }> = {};
  for (const asset of resolvedAssets) {
    if (existsSync(resolveAssetFilePath(asset.asset_file_id, stagingDir))) {
      assetPaths[asset.asset_file_id] = { path: asset.asset_file_id, is_video: asset.media_properties?.["type"] === "video" };
    }
  }

  const remotionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "remotion");
  const entryPoint = path.join(remotionDir, "index.tsx");
  const inputProps = { timeline, assetPaths };

  // Try the pre-installed Playwright Chromium first (no second download);
  // Remotion falls back to its own managed browser if this is unset/unusable.
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;

  const serveUrl = await bundle({ entryPoint, publicDir: existsSync(stagingDir) ? stagingDir : null });
  const composition = await selectComposition({
    serveUrl,
    id: "P3Timeline",
    inputProps,
    browserExecutable,
  });
  await renderMedia({
    composition,
    serveUrl,
    codec: codec as "h264" | "h265" | "vp8" | "vp9" | "av1" | "mp3" | "aac" | "wav" | "prores" | "h264-mkv" | "h264-ts" | "gif",
    outputLocation: outputPath,
    inputProps: { ...inputProps, resolution },
    browserExecutable,
  });

  const stat = await fs.stat(outputPath);
  return { bytes: stat.size };
};

/**
 * TIER-1 REPAIR T1.11 — render safety for missing required assets.
 *
 * PROBLEM: defaultExecRemotionRender omits any asset whose staged file does
 * not exist, and P3Composition draws a labelled coloured block in its place.
 * renderTimeline then returned result: "success". A run in which EVERY
 * required asset was missing produced a full-length video of placeholder
 * cards and reported production success.
 *
 * REPAIR: production mode hard-fails before a single frame is rendered if a
 * required asset is not staged. Placeholders survive ONLY under an explicit
 * non-production mode, which must be asked for by name.
 */
export type RenderMode = "production" | "development";

export interface MissingAssetReport {
  asset_requirement_id: string;
  asset_file_id: string;
  reason: string;
}

/**
 * Returns the required assets that are not actually present on disk.
 * `requiredRequirementIds` is the set P2 marked required; an asset outside
 * that set may legitimately be absent.
 */
export async function findMissingRequiredAssets(params: {
  timeline: Timeline;
  resolvedAssets: ResolvedAsset[];
  stagingDir: string;
  requiredRequirementIds?: Set<string>;
  fileExists?: (p: string) => Promise<boolean>;
}): Promise<MissingAssetReport[]> {
  const exists =
    params.fileExists ??
    (async (p: string) => {
      const { promises: fs } = await import("node:fs");
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    });

  const byFileId = new Map(params.resolvedAssets.map((a) => [a.asset_file_id, a]));
  const missing: MissingAssetReport[] = [];
  const seen = new Set<string>();

  for (const entry of params.timeline.entries) {
    if (seen.has(entry.asset_file_id)) continue;
    seen.add(entry.asset_file_id);

    const asset = byFileId.get(entry.asset_file_id);
    if (!asset) {
      missing.push({
        asset_requirement_id: "<unresolved>",
        asset_file_id: entry.asset_file_id,
        reason: `timeline entry for shot "${entry.shot_id}" references an asset that was never resolved`,
      });
      continue;
    }
    if (params.requiredRequirementIds && !params.requiredRequirementIds.has(asset.asset_requirement_id)) {
      continue; // genuinely optional
    }
    if (!(await exists(resolveAssetFilePath(asset.asset_file_id, params.stagingDir)))) {
      missing.push({
        asset_requirement_id: asset.asset_requirement_id,
        asset_file_id: asset.asset_file_id,
        reason: "required asset is not staged; it would have rendered as a placeholder",
      });
    }
  }
  return missing;
}

export async function renderTimeline(
  params: {
    projectId: string;
    targetId: string;
    outputPath: string;
    resolution: string;
    codec: string;
    timeline: Timeline;
    resolvedAssets: ResolvedAsset[];
    stagingDir: string;
    /**
     * T1.11 — defaults to "production". Placeholder rendering for missing
     * required assets is available only by explicitly asking for
     * "development".
     */
    mode?: RenderMode;
    requiredRequirementIds?: Set<string>;
    /** T1.8/T1.9 — recorded on the manifest so the render is reproducible. */
    renderBundleHash?: string;
    codeVersion?: RenderManifest["code_version"];
    fileExists?: (p: string) => Promise<boolean>;
    // R02.5 — when supplied, every staged asset's real bytes are verified
    // against the render bundle's declared content_hash before rendering
    // (see renderBundle.ts::verifyRenderBundleAssetBinding). Optional so
    // existing callers that don't yet build a RenderBundle are unaffected;
    // any canonical production render SHOULD supply this.
    renderBundle?: RenderBundle;
    readAssetBytes?: (p: string) => Promise<Buffer>;
  },
  execRender: ExecRemotionRender = defaultExecRemotionRender,
): Promise<RenderManifest> {
  const run_id = stableRenderRunId(params.projectId, "master", params.targetId);
  const mode: RenderMode = params.mode ?? "production";

  if (mode === "production") {
    const missing = await findMissingRequiredAssets({
      timeline: params.timeline,
      resolvedAssets: params.resolvedAssets,
      stagingDir: params.stagingDir,
      requiredRequirementIds: params.requiredRequirementIds,
      fileExists: params.fileExists,
    });
    if (missing.length > 0) {
      // HARD FAIL, and NO final render: not a placeholder, not a partial.
      return {
        run_id,
        scope: "master",
        target_id: params.targetId,
        fps: params.timeline.fps,
        resolution: params.resolution,
        codec: params.codec,
        outputs: [],
        result: "failed",
        render_bundle_hash: params.renderBundleHash,
        code_version: params.codeVersion,
        error_details:
          `production render aborted: ${missing.length} required asset(s) missing — ` +
          missing.map((m) => `${m.asset_requirement_id}(${m.asset_file_id})`).join(", ") +
          ". Placeholders are permitted only in development mode (T1.11).",
      };
    }

    // R02.5 — worker asset binding: prove every staged file's real bytes
    // match the render bundle's declared content_hash before rendering.
    if (params.renderBundle) {
      const binding = await verifyRenderBundleAssetBinding(
        params.renderBundle,
        params.stagingDir,
        params.readAssetBytes,
      );
      if (!binding.valid) {
        return {
          run_id,
          scope: "master",
          target_id: params.targetId,
          fps: params.timeline.fps,
          resolution: params.resolution,
          codec: params.codec,
          outputs: [],
          result: "failed",
          render_bundle_hash: params.renderBundleHash,
          code_version: params.codeVersion,
          error_details:
            `production render aborted: ${binding.mismatches.length} asset(s) failed worker binding ` +
            `verification — ${binding.mismatches.map((m) => `${m.asset_file_id}: ${m.reason}`).join("; ")}`,
        };
      }
    }
  }
  const prevResolution = process.env.REMOTION_RESOLUTION;
  const prevCodec = process.env.REMOTION_CODEC;

  try {
    // Set render configuration via environment variables. This allows the frozen
    // ExecRemotionRender seam to remain a pure 4-parameter interface while still
    // allowing the default implementation (defaultExecRemotionRender) to access
    // the resolution and codec for Remotion.
    process.env.REMOTION_RESOLUTION = params.resolution;
    process.env.REMOTION_CODEC = params.codec;

    const { bytes } = await execRender({
      timeline: params.timeline,
      outputPath: params.outputPath,
      resolvedAssets: params.resolvedAssets,
      stagingDir: params.stagingDir,
    });

    // Hash the actual rendered file's bytes (not run_id/size metadata) so the
    // manifest's sha256 is a real content-integrity check: two different
    // outputs of the same byte count must never collide on this hash.
    const { promises: fs } = await import("node:fs");
    const fileBytes = await fs.readFile(params.outputPath);
    const output: RenderOutput = { path: params.outputPath, sha256: sha256Buffer(fileBytes), bytes };
    return {
      run_id,
      scope: "master",
      target_id: params.targetId,
      fps: params.timeline.fps,
      resolution: params.resolution,
      codec: params.codec,
      outputs: [output],
      result: "success",
      render_bundle_hash: params.renderBundleHash,
      code_version: params.codeVersion,
    };
  } catch (err) {
    return {
      run_id,
      scope: "master",
      target_id: params.targetId,
      fps: params.timeline.fps,
      resolution: params.resolution,
      codec: params.codec,
      outputs: [],
      result: "failed",
      render_bundle_hash: params.renderBundleHash,
      code_version: params.codeVersion,
      error_details: err instanceof Error ? err.message : String(err),
    };
  } finally {
    // Restore previous environment state to avoid contaminating other render calls
    // in concurrent scenarios. If no previous value existed, delete the variable.
    if (prevResolution !== undefined) {
      process.env.REMOTION_RESOLUTION = prevResolution;
    } else {
      delete process.env.REMOTION_RESOLUTION;
    }
    if (prevCodec !== undefined) {
      process.env.REMOTION_CODEC = prevCodec;
    } else {
      delete process.env.REMOTION_CODEC;
    }
  }
}
