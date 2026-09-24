// B10.01 — Generate traceable, executable optimization decision artifacts
import type { OptimizationProposal, B10Deps } from "../types.js";
import type { LearningProposal } from "../../b09/types.js";
import { canonicalHasher } from "../../b00/hashing.js";

export function generateOptimizationProposals(learningProposals: LearningProposal[], deps?: B10Deps): OptimizationProposal[] {
  const hash = deps?.hash || createDefaultB10Deps().hash!;
  const now = deps?.now || (() => new Date().toISOString());
  return learningProposals
    .filter((lp) => lp.proposal_type === "strategy_refinement" || lp.proposal_type === "gap_closure" || lp.proposal_type === "performance_optimization")
    .map((lp) => {
      const proposal_id = hash.stableProposalId(lp.target_module, `${lp.proposal_type}:${lp.proposal_id}`);
      const observedProblem = lp.description;
      const proposedChange = `Review ${lp.target_module} and apply an owner-approved change that addresses B09 proposal ${lp.proposal_id}`;
      const expectedEffect = `Reduce or resolve the condition represented by B09 proposal ${lp.proposal_id}; effect remains unverified until post-change observations exist`;
      return {
        proposal_id,
        proposal_type: lp.proposal_type === "gap_closure" ? "gap_closure" : "strategy_refinement",
        target_module: lp.target_module,
        parameter_name: "owner_selected_change",
        current_state: "UNKNOWN: B10 does not fabricate the current strategic value",
        observed_problem: observedProblem,
        hypothesis: `A targeted change in ${lp.target_module} may improve the observed condition if B09's learning interpretation is causal`,
        proposed_change: proposedChange,
        expected_effect: expectedEffect,
        required_approval: true,
        proposal_basis: "LEARNING_SIGNAL",
        current_value: "UNKNOWN",
        proposed_value: proposedChange,
        confidence: Math.min(lp.confidence, 0.9),
        confidence_basis: lp.confidence_basis,
        expected_impact: expectedEffect,
        evidence_refs: lp.evidence_refs || [],
        provenance: { type:"RECOMMENDED", decision_authority:"B10_01:generateOptimizationProposals", timestamp:now(), rationale:`Decision artifact derived from B09 proposal ${lp.proposal_id}; no production mutation performed` },
      };
    });
}
function createDefaultB10Deps(): B10Deps { return { hash:{ stableProposalId:(m,p)=>`opt_${canonicalHasher.hash(`${m}:${p}`).slice(0,32)}`, stableAssessmentId:(p)=>`assess_${canonicalHasher.hash(p).slice(0,32)}` }, now:()=>new Date().toISOString() }; }
