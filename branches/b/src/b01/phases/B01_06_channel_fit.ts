// B01.06 — Channel-Platform Fit Analysis
// Score channel-platform compatibility based on roles, capabilities, and audience.
// CRITICAL: Preliminary fit only. Deep audience research is B03's job; B01 uses categories only.

import type { B01Deps, EcosystemData, RoleMap, PlatformRegistry, ChannelFitMap } from "../types.js";
import type { EvidenceRef } from "../../types/entities.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import { stableEvidenceId } from "../../b00/stableIds.js";

/**
 * Create evidence ref for fit scoring
 */
function createEvidenceRef(source: string, seed: string): EvidenceRef {
  return {
    id: stableEvidenceId(source, seed),
    source,
    status: "INFERRED", // Fit scores are preliminary; verified only by user approval
    excerpt: `Channel-platform fit evaluation from ${source}`,
  };
}

/**
 * Create provenance ref marking fit scores as INFERRED (preliminary)
 */
function createProvenanceRef(type: "INFERRED" | "OBSERVED" | "DECIDED" = "INFERRED"): ProvenanceRef {
  return {
    type,
    decision_authority: type === "INFERRED" ? "B01.06_algorithm" : "user",
    timestamp: new Date().toISOString(),
  };
}

/**
 * Score channel-platform fit (0-1)
 *
 * Factors:
 * 1. Role compatibility: primary channels fit established platforms; experimental fit emerging platforms
 * 2. Audience category: align channel audience with platform strength (e.g., gen_z → TikTok/Instagram, professional → LinkedIn)
 * 3. Capability availability: platform must have capabilities for channel's planned content
 * 4. Maturity alignment: experimental channels can try new platforms; primary channels need proven ones
 *
 * Algorithm:
 * - Start with base fit 0.5 (neutral)
 * - Add bonus for role-audience-platform alignment (0.0–0.4)
 * - Subtract penalty for capability gaps (0.0–0.3)
 * - Clamp to [0, 1]
 */
function scoreChannelFit(
  channelId: string,
  channelAudience: string | undefined,
  role: string,
  platform: string,
  platformRegistry: PlatformRegistry,
): { fit_score: number; reasoning: string[] } {
  const reasoning: string[] = [];
  let score = 0.5; // Neutral baseline

  // Guard: platform must exist in registry
  const platEntry = platformRegistry[platform];
  if (!platEntry) {
    reasoning.push(`platform_${platform}_not_in_registry`);
    return { fit_score: 0.0, reasoning };
  }

  // Factor 1: Role compatibility
  if (role === "primary") {
    // Primary channels need established platforms with existing presence
    const hasCapabilities = platEntry.capabilities && platEntry.capabilities.length > 0;
    if (hasCapabilities) {
      score += 0.25;
      reasoning.push("primary_channel_matches_established_platform");
    } else {
      score -= 0.15;
      reasoning.push("primary_channel_lacks_platform_capabilities");
    }
  } else if (role === "secondary") {
    // Secondary channels can use established platforms
    const hasCapabilities = platEntry.capabilities && platEntry.capabilities.length > 0;
    if (hasCapabilities) {
      score += 0.2;
      reasoning.push("secondary_channel_matches_platform");
    } else {
      score -= 0.1;
      reasoning.push("secondary_channel_capability_gap");
    }
  } else if (role === "experimental") {
    // Experimental channels can try new/emerging platforms
    score += 0.15;
    reasoning.push("experimental_channel_allows_platform_exploration");
  } else {
    reasoning.push("role_unknown");
  }

  // Factor 2: Audience-platform alignment (preliminary, not deep segmentation)
  // Map platform to typical audience strength
  const platformAudienceStrength: Record<string, string[]> = {
    youtube: ["general", "creators", "entertainment"],
    tiktok: ["gen_z", "entertainment", "trends"],
    instagram: ["gen_z", "visual", "lifestyle"],
    linkedin: ["professional", "b2b", "career"],
    twitter: ["news", "discussion", "general"],
    reddit: ["niche", "communities", "discussion"],
    tikhtok: ["gen_z"],
  };

  const platformStrength = platformAudienceStrength[platform] || [];
  if (channelAudience && platformStrength.includes(channelAudience)) {
    score += 0.15;
    reasoning.push(`audience_${channelAudience}_aligns_with_${platform}`);
  } else if (channelAudience) {
    reasoning.push(`audience_${channelAudience}_not_primary_fit_for_${platform}`);
  }

  // Factor 3: Capability availability (0.1 bonus if capabilities present)
  if (platEntry.capabilities && platEntry.capabilities.length > 0) {
    score += 0.1;
    reasoning.push(`platform_has_${platEntry.capabilities.length}_capabilities`);
  } else {
    reasoning.push("platform_has_no_defined_capabilities");
  }

  // Clamp to [0, 1]
  const final_score = Math.max(0, Math.min(1, score));

  return { fit_score: final_score, reasoning };
}

/**
 * B01.06 phase: Analyze channel-platform fit
 *
 * Input: EcosystemData, RoleMap, PlatformRegistry
 * Output: ChannelFitMap with fit scores for each channel
 *
 * CRITICAL: This is preliminary fit analysis. Deep audience research (segmentation, pain points, needs)
 * belongs to B03 (Audience Intelligence), not B01. B01.06 uses audience CATEGORIES only.
 *
 * Each fit score is marked INFERRED; user approval required to make canonical.
 */
export async function runPhaseB0106(
  ecosystem: EcosystemData,
  roleMap: RoleMap,
  platformRegistry: PlatformRegistry,
  _deps?: B01Deps,
): Promise<ChannelFitMap> {
  const fitMap: ChannelFitMap = {};

  if (!ecosystem.channels || ecosystem.channels.length === 0) {
    return {};
  }

  for (const channel of ecosystem.channels) {
    // Get role (default UNKNOWN if not found)
    const role = roleMap[channel.channel_id]?.role ?? "UNKNOWN";

    // Score fit
    const { fit_score, reasoning } = scoreChannelFit(
      channel.channel_id,
      channel.audience_category,
      role,
      channel.platform,
      platformRegistry,
    );

    // Create evidence for this fit score
    const evRef = createEvidenceRef(
      `B01.06:channel_fit`,
      `${channel.channel_id}:${channel.platform}`,
    );

    // Mark as INFERRED (not DECIDED)
    const provRef = createProvenanceRef("INFERRED");

    fitMap[channel.channel_id] = {
      fit_score,
      platform: channel.platform,
      audience_category: channel.audience_category ?? "UNKNOWN",
      reasoning,
      provenance_refs: [provRef],
      evidence_refs: [evRef],
    };
  }

  return fitMap;
}
