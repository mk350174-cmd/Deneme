// B08.02 — Data Source Definition

import type { DataSourceDefinition } from "../types.js";
import type { AnalyticsContext } from "./B08_01_registry.js";

const CHANNEL_SOURCES: { [key: string]: string[] } = {
  youtube: ["YouTube Analytics", "YouTube Data API"],
  linkedin: ["LinkedIn Analytics", "LinkedIn API"],
  tiktok: ["TikTok Analytics", "TikTok Ads API"],
  instagram: ["Instagram Insights", "Facebook Business API"],
};

export function defineDataSources(
  context: AnalyticsContext,
  deps?: { hash?: { stableSourceId: (type: string, platform: string) => string }; now?: () => string },
): DataSourceDefinition[] {
  const sources: DataSourceDefinition[] = [];
  const stableSourceId =
    deps?.hash?.stableSourceId || ((type: string, platform: string) => `src_${type}_${platform}`.toLowerCase());
  const now = deps?.now?.() || new Date().toISOString();

  const seenSourceIds = new Set<string>();

  for (const channel of context.channels) {
    const sourceNames = CHANNEL_SOURCES[channel.channel_id.toLowerCase()] || ["Generic Analytics"];

    for (const sourceName of sourceNames) {
      const source_id = stableSourceId("native_platform", `${channel.channel_id}:${sourceName}`);

      if (seenSourceIds.has(source_id)) continue;
      seenSourceIds.add(source_id);

      const isNative = sourceName.toLowerCase().includes("analytics") && !sourceName.includes("Third");

      const source: DataSourceDefinition = {
        source_id,
        source_name: sourceName,
        source_type: isNative ? "native_platform" : "third_party_analytics",
        platform_id: channel.channel_id,
        api_available: sourceName.toLowerCase().includes("api") || sourceName.toLowerCase().includes("analytics") || sourceName.toLowerCase().includes("insights"),
        api_availability_basis: "CATALOG_DEFAULT",
        real_time: false,
        execution_state: "DEFINED",
        source_mode: "UNKNOWN",
        execution_verified: false,
        latency_hours: undefined,
        data_retention_days: undefined,

        evidence_refs: [
          {
            id: `ev_source_${source_id}`,
            source: `channel:${channel.channel_id}`,
            status: "INFERRED" as const,
            excerpt: `Data source for ${channel.name}`,
          },
        ],
        provenance: {
          type: "INFERRED" as const,
          decision_authority: "B08_02:defineDataSources",
          timestamp: now,
          rationale: `Data source identified for ${sourceName}`,
        },
      };

      sources.push(source);
    }
  }

  return sources;
}
