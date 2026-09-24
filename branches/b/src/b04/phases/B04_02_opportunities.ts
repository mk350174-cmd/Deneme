// B04.02 — Opportunity-Segment Analysis
// Uses explicit territory ontology; never compares content-territory IDs to geography strings.
import type { AlignmentScore, B04Deps } from "../types.js";
import type { StrategyContext } from "./B04_01_registry.js";
import { canonicalHasher } from "../../b00/hashing.js";

export function analyzeOpportunitySegmentAlignment(context:StrategyContext,deps?:B04Deps):AlignmentScore[] {
  const alignments:AlignmentScore[]=[]; const deps_=deps||{hash:createDefaultHashFunctions()};
  for (const opportunity of context.opportunities) for (const segment of context.segments) {
    const geographicTerritories=opportunity.territories.flatMap((id)=>context.territory_ontology.filter((t)=>t.b04_strategic_territory_id===id).flatMap((t)=>t.geography_codes));
    const sharedGeographies=geographicTerritories.filter((g)=>segment.geography.includes(g));
    const territoryCoverage=geographicTerritories.length ? (sharedGeographies.length ? 0.3 : 0) : 0;
    const segmentConfidence=segment.confidence*0.5;
    const opportunityScore=opportunity.priority_score*0.2;
    const score=Math.min(territoryCoverage+segmentConfidence+opportunityScore,1);
    if (score>0.3) alignments.push({
      score_id:deps_.hash!.stableAlignmentId(opportunity.opportunity_id,segment.segment_id,score.toFixed(6)),
      opportunity_id:opportunity.opportunity_id, segment_id:segment.segment_id, alignment_score:score,
      rationale:`Territory/geography mapping: ${geographicTerritories.length ? (sharedGeographies.join(", ")||"no geographic overlap") : "UNKNOWN (territory has no geography mapping)"} | segment confidence ${segment.confidence.toFixed(2)} | opportunity score basis ${opportunity.priority_basis}`,
      evidence_refs:[...opportunity.evidence_refs,...segment.evidence_refs],
    });
  }
  return alignments;
}
function createDefaultHashFunctions(){return{stableCampaignId:(name:string,v:string)=>`camp_${canonicalHasher.hash(`${v}:${name}`)}`,stablePriorityId:(id:string,r:number)=>`prio_${canonicalHasher.hash(`${id}:${r}`)}`,stableAlignmentId:(o:string,s:string,x:string)=>`align_${canonicalHasher.hash(`${o}:${s}:${x}`)}`};}
