// B00 — Authoritative Governance State Machine
//
// Governance is separate from EvidenceStatus and ProvenanceType. Every write is
// validated against the entire supplied history and every approval/canonical
// event can bind to an exact object/version/content hash.

import type { ProvenanceRef, ProvenanceType } from "./provenanceRef.js";
import { bindProvenanceToSubject } from "./provenanceRef.js";
import { canonicalHasher } from "./hashing.js";
import type { ArtifactBinding } from "./identity.js";

export type GovernanceState =
  | "PROPOSED"
  | "APPROVED"
  | "REJECTED"
  | "REVOKED"
  | "SUPERSEDED"
  | "CANONICAL";

export const LEGAL_GOVERNANCE_TRANSITIONS: Readonly<Record<GovernanceState, readonly GovernanceState[]>> = {
  PROPOSED: ["APPROVED", "REJECTED"],
  APPROVED: ["REVOKED", "SUPERSEDED", "CANONICAL"],
  REJECTED: ["APPROVED"],
  REVOKED: ["APPROVED"],
  SUPERSEDED: [],
  CANONICAL: [],
};

export function validateTransition(from: GovernanceState | undefined, to: GovernanceState): boolean {
  if (from === undefined) return to === "PROPOSED";
  return LEGAL_GOVERNANCE_TRANSITIONS[from].includes(to);
}

export class GovernanceTransitionError extends Error {
  constructor(public readonly itemId: string, public readonly from: GovernanceState | undefined, public readonly to: GovernanceState, public readonly reason = "ILLEGAL_TRANSITION") {
    super(`Illegal governance transition for item "${itemId}": ${from ?? "(none)"} -> ${to} (${reason})`);
    this.name = "GovernanceTransitionError";
  }
}

export class GovernanceHistoryError extends Error {
  constructor(public readonly itemId: string, public readonly errors: readonly string[]) {
    super(`Invalid governance history for item "${itemId}": ${errors.join(", ")}`);
    this.name = "GovernanceHistoryError";
  }
}

export interface GovernanceEvent {
  id: string;
  item_id: string;
  state: GovernanceState;
  provenance: ProvenanceRef;
  /** Exact artifact binding for lifecycle events that depend on artifact identity. */
  artifact?: ArtifactBinding;
}

const PROVENANCE_TYPE_FOR_STATE: Record<GovernanceState, ProvenanceType> = {
  PROPOSED: "RECOMMENDED",
  APPROVED: "DECIDED",
  REJECTED: "DECIDED",
  REVOKED: "DECIDED",
  SUPERSEDED: "DECIDED",
  CANONICAL: "CANONICAL",
};

export interface GovernanceTransitionInput {
  itemId: string;
  history: readonly GovernanceEvent[];
  authority: string;
  timestamp: string;
  rationale?: string;
  artifact?: ArtifactBinding;
  /** Canonical B-Branch approval/canonical writes set this true. Optional only
   *  to keep legacy/transient lifecycle use non-breaking. */
  requireArtifactBinding?: boolean;
  sourceEvidenceRefs?: readonly string[];
}

export interface GovernanceTransitionResult { event: GovernanceEvent; history: GovernanceEvent[]; }
export interface GovernanceHistoryValidation { valid: boolean; errors: string[]; }

function currentState(history: readonly GovernanceEvent[]): GovernanceState | undefined {
  return history[history.length - 1]?.state;
}

function sameBinding(a: ArtifactBinding | undefined, b: ArtifactBinding | undefined): boolean {
  return Boolean(a && b &&
    a.object_id === b.object_id &&
    a.object_type === b.object_type &&
    a.object_version === b.object_version &&
    a.object_content_hash === b.object_content_hash);
}

/** Validate history, not just the last state. This prevents a fabricated
 * terminal record or a broken prior-provenance chain from being accepted. */
export function validateGovernanceHistory(itemId: string, history: readonly GovernanceEvent[]): GovernanceHistoryValidation {
  const errors: string[] = [];
  let previous: GovernanceEvent | undefined;
  const ids = new Set<string>();
  for (let i = 0; i < history.length; i += 1) {
    const event = history[i]!;
    if (event.item_id !== itemId) errors.push(`ITEM_ID_MISMATCH@${i}`);
    if (!event.id || ids.has(event.id)) errors.push(`DUPLICATE_OR_MISSING_EVENT_ID@${i}`);
    if (event.id) ids.add(event.id);
    const expectedFrom = previous?.state;
    if (!validateTransition(expectedFrom, event.state)) errors.push(`ILLEGAL_HISTORY_TRANSITION:${expectedFrom ?? "NONE"}->${event.state}@${i}`);
    const expectedPrior = previous?.provenance.id;
    if ((event.provenance.prior_provenance_id ?? undefined) !== (expectedPrior ?? undefined)) errors.push(`BROKEN_PROVENANCE_LINK@${i}`);
    if (event.provenance.subject_id && event.provenance.subject_id !== (event.artifact?.object_id ?? itemId)) errors.push(`PROVENANCE_SUBJECT_MISMATCH@${i}`);
    previous = event;
  }
  return { valid: errors.length === 0, errors };
}

