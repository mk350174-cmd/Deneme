// P1 Category 5: Governance & Handoff — Validation boundary
// Validates structural completeness, referential integrity, and safety for A→B handoff
// without assuming B responsibilities (strategy, channel fit, ranking, adoption)

import { ValidationError } from "./errors.js";
import { verifyIntegrityDetailed } from "./manifest.js";
import { requireGateState } from "./gates.js";
import { contentHash, verifyIdentity } from "./canonicalIdentity.js";
import { findTransition } from "./gateTransitions.js";
import type { GateApprovalRecord, ResearchPackageHandoff } from "./types.js";

// Validation result: distinguishes valid, blocking errors, warnings
export interface ValidationResult {
  status: "valid" | "invalid" | "valid_with_warnings";
  errors: ValidationErrorDetail[];
  warnings: ValidationWarning[];
  checks_run: number;
  validation_timestamp: string;
}

export interface ValidationErrorDetail {
  code: string; // e.g., "REFERENTIAL_INTEGRITY_VIOLATED"
  field: string; // e.g., "claims[0].evidence_refs[1]"
  message: string;
}

export interface ValidationWarning {
  code: string;
  field: string;
  message: string;
}

const GATE_A1 = "A1";

export function validateResearchPackage(handoff: ResearchPackageHandoff): ValidationResult {
  const errors: ValidationErrorDetail[] = [];
  const warnings: ValidationWarning[] = [];

  // 1. Required canonical fields
  errors.push(...validateRequiredFields(handoff));

  // 2. Referential integrity (blocking)
  errors.push(...validateReferentialIntegrity(handoff));

  // 3. Verification consistency (blocking)
  errors.push(...validateVerificationConsistency(handoff));

  // 4. Knowledge quality — no silent conversions (blocking)
  errors.push(...validateKnowledgeQuality(handoff));

  // 5. Manifest & integrity (blocking)
  errors.push(...validateIntegritySignature(handoff));

  // 6. Gates (blocking)
  errors.push(...validateGates(handoff));

  // 7. C2 context (warnings if present)
  if (handoff.category_2_context) {
    warnings.push(...validateCategory2Context(handoff));
  }

  // 8. SynthesisMetadata (warnings if present)
  if ((handoff as any).synthesis_metadata) {
    warnings.push(...validateSynthesisMetadata(handoff));
  }

  // 9. Data quality warnings
  warnings.push(...validateDataQuality(handoff));

  return {
    status: errors.length > 0 ? "invalid" : warnings.length > 0 ? "valid_with_warnings" : "valid",
    errors,
    warnings,
    checks_run: 9,
    validation_timestamp: new Date().toISOString(),
  };
}

// --- Required Fields ---

function validateRequiredFields(handoff: ResearchPackageHandoff): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];

  // 14 core required fields
  if (!handoff.package_id || typeof handoff.package_id !== "string") {
    errors.push({
      code: "REQUIRED_FIELD_MISSING",
      field: "package_id",
      message: "package_id must be non-empty string",
    });
  }

  if (handoff.schema_version !== "1.0.0") {
    errors.push({
      code: "INVALID_SCHEMA_VERSION",
      field: "schema_version",
      message: `schema_version must be "1.0.0", got "${handoff.schema_version}"`,
    });
  }

  if (!handoff.project_id || typeof handoff.project_id !== "string") {
    errors.push({
      code: "REQUIRED_FIELD_MISSING",
      field: "project_id",
      message: "project_id must be non-empty string",
    });
  }

  if (!Array.isArray(handoff.manifest)) {
    errors.push({
      code: "REQUIRED_FIELD_MISSING",
      field: "manifest",
      message: "manifest must be array",
    });
  }

  if (!handoff.integrity_hashes) {
    errors.push({
      code: "REQUIRED_FIELD_MISSING",
      field: "integrity_hashes",
      message: "integrity_hashes required",
    });
  }

  if (!handoff.research_scope) {
    errors.push({
      code: "REQUIRED_FIELD_MISSING",
      field: "research_scope",
      message: "research_scope required",
    });
  }

  if (!Array.isArray(handoff.sources)) {
    errors.push({
      code: "REQUIRED_FIELD_MISSING",
      field: "sources",
      message: "sources must be array",
    });
  }

  if (!Array.isArray(handoff.evidence)) {
    errors.push({
      code: "REQUIRED_FIELD_MISSING",
      field: "evidence",
      message: "evidence must be array",
    });
  }

  if (!Array.isArray(handoff.claims)) {
    errors.push({
      code: "REQUIRED_FIELD_MISSING",
      field: "claims",
      message: "claims must be array",
    });
  }

  if (!Array.isArray(handoff.verifications)) {
    errors.push({
      code: "REQUIRED_FIELD_MISSING",
      field: "verifications",
      message: "verifications must be array",
    });
  }

  if (!handoff.knowledge_package) {
    errors.push({
      code: "REQUIRED_FIELD_MISSING",
      field: "knowledge_package",
      message: "knowledge_package required",
    });
  }

  if (!Array.isArray(handoff.unresolved_questions)) {
    errors.push({
      code: "REQUIRED_FIELD_MISSING",
      field: "unresolved_questions",
      message: "unresolved_questions must be array",
    });
  }

  if (typeof handoff.handoff_notes !== "string") {
    errors.push({
      code: "REQUIRED_FIELD_MISSING",
      field: "handoff_notes",
      message: "handoff_notes must be string",
    });
  }

  if (!Array.isArray(handoff.gates)) {
    errors.push({
      code: "REQUIRED_FIELD_MISSING",
      field: "gates",
      message: "gates must be array",
    });
  }

  // project_id consistency check
  if (handoff.research_scope && handoff.project_id !== handoff.research_scope.project_id) {
    errors.push({
      code: "PROJECT_ID_MISMATCH",
      field: "project_id",
      message: `project_id mismatch: handoff has "${handoff.project_id}" but research_scope has "${handoff.research_scope.project_id}"`,
    });
  }

  return errors;
}

