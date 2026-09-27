// B12 — Integration / Branch State Control Plane
import type { EvidenceRef } from "../types/entities.js";
import type { ProvenanceRef } from "../b00/provenanceRef.js";
import type { GovernanceEvent } from "../b00/governance.js";
import type { Recommendation, Decision } from "../b00/contracts.js";
import type { CanonicalIdentity } from "../b00/identity.js";
import type { B01StatePersistence } from "../b01/types.js"; import type { B02StatePersistence } from "../b02/types.js"; import type { B03StatePersistence } from "../b03/types.js"; import type { B04StatePersistence } from "../b04/types.js"; import type { B05StatePersistence } from "../b05/types.js"; import type { B06StatePersistence } from "../b06/types.js"; import type { B07StatePersistence } from "../b07/types.js"; import type { B08StatePersistence } from "../b08/types.js"; import type { B09StatePersistence } from "../b09/types.js"; import type { B10StatePersistence } from "../b10/types.js"; import type { B11StatePersistence } from "../b11/types.js";
export type BModule="b01"|"b02"|"b03"|"b04"|"b05"|"b06"|"b07"|"b08"|"b09"|"b10"|"b11";
export interface BranchVersion { module:BModule; version:string; created_at:string; canonical_state_id:string; object_type:string; content_hash:string; identity_status:"VERIFIED"|"DECLARED"|"MISSING"|"INVALID"; }
export interface StateTransition { transition_id:string; from_version:BranchVersion[]; to_version:BranchVersion[]; triggered_by:"user_decision"|"system_recommendation"|"scheduled_check"; decision_authority:string; rationale:string; timestamp:string; evidence_refs:EvidenceRef[]; provenance:ProvenanceRef; }
export interface BranchCompletenessSummary {
 b01_ready:boolean;b02_ready:boolean;b03_ready:boolean;b04_ready:boolean;b05_ready:boolean;b06_ready:boolean;b07_ready:boolean;b08_ready:boolean;b09_ready:boolean;b10_ready:boolean;b11_ready:boolean;
 /** Legacy field retained as structural percentage only. */ overall_completeness:number;
 structural_completeness:number; structural_status:"COMPLETE"|"INCOMPLETE";
 semantic_validity:"VALID"|"INVALID"|"UNKNOWN";
 operational_readiness:"READY"|"NOT_READY"|"NOT_VERIFIED";
 semantic_findings:string[]; operational_findings:string[];
}
export interface BranchCanonicalState { identity:CanonicalIdentity; state_id:string; created_at:string; updated_at:string; user_decision_authority:string; module_versions:BranchVersion[]; state_transitions:StateTransition[]; last_decision:{timestamp:string;authority:string;decision:string}; audit_trail:Array<{timestamp:string;action:string;actor:string;affected_modules:string[]}>; completeness_summary:BranchCompletenessSummary; evidence_refs:EvidenceRef[]; provenance_refs:ProvenanceRef[]; governance_events:Record<string,GovernanceEvent[]>; missing_modules?:string[]; failed_modules?:string[]; decisions_made:Decision[]; recommendations_considered:Recommendation[]; decision_timestamp:string; cannot_be_modified_until_next_version:boolean; }
export interface B12UpstreamReader { b01:B01StatePersistence;b02:B02StatePersistence;b03:B03StatePersistence;b04:B04StatePersistence;b05:B05StatePersistence;b06:B06StatePersistence;b07:B07StatePersistence;b08:B08StatePersistence;b09:B09StatePersistence;b10:B10StatePersistence;b11:B11StatePersistence; }
export interface B12Deps { hash?:{stableTransitionId:(fromSignature:string,toSignature:string)=>string;stateId:(signature:string)=>string};now?:()=>string;upstreamReader?:B12UpstreamReader; }
export interface B12StatePersistence { save:(state:BranchCanonicalState)=>Promise<void>;load:(stateId:string)=>Promise<BranchCanonicalState|null>;listStates:()=>Promise<string[]>;latest:()=>Promise<BranchCanonicalState|null>; }
export const KNOWN_CANONICALIZATION_DROPS={state_transitions:"Created only by actual branch snapshot changes/commits; upstream decisions and recommendations are aggregated explicitly"} as const;
