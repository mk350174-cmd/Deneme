// B08 — Execution-layer firewall. Definitions do not become measurements by being present.
import type { AnalyticsResult,MetricDefinition,DataSourceDefinition } from "./types.js";
import { validateEvidenceCollection,type StructuredValidationResult,type ValidationIssue } from "../b00/validation.js";

export function validateAnalyticsResult(result:unknown,metrics:readonly MetricDefinition[]):StructuredValidationResult {
  const issues:ValidationIssue[]=[];
  if(typeof result!=="object"||result===null) {
    return {valid:false,issues:[{severity:"ERROR",code:"MALFORMED_ANALYTICS_RESULT",message:"Expected analytics result object"}]};
  }
  const r=result as AnalyticsResult;
  if(!metrics.some(m=>m.metric_id===r.metric_id)) {
    issues.push({severity:"ERROR",code:"UNDEFINED_METRIC_RESULT",message:`Metric ${String(r.metric_id)} is not defined`});
  }
  if(!["REAL","MOCK","SYNTHETIC"].includes(String(r.source_mode))) {
    issues.push({severity:"ERROR",code:"INVALID_SOURCE_MODE",message:"Analytics result must explicitly declare REAL, MOCK, or SYNTHETIC"});
  }
  const ev=validateEvidenceCollection(r.evidence_refs);
  issues.push(...ev.issues);

  if(r.source_mode==="MOCK"||r.source_mode==="SYNTHETIC") {
    const forbiddenEvidence=(r.evidence_refs??[]).some(e=>e.status==="VERIFIED"||e.source_mode==="REAL"||e.production_eligible===true);
    if(forbiddenEvidence) {
      issues.push({
        severity:"ERROR",
        code:r.source_mode==="MOCK"?"MOCK_REAL_FIREWALL_VIOLATION":"SYNTHETIC_REAL_FIREWALL_VIOLATION",
        message:`${r.source_mode} result cannot carry VERIFIED/REAL/production-eligible evidence semantics`,
      });
    }
  }

  if((r.state==="VALIDATED"||r.state==="USABLE")&&(r.evidence_refs??[]).length===0) {
    issues.push({severity:"ERROR",code:"VALIDATED_RESULT_MISSING_EVIDENCE",message:"Validated/usable metric result requires evidence"});
  }
  return {valid:!issues.some(i=>i.severity==="ERROR"),issues};
}

export function providerExecutionClaim(source:DataSourceDefinition):
  "DEFINED_ONLY"|"EXECUTED_REAL"|"EXECUTED_MOCK"|"EXECUTED_SYNTHETIC"|"EXECUTED_UNKNOWN"|"FAILED" {
  if(source.execution_state==="FAILED") return "FAILED";
  if(!source.execution_verified||["DEFINED","CONNECTED"].includes(source.execution_state)) return "DEFINED_ONLY";
  if(source.source_mode==="REAL") return "EXECUTED_REAL";
  if(source.source_mode==="MOCK") return "EXECUTED_MOCK";
  if(source.source_mode==="SYNTHETIC") return "EXECUTED_SYNTHETIC";
  return "EXECUTED_UNKNOWN";
}
