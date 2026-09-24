// B11.03 — Evidence-based compliance checks. Hashes identify checks; they never determine outcomes.
import type { ComplianceCheckResult, ComplianceRule, ComplianceSubject, ComplianceEvidence, B11Deps, ComplianceStatus } from "../types.js";
import { validateEvidenceSemantics } from "../../b00/evidence.js";
import { canonicalHasher } from "../../b00/hashing.js";

function evaluate(evidence:ComplianceEvidence[]):{status:ComplianceStatus;findings:string[]} {
  if(evidence.length===0) return {status:"UNKNOWN",findings:["No subject-bound compliance evidence was supplied; compliance cannot be determined"]};
  if(evidence.some(e=>e.assertion==="VIOLATES")) return {status:"NON_COMPLIANT",findings:evidence.filter(e=>e.assertion==="VIOLATES").map(e=>e.rationale)};
  if(evidence.some(e=>e.assertion==="REQUIRES_REVIEW")) return {status:"PENDING",findings:evidence.filter(e=>e.assertion==="REQUIRES_REVIEW").map(e=>e.rationale)};
  if(evidence.every(e=>e.assertion==="NOT_APPLICABLE")) return {status:"NOT_APPLICABLE",findings:evidence.map(e=>e.rationale)};
  if(evidence.length>0 && evidence.every(e=>e.assertion==="SATISFIES")) return {status:"COMPLIANT",findings:evidence.map(e=>e.rationale)};
  return {status:"UNKNOWN",findings:["Evidence assertions are incomplete or conflicting"]};
}
export function runComplianceChecks(rules:ComplianceRule[],subjects:ComplianceSubject[]=[],deps?:B11Deps):ComplianceCheckResult[]{
 const h=deps?.hash||createDefaultB11Deps().hash!,now=deps?.now||(()=>new Date().toISOString()), supplied=deps?.complianceEvidence||[];
 const actualSubjects=subjects.length?subjects:[{subject_id:"B_BRANCH_UNRESOLVED_SUBJECT",subject_type:"B_BRANCH",subject_version:"UNKNOWN",subject_content_hash:"UNKNOWN",affected_modules:[]}];
 const out:ComplianceCheckResult[]=[];
 for(const rule of rules){
   for(const subject of actualSubjects){
     const ev=supplied.filter(e=>e.rule_id===rule.rule_id && e.subject_id===subject.subject_id && e.subject_type===subject.subject_type && e.subject_version===subject.subject_version && e.subject_content_hash===subject.subject_content_hash && subject.subject_content_hash!=="UNKNOWN" && validateEvidenceSemantics(e.evidence_ref).valid && e.evidence_ref.status==="VERIFIED" && e.evidence_ref.source_mode==="REAL" && e.evidence_ref.production_eligible!==false);
     const r=evaluate(ev); const check_id=h.stableCheckId(rule.rule_id,subject.subject_id);
     out.push({check_id,compliance_rule_id:rule.rule_id,subject,status:r.status,check_basis:ev.length?"EVIDENCE_CHECK":"NO_EVIDENCE",findings:r.findings,finding_review_state:"UNREVIEWED",remediation_required:r.status==="NON_COMPLIANT",evidence_refs:ev.map(e=>e.evidence_ref),provenance:{type:"INFERRED",decision_authority:"B11_03:runComplianceChecks",timestamp:now(),rationale:`RULE + SUBJECT + EVIDENCE check for ${rule.rule_id}; outcome is not derived from hash or governance approval`}});
   }
 }
 return out;
}
function createDefaultB11Deps():B11Deps{return{hash:{stableRuleId:(c,d)=>`rule_${canonicalHasher.hash(`${c}:${d}`).slice(0,32)}`,stableCheckId:(r,s="unknown")=>`check_${canonicalHasher.hash(`${r}:${s}`).slice(0,32)}`},now:()=>new Date().toISOString()};}
