// P1 -> P2 handoff ingestion. P2 consumes P1 strictly through this
// serialized contract — no P1 import, no shared runtime object. Validates
// structure before anything downstream touches it (Architectural Principle
// 8: "a receiving pipeline validates the handoff package's structure/
// integrity before acting on it, never infers missing context from prose").

import { HandoffValidationError } from "./errors.js";
import { sha256 } from "./ids.js";
import type { ResearchPackageHandoffInput } from "./types.js";

function requireField(obj: Record<string, unknown>, field: string, kind: "string" | "object" | "array"): void {
  const value = obj[field];
  if (value === undefined || value === null) {
    throw new HandoffValidationError(field, "required field is missing");
  }
  if (kind === "array" && !Array.isArray(value)) {
    throw new HandoffValidationError(field, "expected an array");
  }
  if (kind === "object" && (typeof value !== "object" || Array.isArray(value))) {
    throw new HandoffValidationError(field, "expected an object");
  }
  if (kind === "string" && typeof value !== "string") {
    throw new HandoffValidationError(field, "expected a string");
  }
}

// Verifies the Research Package carries a real Gate A1 package-approval
// record (state_after === "PACKAGE_APPROVED"), not just an approved scope.
// gates is untyped/optional on the wire, so absence or an empty/incomplete
// array is rejected explicitly rather than treated as implicitly approved.
function requirePackageApprovalGate(obj: Record<string, unknown>): void {
  const gates = obj.gates;
  if (!Array.isArray(gates)) {
    throw new HandoffValidationError("gates", "Research Package gates array is missing — cannot verify Gate A1 package approval");
  }
  const approved = gates.some((g) => {
    const gate = g as Record<string, unknown>;
    return gate?.gate_id === "A1" && gate?.state_after === "PACKAGE_APPROVED";
  });
  if (!approved) {
    throw new HandoffValidationError(
      "gates",
      "Research Package has no Gate A1 PACKAGE_APPROVED record — P2 cannot consume an unapproved package",
    );
  }
}

// Canonical section-hash reconstruction — must mirror P1's
// manifest.ts::buildManifestAndIntegrity exactly, since that is the
// representation P1 hashed. Deliberately reimplemented here rather than
// imported: P2 consumes P1 strictly through the serialized contract and
// takes no runtime dependency on P1 (Architectural Principle 8).
const P1_SECTION_ORDER = [
  "research_scope",
  "sources",
  "evidence",
  "claims",
  "verifications",
  "knowledge_package",
  "unresolved_questions",
  "handoff_notes",
] as const;

function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)));
    }
    return val;
  });
}

export interface ResearchPackageIntegrityResult {
  package_sha256: string;
  per_section: Record<string, string>;
}

/**
 * Recomputes the Research Package's canonical hashes from the received
 * content and compares them against everything the package declares:
 * package_sha256, every per_file entry, and every manifest entry.
 * HARD FAILS on any mismatch (T1.2).
 */
