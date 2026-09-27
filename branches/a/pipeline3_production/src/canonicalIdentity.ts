// CANONICAL IDENTITY MODEL (Tier-1 repair T1.1)
//
// Before this module, canonical handoff artifacts carried a deterministic
// *name* (package_id) but no content identity: package_id was derived from
// (project_id, scope_id, claim_ids) only, so mutating handoff_notes,
// verifications or the knowledge_package left package_id — and therefore
// any approval bound to it — unchanged. See A_BRANCH_OPUS5_CANONICAL_REPAIR
// _BRIEF T1.1/T1.4.
//
// The model is deliberately minimal and additive: existing deterministic
// local ids (claim_id, source_id, ...) are untouched. Only canonical
// handoff artifacts gain explicit version/content identity.

import { sha256 } from "./ids.js";

export type CanonicalObjectType =
  | "research_scope"
  | "research_package"
  | "production_package"
  | "final_delivery_package"
  | "qa_report"
  | "render_run"
  | "render_bundle";

/**
 * Canonical identity of a versioned, hash-addressed artifact.
 *
 *   object_id     — stable logical name (survives content changes)
 *   object_type   — which canonical artifact class this is
 *   version       — monotonically-meaningful schema/content version string
 *   content_hash  — SHA-256 over the canonical representation of the
 *                   object's *content* (never over the identity block
 *                   itself; self-reference is structurally impossible)
 *   parent_id     — the upstream canonical object this was derived from
 */
export interface CanonicalIdentity {
  object_id: string;
  object_type: CanonicalObjectType;
  version: string;
  content_hash: string;
  parent_id?: string;
  parent_content_hash?: string;
}

/**
 * Order-independent canonical JSON representation.
 *
 * Object keys are sorted recursively so two structurally-identical objects
 * that differ only in key insertion order hash identically. Array order is
 * preserved because it is semantically meaningful (timeline entries,
 * manifest ordering, ...). `undefined`-valued keys are dropped so that an
 * explicitly-absent optional field and an omitted one agree.
 */
export function canonicalRepresentation(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeysDeep(v)]));
  }
  return value;
}

/** SHA-256 over the canonical representation of any content object. */
export function contentHash(content: unknown): string {
  return sha256(canonicalRepresentation(content));
}

/**
 * Builds a CanonicalIdentity. `content` must exclude the identity block
 * itself — callers pass the artifact's content sections, never the whole
 * artifact including its own `identity` field.
 */
export function buildIdentity(params: {
  objectId: string;
  objectType: CanonicalObjectType;
  version: string;
  content: unknown;
  parentId?: string;
  parentContentHash?: string;
}): CanonicalIdentity {
  return {
    object_id: params.objectId,
    object_type: params.objectType,
    version: params.version,
    content_hash: contentHash(params.content),
    parent_id: params.parentId,
    parent_content_hash: params.parentContentHash,
  };
}

/**
 * Recomputes an artifact's content hash and compares it to the declared
 * identity. This is what makes an approved artifact immutable in practice
 * (T1.4): if the content changed, the recomputed hash differs and every
 * approval bound to the old hash stops verifying.
 */
export function verifyIdentity(
  identity: CanonicalIdentity,
  content: unknown,
): { valid: boolean; expected: string; actual: string } {
  const actual = contentHash(content);
  return { valid: actual === identity.content_hash, expected: identity.content_hash, actual };
}
