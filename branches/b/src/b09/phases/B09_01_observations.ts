import { externalObservations, eligibleExternalReview } from "../../b08/external/context.js";
import { createArtifactBinding } from "../../b00/identity.js";
import { bindProvenanceToSubject } from "../../b00/provenanceRef.js";
// B09.01 — Actual Observations + Operational Gaps
// Learning observations originate only from validated REAL B08 analytics results.
import type { LearningObservation, OperationalGap } from "../types.js";
import type { B08CandidateState, B08CanonicalState, AnalyticsResult } from "../../b08/types.js";
import { validateAnalyticsResult } from "../../b08/execution.js";
import { validateEvidenceSemantics } from "../../b00/evidence.js";
import type { B06CandidateState, B06CanonicalState } from "../../b06/types.js";


export function isLearningEligibleAnalyticsResult(
  result: AnalyticsResult,
  b08State: B08CandidateState | B08CanonicalState,
): boolean {
  if (result.source_mode !== "REAL" || !(result.state === "VALIDATED" || result.state === "USABLE")) return false;
  if (!validateAnalyticsResult(result, b08State.metrics || []).valid) return false;
  return (result.evidence_refs || []).some((e) => {
    const validation = validateEvidenceSemantics(e);
    return validation.valid && validation.normalized_status === "VERIFIED" && e.source_mode === "REAL" && e.production_eligible !== false;
  });
}

export function generateLearningObservations(b08State:B08CandidateState|B08CanonicalState,_b06State:B06CandidateState|B06CanonicalState,deps?:{hash?:{stableObservationId:(type:string,module:string)=>string};now?:()=>string}):LearningObservation[]{
  const stable=deps?.hash?.stableObservationId||((t:string,m:string)=>`obs_${t}_${m}`.toLowerCase());
  return (b08State.analytics_results||[])
    .filter((r)=>isLearningEligibleAnalyticsResult(r,b08State))
    .map((r)=>({
      observation_id:stable("metric_observation",`${r.result_id}:${r.metric_id}`), observation_type:"metric_observation" as const, observation_kind:"ACTUAL" as const,
      observed_at:r.period_end, source_analytics_result_id:r.result_id,
      description:`Observed ${r.metric_id}: ${r.value} ${r.unit}`, magnitude:Math.min(1,Math.abs(r.value)/(Math.abs(r.value)+1)), magnitude_basis:"OBSERVED_VALUE" as const,
      affected_module:"B08", evidence_refs:r.evidence_refs,
      provenance:{type:"OBSERVED" as const,decision_authority:"B09_01:generateLearningObservations",timestamp:deps?.now?.()||new Date().toISOString(),rationale:`Validated REAL analytics result ${r.result_id}`},
    }));
}

export function identifyOperationalGaps(b08State:B08CandidateState|B08CanonicalState,b06State:B06CandidateState|B06CanonicalState,deps?:{now?:()=>string}):OperationalGap[]{
  const now=deps?.now?.()||new Date().toISOString(); const gaps:OperationalGap[]=[];
  if (!(b08State.workflows||[]).length) gaps.push({gap_id:"opgap_b08_workflows",affected_module:"B08",description:"No analytics workflow definitions are present",evidence_refs:[],provenance:{type:"INFERRED",decision_authority:"B09_01:identifyOperationalGaps",timestamp:now,rationale:"Configuration gap; not a performance observation"}});
  if (!(b08State.analytics_results||[]).some((r)=>isLearningEligibleAnalyticsResult(r,b08State))) gaps.push({gap_id:"opgap_b08_actual_data",affected_module:"B08",description:"No validated REAL analytics results are available for learning",evidence_refs:[],provenance:{type:"INFERRED",decision_authority:"B09_01:identifyOperationalGaps",timestamp:now,rationale:"Operational data gap; not a performance observation"}});
  if (!(b06State.distribution_strategies||[]).length) gaps.push({gap_id:"opgap_b06_distribution",affected_module:"B06",description:"No distribution strategies are defined",evidence_refs:[],provenance:{type:"INFERRED",decision_authority:"B09_01:identifyOperationalGaps",timestamp:now,rationale:"Configuration gap; not a performance observation"}});
  return gaps;
}

/** Reviewed external reports are observations of source content, not causal or
 * population-level findings. No strength number is manufactured from text. */
export function generateExternalLearningObservations(b08State:B08CandidateState|B08CanonicalState):LearningObservation[] {
  const context=b08State.external_intelligence;
  if(!context) return [];
  return externalObservations(context,["AudienceObservation","CommunityObservation","TrendObservation","CompetitiveObservation","PerformanceObservation"])
    .flatMap(o=>{
      const review=eligibleExternalReview(o,context);
      if(!review) return [];
      const types = {AudienceObservation:"external_audience",CommunityObservation:"external_community",TrendObservation:"external_trend",CompetitiveObservation:"external_competitive",PerformanceObservation:"metric_observation"} as const;
      const body = {observation_id:`learn_${o.observation_id}`,observation_type:types[o.kind],observation_kind:"ACTUAL" as const,
        observed_at:o.observed_at,source_external_observation_id:o.observation_id,
        description:`Independently reviewed source report (not a causal finding): ${o.statement}`,magnitude_basis:"UNKNOWN" as const,
        affected_module:o.kind === "AudienceObservation" || o.kind === "CommunityObservation" ? "B03" : o.kind === "PerformanceObservation" ? "B07" : "B02",
        evidence_refs:[...o.evidence_refs,...review.evidence_refs]};
      return [{...body,provenance:bindProvenanceToSubject({type:"OBSERVED",decision_authority:"B09:externalReview",timestamp:review.reviewed_at,
        prior_provenance_id:o.provenance.id,rationale:`External observation ${o.observation_id} has an exact-bound independent confirmation review`},
        createArtifactBinding(body,body.observation_id,"B09_LEARNING_OBSERVATION","v1"),body.evidence_refs.map(e=>e.id),"reviewed_external_observation_to_learning")}];
    });
}
