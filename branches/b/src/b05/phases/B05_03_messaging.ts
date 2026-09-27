// B05.03 — Messaging Strategy Synthesis
// Create messaging strategies for each segment

import type { MessagingStrategy } from "../types.js";
import type { EvidenceRef } from "../../types/entities.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import type { CreativeContext } from "./B05_01_registry.js";

export function synthesizeMessagingStrategies(
  context: CreativeContext,
  deps?: { hash?: { stableMessagingId: (segmentId: string, campaignId: string) => string }; now?: () => string },
): MessagingStrategy[] {
  const strategies: MessagingStrategy[] = [];
  const stableMessagingId =
    deps?.hash?.stableMessagingId || ((sid: string, cid: string) => `msg_${sid}_${cid}`);
  const now = deps?.now?.() || new Date().toISOString();

  for (const segment of context.segments) {
    for (const campaign of context.campaigns) {
      if (!campaign.target_segments.includes(segment.segment_id)) continue;

      const strategy: MessagingStrategy = {
        messaging_id: stableMessagingId(segment.segment_id, campaign.campaign_id),
        segment_id: segment.segment_id,
        campaign_id: campaign.campaign_id,

        primary_message: generatePrimaryMessage(campaign, segment),
        supporting_messages: generateSupportingMessages(campaign, segment),
        value_proposition: generateValueProposition(context.brand_positioning, segment),

        pain_points_addressed: segment.pain_points || [],
        desired_outcome: `${segment.segment_name} achieves ${campaign.primary_objective.toLowerCase()}`,

        language_style: inferLanguageStyle(segment.segment_name),
        key_terminology: inferKeyTerminology(segment),

        evidence_refs: [
          {
            id: `ev_msg_${stableMessagingId(segment.segment_id, campaign.campaign_id)}`,
            source: `segment:${segment.segment_id},campaign:${campaign.campaign_id}`,
            status: "INFERRED" as const,
            excerpt: `Messaging for ${segment.segment_name} in ${campaign.campaign_name}`,
          },
        ],
        provenance: {
          type: "INFERRED" as const,
          decision_authority: `B05_03:synthesizeMessagingStrategies`,
          timestamp: now,
          rationale: `Generated from segment characteristics and campaign objectives`,
        },
        derivation_basis: "TEMPLATE",
      };

      strategies.push(strategy);
    }
  }

  return strategies;
}

function generatePrimaryMessage(campaign: { campaign_name: string; primary_objective: string }, segment: { segment_name: string }): string {
  return `${campaign.campaign_name}: Achieve ${campaign.primary_objective.toLowerCase()} for ${segment.segment_name}`;
}

function generateSupportingMessages(campaign: { territories?: string[]; campaign_name?: string }, segment: { pain_points?: string[]; segment_name: string }): string[] {
  const messages: string[] = [];

  if (segment.pain_points && segment.pain_points.length > 0) {
    messages.push(`Solves: ${segment.pain_points[0]}`);
  }

  messages.push(`Specific to ${segment.segment_name} needs`);

  if (campaign.territories && campaign.territories.length > 0) {
    messages.push(`Available in: ${campaign.territories.join(", ")}`);
  }

  return messages.slice(0, 3); // Cap at 3
}

function generateValueProposition(brandPositioning: string, segment: { pain_points?: string[]; segment_name: string }): string {
  if (segment.pain_points && segment.pain_points.length > 0 && segment.pain_points[0]) {
    return `${brandPositioning} addresses ${segment.pain_points[0].toLowerCase()}`;
  }
  return `${brandPositioning} benefits ${segment.segment_name}`;
}

function inferLanguageStyle(segmentName: string): string {
  if (segmentName.toLowerCase().includes("executive") || segmentName.toLowerCase().includes("cto")) {
    return "Professional, data-driven";
  }
  if (segmentName.toLowerCase().includes("developer")) {
    return "Technical, practical";
  }
  return "Accessible, inclusive";
}

function inferKeyTerminology(segment: { segment_name: string; characteristics?: { industry?: string[] } }): string[] {
  const terminology: string[] = [];

  if (segment.segment_name.toLowerCase().includes("executive")) {
    terminology.push("ROI", "Strategic impact", "Competitive advantage");
  } else if (segment.segment_name.toLowerCase().includes("developer")) {
    terminology.push("Implementation", "Integration", "API", "Performance");
  }

  if (segment.characteristics?.industry && Array.isArray(segment.characteristics.industry)) {
    segment.characteristics.industry.forEach(ind => terminology.push(ind));
  }

  return terminology.slice(0, 4);
}
