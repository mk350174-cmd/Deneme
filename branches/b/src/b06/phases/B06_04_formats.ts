// B06.04 — Format Rules
// Define content format rules for channels

import type { FormatRule } from "../types.js";
import type { ChannelSelection } from "../types.js";

export function defineFormatRules(
  selections: ChannelSelection[],
  deps?: { hash?: { stableFormatRuleId: (campaignId: string, channelId: string) => string }; now?: () => string },
): FormatRule[] {
  const rules: FormatRule[] = [];
  const stableFormatRuleId =
    deps?.hash?.stableFormatRuleId || ((cid: string, chid: string) => `fmt_${cid}_${chid}`);
  const timestamp = deps?.now?.() || new Date().toISOString();

  for (const selection of selections) {
    const rule: FormatRule = {
      rule_id: stableFormatRuleId(selection.campaign_id, selection.channel_id),
      campaign_id: selection.campaign_id,
      channel_id: selection.channel_id,

      preferred_content_formats: inferPreferredFormats(selection.channel_id),
      forbidden_formats: inferForbiddenFormats(selection.channel_id),

      duration_category: inferDurationCategory(selection.channel_id),
      duration_guidance: inferDurationGuidance(selection.channel_id),
      rule_basis: "DEFAULT",

      quality_standards: ["mobile_optimized", "accessible", "on_brand"],

      evidence_refs: [
        {
          id: `ev_fmt_${stableFormatRuleId(selection.campaign_id, selection.channel_id)}`,
          source: `channel:${selection.channel_id}`,
          status: "INFERRED" as const,
          excerpt: `Format rules for ${selection.channel_id}`,
        },
      ],
      provenance: {
        type: "INFERRED" as const,
        decision_authority: `B06_04:defineFormatRules`,
        timestamp,
        rationale: `Format rules inferred from channel platform capabilities`,
      },
    };

    rules.push(rule);
  }

  return rules;
}

function inferPreferredFormats(channelId: string): string[] {
  const formatsByChannel: { [key: string]: string[] } = {
    youtube: ["short_video", "long_video", "playlist"],
    linkedin: ["article", "carousel", "video"],
    tiktok: ["short_video", "remix"],
    instagram: ["carousel", "reel", "story"],
  };
  return formatsByChannel[channelId.toLowerCase()] || ["video", "text"];
}

function inferForbiddenFormats(channelId: string): string[] {
  const forbiddenByChannel: { [key: string]: string[] } = {
    linkedin: ["short_video_clips", "memes"],
    youtube: ["text_only"],
  };
  return forbiddenByChannel[channelId.toLowerCase()] || [];
}

function inferDurationCategory(channelId: string): "short" | "medium" | "long" | "flexible" {
  if (channelId.toLowerCase() === "tiktok") {
    return "short";
  }
  if (channelId.toLowerCase() === "youtube") {
    return "flexible";
  }
  return "medium";
}

function inferDurationGuidance(channelId: string): string {
  const guidanceByChannel: { [key: string]: string } = {
    youtube: "Framework default: 15-60 seconds for short-form; long-form may be longer",
    linkedin: "Framework default: 30-90 seconds; platform limits must be checked at execution time",
    tiktok: "Framework default: 15-30 seconds; not an empirically verified optimum",
    instagram: "Framework default: short-form pacing; platform limits must be checked at execution time",
  };
  return guidanceByChannel[channelId.toLowerCase()] || "Strategic duration";
}
