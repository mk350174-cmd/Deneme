// B06.01 — Distribution Context Registry

import type { B01CanonicalState } from "../../b00/contracts.js";
import type { B03CandidateState } from "../../b03/types.js";
import type { B04CandidateState, B04CanonicalState, CampaignStrategy } from "../../b04/types.js";
import type { AudienceSegment } from "../../b03/types.js";

export interface DistributionContext {
  brand_name: string;
  campaigns: Array<{
    campaign_id: string;
    campaign_name: string;
    target_segments: string[];
    territories: string[];
  }>;
  channels: Array<{
    channel_id: string;
    name: string;
    platform: string;
  }>;
  segments: Array<{
    segment_id: string;
    segment_name: string;
  }>;
  gaps: string[];
}

export function buildDistributionContext(
  b01State: B01CanonicalState,
  b03State: B03CandidateState,
  b04State: B04CandidateState | B04CanonicalState,
): DistributionContext {
  const gaps: string[] = [];

  const brand_name = b01State?.brand_profile?.brand_name || "UNKNOWN";

  const campaigns = b04State?.campaigns?.map((c: CampaignStrategy) => ({
    campaign_id: c.campaign_id,
    campaign_name: c.campaign_name,
    target_segments: c.target_segments || [],
    territories: c.territories || [],
  })) || [];

  if (campaigns.length === 0) {
    gaps.push("no_campaigns_available");
  }

  const channels = b01State?.channels || [];
  if (channels.length === 0) {
    gaps.push("no_channels_available");
  }

  const segments = b03State?.audience_segments?.map((s: AudienceSegment) => ({
    segment_id: s.segment_id,
    segment_name: s.segment_name,
  })) || [];

  if (segments.length === 0) {
    gaps.push("no_audience_segments_available");
  }

  return { brand_name, campaigns, channels, segments, gaps };
}

export function validateDistributionContext(context: DistributionContext): {
  valid: boolean;
  gaps: string[];
} {
  const gaps = [...context.gaps];

  if (context.campaigns.length === 0) {
    gaps.push("at_least_one_campaign_required");
  }

  if (context.channels.length === 0) {
    gaps.push("at_least_one_channel_required");
  }

  return { valid: gaps.length === 0, gaps };
}
