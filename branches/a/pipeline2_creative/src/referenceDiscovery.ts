// P2.01 Reference Discovery — new, no source equivalent. Per the
// architecture doc: "suggest a small candidate set, ask the user which ones
// to inspect, analyze only the selected references, let the user add
// references manually." This module never invents reference candidates,
// creative facts, or research — it only organizes/evaluates explicitly
// supplied inputs or existing approved references.

import { stableCandidateId, stableObservationId, stableReferenceId } from "./ids.js";
import { redactSecrets } from "./secretGuard.js";
import type { Observation, Reference, ReferenceCandidate, ReferenceCandidateSeed } from "./types.js";

/**
 * Assigns stable ids to caller-supplied candidate seeds. An empty seed list
 * returns an empty candidate list — never a guessed/invented candidate.
 */
export function suggestCandidates(seeds: ReferenceCandidateSeed[]): ReferenceCandidate[] {
  return seeds.map((seed) => ({
    candidate_id: stableCandidateId(seed.label),
    label: seed.label,
    rationale: seed.rationale,
  }));
}

/**
 * Turns user-approved candidate ids + any manually-added sources +
 * user_candidate_references into References.
 *
 * P2.01 Improvement (P2-A): User-seeded reference discovery. When
 * user_candidate_references is supplied, these references take precedence
 * and are merged with system-suggested candidates. This allows users to
 * guide the reference universe BEFORE creative analysis starts.
 *
 * Selection rules:
 * 1. User-provided references (user_candidate_references) are included as-is
 * 2. System-suggested candidates are included if their IDs are in approvedCandidateIds
 * 3. Manually-added sources are included as-is
 * 4. Final reference set = user references + approved system candidates + manual sources
 */
export function selectReferences(params: {
  candidates: ReferenceCandidate[];
  approvedCandidateIds: string[];
  manuallyAddedSources: string[];
  user_candidate_references?: Reference[]; // P2-A: user-provided seed references
}): Reference[] {
  const byId = new Map(params.candidates.map((c) => [c.candidate_id, c]));
  const approved = new Set(params.approvedCandidateIds);

  // P2-A: Include user-provided references first (highest priority)
  const userProvided: Reference[] = params.user_candidate_references ?? [];

  // System-suggested candidates: only if explicitly approved
  const fromCandidates: Reference[] = params.approvedCandidateIds
    .filter((id) => byId.has(id))
    .map((id) => ({
      reference_id: stableReferenceId(byId.get(id)!.label),
      candidate_id: id,
      source: byId.get(id)!.label,
      approved: approved.has(id),
    }));

  // Manually-added sources
  const manual: Reference[] = params.manuallyAddedSources.map((source) => ({
    reference_id: stableReferenceId(source),
    source,
    approved: true,
  }));

  // Merge: user references + system candidates + manual sources
  return [...userProvided, ...fromCandidates, ...manual];
}

/**
 * Records an observation the user makes about an approved reference.
 * Content is redacted for secrets before storage (same discipline as P1).
 * This only structures what the user/caller supplies — no analysis is
 * fabricated here.
 */
export function recordObservation(reference: Reference, dimension: string, content: string): Observation {
  return {
    observation_id: stableObservationId(reference.reference_id, dimension),
    reference_id: reference.reference_id,
    dimension,
    content: redactSecrets(content),
  };
}
