// B08.01 — Analytics Context Registry

import type { B01CanonicalState } from "../../b00/contracts.js";
import type { B06CandidateState, B06CanonicalState } from "../../b06/types.js";
import type { B07CandidateState, B07CanonicalState } from "../../b07/types.js";

export interface AnalyticsContext {
  kpis: Array<{
    kpi_id: string;
    campaign_id: string;
    metric_name: string;
    channel_id: string;
  }>;
  channels: Array<{
    channel_id: string;
    name: string;
  }>;
  campaigns: Array<{
    campaign_id: string;
    campaign_name: string;
  }>;
  gaps: string[];
}

export function buildAnalyticsContext(b07State: B07CandidateState | B07CanonicalState, b06State: B06CandidateState | B06CanonicalState, b01State: B01CanonicalState): AnalyticsContext {
  const gaps: string[] = [];

  const kpis = b07State?.kpi_definitions?.map((k: { kpi_id: string; campaign_id: string; metric_name: string; channel_id: string }) => ({
    kpi_id: k.kpi_id,
    campaign_id: k.campaign_id,
    metric_name: k.metric_name,
    channel_id: k.channel_id,
  })) || [];

  if (kpis.length === 0) {
    gaps.push("no_kpis_available");
  }

  const channelSet = new Set<string>();
  b06State?.distribution_strategies?.forEach((s: { channel_selections?: Array<{ channel_id: string }> }) => {
    s.channel_selections?.forEach((cs: { channel_id: string }) => {
      channelSet.add(cs.channel_id);
    });
  });

  const channels = Array.from(channelSet).map((id) => ({
    channel_id: id,
    name: id,
  }));

  if (channels.length === 0) {
    gaps.push("no_channels_available");
  }

  // Campaign identity comes from the explicit KPI campaign_id, never by parsing a hash/id.
  const campaignMap = new Map<string, { campaign_id: string; campaign_name: string }>();
  for (const kpi of kpis) {
    if (!kpi.campaign_id) { gaps.push(`missing_campaign_for_kpi:${kpi.kpi_id}`); continue; }
    if (!campaignMap.has(kpi.campaign_id)) campaignMap.set(kpi.campaign_id, { campaign_id:kpi.campaign_id, campaign_name:`Campaign ${kpi.campaign_id}` });
  }
  const campaigns = Array.from(campaignMap.values());

  return { kpis, channels, campaigns, gaps };
}
