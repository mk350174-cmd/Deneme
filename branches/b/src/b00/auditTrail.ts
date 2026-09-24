// B00 — Audit Trail & Term Evolution
//
// Tracks all changes to canonical terminology and governance decisions.
// Enables rollback to prior terminology versions and visibility into
// how terms evolved over time.
//
// Every version of B01.12 canonical state includes complete audit trail from v1.0.
// Immutable once finalized; enables rollback and decision traceability.

import type { EvidenceRef } from "../types/entities.js";
import { canonicalHasher } from "./hashing.js";

/** Tracks a single change to terminology or canonical state */
export interface AuditEntry {
  audit_id: string; // Stable ID: hash of version + timestamp + field

  /** Which version does this audit entry belong to? (v1.0, v1.1, etc.) */
  version: string;

  /** What changed? (path: "terminology.platforms", "b01.channel_roles.youtube", etc.) */
  changed_field: string;

  /** Previous value (null if new field) */
  old_value?: unknown;

  /** New value */
  new_value: unknown;

  /** Who made this decision? (user email, committee name, "auto-accept", etc.) */
  decision_authority: string;

  /** When was this approved? (ISO 8601) */
  timestamp: string;

  /** Why? (rationale, justification, decision notes) */
  rationale: string;

  /** Evidence supporting this change */
  evidence_refs: EvidenceRef[];

  /** If this change was recommended by an agent, which recommendation_id? */
  related_recommendation_id?: string;

  /** Type of change: "terminology_add" | "terminology_update" | "canonical_state_update" | "conflict_resolution" */
  change_type:
    | "terminology_add"
    | "terminology_update"
    | "canonical_state_update"
    | "conflict_resolution";
}

/** Complete history of changes for a version */
export interface AuditTrail {
  trail_id: string; // e.g., "audit_v1.0", "audit_v1.1"

  /** Which version does this trail track? */
  version: string;

  /** All changes that led to this version */
  entries: AuditEntry[];

  /** When was this version finalized? (ISO 8601) */
  finalized_at: string;

  /** Who approved this version as canonical? */
  approver: string;
}

/** Metadata about the audit trail and version history */
export interface AuditContext {
  /** All versions ever created (v1.0, v1.1, ..., current) */
  version_history: string[];

  /** From version X to Y, what changed? (summary) */
  version_changes: Array<{
    from_version: string;
    to_version: string;
    summary: string; // e.g., "Added TikTok channel, updated YouTube role"
    entry_count: number; // How many audit entries?
    finalized_at: string;
  }>;

  /** Total changes across all versions */
  total_changes: number;

  /** Terminology version when this state was created (for compatibility) */
  terminology_version: string;
}

/** What changed between two versions? */
export interface VersionDiff {
  from_version: string;
  to_version: string;

  /** Audit entries between these versions */
  changes: AuditEntry[];

  /** Summary statistics */
  stats: {
    total_changes: number;
    terminology_changes: number;
    canonical_state_changes: number;
    conflict_resolutions: number;
  };

  /** Can we roll back to from_version? */
  can_rollback: boolean;
  rollback_reason?: string; // e.g., "No, v1.0 is locked"
}

/** User request to rollback to prior version */
export interface RollbackRequest {
  rollback_id: string;
  current_version: string;
  target_version: string; // What version to go back to
  requested_by: string; // Who requested?
  requested_at: string; // ISO 8601
  reason: string; // Why roll back?
  status: "pending" | "approved" | "rejected" | "completed";
  /** If approved, which new version was created? (e.g., v1.0 → v1.2 rollback) */
  resulting_version?: string;
}

/** B00 evaluation of a term proposal or state change */
export interface GovernanceDecision {
  decision_id: string;

  /** What is being decided? (e.g., "Accept ProposedTerm: creator_partnership") */
  subject: string;

  /** B00 decision: accept | reject | defer */
  decision: "accept" | "reject" | "defer";

  /** Who decided? (governance body name) */
  authority: string;

  /** When? (ISO 8601) */
  decided_at: string;

  /** Rationale for decision */
  rationale: string;

  /** Evidence considered in this decision */
  evidence_refs: EvidenceRef[];

  /** If deferred, when should this be revisited? */
  deferred_until?: string;

