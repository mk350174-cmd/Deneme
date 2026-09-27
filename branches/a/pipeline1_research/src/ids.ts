// REUSE (sha256 core) + ADAPT (stable-id generators) from SOP src/utils/hash.ts
// — see capability table: "Deterministic ID hashing | REUSE | Origin: SOP".
//
// No random UUIDs: every id is derived from its inputs, so re-running P1
// against the same request/scope/finding reproduces the same ids instead of
// minting duplicates (architecture doc: Research Engine contract, "MUST be
// replayable").

import { createHash } from "node:crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

export function stableProjectId(seed: string): string {
  return `proj_${sha256(seed.trim().toLowerCase()).slice(0, 16)}`;
}

export function stableScopeId(projectId: string, topic: string): string {
  return `scope_${sha256(`${projectId}::${topic.trim().toLowerCase()}`).slice(0, 16)}`;
}

export function stableSourceId(origin: string, sourceType: string): string {
  return `src_${sha256(`${origin.trim().toLowerCase()}::${sourceType}`).slice(0, 12)}`;
}

export function stableEvidenceId(sourceId: string, excerptOrPointer: string): string {
  return `ev_${sha256(`${sourceId}::${excerptOrPointer}`).slice(0, 12)}`;
}

export function stableClaimId(
  projectId: string,
  dimension: string,
  statement: string,
): string {
  return `claim_${sha256(`${projectId}::${dimension}::${statement.trim().toLowerCase()}`).slice(0, 16)}`;
}

export function stableVerificationId(claimId: string, status: string): string {
  return `verif_${sha256(`${claimId}::${status}`).slice(0, 12)}`;
}

export function stablePackageId(projectId: string, scopeId: string, claimIdsKey: string): string {
  return `rpkg_${sha256(`${projectId}::${scopeId}::${claimIdsKey}`).slice(0, 16)}`;
}

export function stableApprovalRecordId(gateId: string, objectVersion: string, actor: string): string {
  return `appr_${sha256(`${gateId}::${objectVersion}::${actor}`).slice(0, 12)}`;
}

// --- P1 Category 2: Discovery & Acquisition ---

export function stableCandidateId(topic: string, discoveryMethod: string, discoveredResourceId: string): string {
  return `cand_${sha256(`${topic.trim().toLowerCase()}::${discoveryMethod.trim().toLowerCase()}::${discoveredResourceId.trim().toLowerCase()}`).slice(0, 16)}`;
}

export function stableObservationId(ownerId: string, metricName: string, observedAt: string): string {
  return `obs_${sha256(`${ownerId}::${metricName.trim().toLowerCase()}::${observedAt}`).slice(0, 12)}`;
}

export function stableAcquisitionAttemptId(candidateId: string, provider: string, requestedAt: string): string {
  return `acq_${sha256(`${candidateId}::${provider.trim().toLowerCase()}::${requestedAt}`).slice(0, 12)}`;
}
