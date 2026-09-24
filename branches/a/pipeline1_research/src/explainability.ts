// Small-improvements addition (C1) — P1.04 explainability layer. Purely
// structuring: reorganizes fields already present on the Claim/Verification
// it's given (claim.statement, claim.evidence_refs, claim.contradiction_refs,
// verification.rationale/unresolved_reason/contradiction_relationship) into
// a small, separate, human-readable explanation. Never fabricates new
// judgments, never touches Verification's own schema or its enforcement in
// verification.ts.

import type { Claim, Verification, VerificationExplanation } from "./types.js";

export function buildVerificationExplanation(
  verification: Verification,
  claim: Claim,
): VerificationExplanation | undefined {
  // A VERIFIED claim already has non-empty evidence_refs and no
  // unresolved_reason — there is nothing uncertain to explain. Returning
  // an explanation anyway would mean either an empty, noise-adding record,
  // or inventing content to fill it — both are refused.
  if (verification.status === "VERIFIED") {
    return undefined;
  }

  const known: string[] = [];
  const unknown: string[] = [];

  if (claim.evidence_refs.length > 0) {
    known.push(`Evidence attached: ${claim.evidence_refs.join(", ")}`);
  } else {
    unknown.push(`No evidence has been attached to claim "${claim.claim_id}"`);
  }

  if (verification.status === "INFERRED") {
    known.push(`Verification rationale: ${verification.rationale}`);
  }

  if (verification.status === "UNKNOWN") {
    unknown.push(claim.statement);
  }

  const missing_evidence = claim.evidence_refs.length === 0 ? [claim.statement] : [];

  const source_conflicts = claim.contradiction_refs.map(
    (refId) => `Conflicts with claim "${refId}" (contradiction_relationship: ${verification.contradiction_relationship})`,
  );

  const uncertainty_reason = verification.unresolved_reason?.trim() || verification.rationale;

  const follow_up_research_questions =
    missing_evidence.length > 0 ? [`What evidence would substantiate: "${claim.statement}"?`] : [];

  return {
    verification_id: verification.verification_id,
    known,
    unknown,
    uncertainty_reason,
    missing_evidence,
    source_conflicts,
    follow_up_research_questions,
  };
}