// --- Referential Integrity ---

function validateReferentialIntegrity(handoff: ResearchPackageHandoff): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];

  const sourceMap = new Map(handoff.sources.map((s) => [s.source_id, s]));
  const evidenceMap = new Map(handoff.evidence.map((e) => [e.evidence_id, e]));
  const claimMap = new Map(handoff.claims.map((c) => [c.claim_id, c]));

  // Evidence → Source chain
  for (let i = 0; i < handoff.evidence.length; i++) {
    const e = handoff.evidence[i]!;
    if (!sourceMap.has(e.source_id)) {
      errors.push({
        code: "REFERENTIAL_INTEGRITY_VIOLATED",
        field: `evidence[${i}].source_id`,
        message: `Evidence "${e.evidence_id}" references missing source "${e.source_id}"`,
      });
    }
  }

  // Claim → Evidence chain
  for (let i = 0; i < handoff.claims.length; i++) {
    const c = handoff.claims[i]!;
    if (c.evidence_refs) {
      for (let j = 0; j < c.evidence_refs.length; j++) {
        const ref = c.evidence_refs[j]!;
        if (!evidenceMap.has(ref)) {
          errors.push({
            code: "REFERENTIAL_INTEGRITY_VIOLATED",
            field: `claims[${i}].evidence_refs[${j}]`,
            message: `Claim "${c.claim_id}" references missing evidence "${ref}"`,
          });
        }
      }
    }
  }

  // Claim → Contradiction chain
  for (let i = 0; i < handoff.claims.length; i++) {
    const c = handoff.claims[i]!;
    if (c.contradiction_refs) {
      for (let j = 0; j < c.contradiction_refs.length; j++) {
        const ref = c.contradiction_refs[j]!;
        if (!claimMap.has(ref)) {
          errors.push({
            code: "REFERENTIAL_INTEGRITY_VIOLATED",
            field: `claims[${i}].contradiction_refs[${j}]`,
            message: `Claim "${c.claim_id}" references missing claim "${ref}"`,
          });
        }
      }
    }
  }

  return errors;
}

// --- Verification Consistency ---

function validateVerificationConsistency(handoff: ResearchPackageHandoff): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];

  const claimMap = new Map(handoff.claims.map((c) => [c.claim_id, c]));

  for (let i = 0; i < handoff.verifications.length; i++) {
    const v = handoff.verifications[i]!;

    // Verification → Claim
    if (!claimMap.has(v.claim_id)) {
      errors.push({
        code: "REFERENTIAL_INTEGRITY_VIOLATED",
        field: `verifications[${i}].claim_id`,
        message: `Verification "${v.verification_id}" references missing claim "${v.claim_id}"`,
      });
    }

    // Status validity
    if (!["VERIFIED", "INFERRED", "UNKNOWN"].includes(v.status)) {
      errors.push({
        code: "INVALID_VERIFICATION_STATUS",
        field: `verifications[${i}].status`,
        message: `status must be VERIFIED, INFERRED, or UNKNOWN; got "${v.status}"`,
      });
    }

    // UNKNOWN requires unresolved_reason
    if (v.status === "UNKNOWN") {
      if (!v.unresolved_reason || v.unresolved_reason.trim().length === 0) {
        errors.push({
          code: "MISSING_UNRESOLVED_REASON",
          field: `verifications[${i}].unresolved_reason`,
          message: "When status=UNKNOWN, unresolved_reason must be non-empty string",
        });
      }
    }
  }

  return errors;
}

