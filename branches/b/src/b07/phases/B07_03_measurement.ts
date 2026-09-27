// B07.03 — Measurement Plans

import type { MeasurementPlan } from "../types.js";
import type { PerformanceContext } from "./B07_01_registry.js";

export function createMeasurementPlans(
  context: PerformanceContext,
  kpiCount: number,
  deps?: { hash?: { stablePlanId: (campaignId: string) => string }; now?: () => string },
): MeasurementPlan[] {
  const plans: MeasurementPlan[] = [];
  const stablePlanId = deps?.hash?.stablePlanId || ((cid: string) => `plan_${cid}`);
  const now = deps?.now?.() || new Date().toISOString();

  for (const campaign of context.campaigns) {
    const plan: MeasurementPlan = {
      plan_id: stablePlanId(campaign.campaign_id),
      campaign_id: campaign.campaign_id,

      tracked_kpis: [], // Will be filled by campaign

      measurement_frequency: "daily",
      reporting_cadence: "weekly report on Mondays",

      data_collection_method: "DEFINED integration contract: native platform API connection/fetch must be established in B08",
      tools: Array.from(new Set(context.channels.map((c) => `${c.name} Analytics`))),
      dashboards: [`Campaign Dashboard for ${campaign.campaign_name}`],

      minimum_sample_size: 100,
      minimum_sample_size_basis: "DEFAULT",
      execution_state: "DEFINED",

      evidence_refs: [
        {
          id: `ev_plan_${stablePlanId(campaign.campaign_id)}`,
          source: `campaign:${campaign.campaign_id}`,
          status: "INFERRED" as const,
          excerpt: `Measurement plan for ${campaign.campaign_name}`,
        },
      ],
      provenance: {
        type: "INFERRED" as const,
        decision_authority: `B07_03:createMeasurementPlans`,
        timestamp: now,
        rationale: `Measurement plan defined for tracking KPIs`,
      },
    };

    plans.push(plan);
  }

  return plans;
}
