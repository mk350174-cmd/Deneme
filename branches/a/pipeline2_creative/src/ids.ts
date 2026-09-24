// REUSE (sha256 core) + ADAPT (P2-specific stable-id generators) from SOP
// src/utils/hash.ts, duplicated from pipeline1_research/src/ids.ts (no
// cross-package dependency). No random UUIDs: re-running P2 against the
// same inputs reproduces the same ids.

import { createHash } from "node:crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

export function stableCandidateId(seed: string): string {
  return `cand_${sha256(seed.trim().toLowerCase()).slice(0, 12)}`;
}

export function stableReferenceId(source: string): string {
  return `ref_${sha256(source.trim().toLowerCase()).slice(0, 12)}`;
}

export function stableObservationId(referenceId: string, dimension: string): string {
  return `obs_${sha256(`${referenceId}::${dimension}`).slice(0, 12)}`;
}

export function stableSceneId(projectId: string, narrativeFunction: string, index: number): string {
  return `scene_${sha256(`${projectId}::${narrativeFunction}::${index}`).slice(0, 12)}`;
}

export function stableShotId(sceneId: string, index: number): string {
  return `shot_${sha256(`${sceneId}::${index}`).slice(0, 12)}`;
}

// Small-improvements addition (C5): a discriminator param was added because
// P2.07 can now plan more than one AssetRequirement per shot (distinct
// asset_role values sharing the same shot_id/expectedMediaType) — without
// it, two such requirements would collide on the same id. Existing callers
// that pass a fixed discriminator (e.g. 0) keep getting a deterministic id;
// the exact id value changes from before this addition (new hash input),
// which no existing test depends on (only relative determinism is asserted).
export function stableAssetRequirementId(
  shotId: string,
  expectedMediaType: string,
  discriminator: string | number = 0,
): string {
  return `astreq_${sha256(`${shotId}::${expectedMediaType}::${discriminator}`).slice(0, 12)}`;
}

export function stableDecisionId(question: string, targetId: string): string {
  return `dec_${sha256(`${question}::${targetId}`).slice(0, 12)}`;
}

export function stablePromptSpecId(shotId: string, promptFamily: string): string {
  return `pspec_${sha256(`${shotId}::${promptFamily}`).slice(0, 12)}`;
}

export function stableProductionPackageId(
  projectId: string,
  researchPackageRef: string,
  shotIdsKey: string,
): string {
  return `ppkg_${sha256(`${projectId}::${researchPackageRef}::${shotIdsKey}`).slice(0, 16)}`;
}

export function stableApprovalRecordId(gateId: string, objectVersion: string, actor: string): string {
  return `appr_${sha256(`${gateId}::${objectVersion}::${actor}`).slice(0, 12)}`;
}

export function stableMemoryRecordId(bucket: string, content: string): string {
  return `mem_${sha256(`${bucket}::${content}`).slice(0, 12)}`;
}

export function stableFormatDecisionMatrixId(
  formatDecisionId: string,
  format: string,
): string {
  return `fmat_${sha256(`${formatDecisionId}::${format}`).slice(0, 12)}`;
}

// T2.4: stable id for a VoiceLine, derived from its position and text so
// re-running P2.10 on identical narration reproduces the same line ids.
export function stableVoiceLineId(index: number, text: string): string {
  return `vline_${sha256(`${index}::${text.trim().toLowerCase()}`).slice(0, 12)}`;
}
