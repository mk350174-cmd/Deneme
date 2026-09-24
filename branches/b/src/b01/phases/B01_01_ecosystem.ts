// B01.01 — Ecosystem Discovery
// Normalize channels and platforms from user input, creating foundation for all phases

import type { B01Input, B01CanonicalState } from "../../b00/contracts.js";
import type { Platform } from "../../b00/terminology.js";
import { Platform as PlatformEnum, PLATFORMS_REGISTRY } from "../../b00/terminology.js";
import type { EcosystemData } from "../types.js";
import type { B01Deps } from "../types.js";
import type { EvidenceRef } from "../../types/entities.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import { stableEvidenceId } from "../../b00/stableIds.js";

/**
 * Normalize a user-provided platform string to canonical Platform enum.
 * Handles aliases (twitter→X, yt→YOUTUBE, etc.) and case-insensitivity.
 * Returns UNKNOWN if no match found.
 */
function normalizePlatform(rawPlatform: string): Platform {
  const normalized = rawPlatform.trim().toLowerCase();

  // Direct enum match (case-insensitive)
  for (const [key, value] of Object.entries(PlatformEnum)) {
    if (key.toLowerCase() === normalized) {
      return value as Platform;
    }
  }

  // Common aliases
  const aliases: Record<string, Platform> = {
    twitter: PlatformEnum.X,
    "x.com": PlatformEnum.X,
    youtube: PlatformEnum.YOUTUBE,
    yt: PlatformEnum.YOUTUBE,
    tiktok: PlatformEnum.TIKTOK,
    "tik tok": PlatformEnum.TIKTOK,
    linkedin: PlatformEnum.LINKEDIN,
    instagram: PlatformEnum.INSTAGRAM,
    ig: PlatformEnum.INSTAGRAM,
    fb: PlatformEnum.FACEBOOK,
    "youtube shorts": PlatformEnum.YOUTUBE_SHORTS,
    shorts: PlatformEnum.YOUTUBE_SHORTS,
  };

  if (aliases[normalized]) {
    return aliases[normalized];
  }

  return PlatformEnum.UNKNOWN;
}

/**
 * Create evidence ref for ecosystem discovery
 */
function createEvidenceRef(source: string, seed: string): EvidenceRef {
  return {
    id: stableEvidenceId(source, seed),
    source,
    status: "INFERRED",
    origin: "USER_ASSERTION",
    basis: "ASSERTED",
    source_mode: "REAL",
    production_eligible: true,
    excerpt: `Platform/channel discovered from ${source}`,
  };
}

/**
 * B01.01 phase: Discover and normalize ecosystem (channels + platforms)
 *
 * Input: B01Input with known_channels, known_platforms, user_input
 * Output: EcosystemData with normalized channels and platforms
 *
 * Algorithm:
 * 1. Extract user-provided channels (normalize platform, deduplicate by channel_id)
 * 2. Extract user-provided platforms
 * 3. Infer additional platforms from channels
 * 4. Merge user + inferred platforms (user overrides inferred)
 * 5. Tag all with evidence refs (source tracking)
 */
export async function runPhaseB0101(
  input: B01Input,
  _deps?: B01Deps,
): Promise<EcosystemData> {
  const channels: EcosystemData["channels"] = [];
  const platforms: Map<string, EcosystemData["platforms"][0]> = new Map();
  const evidence_refs: EvidenceRef[] = [];

  // Track channel_ids seen (deduplication)
  const seenChannelIds = new Set<string>();

  // Process known_channels
  if (input.known_channels && Array.isArray(input.known_channels)) {
    for (const ch of input.known_channels) {
      if (!ch || typeof ch !== "object") continue;

      const channelName = (ch.channel_name ?? ch.name ?? ch.channel_id ?? "").trim();
      const rawPlatform = (ch.platform ?? "").trim();

      if (!channelName || !rawPlatform) continue;

      const platform = normalizePlatform(rawPlatform);
      const channel_id = ch.channel_id ?? `ch_${channelName.toLowerCase().replace(/\s+/g, "_")}`;

      // Deduplication: skip if already seen
      if (seenChannelIds.has(channel_id)) continue;
      seenChannelIds.add(channel_id);

      const evRef = createEvidenceRef(`user_input:known_channels[${channels.length}]`, channelName);
      evidence_refs.push(evRef);

      channels.push({
        channel_id,
        name: channelName,
        raw_platform: rawPlatform,
        platform,
        audience_category: ch.audience_category,
        url: ch.url,
        source: `user_input:known_channels[${channels.length}]`,
        evidence_refs: [evRef],
      });

      // Infer platform entry if not yet seen
      if (!platforms.has(platform)) {
        const platformEntry: EcosystemData["platforms"][0] = {
          platform_id: `plat_${platform.toLowerCase().replace(/_/g, "")}`,
          name: rawPlatform,
          raw_name: rawPlatform !== platform ? rawPlatform : undefined,
        };
        platforms.set(platform, platformEntry);
      }
    }
  }

  // Process known_platforms (user-provided platform definitions)
  if (input.known_platforms && Array.isArray(input.known_platforms)) {
    for (const p of input.known_platforms) {
      if (!p || typeof p !== "object") continue;

      const name = (p.name ?? "").trim();
      if (!name) continue;

      const platform = normalizePlatform(name);
      const evRef = createEvidenceRef(`user_input:known_platforms[${Array.from(platforms.values()).length}]`, name);
      evidence_refs.push(evRef);

      const platformEntry: EcosystemData["platforms"][0] = {
        platform_id: `plat_${platform.toLowerCase().replace(/_/g, "")}`,
        name,
        raw_name: name !== platform ? name : undefined,
        evidence_refs: [evRef],
      };

      platforms.set(platform, platformEntry);
    }
  }

  // Merge inferred platforms from channels
  // (already done above in channel processing)

  // Provenance records that the system observed a user assertion; evidence status remains INFERRED, not VERIFIED.
  // (channels/platforms named explicitly by the user), it does not infer or
  // recommend anything — so each item's provenance type is OBSERVED, not
  // INFERRED/RECOMMENDED.
  const provenance_refs: ProvenanceRef[] = channels.map((ch) => ({
    id: stableEvidenceId("B01.01:provenance", ch.channel_id),
    type: "OBSERVED",
    decision_authority: "B01_ecosystem_discovery",
    timestamp: new Date().toISOString(),
    rationale: `Channel "${ch.name}" observed directly from ${ch.source}`,
  }));

  return {
    channels,
    platforms: Array.from(platforms.values()),
    evidence_refs,
    provenance_refs,
  };
}
