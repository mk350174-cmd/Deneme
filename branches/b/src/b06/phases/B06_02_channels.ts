// B06.02 — Channel Selection
// Select rule-based channel candidates for each campaign

import type { ChannelSelection } from "../types.js";
import type { DistributionContext } from "./B06_01_registry.js";

export function selectChannelsForCampaigns(
  context: DistributionContext,
  deps?: { hash?: { stableSelectionId: (campaignId: string, channelId: string) => string }; now?: () => string },
): ChannelSelection[] {
  const selections: ChannelSelection[] = [];
  const stableSelectionId =
    deps?.hash?.stableSelectionId || ((cid: string, chid: string) => `sel_${cid}_${chid}`);
  const timestamp = deps?.now?.() || new Date().toISOString();

  for (const campaign of context.campaigns) {
    // Rank channels by platform fit
    const rankedChannels = context.channels
      .map((ch) => ({
        channel: ch,
        fit: calculateChannelFit(ch, campaign),
      }))
      .filter((x) => x.fit > 0)
      .sort((a, b) => b.fit - a.fit);

    for (let rank = 0; rank < rankedChannels.length; rank++) {
      const { channel, fit } = rankedChannels[rank]!;
      const role: "primary_channel" | "secondary_channel" | "testing_ground" | "experimental" =
        rank === 0 ? "primary_channel" : rank === 1 ? "secondary_channel" : rank === 2 ? "testing_ground" : "experimental";

      const selection: ChannelSelection = {
        selection_id: stableSelectionId(campaign.campaign_id, channel.channel_id),
        campaign_id: campaign.campaign_id,
        channel_id: channel.channel_id,
        role,
        priority_rank: rank + 1,
        rationale: `Selected for ${campaign.campaign_name} - platform fit: ${(fit * 100).toFixed(0)}%`,
        strategic_fit: fit,
        fit_basis: "HEURISTIC",
        evidence_refs: [
          {
            id: `ev_sel_${stableSelectionId(campaign.campaign_id, channel.channel_id)}`,
            source: `campaign:${campaign.campaign_id},channel:${channel.channel_id}`,
            status: "INFERRED" as const,
            excerpt: `Channel fit score: ${fit}`,
          },
        ],
        provenance: {
          type: "INFERRED" as const,
          decision_authority: `B06_02:selectChannelsForCampaigns`,
          timestamp,
          rationale: `Selected based on platform capabilities and campaign targeting`,
        },
      };

      selections.push(selection);

      // Only select top 3 channels per campaign
      if (rank >= 2) break;
    }
  }

  return selections;
}

function calculateChannelFit(
  channel: { channel_id: string; name: string; platform: string },
  campaign: { campaign_id: string; campaign_name: string; target_segments: string[]; territories: string[] },
): number {
  let fit = 0.5; // Base fit

  // Territory fit (if channel platform has global reach, assume 0.3 boost)
  if (channel.platform && campaign.territories && campaign.territories.length > 0) {
    fit += 0.2;
  }

  // Segment fit (presence = presence assumption)
  if (campaign.target_segments && campaign.target_segments.length > 0) {
    fit += 0.15;
  }

  // Platform-specific bonuses
  if (channel.platform === "YOUTUBE" || channel.platform === "TIKTOK") {
    fit += 0.15; // Video platforms
  }

  return Math.min(fit, 1.0);
}
