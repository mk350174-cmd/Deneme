import { canonicalHasher } from "../../b00/hashing.js";
import { createArtifactBinding, parentReferenceFromIdentity } from "../../b00/identity.js";
import { isApprovedForArtifact } from "../../b00/governance.js";
import { validateEvidenceSemantics } from "../../b00/evidence.js";
import { validateExternalResult, validTime } from "./adapter.js";
import type { ExternalIntelligenceContext, ExternalObservation, ExternalObservationReview, ObservationKind } from "./types.js";

/** Callers explicitly supply project scope; malformed/cross-project results fail
 * closed. Non-real fixtures remain auditable in B08 but have no consumer path. */
export function externalObservations(context: ExternalIntelligenceContext | undefined, kinds: readonly ObservationKind[], channelId?: string): ExternalObservation[] {
  if (!context) return [];
  if (!context.project_id || !Array.isArray(context.results)) throw new Error("INVALID_EXTERNAL_CONTEXT");
  for (const result of context.results) {
    if (!validateExternalResult(result) || result.request.project_id !== context.project_id) throw new Error("INVALID_OR_CROSS_PROJECT_EXTERNAL_RESULT");
  }
  return [...new Map(context.results.filter(r=>r.status === "EXECUTED_REAL" && r.source_mode === "REAL")
    .flatMap(r=>r.observations).filter(o=>kinds.includes(o.kind) && (channelId === undefined || o.channel_id === channelId))
    .map(o=>[o.observation_id,structuredClone(o)])).values()];
}
export function externalLineage(context?: ExternalIntelligenceContext) {
  externalObservations(context,[]);
  return context?.results.map(r=>parentReferenceFromIdentity("B08",r.identity,"external_intelligence_input")) ?? [];
}
export function externalProvenance(context?: ExternalIntelligenceContext) {
  externalObservations(context,[]);
  return context?.results.filter(r=>r.source_mode === "REAL" && r.status === "EXECUTED_REAL").flatMap(r=>structuredClone(r.provenance)) ?? [];
}
export function externalReviewBinding(review: ExternalObservationReview) {
  return createArtifactBinding(review,`review:${review.observation_id}`,"B08_EXTERNAL_REVIEW","v1");
}
export function eligibleExternalReview(observation: ExternalObservation, context: ExternalIntelligenceContext): ExternalObservationReview | undefined {
  if (observation.source_mode !== "REAL") return undefined;
  return context.reviews?.find(review=>{
    try {
      if (review.observation_id !== observation.observation_id || review.observation_content_hash !== canonicalHasher.hashValue(observation)
        || !review.authority.trim() || !validTime(review.reviewed_at) || !review.evidence_refs.length) return false;
      // Independent confirmation must not merely reuse the retrieval evidence.
      if (!review.evidence_refs.every(e=>validateEvidenceSemantics(e).valid && e.status === "VERIFIED" && e.source_mode === "REAL"
        && e.production_eligible !== false && !observation.evidence_refs.some(raw=>raw.id === e.id))) return false;
      const binding=externalReviewBinding(review);
      return isApprovedForArtifact(review.governance_events,binding) && review.governance_events.some(e=>e.state === "APPROVED" && e.provenance.decision_authority === review.authority);
    } catch { return false; }
  });
}
