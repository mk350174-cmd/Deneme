// TIER-1 REPAIR T1.8 + T1.9 — immutable render bundle and code pinning.
//
// PROBLEM (as found in the baseline):
//   orchestration_p309.ts built its Kaggle parameter bundle with
//       timeline_json: JSON.stringify({})
//   while a real, approved timeline was sitting in `params.timeline`. Worse,
//   the generated kernel never read that field at all: it ran
//       npx remotion render remotion/index.tsx P3Timeline
//   with no input props, after a `git clone` + `git pull` that resolved
//   whatever the repository HEAD happened to be. So the distributed path
//   rendered an unspecified composition from unpinned code, and the local
//   path rendered the approved timeline. The two paths did not consume the
//   same input.
//
// REPAIR:
//   One RenderBundle is built from the approved inputs and is what BOTH
//   paths render. Its bundle_hash covers the timeline, the asset manifest
//   (including each asset's real content hash), the render configuration,
//   the production package manifest/hash, and the pinned code version — so
//   "which inputs produced this output" is answerable after the fact, and a
//   mismatch is detectable rather than invisible.

import { contentHash } from "./canonicalIdentity.js";
import { P3Error } from "./errors.js";
import { resolveAssetFilePath } from "./assetStaging.js";
import { sha256Buffer } from "./ids.js";
import type {
  CodeVersion,
  ManifestEntry,
  RenderBundle,
  RenderBundleAssetEntry,
  RenderConfiguration,
  ResolvedAsset,
  Timeline,
} from "./types.js";

const GIT_SHA = /^[0-9a-f]{40}$/;

/**
 * Validates a code version is genuinely immutable.
 *
 * Branch names, tags and "HEAD" are all rejected: a tag can be moved and a
 * branch always moves, so neither pins the code that rendered an approved
 * package.
 */
export function assertPinnedCodeVersion(codeVersion: CodeVersion): CodeVersion {
  if (codeVersion.kind === "git_commit") {
    if (!GIT_SHA.test(codeVersion.value)) {
      throw new P3Error({
        code: "RENDER_COORDINATION_ERROR",
        field: "code_version.value",
        object_id: codeVersion.value,
        reason:
          "distributed render requires a full 40-hex commit SHA. Branch names, tags and HEAD are " +
          "mutable and cannot pin the code that rendered an approved package (T1.9).",
      });
    }
    return codeVersion;
  }
  if (codeVersion.kind === "release_digest") {
    if (!codeVersion.value || codeVersion.value.trim().length < 16) {
      throw new P3Error({
        code: "RENDER_COORDINATION_ERROR",
        field: "code_version.value",
        object_id: codeVersion.value,
        reason: "release digest is missing or too short to be an immutable artifact digest (T1.9).",
      });
    }
    return codeVersion;
  }
  throw new P3Error({
    code: "RENDER_COORDINATION_ERROR",
    field: "code_version.kind",
    object_id: String((codeVersion as { kind?: string }).kind),
    reason: 'code_version.kind must be "git_commit" or "release_digest".',
  });
}

/**
 * Builds the immutable render bundle. Every required asset must already be
 * resolved and carry a real content hash — the bundle is the last point at
 * which a missing asset can be caught before frames are spent on it.
 */
export function buildRenderBundle(params: {
  timeline: Timeline;
  resolvedAssets: ResolvedAsset[];
  renderConfig: RenderConfiguration;
  packageManifest: ManifestEntry[];
  productionPackageId: string;
  productionPackageHash: string;
  codeVersion: CodeVersion;
}): RenderBundle {
  assertPinnedCodeVersion(params.codeVersion);

  const asset_manifest: RenderBundleAssetEntry[] = params.resolvedAssets
    .map((a) => ({
      asset_requirement_id: a.asset_requirement_id,
      asset_file_id: a.asset_file_id,
      content_hash: a.hash,
      media_type: typeof a.media_properties?.["type"] === "string"
        ? (a.media_properties["type"] as string)
        : undefined,
    }))
    .sort((x, y) => x.asset_requirement_id.localeCompare(y.asset_requirement_id));

  // Every timeline entry must map to an asset in the bundle: a timeline
  // referencing an asset the bundle does not carry would render as a
  // placeholder on the worker with nothing to flag it.
  const knownFileIds = new Set(asset_manifest.map((a) => a.asset_file_id));
  for (const entry of params.timeline.entries) {
    if (!knownFileIds.has(entry.asset_file_id)) {
      throw new P3Error({
        code: "MISSING_ASSET",
        field: "render_bundle.asset_manifest",
        object_id: entry.asset_file_id,
        reason: `timeline entry for shot "${entry.shot_id}" references an asset that is not in the render bundle`,
      });
    }
  }

  const content = {
    timeline: params.timeline,
    asset_manifest,
    render_config: params.renderConfig,
    package_manifest: params.packageManifest,
    production_package_id: params.productionPackageId,
    production_package_hash: params.productionPackageHash,
    code_version: params.codeVersion,
  };
  const bundle_hash = contentHash(content);

  return {
    bundle_id: `rbundle_${bundle_hash.slice(0, 16)}`,
    bundle_hash,
    ...content,
  };
}

/** Recomputes a bundle's hash and proves it still describes its content. */
export function verifyRenderBundle(bundle: RenderBundle): { valid: boolean; expected: string; actual: string } {
  const actual = contentHash({
    timeline: bundle.timeline,
    asset_manifest: bundle.asset_manifest,
    render_config: bundle.render_config,
    package_manifest: bundle.package_manifest,
    production_package_id: bundle.production_package_id,
    production_package_hash: bundle.production_package_hash,
    code_version: bundle.code_version,
  });
  return { valid: actual === bundle.bundle_hash, expected: bundle.bundle_hash, actual };
}

