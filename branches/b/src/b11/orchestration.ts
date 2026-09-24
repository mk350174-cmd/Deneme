// B11 Orchestration — compliance findings remain distinct from governance approval.
import { canonicalHasher } from "../b00/hashing.js";
import { bindProvenanceToSubject, bindUnboundProvenanceRefs } from "../b00/provenanceRef.js";
import { proposeItem, approveItem, isApprovedForArtifact, type GovernanceEvent } from "../b00/governance.js";
import { createArtifactBinding, createCanonicalIdentity, resolveParentReference } from "../b00/identity.js";
import type { B11CandidateState,B11CanonicalState,B11Deps,B11StatePersistence,ComplianceRule,RiskAssessment,ComplianceSubject,ComplianceCheckResult } from "./types.js";
import type { B10CandidateState,B10CanonicalState } from "../b10/types.js";
import { defineComplianceRules } from "./phases/B11_01_rules.js";
import { assessRisks } from "./phases/B11_02_risks.js";
import { runComplianceChecks } from "./phases/B11_03_checks.js";
import { detectComplianceConflicts,identifyComplianceGaps,calculateComplianceCompleteness } from "./phases/B11_04_validation.js";

function complianceSubjects(state:B10CandidateState|B10CanonicalState):ComplianceSubject[]{
 const version="version" in state?state.version:state.candidate_id; const impactByProposal=new Map((state.impact_assessments ?? []).map(a=>[a.proposal_id,a]));
 return (state.optimization_proposals ?? []).map(p=>{const b=createArtifactBinding(p,p.proposal_id,"B10_OPTIMIZATION_PROPOSAL",version);return{subject_id:b.object_id,subject_type:b.object_type,subject_version:b.object_version,subject_content_hash:b.object_content_hash,affected_modules:impactByProposal.get(p.proposal_id)?.affected_modules||[p.target_module]};});
}
/** UNIFIED FIX (B-4): every B11 provenance ref is bound to the exact rule/risk/check artifact it explains
 *  (B00 validateSubjectBoundProvenance). Previously the raw, unbound refs were copied, so B12 reported
 *  "B11 provenance UNKNOWN: MISSING_SUBJECT_BINDING" and marked every branch semantically INVALID. */