  /** Related term proposal or canonical claim ID */
  related_proposal_id?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

/** Diff two audit trails (versions).
 *  Returns what changed between from_version and to_version. */
export function diffVersions(from_trail: AuditTrail, to_trail: AuditTrail): VersionDiff {
  const from_entries = from_trail.entries;
  const to_entries = to_trail.entries;

  // Find changes: entries in to_trail that aren't in from_trail
  const changes = to_entries.filter(
    (entry) =>
      !from_entries.some(
        (e) => e.audit_id === entry.audit_id && e.version === from_trail.version
      )
  );

  return {
    from_version: from_trail.version,
    to_version: to_trail.version,
    changes,
    stats: {
      total_changes: changes.length,
      terminology_changes: changes.filter(
        (e) => e.change_type === "terminology_add" || e.change_type === "terminology_update"
      ).length,
      canonical_state_changes: changes.filter((e) => e.change_type === "canonical_state_update")
        .length,
      conflict_resolutions: changes.filter((e) => e.change_type === "conflict_resolution")
        .length,
    },
    can_rollback: true,
  };
}

/** Summarize audit context for display */
export function summarizeAuditContext(context: AuditContext): string {
  const versions = context.version_history.join(" → ");
  const changes = context.version_changes
    .map((v) => `${v.from_version}→${v.to_version}: ${v.summary}`)
    .join("\n");
  return `Versions: ${versions}\n\nChanges:\n${changes}\n\nTotal: ${context.total_changes} changes`;
}

// ============================================================================
// REAL FIELD-LEVEL DIFF (replaces the hardcoded single-entry stub previously
// used by b01/b02 orchestration's buildAuditEntries)
// ============================================================================

export interface ComputeFieldDiffOptions {
  version: string;
  decision_authority: string;
  timestamp: string;
  rationale: string;
  change_type?: AuditEntry["change_type"];
  evidence_refs?: EvidenceRef[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length || aKeys.some((k, i) => k !== bKeys[i])) return false;
    return aKeys.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function buildAuditEntry(
  changedField: string,
  oldValue: unknown,
  newValue: unknown,
  options: ComputeFieldDiffOptions
): AuditEntry {
  const auditId = `audit_${canonicalHasher.hash(
    `${options.version}:${changedField}:${options.timestamp}:${options.decision_authority}`
  )}`;
  return {
    audit_id: auditId,
    version: options.version,
    changed_field: changedField,
    old_value: oldValue,
    new_value: newValue,
    decision_authority: options.decision_authority,
    timestamp: options.timestamp,
    rationale: options.rationale,
    evidence_refs: options.evidence_refs ?? [],
    change_type: options.change_type ?? "canonical_state_update",
  };
}

/**
 * Computes a real, deterministic, field-level diff between `before` and
 * `after`, recursing into nested plain objects (dot-path field names, e.g.
 * "brand_profile.positioning"). Arrays are compared as whole values (not
 * element-by-element diffed) since B-Branch arrays are typically unordered
 * evidence/provenance collections where positional diffing would be
 * misleading.
 *
 * Returns one AuditEntry per added, removed, or changed field. Fields whose
 * value is unchanged (deepEqual) produce no entry — this is a real diff, not
 * a hardcoded "something changed" stub.
 */
export function computeFieldDiff(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  options: ComputeFieldDiffOptions,
  pathPrefix = ""
): AuditEntry[] {
  const entries: AuditEntry[] = [];
  const beforeObj = before ?? {};
  const keys = Array.from(
    new Set([...Object.keys(beforeObj), ...Object.keys(after)])
  ).sort();

  for (const key of keys) {
    const fieldPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    const hasBefore = Object.prototype.hasOwnProperty.call(beforeObj, key);
    const hasAfter = Object.prototype.hasOwnProperty.call(after, key);
    const beforeVal = beforeObj[key];
    const afterVal = after[key];

    if (hasBefore && !hasAfter) {
      entries.push(buildAuditEntry(fieldPath, beforeVal, undefined, options));
      continue;
    }
    if (!hasBefore && hasAfter) {
      entries.push(buildAuditEntry(fieldPath, undefined, afterVal, options));
      continue;
    }
    if (deepEqual(beforeVal, afterVal)) {
      continue; // no-op: field unchanged
    }
    if (isPlainObject(beforeVal) && isPlainObject(afterVal)) {
      entries.push(...computeFieldDiff(beforeVal, afterVal, options, fieldPath));
      continue;
    }
    entries.push(buildAuditEntry(fieldPath, beforeVal, afterVal, options));
  }

  return entries;
}