// --- Knowledge Quality ---

function validateKnowledgeQuality(handoff: ResearchPackageHandoff): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];

  const kp = handoff.knowledge_package;
  const verificationMap = new Map(handoff.verifications.map((v) => [v.claim_id, v]));

  // Collect all claims in knowledge package buckets
  const allDimensions = [
    "facts",
    "concepts",
    "people",
    "events",
    "places",
    "objects",
    "processes",
    "relationships",
    "chronology",
    "terminology",
    "quantitative",
    "visual",
    "examples",
    "interpretations",
    "production_context",
  ];

  const claimsInTopicalBuckets = new Set<string>();
  for (const dim of allDimensions) {
    if (Array.isArray((kp as any)[dim])) {
      for (const claim of (kp as any)[dim]) {
        claimsInTopicalBuckets.add(claim.claim_id);
      }
    }
  }

  // Check unknowns bucket
  const unknownClaimIds = new Set<string>();
  if (Array.isArray(kp.unknowns)) {
    for (const claim of kp.unknowns) {
      unknownClaimIds.add(claim.claim_id);

      // UNKNOWN claims must NOT appear in topical buckets
      if (claimsInTopicalBuckets.has(claim.claim_id)) {
        errors.push({
          code: "SILENT_CONVERSION_DETECTED",
          field: `knowledge_package.unknowns`,
          message: `Claim "${claim.claim_id}" marked UNKNOWN but also appears in a topical dimension (silent conversion)`,
        });
      }

      // Verify verification status matches
      const verification = verificationMap.get(claim.claim_id);
      if (verification && verification.status !== "UNKNOWN") {
        errors.push({
          code: "STATE_MISMATCH",
          field: `knowledge_package.unknowns[*].${claim.claim_id}`,
          message: `Claim "${claim.claim_id}" in unknowns bucket but verification status is "${verification.status}" (not UNKNOWN)`,
        });
      }
    }
  }

  // Check contradictions bucket
  const contradictionClaimIds = new Set<string>();
  if (Array.isArray(kp.contradictions)) {
    for (const claim of kp.contradictions) {
      contradictionClaimIds.add(claim.claim_id);

      // Contradictions must have contradiction_refs
      if (claim.contradiction_refs.length === 0) {
        errors.push({
          code: "CONTRADICTION_MISMATCH",
          field: `knowledge_package.contradictions[*].${claim.claim_id}`,
          message: `Claim "${claim.claim_id}" in contradictions bucket but has no contradiction_refs`,
        });
      }
    }
  }

  // Check no duplicate claims across buckets
  const seenClaimIds = new Set<string>();
  const allBuckets = [
    ...allDimensions,
    "contradictions",
    "unknowns",
  ];
  for (const bucket of allBuckets) {
    if (Array.isArray((kp as any)[bucket])) {
      for (const claim of (kp as any)[bucket]) {
        if (seenClaimIds.has(claim.claim_id)) {
          errors.push({
            code: "DUPLICATE_CLAIM_IN_BUCKETS",
            field: `knowledge_package.${bucket}`,
            message: `Claim "${claim.claim_id}" appears in multiple dimension buckets (data integrity violation)`,
          });
        }
        seenClaimIds.add(claim.claim_id);
      }
    }
  }

  return errors;
}

// --- Integrity Signature ---

