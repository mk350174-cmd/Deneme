// B00 — Provenance Tracking
//
// Defines ProvenanceRef: tracks how a fact became canonical.
// SEPARATE from EvidenceRef (which tracks data source/backing).
//
// Evidence answers: "Where did this data come from?"
// Provenance answers: "Who decided this fact became canonical?"
//
// Example claim: "YouTube is primary channel"
// - Evidence: EvidenceRef pointing to audit that found YouTube presence (VERIFIED)
// - Provenance: ProvenanceRef tracking that user approved this as canonical decision

import type { EvidenceRef } from "../types/entities.js";

export type ProvenanceType = "OBSERVED" | "INFERRED" | "RECOMMENDED" | "DECIDED" | "CANONICAL";

/** Tracks the decision chain that made a fact canonical.
 *  OBSERVED = Direct audit/data collection (fact comes from observation)
 *  INFERRED = Derived from observation (analysis of data)
 *  RECOMMENDED = Agent analysis + suggestion (not yet decided)
 *  DECIDED = User approved this fact as canonical (makes it truth)
 *  CANONICAL = Stored in version-controlled state (immutable until next version)
 */
export interface ProvenanceRef {
  id?: string;

  /** OBSERVED | INFERRED | RECOMMENDED | DECIDED | CANONICAL */
  type: ProvenanceType;

  /** Who made the decision (user email, system name, agent name, etc.)
   *  For OBSERVED/INFERRED: source system name
   *  For RECOMMENDED: agent name
   *  For DECIDED: user email or identifier
   *  For CANONICAL: user email (approval for this version) */
  decision_authority: string;

  /** ISO 8601 timestamp when this became canonical (or when decision was made) */
  timestamp: string;

  /** If this provenance came from agent recommendation, link to the recommendation.
   *  Allows tracing: RECOMMENDED → DECIDED → CANONICAL chain. */
  related_recommendation_id?: string;

  /** If this provenance links back to a DECIDED item (when tracking CANONICAL).
   *  Enables audit trail reconstruction: DECIDED ← CANONICAL. */
  related_decision_id?: string;

  /** If this is part of a chain update, link to previous provenance event. */
  prior_provenance_id?: string;

  /** The exact subject explained by this provenance record. Optional only for
   *  legacy/transient refs; canonical governance writes populate these. */
  subject_id?: string;
  subject_type?: string;
  subject_version?: string;
  subject_content_hash?: string;

  /** Evidence/source refs used by the transformation/decision. */
  source_evidence_refs?: string[];
  transformation?: string;

  /** Why this decision was made. Rationale for user decisions, source for observations. */
  rationale?: string;

  /** For CANONICAL items: marks immutability until next version.
   *  Signals that this fact cannot be modified without version increment. */
  cannot_change_until_next_version?: boolean;
}


/** Bind a provenance event to the exact artifact it explains. */
export function bindProvenanceToSubject(
  provenance: ProvenanceRef,
  subject: { object_id: string; object_type: string; object_version: string; object_content_hash: string },
  sourceEvidenceRefs: readonly string[] = [],
  transformation?: string
): ProvenanceRef {
  return {
    ...provenance,
    subject_id: subject.object_id,
    subject_type: subject.object_type,
    subject_version: subject.object_version,
    subject_content_hash: subject.object_content_hash,
    source_evidence_refs: [...sourceEvidenceRefs],
    transformation,
  };
}

export interface ProvenanceValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateSubjectBoundProvenance(value: unknown): ProvenanceValidationResult {
  if (typeof value !== "object" || value === null) return { valid: false, errors: ["MALFORMED_PROVENANCE"] };
  const ref = value as ProvenanceRef;
  const errors: string[] = [];
  if (!ref.type || !ref.decision_authority || !ref.timestamp) errors.push("MISSING_CORE_PROVENANCE_FIELDS");
  if (!ref.subject_id || !ref.subject_type || !ref.subject_version || !ref.subject_content_hash) {
    errors.push("MISSING_SUBJECT_BINDING");
  }
  return { valid: errors.length === 0, errors };
}

/** Full provenance chain tracking OBSERVATION → EVIDENCE → ANALYSIS → RECOMMENDATION → DECISION → CANONICAL.
 *  Enables complete audit trail reconstruction: where did the claim come from, who analyzed it, who decided it. */
