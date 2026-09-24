// Evidence & Provenance Contract enforcement — architecture doc:
// "A Claim is invalid unless evidence_refs[] is non-empty, OR
// status == UNKNOWN AND unresolved_reason exists. No silent provenance
// gaps." This is schema-level enforcement, not a convention: callers cannot
// construct a package that violates it without hitting a ValidationError.

import { ValidationError } from "./errors.js";
import type { Claim, Verification } from "./types.js";

export function assertClaimHasProvenance(claim: Claim, verification: Verification): void {
  const hasEvidence = claim.evidence_refs.length > 0;
  const isExplicitUnknown =
    verification.status === "UNKNOWN" && Boolean(verification.unresolved_reason?.trim());

  if (!hasEvidence && !isExplicitUnknown) {
    throw new ValidationError(
      "P1.04",
      `claims[${claim.claim_id}].evidence_refs`,
      "Claim has no evidence_refs and is not an explicit UNKNOWN with unresolved_reason. " +
        "No silent provenance gaps are permitted.",
    );
  }

  if (verification.status === "UNKNOWN" && !verification.unresolved_reason?.trim()) {
    throw new ValidationError(
      "P1.04",
      `verifications[${verification.verification_id}].unresolved_reason`,
      "status is UNKNOWN but unresolved_reason is missing.",
    );
  }
}
