// B03.02 — Evidence Aggregation Layer
// Collects audience evidence without upgrading assertions/templates to VERIFIED.

import type { B03Input, B03Deps } from "../types.js";
import type { EvidenceRef } from "../../types/entities.js";
import type { Gap } from "../../b00/contracts.js";
import { normalizeEvidenceRef } from "../../b00/evidence.js";

export interface AggregatedEvidenceSet {
  analytics_evidence: EvidenceRef[];
  research_evidence: EvidenceRef[];
  documentation_evidence: EvidenceRef[];
  user_input_evidence: EvidenceRef[];
  all_evidence: EvidenceRef[];
  gaps: Gap[];
}

function ref(input: Omit<EvidenceRef, "status"> & { status: EvidenceRef["status"] }): EvidenceRef {
  return normalizeEvidenceRef(input);
}

export function aggregateAudienceEvidence(input: B03Input, _deps?: B03Deps): AggregatedEvidenceSet {
  const analytics_evidence: EvidenceRef[] = [];
  const research_evidence: EvidenceRef[] = [];
  const documentation_evidence: EvidenceRef[] = [];
  const user_input_evidence: EvidenceRef[] = [];
  const gaps: Gap[] = [];

  for (const analytics of input.audience_sources?.platform_analytics ?? []) {
    // `verified_at` is the only source-level verification signal available in the contract.
    const status = analytics.verified_at ? "VERIFIED" as const : "INFERRED" as const;
    const base = { origin: "PROVIDER_DATA" as const, basis: analytics.verified_at ? "OBSERVED" as const : "ASSERTED" as const, source_mode: "REAL" as const, production_eligible: true };
    if (analytics.demographic_data) analytics_evidence.push(ref({ id:`ev_analytics_${analytics.channel_id}_demographics`, source:analytics.source, status, excerpt:`${analytics.source}: ${analytics.demographic_data}`, ...base }));
    if (analytics.geography?.length) analytics_evidence.push(ref({ id:`ev_analytics_${analytics.channel_id}_geography`, source:analytics.source, status, excerpt:`${analytics.source}: Geography reach in ${analytics.geography.join(", ")}`, ...base }));
    if (analytics.interests?.length) analytics_evidence.push(ref({ id:`ev_analytics_${analytics.channel_id}_interests`, source:analytics.source, status, excerpt:`${analytics.source}: Audience interests include ${analytics.interests.join(", ")}`, ...base }));
    if (analytics.engagement_pattern) analytics_evidence.push(ref({ id:`ev_analytics_${analytics.channel_id}_engagement`, source:analytics.source, status, excerpt:`${analytics.source}: Engagement pattern shows ${analytics.engagement_pattern}`, ...base }));
  }

  for (const research of input.audience_sources?.user_research ?? []) {
    research_evidence.push(ref({
      id:`ev_research_${research.research_id}`,
      source:`User Research (${research.method})`,
      status:"INFERRED",
      origin:"RESEARCH", basis:"ASSERTED", source_mode:"REAL", production_eligible:true,
      excerpt: research.findings,
    }));
  }

  const doc = input.audience_sources?.documentation;
  const docs: Array<[string, string | undefined, string]> = [
    ["ev_doc_audience_profile", doc?.audience_profile_doc, "Audience Profile Documentation"],
    ["ev_doc_brand_guidelines", doc?.brand_guidelines, "Brand Guidelines"],
    ["ev_doc_market_research", doc?.market_research, "Market Research"],
    ["ev_doc_competitive_analysis", doc?.competitive_analysis, "Competitive Analysis"],
  ];
  for (const [id, excerpt, source] of docs) if (excerpt) documentation_evidence.push(ref({ id, source, status:"INFERRED", origin:"DOCUMENTATION", basis:"ASSERTED", source_mode:"REAL", production_eligible:true, excerpt }));

  if (input.audience_sources?.user_input) {
    user_input_evidence.push(ref({ id:"ev_user_input", source:"User Input", status:"INFERRED", origin:"USER_ASSERTION", basis:"ASSERTED", source_mode:"REAL", production_eligible:true, excerpt:input.audience_sources.user_input }));
  }

  const totalEvidence = analytics_evidence.length + research_evidence.length + documentation_evidence.length + user_input_evidence.length;
  if (totalEvidence === 0) gaps.push({ gap_id:"gap_no_audience_evidence", description:"No audience evidence provided", required_for:"segment audiences and identify needs", priority:"high" });
  if (!(input.audience_sources?.platform_analytics?.length)) gaps.push({ gap_id:"gap_platform_analytics", description:"No platform analytics data available", required_for:"validate audience reach and engagement", priority:"medium" });
  if (!(input.audience_sources?.user_research?.length)) gaps.push({ gap_id:"gap_user_research", description:"No user research data available", required_for:"understand audience needs and pain points", priority:"medium" });

  const all_evidence = [...analytics_evidence, ...research_evidence, ...documentation_evidence, ...user_input_evidence];
  return { analytics_evidence, research_evidence, documentation_evidence, user_input_evidence, all_evidence, gaps };
}