/**
 * The serializable payload a distributed worker receives. This is what
 * replaces `timeline_json: "{}"` — the worker gets the real timeline, the
 * real asset manifest, the real render config, and the pinned code version.
 */
export interface WorkerRenderPayload {
  bundle_id: string;
  bundle_hash: string;
  shard_id: string;
  frame_range: { start: number; end: number };
  timeline_json: string;
  asset_manifest: RenderBundleAssetEntry[];
  render_config: RenderConfiguration;
  code_version: CodeVersion;
  production_package_id: string;
  production_package_hash: string;
}

export function buildWorkerPayload(
  bundle: RenderBundle,
  shard: { shard_id: string; frame_range: { start: number; end: number } },
): WorkerRenderPayload {
  const check = verifyRenderBundle(bundle);
  if (!check.valid) {
    throw new P3Error({
      code: "RENDER_COORDINATION_ERROR",
      field: "render_bundle.bundle_hash",
      object_id: bundle.bundle_id,
      reason: `render bundle was modified after it was sealed (declared ${check.expected}, recomputed ${check.actual})`,
    });
  }
  return {
    bundle_id: bundle.bundle_id,
    bundle_hash: bundle.bundle_hash,
    shard_id: shard.shard_id,
    frame_range: shard.frame_range,
    timeline_json: JSON.stringify(bundle.timeline),
    asset_manifest: bundle.asset_manifest,
    render_config: bundle.render_config,
    code_version: bundle.code_version,
    production_package_id: bundle.production_package_id,
    production_package_hash: bundle.production_package_hash,
  };
}


// R02.5 REPAIR — worker asset binding proof.
//
// PROBLEM: the render bundle's asset_manifest declares each asset's real
// content_hash (T1.2/T1.8), and that hash reaches the worker payload sent
// to Kaggle — but nothing ever VERIFIED that the actual bytes sitting at
// each asset_file_id's resolved path still match that declared hash
// immediately before rendering. The chain
// "asset_file_id -> exact worker file -> SHA-256 matches -> render" was
// declared but not proven: a staged file could have been swapped, corrupted,
// or simply be the wrong file, and rendering would proceed regardless.
//
// REPAIR: this function performs the real byte-level check — for every
// asset in the bundle's manifest, resolve its expected on-disk path (the
// same deterministic resolveAssetFilePath used by the local render path
// and by T1.2's asset validation) and recompute SHA-256 against the
// declared content_hash. It is the pre-render gate a worker (local or
// remote) MUST pass before it is entitled to treat its local files as the
// approved assets.
//
// DOCUMENTED LIMITATION (honest, not silently omitted): the CURRENT Kaggle
// kernel script (distribution.ts's generated Python) does not download or
// stage real asset bytes from a Kaggle input dataset at all — no
// asset-distribution mechanism onto the remote worker exists yet, so this
// verification cannot literally run INSIDE a live Kaggle kernel today. What
// this function proves is the LOCAL/integration side of the chain: given a
// render bundle and a directory of staged files (the shape a real worker
// would need to have), the exact-match invariant is enforced and testable
// end-to-end before any live Kaggle wiring is asked to carry it further.
export interface AssetBindingMismatch {
  asset_file_id: string;
  asset_requirement_id: string;
  declared_hash: string;
  actual_hash: string;
  reason: string;
}

export async function verifyRenderBundleAssetBinding(
  bundle: RenderBundle,
  stagingDir: string,
  readBytes?: (path: string) => Promise<Buffer>,
): Promise<{ valid: boolean; mismatches: AssetBindingMismatch[] }> {
  const read =
    readBytes ??
    (async (p: string) => {
      const { promises: fs } = await import("node:fs");
      return fs.readFile(p);
    });

  const mismatches: AssetBindingMismatch[] = [];
  for (const asset of bundle.asset_manifest) {
    const filePath = resolveAssetFilePath(asset.asset_file_id, stagingDir);
    try {
      const bytes = await read(filePath);
      const actual = sha256Buffer(bytes);
      if (actual !== asset.content_hash) {
        mismatches.push({
          asset_file_id: asset.asset_file_id,
          asset_requirement_id: asset.asset_requirement_id,
          declared_hash: asset.content_hash,
          actual_hash: actual,
          reason: "staged file bytes do not match the render bundle's declared content_hash",
        });
      }
    } catch (err) {
      mismatches.push({
        asset_file_id: asset.asset_file_id,
        asset_requirement_id: asset.asset_requirement_id,
        declared_hash: asset.content_hash,
        actual_hash: "<unreadable>",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { valid: mismatches.length === 0, mismatches };
}

/**
 * Hard-failing variant: throws a P3Error naming every mismatch rather than
 * returning a report. This is the gate a render path should call
 * immediately before invoking the actual render executable.
 */
export async function assertRenderBundleAssetBinding(
  bundle: RenderBundle,
  stagingDir: string,
  readBytes?: (path: string) => Promise<Buffer>,
): Promise<void> {
  const result = await verifyRenderBundleAssetBinding(bundle, stagingDir, readBytes);
  if (!result.valid) {
    throw new P3Error({
      code: "MISSING_ASSET",
      field: "render_bundle.asset_manifest",
      object_id: bundle.bundle_id,
      reason:
        `${result.mismatches.length} asset(s) failed worker binding verification: ` +
        result.mismatches.map((m) => `${m.asset_file_id} (${m.reason})`).join("; "),
    });
  }
}