function boundProvenance(rules:ComplianceRule[],risks:RiskAssessment[],checks:ComplianceCheckResult[],version:string){
 const ids=(x:{evidence_refs:any[]})=>x.evidence_refs.map((e:any)=>e.id);
 return[...rules.map(r=>bindProvenanceToSubject(r.provenance,createArtifactBinding(r,r.rule_id,"B11_COMPLIANCE_RULE",version),ids(r),"compliance_rule_definition")),
  ...risks.map(r=>bindProvenanceToSubject(r.provenance,createArtifactBinding(r,r.risk_id,"B11_RISK_ASSESSMENT",version),ids(r),"risk_assessment")),
  ...checks.map(c=>bindProvenanceToSubject(c.provenance,createArtifactBinding(c,c.check_id,"B11_COMPLIANCE_CHECK",version),ids(c),"compliance_check"))];
}
export async function runB11(b10State:B10CandidateState|B10CanonicalState,deps?:B11Deps):Promise<B11CandidateState>{
 const d=deps||createDefaultB11Deps(),now=()=>d.now?.()||new Date().toISOString(),rules=defineComplianceRules(d),risks=assessRisks(d),checks=runComplianceChecks(rules,complianceSubjects(b10State),d),conflicts=detectComplianceConflicts(rules.length,checks),gaps=identifyComplianceGaps(rules.length,checks),completeness=calculateComplianceCompleteness(rules.length,checks,gaps);
 const ev=Array.from(new Map([...rules.flatMap(r=>r.evidence_refs),...risks.flatMap(r=>r.evidence_refs),...checks.flatMap(c=>c.evidence_refs)].map(e=>[e.id,e])).values());
 const candidate_id=`cand_${canonicalHasher.stableCandidateId("b11",`${"candidate_id" in b10State?b10State.candidate_id:b10State.version}:${rules.length}:${checks.length}`)}`;
 return{candidate_id,parent_references:[resolveParentReference("B10",b10State,"optimization_input")],created_at:now(),b10_version:"version" in b10State?b10State.version:b10State.b09_version,compliance_rules:rules,risk_assessments:risks,compliance_checks:checks,conflicts_detected:conflicts,gaps,evidence_refs:ev,provenance_refs:boundProvenance(rules,risks,checks,candidate_id),governance_events:{},all_recommendations:[],completeness};
}
function approve<T extends {provenance:any;evidence_refs:any[]}>(candidateId:string,item:T,id:string,type:string,authority:string,now:()=>string):{item:T;events:GovernanceEvent[]}{const binding=createArtifactBinding(item,id,type,candidateId);const p=proposeItem({itemId:id,history:[],authority,timestamp:now(),rationale:`Proposed ${type}`});const a=approveItem({itemId:id,history:p.history,authority,timestamp:now(),rationale:`Approved exact ${type} artifact`,artifact:binding,requireArtifactBinding:true,sourceEvidenceRefs:item.evidence_refs.map((e:any)=>e.id)});return{item:{...item,provenance:{...item.provenance,type:"DECIDED",decision_authority:authority,timestamp:now(),prior_provenance_id:a.event.provenance.id}},events:[p.event,a.event]};}
/** Approves rule/risk decision artifacts only. Compliance result status is NOT changed by approval. */
export async function approveCandidate(candidate:B11CandidateState,userAuthority:string,deps?:B11Deps):Promise<B11CandidateState>{const d=deps||createDefaultB11Deps(),now=()=>d.now?.()||new Date().toISOString(),events:Record<string,GovernanceEvent[]>={};const rules=candidate.compliance_rules.map(r=>{const x=approve(candidate.candidate_id,r,r.rule_id,"B11_COMPLIANCE_RULE",userAuthority,now);events[r.rule_id]=x.events;return x.item});const risks=candidate.risk_assessments.map(r=>{const x=approve(candidate.candidate_id,r,r.risk_id,"B11_RISK_ASSESSMENT",userAuthority,now);events[r.risk_id]=x.events;return x.item});return{...candidate,compliance_rules:rules,risk_assessments:risks,governance_events:events};}
/** Explicit finding review. Reviewing a finding never converts it to COMPLIANT. */
export function reviewComplianceFinding(candidate:B11CandidateState,checkId:string):B11CandidateState{return{...candidate,compliance_checks:candidate.compliance_checks.map(c=>c.check_id===checkId?{...c,finding_review_state:"REVIEWED"}:c)}};
function approved(candidate:B11CandidateState,item:any,id:string,type:string){return isApprovedForArtifact(candidate.governance_events[id]||[],createArtifactBinding(item,id,type,candidate.candidate_id));}
export async function commitVersion(candidate:B11CandidateState,nextVersion:string,userAuthority:string,persistence:B11StatePersistence,priorState?:B11CanonicalState,deps?:B11Deps):Promise<B11CanonicalState>{
 const d=deps||createDefaultB11Deps(),now=()=>d.now?.()||new Date().toISOString();if(!/^v\d+\.\d+$/.test(nextVersion))throw new Error(`Invalid semantic version format: ${nextVersion}. Expected v#.#`);if(await persistence.load(nextVersion))throw new Error(`Version ${nextVersion} already exists (immutable)`);
 const rules=candidate.compliance_rules.filter(r=>r.provenance.type==="DECIDED"&&approved(candidate,r,r.rule_id,"B11_COMPLIANCE_RULE"));const risks=candidate.risk_assessments.filter(r=>r.provenance.type==="DECIDED"&&approved(candidate,r,r.risk_id,"B11_RISK_ASSESSMENT"));
 const created=now();const audit=[...(priorState?.audit_trail||[]),{version:nextVersion,changed_at:created,changed_by:userAuthority,summary:`B11: ${rules.length} approved framework rules, ${risks.length} approved risk assessments, ${candidate.compliance_checks.length} evidence-check results (${candidate.completeness.semantic_status})`}];
 const without:Omit<B11CanonicalState,"identity">={version:nextVersion,created_at:created,updated_at:created,user_decision_authority:userAuthority,b10_canonical_version:candidate.b10_version,compliance_rules:rules,risk_assessments:risks,compliance_checks:candidate.compliance_checks,audit_trail:audit,decisions_made:[],recommendations_considered:candidate.all_recommendations,evidence_refs:candidate.evidence_refs,provenance_refs:boundProvenance(rules,risks,candidate.compliance_checks,candidate.candidate_id),governance_events:candidate.governance_events,decision_timestamp:created,cannot_be_modified_until_next_version:true};
 const state:B11CanonicalState={...without,identity:createCanonicalIdentity({object_id:`b11:${nextVersion}`,object_type:"B11_CANONICAL_STATE",version:nextVersion,artifact:without,parent_references:candidate.parent_references,created_at:created})};await persistence.save(state);return state;
}
export async function loadVersion(v:string,p:B11StatePersistence){return p.load(v)} export async function listVersions(p:B11StatePersistence){return p.listVersions()} export async function getLatestVersion(p:B11StatePersistence){return p.latest()}
function createDefaultB11Deps():B11Deps{return{hash:{stableRuleId:(c,d)=>`rule_${canonicalHasher.hash(`${c}:${d}`).slice(0,32)}`,stableCheckId:(r,s="unknown")=>`check_${canonicalHasher.hash(`${r}:${s}`).slice(0,32)}`},now:()=>new Date().toISOString()};}
