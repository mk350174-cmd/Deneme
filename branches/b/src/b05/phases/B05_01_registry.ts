// B05.01 — Creative Context Registry
// Extract brand, campaigns, segments for creative synthesis

import type { B01CanonicalState } from "../../b00/contracts.js";
import type { B03CandidateState, AudienceSegment, AudienceCharacteristics } from "../../b03/types.js";
import type { B04CandidateState, B04CanonicalState, CampaignStrategy } from "../../b04/types.js";

export interface CreativeContext {
  brand_name: string;
  brand_positioning: string;
  brand_values: string[];

  campaigns: Array<{
    campaign_id: string;
    campaign_name: string;
    primary_objective: string;
    target_segments: string[];
    territories: string[];
  }>;

  segments: Array<{
    segment_id: string;
    segment_name: string;
    characteristics: AudienceCharacteristics;
    pain_points?: string[];
    questions?: string[];
  }>;

  gaps: string[];
}

export function buildCreativeContext(b01State: B01CanonicalState, b03State: B03CandidateState, b04State: B04CandidateState | B04CanonicalState): CreativeContext {
  const gaps: string[] = [];

  // Brand from B01
  const brand_name = b01State.brand_profile?.brand_name || "UNKNOWN";
  const brand_positioning = b01State.brand_profile?.positioning || "UNKNOWN";
  const brand_values = b01State.brand_profile?.values || [];

  if (brand_positioning === "UNKNOWN") {
    gaps.push("brand_positioning_undefined");
  }

  // Campaigns from B04
  const campaigns = b04State?.campaigns?.map((c: CampaignStrategy) => ({
    campaign_id: c.campaign_id,
    campaign_name: c.campaign_name,
    primary_objective: c.primary_objective,
    target_segments: c.target_segments || [],
    territories: c.territories || [],
  })) || [];

  if (campaigns.length === 0) {
    gaps.push("no_campaigns_available");
  }

  // Segments from B03
  const segments = b03State?.audience_segments?.map((s: AudienceSegment) => ({
    segment_id: s.segment_id,
    segment_name: s.segment_name,
    characteristics: s.characteristics,
  })) || [];

  if (segments.length === 0) {
    gaps.push("no_audience_segments_available");
  }

  return {
    brand_name,
    brand_positioning,
    brand_values,
    campaigns,
    segments,
    gaps,
  };
}

export function validateCreativeContext(context: CreativeContext): {
  valid: boolean;
  gaps: string[];
} {
  const gaps = [...context.gaps];

  if (context.brand_positioning === "UNKNOWN") {
    gaps.push("brand_positioning_required");
  }

  if (context.campaigns.length === 0) {
    gaps.push("at_least_one_campaign_required");
  }

  if (context.segments.length === 0) {
    gaps.push("at_least_one_segment_required");
  }

  return {
    valid: gaps.length === 0,
    gaps,
  };
}
