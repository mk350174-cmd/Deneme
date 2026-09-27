// B04.01 — Strategic Context Registry
// Explicitly separates B01 content territories, B03 geography and B04 strategic territory IDs.

import type { B01CanonicalState } from "../../b00/contracts.js";
import type { B02CandidateState, B02CanonicalState, B02StrategicOpportunity } from "../../b02/types.js";
import type { B03CandidateState, AudienceCharacteristics } from "../../b03/types.js";
import type { B04Deps } from "../types.js";
import type { EvidenceRef } from "../../types/entities.js";

export interface TerritoryOntologyEntry {
  b01_territory_id: string;
  b04_strategic_territory_id: string;
  geography_codes: string[];
  mapping_basis: "STRUCTURED_BOUNDARY" | "UNMAPPED";
}

export interface StrategyContext {
  brand_profile: { name: string; positioning: string; territories: string[] };
  opportunities: Array<{ opportunity_id:string; description:string; priority_score:number; priority_basis:string; territories:string[]; evidence_refs:EvidenceRef[] }>;
  segments: Array<{ segment_id:string; segment_name:string; characteristics:AudienceCharacteristics; geography:string[]; data_sources:string[]; confidence:number; evidence_refs:EvidenceRef[] }>;
  territories: string[];
  territory_ontology: TerritoryOntologyEntry[];
  channels: Array<{ channel_id:string; name:string; platform:string; role:string }>;
  gaps: string[];
}

const GEO_PATTERNS: Array<[RegExp,string]> = [
  [/\bUS\b|\bUNITED STATES\b/i,"US"], [/\bUK\b|\bUNITED KINGDOM\b/i,"UK"], [/\bEU\b|\bEUROPE(?:AN)?\b/i,"EU"],
  [/\bASIA(?:N)?\b/i,"ASIA"], [/\bCANADA\b/i,"CANADA"], [/\bAUSTRALIA\b/i,"AUSTRALIA"],
];
function mapTerritory(t: NonNullable<B01CanonicalState["content_territories"]>[number]): TerritoryOntologyEntry {
  const text = (t.boundaries || []).join(" ");
  const geography_codes = GEO_PATTERNS.filter(([rx]) => rx.test(text)).map(([,code]) => code);
  return { b01_territory_id:t.territory_id, b04_strategic_territory_id:t.territory_id, geography_codes, mapping_basis:geography_codes.length ? "STRUCTURED_BOUNDARY" : "UNMAPPED" };
}

export function buildStrategyContext(b01State:B01CanonicalState, b02State:B02CandidateState|B02CanonicalState|undefined, b03State:B03CandidateState, _deps?:B04Deps):StrategyContext {
  const gaps:string[]=[];
  const territory_ontology=(b01State.content_territories||[]).map(mapTerritory);
  const territories=territory_ontology.map((t)=>t.b04_strategic_territory_id);
  const brand_profile={ name:b01State.brand_profile?.brand_name||"UNKNOWN", positioning:b01State.brand_profile?.positioning||"UNKNOWN", territories };
  if (brand_profile.positioning === "UNKNOWN") gaps.push("brand_positioning_undefined");
  const opportunities=b02State?.opportunities?.map((opp:B02StrategicOpportunity)=>({ opportunity_id:opp.opportunity_id, description:opp.description, priority_score:opp.strategic_relevance, priority_basis:opp.strategic_relevance_basis, territories, evidence_refs:opp.supporting_evidence||[] }))||[];
  if (!opportunities.length) gaps.push("no_content_opportunities_identified");
  const segments=b03State.audience_segments?.map((seg)=>({ segment_id:seg.segment_id, segment_name:seg.segment_name, characteristics:seg.characteristics, geography:seg.geography||[], data_sources:seg.data_sources||[], confidence:seg.confidence, evidence_refs:seg.evidence_refs }))||[];
  if (!segments.length) gaps.push("no_audience_segments_identified");
  if (territory_ontology.some((t)=>t.mapping_basis==="UNMAPPED")) gaps.push("territory_geography_mapping_incomplete");
  return { brand_profile, opportunities, segments, territories, territory_ontology, channels:b01State.channels||[], gaps };
}

export function validateStrategyContext(context:StrategyContext):{valid:boolean;gaps:string[]} {
  const gaps=[...context.gaps];
  if (context.brand_profile.positioning === "UNKNOWN") gaps.push("brand_positioning_required");
  if (!context.opportunities.length) gaps.push("at_least_one_opportunity_required");
  if (!context.segments.length) gaps.push("at_least_one_segment_required");
  if (!context.territories.length) gaps.push("at_least_one_territory_required");
  return { valid:gaps.length===0, gaps:Array.from(new Set(gaps)) };
}