export function verifyResearchPackageIntegrity(
  obj: Record<string, unknown>,
): ResearchPackageIntegrityResult {
  const integrity = obj.integrity_hashes as { package_sha256: string; per_file?: Record<string, string> };
  const declaredManifest = (obj.manifest ?? []) as Array<{ path: string; sha256: string; purpose?: string }>;

  const per_section: Record<string, string> = {};
  const entries: Array<{ path: string; sha256: string }> = [];
  for (const key of P1_SECTION_ORDER) {
    const virtualPath = `handoff/${key}.json`;
    const hash = sha256(canonicalize(obj[key]));
    per_section[virtualPath] = hash;
    entries.push({ path: virtualPath, sha256: hash });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const recomputed = sha256(entries.map((m) => `${m.path}:${m.sha256}`).join("|"));

  if (recomputed !== integrity.package_sha256) {
    throw new HandoffValidationError(
      "integrity_hashes.package_sha256",
      `Research Package integrity verification FAILED: declared "${integrity.package_sha256}", ` +
        `recomputed "${recomputed}". The package was modified after P1 sealed it.`,
    );
  }

  const declaredPerFile = integrity.per_file ?? {};
  for (const [path, actual] of Object.entries(per_section)) {
    const declared = declaredPerFile[path];
    if (declared !== undefined && declared !== actual) {
      throw new HandoffValidationError(
        `integrity_hashes.per_file[${path}]`,
        `declared "${declared}" does not match recomputed "${actual}"`,
      );
    }
  }

  for (const entry of declaredManifest) {
    const actual = per_section[entry.path];
    if (actual === undefined) {
      throw new HandoffValidationError("manifest", `declared manifest entry "${entry.path}" has no corresponding section`);
    }
    if (entry.sha256 !== actual) {
      throw new HandoffValidationError(
        `manifest[${entry.path}]`,
        `declared sha256 "${entry.sha256}" does not match recomputed "${actual}"`,
      );
    }
  }

  return { package_sha256: recomputed, per_section };
}

/**
 * Parses and validates a raw object against the P1 Research Package handoff
 * contract. Throws HandoffValidationError naming the exact missing/malformed
 * field — never silently proceeds with a partial package.
 */
export function parseResearchPackage(raw: unknown): ResearchPackageHandoffInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new HandoffValidationError("<root>", "expected a JSON object");
  }
  const obj = raw as Record<string, unknown>;

  requireField(obj, "package_id", "string");
  requireField(obj, "schema_version", "string");
  requireField(obj, "project_id", "string");
  requireField(obj, "manifest", "array");
  requireField(obj, "integrity_hashes", "object");
  requireField(obj, "research_scope", "object");
  requireField(obj, "sources", "array");
  requireField(obj, "evidence", "array");
  requireField(obj, "claims", "array");
  requireField(obj, "knowledge_package", "object");
  requireField(obj, "unresolved_questions", "array");
  requireField(obj, "handoff_notes", "string");

  const scope = obj.research_scope as Record<string, unknown>;
  if (scope.state !== "SCOPE_APPROVED") {
    throw new HandoffValidationError(
      "research_scope.state",
      `expected SCOPE_APPROVED, found "${String(scope.state)}" — P2 cannot consume an unapproved scope`,
    );
  }

  // AUDIT FIX (forensic integration audit, §13 item 3): only the scope's
  // own state (Gate A1 transition 1) was checked here — the package-level
  // Gate A1 approval (transition 2, PACKAGE_DRAFTED -> PACKAGE_APPROVED)
  // was never verified, so a Research Package whose package-level gate was
  // never recorded would still be accepted. This closes that gap.
  requirePackageApprovalGate(obj);

  const integrity = obj.integrity_hashes as Record<string, unknown>;
  requireField(integrity, "package_sha256", "string");

  // TIER-1 REPAIR T1.2 — REAL integrity verification at the P1 -> P2
  // boundary. Previously the only check was that package_sha256 was a
  // string; the hash was never recomputed and never compared. A Research
  // Package could be modified in transit, keep its original (now wrong)
  // hash, and P2 would consume it. This is the brief's "do not accept
  // 'looks like a SHA-256' as verification" case.
  verifyResearchPackageIntegrity(obj);

  const knowledgePackage = obj.knowledge_package as Record<string, unknown>;
  requireField(knowledgePackage, "verification_state_schema_version", "string");

  return obj as unknown as ResearchPackageHandoffInput;
}

// P2 never repeats subject research: extracts only claim_ids + statements
// for traceability grounding, never re-derives knowledge from raw sources.
export function claimLookup(pkg: ResearchPackageHandoffInput): Map<string, { statement: string; dimension: string }> {
  const map = new Map<string, { statement: string; dimension: string }>();
  for (const claim of pkg.claims) {
    map.set(claim.claim_id, { statement: claim.statement, dimension: claim.dimension });
  }
  return map;
}
