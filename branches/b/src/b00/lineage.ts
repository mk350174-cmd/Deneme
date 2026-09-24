// B00 — Cross-module canonical lineage validation for the actual B-Branch DAG.
import type { CanonicalIdentity } from "./identity.js";
export type CanonicalModule = "B01"|"B02"|"B03"|"B04"|"B05"|"B06"|"B07"|"B08"|"B09"|"B10"|"B11";
export const B_BRANCH_DEPENDENCY_DAG: Readonly<Record<CanonicalModule, readonly CanonicalModule[]>> = {
 B01:[],B02:["B01"],B03:["B01"],B04:["B01","B02","B03"],B05:["B01","B03","B04"],B06:["B01","B03","B04"],B07:["B04","B06"],B08:["B01","B06","B07"],B09:["B08","B06"],B10:["B09"],B11:["B10"],
};
export interface LineageIssue { severity:"ERROR"|"WARNING"; code:string; module:CanonicalModule; parent_module?:CanonicalModule; message:string; }
export interface LineageValidation { valid:boolean; issues:LineageIssue[]; }
export function validateLineageGraph(identities:Partial<Record<CanonicalModule,CanonicalIdentity>>):LineageValidation { const issues:LineageIssue[]=[];
 for(const [child,parents] of Object.entries(B_BRANCH_DEPENDENCY_DAG) as [CanonicalModule,readonly CanonicalModule[]][]){const ci=identities[child];if(!ci)continue;for(const pm of parents){const pi=identities[pm];if(!pi){issues.push({severity:"WARNING",code:"UPSTREAM_IDENTITY_UNAVAILABLE",module:child,parent_module:pm,message:`${child} expected ${pm}, but upstream identity is unavailable`});continue;}const ref=ci.parent_references.find(r=>r.module.toUpperCase()===pm);if(!ref){issues.push({severity:"ERROR",code:"MISSING_PARENT_REFERENCE",module:child,parent_module:pm,message:`${child} is missing canonical parent reference to ${pm}`});continue;}if(ref.object_id!==pi.object_id||ref.version!==pi.version||ref.content_hash!==pi.content_hash){issues.push({severity:"ERROR",code:"PARENT_IDENTITY_MISMATCH",module:child,parent_module:pm,message:`${child} parent reference does not match ${pm} object/version/hash`});}}
 }
 return{valid:!issues.some(i=>i.severity==="ERROR"),issues}; }