function validateIntegritySignature(handoff: ResearchPackageHandoff): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];

  // Reconstruct sections for integrity verification
  const sections = {
    research_scope: handoff.research_scope,
    sources: handoff.sources,
    evidence: handoff.evidence,
    claims: handoff.claims,
    verifications: handoff.verifications,
    knowledge_package: handoff.knowledge_package,
    unresolved_questions: handoff.unresolved_questions,
    handoff_notes: handoff.handoff_notes,
  };

  // TIER-1 T1.2 / TIER-2 T2.7 — recompute the canonical representation and
  // compare the package hash, EVERY declared per-file hash, and EVERY
  // declared manifest entry. Previously only package_sha256 was compared,
  // so tampering confined to integrity_hashes.per_file or to the manifest
  // itself passed validation.
  const integrityResult = verifyIntegrityDetailed(
    sections,
    handoff.integrity_hashes,
    handoff.manifest,
  );
  if (!integrityResult.package_hash_match) {
    errors.push({
      code: "INTEGRITY_MISMATCH",
      field: "integrity_hashes.package_sha256",
      message:
        `Package integrity verification failed: declared ${integrityResult.declared_package_sha256}, ` +
        `recomputed ${integrityResult.recomputed_package_sha256}`,
    });
  }
  for (const mismatch of integrityResult.per_file_mismatches) {
    errors.push({
      code: "PER_FILE_HASH_MISMATCH",
      field: `integrity_hashes.per_file[${mismatch.path}]`,
      message: `declared "${mismatch.declared}" != recomputed "${mismatch.actual}"`,
    });
  }
  for (const mismatch of integrityResult.manifest_mismatches) {
    errors.push({
      code: "MANIFEST_MISMATCH",
      field: `manifest[${mismatch.path}]`,
      message: mismatch.reason,
    });
  }

  // TIER-1 T1.1 — the declared canonical identity must describe this exact
  // content. This is the check that makes an approval bound to
  // identity.content_hash meaningful.
  if (handoff.identity) {
    const idResult = verifyIdentity(handoff.identity, sections);
    if (!idResult.valid) {
      errors.push({
        code: "IDENTITY_CONTENT_MISMATCH",
        field: "identity.content_hash",
        message: `declared content_hash ${idResult.expected} != recomputed ${idResult.actual}`,
      });
    }
  } else {
    errors.push({
      code: "IDENTITY_MISSING",
      field: "identity",
      message: "canonical identity block is missing; artifact has no content identity",
    });
  }

  // Manifest presence and structure
  if (handoff.manifest.length === 0) {
    errors.push({
      code: "MANIFEST_INCOMPLETE",
      field: "manifest",
      message: "manifest array is empty (expected 8 sections)",
    });
  }

  return errors;
}

// --- Gates ---

function validateGates(handoff: ResearchPackageHandoff): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];

  if (handoff.gates.length === 0) {
    errors.push({
      code: "GATE_MISSING",
      field: "gates",
      message: "gates array is empty; Gate A1 approval required",
    });
    return errors; // Early exit; no gates to check
  }

  // TIER-1 T1.3 — validate EVERY recorded transition against the canonical
  // table, plus ordering and prerequisites. Previously only the terminal
  // state of the last A1 record was inspected, so an A1 history of
  // [PACKAGE_DRAFTED -> PACKAGE_APPROVED] with no scope approval at all,
  // or a record with an invented state_before, validated clean.
  const seenTransitions: GateApprovalRecord[] = [];
  for (let i = 0; i < handoff.gates.length; i++) {
    const gate = handoff.gates[i]!;
    const rule = findTransition(gate.gate_id, gate.state_before, gate.state_after);
    if (!rule) {
      errors.push({
        code: "ILLEGAL_GATE_TRANSITION",
        field: `gates[${i}]`,
        message: `"${gate.state_before}" -> "${gate.state_after}" is not a canonical transition for gate "${gate.gate_id}"`,
      });
      continue;
    }
    if (rule.requires) {
      const satisfied = seenTransitions.some(
        (g) => g.gate_id === rule.requires!.gate_id && g.state_after === rule.requires!.state_after,
      );
      if (!satisfied) {
        errors.push({
          code: "OUT_OF_ORDER_APPROVAL",
          field: `gates[${i}]`,
          message: `gate "${gate.gate_id}" -> "${gate.state_after}" requires ${rule.requires.gate_id}:${rule.requires.state_after} to be recorded first`,
        });
      }
    }
    const duplicate = seenTransitions.some(
      (g) =>
        g.gate_id === gate.gate_id &&
        g.state_after === gate.state_after &&
        (g.object_id ?? g.object_version_being_approved) ===
          (gate.object_id ?? gate.object_version_being_approved),
    );
    if (duplicate) {
      errors.push({
        code: "DUPLICATE_APPROVAL",
        field: `gates[${i}]`,
        message: `duplicate "${gate.state_after}" approval for object "${gate.object_id ?? gate.object_version_being_approved}"`,
      });
    }
    seenTransitions.push(gate);
  }

  try {
    requireGateState(handoff.gates, GATE_A1, "PACKAGE_APPROVED");
  } catch (err) {
    if (err instanceof Error) {
      errors.push({
        code: "GATE_STATE_VIOLATION",
        field: "gates",
        message: `Gate A1 state requirement not met: ${err.message}`,
      });
    }
  }

  // Validate latest Gate A1 record has correct actor and timestamp
  const latestA1 = [...handoff.gates].reverse().find((g) => g.gate_id === GATE_A1);
  if (latestA1) {
    if (!latestA1.actor || latestA1.actor.trim().length === 0) {
      errors.push({
        code: "GATE_VALIDATION_FAILED",
        field: "gates[*].actor",
        message: "Gate A1 actor must be non-empty string",
      });
    }

    if (!latestA1.timestamp) {
      errors.push({
        code: "GATE_VALIDATION_FAILED",
        field: "gates[*].timestamp",
        message: "Gate A1 timestamp required",
      });
    }

    if (latestA1.object_version_being_approved !== handoff.package_id) {
      errors.push({
        code: "GATE_VERSION_MISMATCH",
        field: "gates[*].object_version_being_approved",
        message: `Gate A1 version "${latestA1.object_version_being_approved}" does not match handoff.package_id "${handoff.package_id}"`,
      });
    }

    // TIER-1 T1.4 — the package approval must bind to this package's exact
    // content hash. Without this an approved package could be modified while
    // keeping its approval record intact.
    if (latestA1.state_after === "PACKAGE_APPROVED") {
      if (!latestA1.object_content_hash) {
        errors.push({
          code: "APPROVAL_NOT_CONTENT_BOUND",
          field: "gates[*].object_content_hash",
          message: "Gate A1 package approval carries no object_content_hash; approval is not bound to an immutable artifact",
        });
      } else if (handoff.identity && latestA1.object_content_hash !== handoff.identity.content_hash) {
        errors.push({
          code: "APPROVAL_CONTENT_MISMATCH",
          field: "gates[*].object_content_hash",
          message: `Gate A1 approved content hash "${latestA1.object_content_hash}" does not match current identity.content_hash "${handoff.identity.content_hash}" — the package changed after approval`,
        });
      }
    }
  }

  return errors;
}

