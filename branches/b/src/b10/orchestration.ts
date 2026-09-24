// B10 Orchestration — proposals only; production mutation is intentionally outside B10
import { canonicalHasher } from "../b00/hashing.js";
import { bindUnboundProvenanceRefs } from "../b00/provenanceRef.js";
import { proposeItem, approveItem, isApprovedForArtifact, type GovernanceTransitionInput, type GovernanceEvent } from "../b00/governance.js";
import { createArtifactBinding, createCanonicalIdentity, resolveParentReference } from "../b00/identity.js";
import type { B10CandidateState, B10CanonicalState, B10Deps, B10StatePersistence, OptimizationProposal, ImpactAssessment } from "./types.js";
import type { LearningProposal, B09CandidateState, B09CanonicalState } from "../b09/types.js";
import { generateOptimizationProposals } from "./phases/B10_01_proposals.js";
import { assessProposalImpact } from "./phases/B10_02_impact.js";
import { detectOptimizationConflicts, identifyOptimizationGaps, calculateOptimizationCompleteness } from "./phases/B10_03_validation.js";

export async function runB10(b09State:B09CandidateState|B09CanonicalState,deps?:B10Deps):Promise<B10CandidateState>{
 const d=deps||createDefaultB10Deps(), now=()=>d.now?.()||new Date().toISOString(); const learning:LearningProposal[]=b09State?.proposals||[];
 const proposals=generateOptimizationProposals(learning,d), assessments=assessProposalImpact(proposals,d); const conflicts=detectOptimizationConflicts(proposals.length,assessments.length), gaps=identifyOptimizationGaps(proposals.length,assessments.length), completeness=calculateOptimizationCompleteness(proposals.length,assessments.length,gaps);
 const evidence=Array.from(new Map([...proposals.flatMap(p=>p.evidence_refs),...assessments.flatMap(a=>a.evidence_refs)].map(e=>[e.id,e])).values());
 return { candidate_id:`cand_${canonicalHasher.stableCandidateId("b10",`${"candidate_id" in b09State?b09State.candidate_id:b09State.version}:${proposals.length}`)}`, parent_references:[resolveParentReference("B09",b09State,"learning_input")], created_at:now(), b09_version:"version" in b09State?b09State.version:b09State.b08_version, optimization_proposals:proposals, impact_assessments:assessments, conflicts_detected:conflicts,gaps,evidence_refs:evidence,provenance_refs:[...proposals.map(p=>p.provenance),...assessments.map(a=>a.provenance)],governance_events:{},all_recommendations:[],completeness };
}

function approveArtifact<T extends {provenance:any}>(artifact:T,id:string,type:string,candidateId:string,authority:string,now:()=>string):{artifact:T;events:GovernanceEvent[]} {
 const binding=createArtifactBinding(artifact,id,type,candidateId); const p=proposeItem({itemId:id,history:[],authority,timestamp:now(),rationale:`Proposed ${type}`});
 const a=approveItem({itemId:id,history:p.history,authority,timestamp:now(),rationale:`Approved exact ${type} artifact`,artifact:binding,requireArtifactBinding:true,sourceEvidenceRefs:(artifact as any).evidence_refs?.map((e:any)=>e.id)||[]});
 return {artifact:{...artifact,provenance:{...artifact.provenance,type:"DECIDED",decision_authority:authority,timestamp:now(),prior_provenance_id:a.event.provenance.id}},events:[p.event,a.event]};
}
export async function approveCandidate(candidate:B10CandidateState,userAuthority:string,deps?:B10Deps):Promise<B10CandidateState>{
 const d=deps||createDefaultB10Deps(),now=()=>d.now?.()||new Date().toISOString(), events:Record<string,GovernanceEvent[]>={};
 const proposals=candidate.optimization_proposals.map(p=>{const r=approveArtifact(p,p.proposal_id,"B10_OPTIMIZATION_PROPOSAL",candidate.candidate_id,userAuthority,now);events[p.proposal_id]=r.events;return r.artifact;});
 const assessments=candidate.impact_assessments.map(a=>{const r=approveArtifact(a,a.assessment_id,"B10_IMPACT_ASSESSMENT",candidate.candidate_id,userAuthority,now);events[a.assessment_id]=r.events;return r.artifact;});
 return {...candidate,optimization_proposals:proposals,impact_assessments:assessments,governance_events:events};
}
function currentlyApproved(candidate:B10CandidateState,item:any,id:string,type:string):boolean { return isApprovedForArtifact(candidate.governance_events[id]||[],createArtifactBinding(item,id,type,candidate.candidate_id)); }
export async function commitVersion(candidate:B10CandidateState,nextVersion:string,userAuthority:string,persistence:B10StatePersistence,priorState?:B10CanonicalState,deps?:B10Deps):Promise<B10CanonicalState>{
 const d=deps||createDefaultB10Deps(),now=()=>d.now?.()||new Date().toISOString(); if(!/^v\d+\.\d+$/.test(nextVersion))throw new Error(`Invalid semantic version format: ${nextVersion}. Expected v#.#`); if(await persistence.load(nextVersion))throw new Error(`Version ${nextVersion} already exists (immutable)`);
 const proposals=candidate.optimization_proposals.filter(p=>p.provenance.type==="DECIDED"&&currentlyApproved(candidate,p,p.proposal_id,"B10_OPTIMIZATION_PROPOSAL"));
 const proposalIds=new Set(proposals.map(p=>p.proposal_id)); const assessments=candidate.impact_assessments.filter(a=>proposalIds.has(a.proposal_id)&&a.provenance.type==="DECIDED"&&currentlyApproved(candidate,a,a.assessment_id,"B10_IMPACT_ASSESSMENT"));
 const audit=[...(priorState?.audit_trail||[]),{version:nextVersion,changed_at:now(),changed_by:userAuthority,summary:`B10 approved decision artifacts: ${proposals.length} proposals, ${assessments.length} assessments`}];
 const created=now(); const withoutIdentity:Omit<B10CanonicalState,"identity">={version:nextVersion,created_at:created,updated_at:created,user_decision_authority:userAuthority,b09_canonical_version:candidate.b09_version,optimization_proposals:proposals,impact_assessments:assessments,audit_trail:audit,decisions_made:[],recommendations_considered:candidate.all_recommendations,evidence_refs:candidate.evidence_refs,provenance_refs:candidate.provenance_refs,governance_events:candidate.governance_events,decision_timestamp:created,cannot_be_modified_until_next_version:true};
 const canonical:B10CanonicalState={...withoutIdentity,identity:createCanonicalIdentity({object_id:`b10:${nextVersion}`,object_type:"B10_CANONICAL_STATE",version:nextVersion,artifact:withoutIdentity,parent_references:candidate.parent_references,created_at:created})}; await persistence.save(canonical); return canonical;
}
export async function loadVersion(v:string,p:B10StatePersistence){return p.load(v)} export async function listVersions(p:B10StatePersistence){return p.listVersions()} export async function getLatestVersion(p:B10StatePersistence){return p.latest()}
function createDefaultB10Deps():B10Deps{return{hash:{stableProposalId:(m,p)=>`opt_${canonicalHasher.hash(`${m}:${p}`).slice(0,32)}`,stableAssessmentId:p=>`assess_${canonicalHasher.hash(p).slice(0,32)}`},now:()=>new Date().toISOString()};}
