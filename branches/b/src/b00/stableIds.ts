// B00 — B-Branch stable ID helpers. All delegates use the canonical SHA-256 authority.
import { canonicalHasher } from "./hashing.js";
const h=(s:string)=>canonicalHasher.hash(s);
export const stableEvidenceId=(source:string,field:string)=>`ev_${h(`${source}::${field}`).slice(0,12)}`;
export const stableChannelId=(inputId:string,name:string,platform:string)=>`ch_${h(`${inputId}:${name}:${platform}`).slice(0,16)}`;
export const stablePlatformId=(name:string)=>`plat_${h(name.trim().toLowerCase()).slice(0,16)}`;
export const stableTerritoryId=(inputId:string,description:string)=>`terr_${h(`${inputId}:${description}`).slice(0,16)}`;
export const stableConstraintId=(inputId:string,description:string)=>`constraint_${h(`${inputId}:${description}`).slice(0,16)}`;
export const stableConflictId=(inputId:string,affectedItemsKey:string)=>`conflict_${h(`${inputId}:${affectedItemsKey}`).slice(0,16)}`;
export const stableGapId=(inputId:string,description:string)=>`gap_${h(`${inputId}:${description}`).slice(0,16)}`;
export const stableRecommendationId=(agent:string,subject:string)=>`rec_${h(`${agent}:${subject}`).slice(0,16)}`;