// --- Category 2 Context (Warnings Only) ---

function validateCategory2Context(handoff: ResearchPackageHandoff): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const ctx = handoff.category_2_context;

  if (!ctx) return warnings;

  // R01.1 — category_2_context integrity. Recompute its dedicated hash
  // (see IntegrityHashes.category_2_context_sha256's classification
  // decision) and compare. This is the tamper-evidence gap this field
  // previously had none of: it validated FK resolution (T1.5) but nothing
  // stopped a wholesale swap of the discovery/acquisition trail as long as
  // the swapped-in version was internally self-consistent.
  const declaredHash = handoff.integrity_hashes.category_2_context_sha256;
  if (!declaredHash) {
    warnings.push({
      code: "C2_INTEGRITY_MISSING",
      field: "integrity_hashes.category_2_context_sha256",
      message: "category_2_context is present but carries no integrity hash — its content is not tamper-evident",
    });
  } else {
    const recomputed = contentHash(ctx);
    if (recomputed !== declaredHash) {
      warnings.push({
        code: "C2_INTEGRITY_MISMATCH",
        field: "integrity_hashes.category_2_context_sha256",
        message: `declared "${declaredHash}" does not match recomputed "${recomputed}" — category_2_context was modified after sealing`,
      });
    }
  }

  const sourceMap = new Map(handoff.sources.map((s) => [s.source_id, s]));

  // Acquisition history validation
  if (ctx.acquisition_history && Array.isArray(ctx.acquisition_history)) {
    for (let i = 0; i < ctx.acquisition_history.length; i++) {
      const attempt = ctx.acquisition_history[i]!;

      if (attempt.resolved_source_id && !sourceMap.has(attempt.resolved_source_id)) {
        warnings.push({
          code: "C2_ACQUISITION_INCONSISTENCY",
          field: `category_2_context.acquisition_history[${i}]`,
          message: `Acquisition attempt references missing source "${attempt.resolved_source_id}"`,
        });
      }
    }
  }

  // Observations validation
  if (ctx.observations && Array.isArray(ctx.observations)) {
    for (let i = 0; i < ctx.observations.length; i++) {
      const obs = ctx.observations[i]!;

      if (obs.source_id && !sourceMap.has(obs.source_id)) {
        warnings.push({
          code: "C2_OBSERVATION_INCONSISTENCY",
          field: `category_2_context.observations[${i}]`,
          message: `Observation references missing source "${obs.source_id}"`,
        });
      }

      if (!obs.observed_at) {
        warnings.push({
          code: "C2_OBSERVATION_INCOMPLETE",
          field: `category_2_context.observations[${i}].observed_at`,
          message: "Observation timestamp missing",
        });
      }
    }
  }

  return warnings;
}

