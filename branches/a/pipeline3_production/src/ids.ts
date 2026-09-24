// REUSE (sha256 core) + ADAPT (P3-specific stable-id generators) from SOP
// src/utils/hash.ts, duplicated from P1/P2's ids.ts (no cross-package
// dependency). No random UUIDs.

import { createHash } from "node:crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

export function sha256Buffer(input: Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function isWellFormedSha256(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash);
}

export function stableResolvedAssetId(assetRequirementId: string, assetFileId: string): string {
  return `res_${sha256(`${assetRequirementId}::${assetFileId}`).slice(0, 12)}`;
}

export function stableRenderRunId(projectId: string, scope: string, targetId: string): string {
  return `RUN-${sha256(`${projectId}::${scope}::${targetId}`).slice(0, 12)}`;
}

export function stableQaReportId(scope: string, targetId: string): string {
  return `QAR-${sha256(`${scope}::${targetId}`).slice(0, 8)}`;
}

export function stableApprovalRecordId(gateId: string, objectVersion: string, actor: string): string {
  return `appr_${sha256(`${gateId}::${objectVersion}::${actor}`).slice(0, 12)}`;
}

export function stableKaggleDatasetId(finalVideoId: string): string {
  return `kg_${sha256(finalVideoId.trim().toLowerCase()).slice(0, 16)}`;
}

export function stableFinalDeliveryPackageId(projectId: string, productionPackageRef: string, renderRunId: string): string {
  return `fdpkg_${sha256(`${projectId}::${productionPackageRef}::${renderRunId}`).slice(0, 16)}`;
}

// Deterministic fingerprint for the stage cache (checkpoint.ts) — same
// inputs always produce the same fingerprint, so a re-run with unchanged
// inputs can reuse a validated prior result instead of repeating costed I/O.
export function stableFingerprint(inputs: Record<string, unknown>): string {
  const canonical = JSON.stringify(inputs, Object.keys(inputs).sort());
  return `fp_${sha256(canonical)}`;
}

// P3.08-DIST Distributed Render — deterministic shard identifier. NOT phase
// P3.09 (canonical Automated QA, qa.ts) — see the naming note in
// orchestration_p309.ts. Used for caching shard outputs and idempotency
// (same shard ID = same output).
// Incorporates timeline hash, frame range, and asset list to ensure
// that identical shard specifications always produce identical IDs.
export function stableShardId(timelineHash: string, startFrame: number, endFrame: number): string {
  return `shard_${sha256(`${timelineHash}::${startFrame}::${endFrame}`).slice(0, 16)}`;
}
