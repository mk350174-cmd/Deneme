// B01.08 — Distribution Strategy
// Define strategic routing of content across channels: timing, formats, territory constraints.
// CRITICAL: STRATEGY only. No production specs (resolution, bitrate, exact seconds). the downstream production branch handles production.

import type { B01Deps, EcosystemData, RoleMap, TerritoryData, DistributionData } from "../types.js";
import type { EvidenceRef } from "../../types/entities.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import { stableEvidenceId } from "../../b00/stableIds.js";

/**
 * Create evidence ref for distribution strategy
 */
function createEvidenceRef(source: string, seed: string): EvidenceRef {
  return {
    id: stableEvidenceId(source, seed),
    source,
    status: "INFERRED", // Distribution strategies inferred from roles + territories; user approval required
    excerpt: `Distribution strategy from ${source}`,
  };
}

/**
 * Create provenance ref marking strategies as INFERRED (preliminary)
 */
function createProvenanceRef(type: "INFERRED" | "OBSERVED" | "DECIDED" = "INFERRED"): ProvenanceRef {
  return {
    type,
    decision_authority: type === "INFERRED" ? "B01.08_algorithm" : "user",
    timestamp: new Date().toISOString(),
  };
}

/**
 * Determine distribution role based on channel role
 *
 * Channel role → Distribution role mapping:
 * - primary → primary_channel (high priority, regular posting)
 * - secondary → secondary_channel (supporting role, less frequent)
 * - experimental → testing_ground (low priority, safe for experimentation)
 */
function mapChannelRoleToDistributionRole(
  channelRole: string,
): "primary_channel" | "secondary_channel" | "testing_ground" | "UNKNOWN" {
  if (channelRole === "primary") return "primary_channel";
  if (channelRole === "secondary") return "secondary_channel";
  if (channelRole === "experimental") return "testing_ground";
  return "UNKNOWN";
}

/**
 * Infer routing priority based on channel role and platform capabilities
 *
 * Priority 1: Primary channels with established platforms
 * Priority 2: Secondary channels
 * Priority 3+: Experimental channels
 *
 * Returns integer 1-N where 1 is highest priority
 */
function inferRoutingPriority(channelRole: string, hasCapabilities: boolean): number {
  if (channelRole === "primary" && hasCapabilities) return 1;
  if (channelRole === "primary" && !hasCapabilities) return 2;
  if (channelRole === "secondary") return 3;
  if (channelRole === "experimental") return 4;
  return 5; // Unknown
}

/**
 * Infer posting frequency based on channel role (strategic category, not exact schedule)
 *
 * Categories only: daily, weekly, 2-3_weekly, as_available
 * NOT exact times like "Tuesday 2:34pm UTC" (that belongs to the downstream production layer)
 */
function inferPostingFrequency(channelRole: string): "daily" | "weekly" | "2_3_weekly" | "as_available" {
  if (channelRole === "primary") return "daily"; // Primary channels need regular cadence
  if (channelRole === "secondary") return "2_3_weekly"; // Secondary channels less frequent
  if (channelRole === "experimental") return "as_available"; // Experimental has flexible timing
  return "as_available"; // Default
}

/**
 * B01.08 phase: Define distribution strategy
 *
 * Input: EcosystemData, RoleMap, TerritoryData, PlatformRegistry (for capabilities)
 * Output: DistributionData with strategic channel assignments (NO production specs)
 *
 * CRITICAL BOUNDARIES:
 * 1. This phase defines STRATEGY (routing, timing categories, format categories)
 * 2. The downstream production branch handles PRODUCTION ADAPTATION (exact times, resolutions, bitrates, templates)
 * 3. No decision is final; all marked INFERRED, awaiting user approval
 *
 * DistributionData structure:
 * - strategy_description: summary of routing strategy
 * - channel_assignments: array of {
 *     channel_id,
 *     distribution_role: "primary_channel" | "secondary_channel" | "testing_ground" | "UNKNOWN",
 *     routing_priority: 1 (highest) to N,
 *     timing_rules: { posting_frequency: "daily"|"weekly"|"2_3_weekly"|"as_available", optimal_times?, timezone_adapted? },
 *     format_rules: { preferred_formats: ["short_video"|"carousel"|...], forbidden_formats: [], strategic_duration_category: "short"|"medium"|"long"|"flexible" },
 *     territory_rules: { allowed_territories: [ids], geo_restrictions: [], age_restrictions? },
 *     evidence_refs: [...]
 *   }
 * - evidence_refs: phase-level evidence
 * - recommendation: (implicit; user approval required for canonical)
 */
