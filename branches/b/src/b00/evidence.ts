// B00 — Evidence / Epistemic Policy
// Evidence strength, source origin, provenance and governance are separate axes.

import type { EvidenceRef, EvidenceStatus } from "../types/entities.js";

export type EvidenceOrigin =
  | "REAL_WORLD_OBSERVATION"
  | "PROVIDER_DATA"
  | "RESEARCH"
  | "DOCUMENTATION"
  | "USER_ASSERTION"
  | "SYSTEM_DERIVATION"
  | "DEFAULT"
  | "MOCK"
  | "UNKNOWN";

export type EvidenceBasis = "OBSERVED" | "ASSERTED" | "INFERRED" | "DEFAULT" | "MOCK" | "UNKNOWN";
export type EvidenceSourceMode = "REAL" | "MOCK" | "SYNTHETIC" | "UNKNOWN";

export interface EvidenceValidationIssue {
  severity: "ERROR" | "WARNING" | "INFO";
  code: string;
  message: string;
}

export interface EvidenceValidationResult {
  valid: boolean;
  normalized_status: EvidenceStatus;
  issues: EvidenceValidationIssue[];
}

/** VERIFIED is reserved for directly confirmed, non-mock evidence. Assertions,
 * defaults, templates and system inference can support reasoning but cannot be
 * silently upgraded to VERIFIED. */
export function validateEvidenceSemantics(value: unknown): EvidenceValidationResult {
  const issues: EvidenceValidationIssue[] = [];
  if (typeof value !== "object" || value === null) {
    return {
      valid: false,
      normalized_status: "UNKNOWN",
      issues: [{ severity: "ERROR", code: "MALFORMED_EVIDENCE", message: "Evidence must be an object" }],
    };
  }
  const evidence = value as EvidenceRef;
  const status: EvidenceStatus = ["VERIFIED", "INFERRED", "UNKNOWN"].includes(evidence.status)
    ? evidence.status
    : "UNKNOWN";
  const origin = evidence.origin ?? "UNKNOWN";
  const basis = evidence.basis ?? "UNKNOWN";
  const sourceMode = evidence.source_mode ?? "UNKNOWN";

  let normalized = status;
  const cannotVerify =
    sourceMode === "MOCK" || sourceMode === "SYNTHETIC" || sourceMode === "UNKNOWN" ||
    origin === "MOCK" || origin === "DEFAULT" || origin === "USER_ASSERTION" || origin === "SYSTEM_DERIVATION" ||
    basis === "ASSERTED" || basis === "INFERRED" || basis === "DEFAULT" || basis === "MOCK" || basis === "UNKNOWN";

  if (status === "VERIFIED" && cannotVerify) {
    normalized = origin === "DEFAULT" || sourceMode === "MOCK" || sourceMode === "SYNTHETIC" || sourceMode === "UNKNOWN" ? "UNKNOWN" : "INFERRED";
    issues.push({
      severity: "ERROR",
      code: "EVIDENCE_STATUS_INFLATION",
      message: `Evidence with origin=${origin}, basis=${basis}, source_mode=${sourceMode} cannot be VERIFIED`,
    });
  }
  if (!evidence.id || !evidence.source) {
    normalized = "UNKNOWN";
    issues.push({ severity: "ERROR", code: "MISSING_EVIDENCE_SOURCE", message: "Evidence requires id and source" });
  }
  if ((sourceMode === "MOCK" || sourceMode === "SYNTHETIC" || sourceMode === "UNKNOWN") && evidence.production_eligible === true) {
    normalized = "UNKNOWN";
    const code = sourceMode === "MOCK" ? "MOCK_PRODUCTION_LEAK" : sourceMode === "SYNTHETIC" ? "SYNTHETIC_PRODUCTION_LEAK" : "UNKNOWN_SOURCE_PRODUCTION_LEAK";
    issues.push({ severity: "ERROR", code, message: `${sourceMode} evidence cannot be production-eligible` });
  }
  return { valid: !issues.some((i) => i.severity === "ERROR"), normalized_status: normalized, issues };
}

export function normalizeEvidenceRef(evidence: EvidenceRef): EvidenceRef {
  const result = validateEvidenceSemantics(evidence);
  if (result.normalized_status === evidence.status) return evidence;
  return { ...evidence, status: result.normalized_status };
}

export function weakestEvidenceStatus(refs: readonly EvidenceRef[]): EvidenceStatus {
  if (refs.length === 0) return "UNKNOWN";
  const normalized = refs.map((ref) => normalizeEvidenceRef(ref).status);
  if (normalized.includes("UNKNOWN")) return "UNKNOWN";
  if (normalized.includes("INFERRED")) return "INFERRED";
  return "VERIFIED";
}