// --- SynthesisMetadata (Warnings Only) ---

function validateSynthesisMetadata(handoff: ResearchPackageHandoff): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const metadata = (handoff as any).synthesis_metadata;

  if (!metadata) return warnings;

  // Synthesis run ID format
  if (!metadata.synthesis_run_id || !metadata.synthesis_run_id.startsWith("syn_")) {
    warnings.push({
      code: "METADATA_FORMAT_INVALID",
      field: "synthesis_metadata.synthesis_run_id",
      message: "synthesis_run_id should be non-empty string starting with 'syn_'",
    });
  }

  // Timestamp validity
  if (!metadata.synthesis_timestamp || isNaN(Date.parse(metadata.synthesis_timestamp))) {
    warnings.push({
      code: "METADATA_FORMAT_INVALID",
      field: "synthesis_metadata.synthesis_timestamp",
      message: "synthesis_timestamp must be valid ISO 8601 timestamp",
    });
  }

  // Count consistency (basic sanity check)
  const totalCounts =
    (metadata.verified_facts_count || 0) +
    (metadata.inferred_facts_count || 0) +
    (metadata.unknown_count || 0);

  if (metadata.total_claims && totalCounts !== metadata.total_claims) {
    warnings.push({
      code: "METADATA_COUNT_MISMATCH",
      field: "synthesis_metadata",
      message: `Count mismatch: verified(${metadata.verified_facts_count}) + inferred(${metadata.inferred_facts_count}) + unknown(${metadata.unknown_count}) = ${totalCounts}, but total_claims = ${metadata.total_claims}`,
    });
  }

  // Non-negative counts
  if (
    (metadata.verified_facts_count ?? 0) < 0 ||
    (metadata.inferred_facts_count ?? 0) < 0 ||
    (metadata.unknown_count ?? 0) < 0 ||
    (metadata.contradictions_count ?? 0) < 0 ||
    (metadata.total_claims ?? 0) < 0
  ) {
    warnings.push({
      code: "METADATA_INVALID_VALUE",
      field: "synthesis_metadata",
      message: "Counts must be non-negative",
    });
  }

  return warnings;
}

// --- Data Quality Warnings ---

function validateDataQuality(handoff: ResearchPackageHandoff): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  const evidenceMap = new Map(handoff.evidence.map((e) => [e.evidence_id, e]));
  const usedSources = new Set<string>();

  // Track which sources are actually used
  for (const e of handoff.evidence) {
    usedSources.add(e.source_id);
  }

  // Unused sources warning
  for (const source of handoff.sources) {
    if (!usedSources.has(source.source_id)) {
      warnings.push({
        code: "UNUSED_SOURCE",
        field: `sources[*].${source.source_id}`,
        message: `Source "${source.source_id}" (${source.origin}) not referenced by any evidence`,
      });
    }
  }

  // Unused evidence warning
  for (const evidence of handoff.evidence) {
    let usedByClaimsCount = 0;
    for (const claim of handoff.claims) {
      if (claim.evidence_refs.includes(evidence.evidence_id)) {
        usedByClaimsCount++;
      }
    }

    if (usedByClaimsCount === 0) {
      warnings.push({
        code: "UNUSED_EVIDENCE",
        field: `evidence[*].${evidence.evidence_id}`,
        message: `Evidence "${evidence.evidence_id}" not referenced by any claim`,
      });
    }
  }

  // Verification imbalance warning
  const verificationStatusCounts = {
    VERIFIED: 0,
    INFERRED: 0,
    UNKNOWN: 0,
  };

  for (const v of handoff.verifications) {
    verificationStatusCounts[v.status as keyof typeof verificationStatusCounts]++;
  }

  const unknownRatio =
    handoff.verifications.length > 0
      ? verificationStatusCounts.UNKNOWN / handoff.verifications.length
      : 0;

  if (unknownRatio > 0.5) {
    warnings.push({
      code: "HIGH_UNKNOWN_RATIO",
      field: "verifications",
      message: `${(unknownRatio * 100).toFixed(1)}% of verifications are UNKNOWN (>50% threshold)`,
    });
  }

  return warnings;
}
