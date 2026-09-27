// B00 — Canonical Artifact Identity & Lineage
//
// Important persisted B-Branch artifacts resolve to this identity envelope.
// Content hashes intentionally exclude the identity envelope itself to avoid
// self-referential hashes. Approval hashes also exclude governance provenance,
// so recording the approval event does not mutate the approved business payload.

import { canonicalHasher, canonicalStringify } from "./hashing.js";

export interface CanonicalParentReference {
  module: string;
  object_id: string;
  object_type: string;
  version: string;
  content_hash: string;
  relation?: string;
}

export interface CanonicalIdentity {
  object_id: string;
  object_type: string;
  version: string;
  content_hash: string;
  parent_references: CanonicalParentReference[];
  created_at: string;
}

export interface ArtifactBinding {
  object_id: string;
  object_type: string;
  object_version: string;
  object_content_hash: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Remove top-level identity only. Nested upstream identities remain semantic
 * lineage and therefore remain part of the parent artifact's content. */
export function artifactContentForHash<T>(artifact: T): unknown {
  if (!isRecord(artifact)) return artifact;
  const { identity: _identity, ...content } = artifact;
  return content;
}

/** The approvable subject excludes only governance/provenance envelope fields
 * that are created as a consequence of the approval itself. Any domain-field
 * mutation therefore invalidates the old approval binding. */
export function approvalSubjectForHash<T>(artifact: T): unknown {
  if (!isRecord(artifact)) return artifact;
  const {
    identity: _identity,
    provenance: _provenance,
    governance_history: _governanceHistory,
    governance_events: _governanceEvents,
    ...content
  } = artifact;
  return content;
}

export function hashArtifactContent(artifact: unknown): string {
  return canonicalHasher.hashValue(artifactContentForHash(artifact));
}

export function hashApprovalSubject(artifact: unknown): string {
  return canonicalHasher.hashValue(approvalSubjectForHash(artifact));
}

export function createArtifactBinding(
  artifact: unknown,
  objectId: string,
  objectType: string,
  objectVersion: string
): ArtifactBinding {
  return {
    object_id: objectId,
    object_type: objectType,
    object_version: objectVersion,
    object_content_hash: hashApprovalSubject(artifact),
  };
}

export function createCanonicalIdentity(input: {
  object_id: string;
  object_type: string;
  version: string;
  artifact: unknown;
  parent_references?: readonly CanonicalParentReference[];
  created_at: string;
}): CanonicalIdentity {
  return {
    object_id: input.object_id,
    object_type: input.object_type,
    version: input.version,
    content_hash: hashArtifactContent(input.artifact),
    parent_references: [...(input.parent_references ?? [])],
    created_at: input.created_at,
  };
}

export interface IdentityValidation {
  valid: boolean;
  expected_hash: string;
  actual_hash: string;
  errors: string[];
}

export function validateCanonicalIdentity(
  artifact: unknown,
  identity: CanonicalIdentity
): IdentityValidation {
  const expected = hashArtifactContent(artifact);
  const errors: string[] = [];
  if (expected !== identity.content_hash) errors.push("CONTENT_HASH_MISMATCH");
  if (!identity.object_id) errors.push("MISSING_OBJECT_ID");
  if (!identity.object_type) errors.push("MISSING_OBJECT_TYPE");
  if (!identity.version) errors.push("MISSING_VERSION");
  if (!identity.created_at) errors.push("MISSING_CREATED_AT");
  return { valid: errors.length === 0, expected_hash: expected, actual_hash: identity.content_hash, errors };
}

export function parentReferenceFromIdentity(
  module: string,
  identity: CanonicalIdentity,
  relation?: string
): CanonicalParentReference {
  return {
    module,
    object_id: identity.object_id,
    object_type: identity.object_type,
    version: identity.version,
    content_hash: identity.content_hash,
    relation,
  };
}

/** Conservative adapter for pre-repair states. It never claims the reference
 * was externally verified; it simply gives a deterministic content identity
 * that callers can validate against the supplied state. */
export function resolveParentReference(
  module: string,
  state: unknown,
  relation?: string
): CanonicalParentReference {
  if (isRecord(state) && isRecord(state.identity)) {
    const identity = state.identity as unknown as CanonicalIdentity;
    if (
      typeof identity.object_id === "string" &&
      typeof identity.object_type === "string" &&
      typeof identity.version === "string" &&
      typeof identity.content_hash === "string"
    ) {
      return parentReferenceFromIdentity(module, identity, relation);
    }
  }
  const canonicalVersion = isRecord(state) && typeof state.version === "string" ? state.version : undefined;
  const candidateId = isRecord(state) && typeof state.candidate_id === "string" ? state.candidate_id : undefined;
  const version = canonicalVersion ?? candidateId ?? "UNKNOWN";
  return {
    module,
    object_id: candidateId ?? `${module}:${version}`,
    object_type: candidateId ? `${module}_candidate_state` : `${module}_canonical_state`,
    version,
    content_hash: hashArtifactContent(state),
    relation,
  };
}

export function identitySignature(identity: CanonicalIdentity): string {
  return canonicalStringify({
    object_id: identity.object_id,
    object_type: identity.object_type,
    version: identity.version,
    content_hash: identity.content_hash,
    parent_references: identity.parent_references,
  });
}