export interface ProvenanceChain {
  /** Direct observation (OBSERVED). Where the original fact/data came from. */
  initial_observation: ProvenanceRef;

  /** Analytical inferences (INFERRED). Derivations from the observation. May be multiple layers. */
  inferences: ProvenanceRef[];

  /** Agent recommendation (RECOMMENDED). Null until agent evaluates; null until user approval. */
  recommendation: ProvenanceRef | null;

  /** User decision (DECIDED). Null until user explicitly approves. Records user authority + approval timestamp. */
  decision: ProvenanceRef | null;

  /** Versioned canonical state (CANONICAL). Null until committed to version. Records immutability marker. */
  canonical: ProvenanceRef | null;
}

export interface CanonicalClaim<T = unknown> {
  value: T;
  evidence: EvidenceRef[];
  provenance: ProvenanceRef;
  evidence_status: "VERIFIED" | "INFERRED" | "UNKNOWN";
  confidence: number;
}

export function isTruthMakingProvenance(type: ProvenanceType): boolean {
  return type === "DECIDED" || type === "CANONICAL";
}

export function makeCanonicalClaim<T = unknown>(
  value: T,
  evidence: EvidenceRef[],
  provenance: ProvenanceRef,
  evidence_status: "VERIFIED" | "INFERRED" | "UNKNOWN",
  confidence: number
): CanonicalClaim<T> {
  return {
    value,
    evidence,
    provenance,
    evidence_status,
    confidence,
  };
}

/**
 * Reconstructs the real, ordered provenance chain for one item by walking
 * `prior_provenance_id` links backward from the given `itemLatestRefId`
 * (or, if omitted, from whichever ref in `allRefs` has no other ref pointing
 * to it as a prior — i.e. the newest event) through `allRefs`.
 *
 * This produces the chain from ACTUAL recorded events only. It never
 * fabricates placeholder entries: if a link in the chain is missing (a
 * `prior_provenance_id` that doesn't resolve to any ref in `allRefs`), the
 * walk stops there and `truncated` reports it, rather than inventing a
 * synthetic "initial_observation" as prior implementations did.
 *
 * Deterministic: identical `allRefs`/`itemLatestRefId` always produce the
 * same ordered result — no reliance on array insertion order beyond what's
 * encoded in the `prior_provenance_id` links themselves.
 */
export interface ReconstructedProvenanceChain {
  /** Ordered oldest -> newest. Only refs that were actually found in `allRefs`. */
  events: ProvenanceRef[];
  /** True if the walk stopped early because a `prior_provenance_id` did not
   *  resolve to any ref present in `allRefs` (a genuine gap in the record,
   *  not fabricated data). */
  truncated: boolean;
}

export function reconstructProvenanceChain(
  itemLatestRefId: string,
  allRefs: readonly ProvenanceRef[]
): ReconstructedProvenanceChain {
  const byId = new Map<string, ProvenanceRef>();
  for (const ref of allRefs) {
    if (ref.id) byId.set(ref.id, ref);
  }

  const startRef = byId.get(itemLatestRefId);
  if (!startRef) {
    return { events: [], truncated: true };
  }

  const chainNewestFirst: ProvenanceRef[] = [startRef];
  let truncated = false;
  let cursor: ProvenanceRef = startRef;
  const visited = new Set<string>([itemLatestRefId]);

  while (cursor.prior_provenance_id) {
    const prior = byId.get(cursor.prior_provenance_id);
    if (!prior) {
      truncated = true;
      break;
    }
    if (prior.id && visited.has(prior.id)) {
      // Cycle detected (malformed data) — stop rather than loop forever.
      truncated = true;
      break;
    }
    chainNewestFirst.push(prior);
    if (prior.id) visited.add(prior.id);
    cursor = prior;
  }

  return { events: chainNewestFirst.reverse(), truncated };
}

/** Bind legacy/unbound phase provenance to an explicit containing artifact.
 * Existing more-specific subject bindings are preserved. */
export function bindUnboundProvenanceRefs(
  refs: readonly ProvenanceRef[],
  subject: { object_id: string; object_type: string; object_version: string; object_content_hash: string },
  sourceEvidenceRefs: readonly string[] = [],
  transformation = "module_candidate_to_canonical"
): ProvenanceRef[] {
  return refs.map((ref) => ref.subject_id ? ref : bindProvenanceToSubject(ref, subject, ref.source_evidence_refs ?? sourceEvidenceRefs, transformation));
}
