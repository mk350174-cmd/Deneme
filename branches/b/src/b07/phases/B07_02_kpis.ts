// B07.02 — KPI Definition

import type { KPIDefinition } from "../types.js";
import type { PerformanceContext } from "./B07_01_registry.js";

const CHANNEL_KPIS: { [key: string]: string[] } = {
  youtube: ["Watch Time", "Click-Through Rate", "Subscriber Growth"],
  linkedin: ["Impressions", "Engagement Rate", "Click-Through Rate"],
  tiktok: ["Views", "Engagement Rate", "Share Rate"],
  instagram: ["Reach", "Engagement Rate", "Follower Growth"],
};

export function defineKPIs(
  context: PerformanceContext,
  deps?: { hash?: { stableKPIId: (campaignId: string, metricName: string) => string }; now?: () => string },
): KPIDefinition[] {
  const kpis: KPIDefinition[] = [];
  const stableKPIId =
    deps?.hash?.stableKPIId || ((cid: string, mn: string) => `kpi_${cid}_${mn.replace(/\s+/g, "_").toLowerCase()}`);
  const now = deps?.now?.() || new Date().toISOString();

  for (const campaign of context.campaigns) {
    for (const channel of context.channels) {
      const metrics = CHANNEL_KPIS[channel.channel_id.toLowerCase()] || ["Views", "Engagement"];

      for (const metric of metrics) {
        const kpi: KPIDefinition = {
          kpi_id: stableKPIId(campaign.campaign_id, metric),
          campaign_id: campaign.campaign_id,
          channel_id: channel.channel_id,

          metric_name: metric,
          metric_category: inferCategory(metric),

          calculation_method: `Track ${metric} via ${channel.name} native analytics`,
          data_sources: [`${channel.name} Analytics`],

          target_value: inferTargetValue(metric),
          target_unit: inferUnit(metric),
          target_definition: { value: inferTargetValue(metric), unit: inferUnit(metric), basis: "DEFAULT", source: "B07 framework default", status: "INFERRED", version: "framework-v1" },
          benchmark: undefined,
          benchmark_definition: { basis: "UNKNOWN", status: "UNKNOWN", version: "framework-v1" },

          evidence_refs: [
            {
              id: `ev_kpi_${stableKPIId(campaign.campaign_id, metric)}`,
              source: `campaign:${campaign.campaign_id},channel:${channel.channel_id}`,
              status: "INFERRED" as const,
              excerpt: `KPI: ${metric}`,
            },
          ],
          provenance: {
            type: "INFERRED" as const,
            decision_authority: `B07_02:defineKPIs`,
            timestamp: now,
            rationale: `KPI defined for ${campaign.campaign_name} on ${channel.name}`,
          },
        };

        kpis.push(kpi);
      }
    }
  }

  return kpis;
}

function inferCategory(
  metric: string,
): "engagement" | "reach" | "conversion" | "retention" | "brand_lift" {
  const lower = metric.toLowerCase();
  if (lower.includes("engagement") || lower.includes("click")) return "engagement";
  if (lower.includes("view") || lower.includes("reach") || lower.includes("impression"))
    return "reach";
  if (lower.includes("conversion")) return "conversion";
  if (lower.includes("retention") || lower.includes("subscriber")) return "retention";
  return "engagement";
}

function inferTargetValue(metric: string): number {
  const lower = metric.toLowerCase();
  if (lower.includes("rate") || lower.includes("percentage")) return 5;
  if (lower.includes("growth")) return 20;
  return 1000; // Views/impressions
}

function inferUnit(metric: string): string {
  const lower = metric.toLowerCase();
  if (lower.includes("rate")) return "percent";
  if (lower.includes("time")) return "minutes";
  if (lower.includes("growth")) return "percent";
  return "count";
}