function appendTransition(input: GovernanceTransitionInput, toState: GovernanceState): GovernanceTransitionResult {
  const { itemId, history, authority, timestamp, rationale, artifact } = input;
  const historyValidation = validateGovernanceHistory(itemId, history);
  if (!historyValidation.valid) throw new GovernanceHistoryError(itemId, historyValidation.errors);
  const fromState = currentState(history);
  if (!validateTransition(fromState, toState)) throw new GovernanceTransitionError(itemId, fromState, toState);

  const needsBinding = input.requireArtifactBinding === true && (toState === "APPROVED" || toState === "CANONICAL");
  if (needsBinding && !artifact) throw new GovernanceTransitionError(itemId, fromState, toState, "MISSING_ARTIFACT_BINDING");
  if (artifact && artifact.object_id !== itemId) throw new GovernanceTransitionError(itemId, fromState, toState, "ARTIFACT_ITEM_ID_MISMATCH");

  // Canonicalization must refer to the exact approved artifact. A content,
  // version, object or type mismatch invalidates the approval.
  if (toState === "CANONICAL") {
    const approved = history[history.length - 1];
    if (approved?.state !== "APPROVED") throw new GovernanceTransitionError(itemId, fromState, toState, "MISSING_APPROVED_PRIOR_STATE");
    if (input.requireArtifactBinding && !sameBinding(approved.artifact, artifact)) {
      throw new GovernanceTransitionError(itemId, fromState, toState, "APPROVAL_BINDING_MISMATCH");
    }
  }

  const priorEvent = history[history.length - 1];
  const bindingSignature = artifact
    ? `${artifact.object_id}:${artifact.object_type}:${artifact.object_version}:${artifact.object_content_hash}`
    : "unbound";
  const eventId = `gov_${canonicalHasher.hash(`${itemId}:${toState}:${priorEvent?.provenance.id ?? "root"}:${authority}:${timestamp}:${bindingSignature}`).slice(0, 32)}`;
  let provenance: ProvenanceRef = {
    id: eventId,
    type: PROVENANCE_TYPE_FOR_STATE[toState],
    decision_authority: authority,
    timestamp,
    rationale,
    prior_provenance_id: priorEvent?.provenance.id,
  };
  if (artifact) {
    provenance = bindProvenanceToSubject(provenance, artifact, input.sourceEvidenceRefs ?? [], `governance:${toState.toLowerCase()}`);
  }
  const event: GovernanceEvent = { id: eventId, item_id: itemId, state: toState, provenance, artifact };
  return { event, history: [...history, event] };
}

export function proposeItem(input: GovernanceTransitionInput): GovernanceTransitionResult {
  if (input.history.length > 0) throw new GovernanceTransitionError(input.itemId, currentState(input.history), "PROPOSED");
  return appendTransition(input, "PROPOSED");
}
export function approveItem(input: GovernanceTransitionInput): GovernanceTransitionResult { return appendTransition(input, "APPROVED"); }
export function rejectItem(input: GovernanceTransitionInput): GovernanceTransitionResult { return appendTransition(input, "REJECTED"); }
export function revokeItem(input: GovernanceTransitionInput): GovernanceTransitionResult { return appendTransition(input, "REVOKED"); }
export function supersedeItem(input: GovernanceTransitionInput): GovernanceTransitionResult { return appendTransition(input, "SUPERSEDED"); }
export function canonicalizeItem(input: GovernanceTransitionInput): GovernanceTransitionResult { return appendTransition(input, "CANONICAL"); }
export function getCurrentState(history: readonly GovernanceEvent[]): GovernanceState | undefined { return currentState(history); }
export function canCanonicalize(history: readonly GovernanceEvent[]): boolean { return currentState(history) === "APPROVED"; }

/** Approval is valid only for the exact currently supplied artifact binding. */
export function isApprovedForArtifact(history: readonly GovernanceEvent[], binding: ArtifactBinding): boolean {
  if (!validateGovernanceHistory(binding.object_id, history).valid) return false;
  const last = history[history.length - 1];
  return last?.state === "APPROVED" && sameBinding(last.artifact, binding);
}

export function assertApprovedForArtifact(history: readonly GovernanceEvent[], binding: ArtifactBinding): void {
  if (!isApprovedForArtifact(history, binding)) {
    throw new GovernanceTransitionError(binding.object_id, currentState(history), "CANONICAL", "APPROVAL_BINDING_MISMATCH");
  }
}
