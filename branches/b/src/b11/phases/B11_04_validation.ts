// Structural completeness is not compliance validity. Legacy numeric calls
// remain supported as unverified count summaries, never as evidence findings.
import { canonicalHasher } from "../../b00/hashing.js";
import type { CompletenessScore, ComplianceCheckResult } from "../types.js";
import type { ConflictRecord, Gap } from "../../b00/contracts.js";
export function detectComplianceConflicts(ruleCount:number,checks:ComplianceCheckResult[]|number,reportedViolations=0):ConflictRecord[]{
  const count=typeof checks === "number" ? checks : checks.length;
  const n=typeof checks === "number" ? reportedViolations : checks.filter(c=>c.status === "NON_COMPLIANT").length;
  const x:ConflictRecord[]=[];
  if(ruleCount>0 && count===0)x.push({conflict_id:`conf_${canonicalHasher.stableConflictId("b11","unchecked_rules")}`,description:"Compliance rules are not checked",affected_items:["b11"],severity:"high"});
  if(n>0)x.push({conflict_id:`conf_${canonicalHasher.stableConflictId("b11",`violations_${n}`)}`,description:`${n} ${typeof checks === "number" ? "reported, unverified" : "evidence-backed"} compliance violations`,affected_items:["b11"],severity:"high"});
  return x;
}
export function identifyComplianceGaps(ruleCount:number,checks:ComplianceCheckResult[]|number,reportedViolations=0):Gap[]{
  const g:Gap[]=[];const count=typeof checks === "number" ? checks : checks.length;
  if(!ruleCount)g.push({gap_id:"gap_b11_no_rules",description:"No compliance rules defined",required_for:"compliance_framework",priority:"high"});
  if(count<ruleCount)g.push({gap_id:"gap_b11_incomplete_checks",description:"Some rules lack checks",required_for:"compliance_framework",priority:"high"});
  const unresolved=typeof checks === "number" ? count : checks.filter(c=>c.status === "UNKNOWN" || c.status === "PENDING").length;
  if(unresolved)g.push({gap_id:"gap_b11_unresolved_checks",description:`${unresolved} checks require evidence or review; counts do not establish compliance`,required_for:"semantic_compliance_validity",priority:"high"});
  const n=typeof checks === "number" ? reportedViolations : checks.filter(c=>c.status === "NON_COMPLIANT").length;
  if(n)g.push({gap_id:"gap_b11_violations",description:`${n} ${typeof checks === "number" ? "unverified reported" : "evidence-backed"} violations require review`,required_for:"compliance_resolution",priority:"high"});return g;
}
export function calculateComplianceCompleteness(ruleCount:number,checks:ComplianceCheckResult[]|number,gapsOrViolations:Gap[]|number,legacyGaps:Gap[]=[]):CompletenessScore{
  const count=typeof checks === "number" ? checks : checks.length;
  const structural=ruleCount>0?Math.round(Math.min(100,(count/Math.max(1,ruleCount))*100)):0;
  const non=typeof checks === "number" ? typeof gapsOrViolations === "number" && gapsOrViolations>0 : checks.some(c=>c.status === "NON_COMPLIANT");
  const unresolved=typeof checks === "number" || checks.some(c=>c.status === "UNKNOWN" || c.status === "PENDING") || count<ruleCount;
  return{score:structural,missing_inputs:[...(!ruleCount?["No compliance rules defined"]:[]),...(unresolved?["Compliance evidence/review unresolved"]:[])],
    blocking_decisions:[...(non?["Reported non-compliance must be reviewed/remediated"]:[]),...(unresolved?["Do not claim compliance while checks are UNKNOWN/PENDING"]:[])],
    semantic_status:typeof checks === "number" ? "UNKNOWN" : non?"INVALID":unresolved || count===0?"UNKNOWN":"VALID"};
}