export async function runPhaseB0108(
  ecosystem: EcosystemData,
  roleMap: RoleMap,
  territories: TerritoryData,
  _deps?: B01Deps,
): Promise<DistributionData> {
  const channelAssignments: DistributionData["channel_assignments"] = [];
  const evidenceRefs: EvidenceRef[] = [];

  if (!ecosystem.channels || ecosystem.channels.length === 0) {
    return {
      strategy_description: "No channels to distribute",
      channel_assignments: [],
      evidence_refs: [],
      provenance_refs: [],
    };
  }

  // Build territory ID → territory object map for lookups
  const territoryMap = new Map<string, (typeof territories.territories)[0]>();
  for (const terr of territories.territories) {
    territoryMap.set(terr.territory_id, terr);
  }

  // Process each channel
  for (const channel of ecosystem.channels) {
    const channelRole = roleMap[channel.channel_id]?.role ?? "UNKNOWN";

    // Create evidence for this assignment
    const evRef = createEvidenceRef(
      `B01.08:distribution_assignment`,
      `${channel.channel_id}:${channel.platform}`,
    );
    evidenceRefs.push(evRef);

    // Determine distribution role
    const distribution_role = mapChannelRoleToDistributionRole(channelRole);

    // Infer routing priority (1 = highest)
    const routing_priority = inferRoutingPriority(channelRole, true); // Assume capabilities for now

    // Infer timing strategy (category, not exact times)
    const posting_frequency = inferPostingFrequency(channelRole);

    // Infer format strategy (categories only, not production specs)
    const preferred_formats: string[] = [];
    const forbidden_formats: string[] = [];
    let strategic_duration_category: "short" | "medium" | "long" | "flexible" = "flexible";

    const platformStr = String(channel.platform).toLowerCase();
    if (platformStr.includes("tiktok") || platformStr.includes("instagram") || platformStr.includes("youtube_shorts")) {
      preferred_formats.push("short_video");
      strategic_duration_category = "short";
    } else if (platformStr.includes("youtube") || platformStr.includes("vimeo")) {
      preferred_formats.push("long_video");
      strategic_duration_category = "long";
    } else if (platformStr.includes("linkedin") || platformStr.includes("twitter")) {
      preferred_formats.push("text", "carousel");
      strategic_duration_category = "medium";
    }

    // Territory rules: all territories allowed by default, user can restrict
    const allowed_territories = territories.territories.map((t) => t.territory_id);
    const geo_restrictions: string[] = [];
    const age_restrictions: string | undefined = undefined;

    // Create assignment
    channelAssignments.push({
      channel_id: channel.channel_id,
      distribution_role,
      routing_priority,
      timing_rules: {
        posting_frequency,
        optimal_times: [], // User defines; B01 doesn't prescribe exact times
        timezone_adapted: channelRole === "primary", // Primary channels adapt to timezone
      },
      format_rules: {
        preferred_formats: preferred_formats.length > 0 ? preferred_formats : ["mixed"],
        forbidden_formats,
        strategic_duration_category,
      },
      territory_rules: {
        allowed_territories,
        geo_restrictions,
        age_restrictions,
      },
      evidence_refs: [evRef],
      provenance_refs: [
        { ...createProvenanceRef("INFERRED"), id: `prov_${channel.channel_id}_distribution` },
      ],
    });
  }

  // Sort assignments by routing priority (1 first)
  channelAssignments.sort((a, b) => a.routing_priority - b.routing_priority);

  const phaseProvenanceRef: ProvenanceRef = {
    ...createProvenanceRef("INFERRED"),
    id: "prov_distribution_strategy",
    rationale: `Algorithm derived distribution strategy for ${channelAssignments.length} channel(s) from role + territory data`,
  };

  return {
    strategy_description: `Distribution strategy for ${ecosystem.channels.length} channels: ${channelAssignments.length} assignments by priority`,
    channel_assignments: channelAssignments,
    evidence_refs: evidenceRefs,
    provenance_refs: [phaseProvenanceRef],
  };
}
