// B07.01 — Performance Context Registry

import type { B04CandidateState, B04CanonicalState } from "../../b04/types.js";
import type { B06CandidateState, B06CanonicalState } from "../../b06/types.js";

export interface PerformanceContext {
  campaigns: Array<{
    campaign_id: string;
    campaign_name: string;
    primary_objective: string;
  }>;
  channels: Array<{
    channel_id: string;
    name: string;
  }>;
  gaps: string[];
}

export function buildPerformanceContext(b04State: B04CandidateState | B04CanonicalState, b06State: B06CandidateState | B06CanonicalState): PerformanceContext {
  const gaps: string[] = [];

  const campaigns = b04State?.campaigns?.map((c: { campaign_id: string; campaign_name: string; primary_objective: string }) => ({
    campaign_id: c.campaign_id,
    campaign_name: c.campaign_name,
    primary_objective: c.primary_objective,
  })) || [];

  if (campaigns.length === 0) {
    gaps.push("no_campaigns_available");
  }

  // Extract unique channels from distribution strategies
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
    gaps.push("no_channels_in_distribution");
  }

  return { campaigns, channels, gaps };
}
