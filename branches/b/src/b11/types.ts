// B11 — Risk & Compliance Types
import type { EvidenceRef } from "../types/entities.js";
import type { ProvenanceRef } from "../b00/provenanceRef.js";
import type { ConflictRecord, Gap, Decision, Recommendation } from "../b00/contracts.js";
import type { GovernanceEvent } from "../b00/governance.js";
import type { CanonicalIdentity, CanonicalParentReference } from "../b00/identity.js";

export interface ComplianceRule {
  rule_id:string; rule_category:"legal"|"platform"|"brand"|"operational"|"ethical"; description:string; scope:string[]; required:boolean;
  rule_basis:"FRAMEWORK_DEFAULT"|"EVIDENCE_BACKED"|"USER_DEFINED"; external_verified:boolean; evidence_refs:EvidenceRef[]; provenance:ProvenanceRef;
}
export interface RiskAssessment {
  risk_id:string; risk_category:"legal"|"operational"|"market"|"brand"|"technical"; description:string; likelihood:"low"|"medium"|"high"; impact:"low"|"medium"|"high"; mitigation_strategy:string; affected_modules:string[];
  assessment_basis:"HEURISTIC_FRAMEWORK"|"EVIDENCE_BACKED"|"USER_DEFINED"; evidence_refs:EvidenceRef[]; provenance:ProvenanceRef;
}
export type ComplianceStatus="COMPLIANT"|"NON_COMPLIANT"|"PENDING"|"UNKNOWN"|"NOT_APPLICABLE";
export interface ComplianceSubject { subject_id:string; subject_type:string; subject_version:string; subject_content_hash:string; affected_modules:string[]; }
export interface ComplianceEvidence { evidence_ref:EvidenceRef; rule_id:string; subject_id:string; subject_type?:string; subject_version?:string; subject_content_hash?:string; assertion:"SATISFIES"|"VIOLATES"|"REQUIRES_REVIEW"|"NOT_APPLICABLE"; rationale:string; }
export interface ComplianceCheckResult {
  check_id:string; compliance_rule_id:string; subject:ComplianceSubject; status:ComplianceStatus; check_basis:"EVIDENCE_CHECK"|"NO_EVIDENCE";
  findings:string[]; finding_review_state:"UNREVIEWED"|"REVIEWED"; remediation_required:boolean; remediation?:string; final_compliance_decision?:ComplianceStatus;
  evidence_refs:EvidenceRef[]; provenance:ProvenanceRef;
}
export interface CompletenessScore { score:number; missing_inputs:string[]; blocking_decisions:string[]; semantic_status:"VALID"|"INVALID"|"UNKNOWN"; }
export interface B11CandidateState { candidate_id:string; parent_references:CanonicalParentReference[]; created_at:string; b10_version?:string; compliance_rules:ComplianceRule[]; risk_assessments:RiskAssessment[]; compliance_checks:ComplianceCheckResult[]; conflicts_detected:ConflictRecord[]; gaps:Gap[]; evidence_refs:EvidenceRef[]; provenance_refs:ProvenanceRef[]; governance_events:Record<string,GovernanceEvent[]>; all_recommendations:Recommendation[]; completeness:CompletenessScore; }
export interface B11CanonicalState { identity:CanonicalIdentity; version:string; created_at:string; updated_at:string; user_decision_authority:string; b10_canonical_version?:string; compliance_rules:ComplianceRule[]; risk_assessments:RiskAssessment[]; compliance_checks:ComplianceCheckResult[]; audit_trail:Array<{version:string;changed_at:string;changed_by:string;summary:string}>; decisions_made:Decision[]; recommendations_considered:Recommendation[]; evidence_refs:EvidenceRef[]; provenance_refs:ProvenanceRef[]; governance_events:Record<string,GovernanceEvent[]>; decision_timestamp:string; cannot_be_modified_until_next_version:boolean; }
export interface B11Deps { hash?:{stableRuleId:(category:string,description:string)=>string;stableCheckId:(ruleId:string,subjectId?:string)=>string}; now?:()=>string; complianceEvidence?:ComplianceEvidence[]; }
export interface B11StatePersistence { save:(s:B11CanonicalState)=>Promise<void>;load:(v:string)=>Promise<B11CanonicalState|null>;listVersions:()=>Promise<string[]>;latest:()=>Promise<B11CanonicalState|null>; }
export const KNOWN_CANONICALIZATION_DROPS={candidate_id:"Pre-decision ID",conflicts_detected:"Candidate validation output",gaps:"Candidate validation output",all_recommendations:"Preserved as recommendations_considered",completeness:"Candidate structural/semantic check; branch readiness evaluated by B12"} as const;
