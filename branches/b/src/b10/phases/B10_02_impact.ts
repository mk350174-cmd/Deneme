// B10.02 — Deterministic, explainable impact assessment (no hash-selected semantics)
import type { ImpactAssessment, OptimizationProposal, B10Deps } from "../types.js";
import { canonicalHasher } from "../../b00/hashing.js";

const DOWNSTREAM: Record<string, string[]> = {
  B01:["B02","B03","B04","B05","B06","B08","B12"], B02:["B04","B12"], B03:["B04","B05","B06","B12"],
  B04:["B05","B06","B07","B12"], B05:["B12"], B06:["B07","B08","B09","B12"], B07:["B08","B12"],
  B08:["B09","B12"], B09:["B10","B12"], B10:["B11","B12"], B11:["B12"], B12:[],
};
function normalizedModule(moduleId:string): string { const m=moduleId.toUpperCase(); return /^B\d{2}$/.test(m) ? m : "UNKNOWN"; }
function deriveRisk(proposal:OptimizationProposal, affected:string[]): {level:"low"|"medium"|"high";reason:string} {
  if (proposal.target_module.toUpperCase()==="B00" || proposal.target_module.toUpperCase()==="B11") return {level:"high",reason:"Change targets governance/compliance semantics and therefore requires heightened review"};
  if (affected.length >= 5) return {level:"high",reason:`Dependency graph shows broad downstream blast radius (${affected.length} modules)`};
  if (affected.length >= 2) return {level:"medium",reason:`Dependency graph shows multiple downstream consumers (${affected.join(", ")})`};
  return {level:"low",reason:"Dependency graph indicates limited downstream blast radius; domain risk still requires owner review"};
}
export function assessProposalImpact(proposals:OptimizationProposal[], deps?:B10Deps):ImpactAssessment[] {
  const hash=deps?.hash||createDefaultB10Deps().hash!; const now=deps?.now||(()=>new Date().toISOString());
  return proposals.map((proposal)=>{
    const target=normalizedModule(proposal.target_module);
    const affected=target==="UNKNOWN" ? [] : Array.from(new Set([target,...(DOWNSTREAM[target]||[])]));
    const risk=deriveRisk(proposal,affected);
    const benefit=Math.max(0,Math.min(1,proposal.confidence));
    return { assessment_id:hash.stableAssessmentId(proposal.proposal_id), proposal_id:proposal.proposal_id, risk_level:risk.level, risk_reason:risk.reason,
      benefit_score:benefit, benefit_reason:`Benefit score inherits proposal confidence (${proposal.confidence.toFixed(2)}) and is not an observed realized benefit`,
      affected_modules:affected, affected_modules_basis:"DEPENDENCY_GRAPH", evidence_refs:proposal.evidence_refs,
      provenance:{type:"INFERRED",decision_authority:"B10_02:assessProposalImpact",timestamp:now(),rationale:"Risk and blast radius derived from explicit proposal semantics and the B-Branch dependency graph; no pseudo-random/hash selection"} };
  });
}
function createDefaultB10Deps():B10Deps { return {hash:{stableProposalId:(m,p)=>`opt_${canonicalHasher.hash(`${m}:${p}`).slice(0,32)}`,stableAssessmentId:(p)=>`assess_${canonicalHasher.hash(p).slice(0,32)}`},now:()=>new Date().toISOString()}; }
