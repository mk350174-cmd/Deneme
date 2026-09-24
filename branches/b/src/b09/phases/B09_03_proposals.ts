// B09.03 — Learning proposals and executable feedback rules
import type { LearningProposal, LearningSignal, FeedbackRule } from "../types.js";
export function generateLearningProposals(signals:LearningSignal[],deps?:{hash?:{stableProposalId:(module:string,type:string)=>string};now?:()=>string}):LearningProposal[]{
  const stable=deps?.hash?.stableProposalId||((m:string,t:string)=>`prop_${m}_${t}`.toLowerCase()); const now=deps?.now?.()||new Date().toISOString();
  return [...externalReviewProposals(signals, now), ...signals.filter((s)=>s.signal_type==="negative_signal").map((signal)=>({proposal_id:stable("B-Branch",`performance_optimization:${signal.signal_id}`),proposal_type:"performance_optimization" as const,target_module:"B08",description:`Investigate and address negative signal: ${signal.description}`,confidence:signal.severity==="high"?0.8:0.6,confidence_basis:"SIGNAL_CHAIN" as const,supporting_signals:[signal.signal_id],evidence_refs:signal.evidence_refs,provenance:{type:"RECOMMENDED" as const,decision_authority:"B09_03:generateLearningProposals",timestamp:now,rationale:"Proposal derives from an actual-observation signal chain"}}))];
}
export function generateFeedbackRules(signals:LearningSignal[],deps?:{now?:()=>string}):FeedbackRule[]{
  const now=deps?.now?.()||new Date().toISOString();
  return signals.filter((s)=>s.signal_type==="negative_signal").map((s)=>({rule_id:`fb_${s.signal_id}`,rule_type:"optimization_candidate" as const,condition:`signal_id == ${s.signal_id} AND signal_type == negative_signal`,action:"Create a B10 optimization proposal bound to this signal",priority:s.severity,evidence_refs:s.evidence_refs,provenance:{type:"INFERRED" as const,decision_authority:"B09_03:generateFeedbackRules",timestamp:now,rationale:"Deterministic feedback rule from an actual learning signal"}}));
}

function externalReviewProposals(signals:LearningSignal[],now:string):LearningProposal[] {
  return signals.filter(s=>s.interpretation_basis === "EXTERNAL_REVIEWED_OBSERVATION").map(s=>({
    proposal_id:`review_prop_${s.signal_id}`,proposal_type:"strategy_refinement",target_module:"B08",
    description:`Assess relevance of reviewed external report before selecting any strategic change: ${s.description}`,
    confidence:0,confidence_basis:"HEURISTIC",supporting_signals:[s.signal_id],evidence_refs:s.evidence_refs,
    provenance:{type:"RECOMMENDED",decision_authority:"B09:externalReviewProposal",timestamp:now,
      rationale:"Review-only candidate. Impact, causality and improvement confidence are unknown; zero is an explicit non-confidence default."}
  }));
}
