import { describe, it, expect } from "vitest";
import { validateEvidenceSemantics } from "../../src/b00/evidence.js";
import { platformRegistryProvenance, KNOWN_CANONICALIZATION_DROPS } from "../../src/b01/orchestration.js";
import { validateAnalyticsResult, providerExecutionClaim } from "../../src/b08/execution.js";
import { generateLearningObservations, isLearningEligibleAnalyticsResult } from "../../src/b09/phases/B09_01_observations.js";
import { synthesizeCampaigns } from "../../src/b04/phases/B04_03_synthesis.js";
import { synthesizeCreativeAngles } from "../../src/b05/phases/B05_02_angles.js";
import { createContentSchedules } from "../../src/b06/phases/B06_03_scheduling.js";
import { defineSuccessMetrics } from "../../src/b07/phases/B07_04_success.js";

describe("Remaining repair guards", () => {
  it("aggregates only real B01 platform/capability provenance and fabricates none", () => {
    const platformProv = { id: "prov_platform", type: "OBSERVED", decision_authority: "B01", timestamp: "2026-09-06T00:00:00Z" } as any;
    const capabilityProv = { id: "prov_capability", type: "INFERRED", decision_authority: "B01", timestamp: "2026-09-06T00:00:00Z" } as any;
    const registry: any = {
      youtube: {
        name: "youtube",
        evidence_refs: [],
        provenance_refs: [platformProv],
        capabilities: [{ capability: "video", source: "user_provided", evidence_status: "INFERRED", evidence_refs: [], provenance_refs: [capabilityProv] }],
      },
      unknown_platform: { name: "unknown_platform", evidence_refs: [], capabilities: [] },
    };
    expect(platformRegistryProvenance(registry).map((p) => p.id).sort()).toEqual(["prov_capability", "prov_platform"]);
  });

  it("keeps CONTRACT_EVOLUTION_REQUIRED B01 drops explicit and documented", () => {
    const deferred = KNOWN_CANONICALIZATION_DROPS.filter((x) => x.classification === "CONTRACT_EVOLUTION_REQUIRED");
    expect(deferred.length).toBeGreaterThan(0);
    for (const entry of deferred) {
      expect(entry.field.length).toBeGreaterThan(0);
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });

  it("blocks SYNTHETIC and UNKNOWN evidence from VERIFIED/production semantics", () => {
    for (const source_mode of ["SYNTHETIC", "UNKNOWN"] as const) {
      const result = validateEvidenceSemantics({
        id: `e-${source_mode}`,
        source: "test",
        status: "VERIFIED",
        origin: "DOCUMENTATION",
        basis: "OBSERVED",
        source_mode,
        production_eligible: true,
      });
      expect(result.valid).toBe(false);
      expect(result.normalized_status).toBe("UNKNOWN");
      expect(result.issues.some((x) => x.code.includes("PRODUCTION_LEAK"))).toBe(true);
    }
  });

  it("keeps REAL/MOCK/SYNTHETIC/UNKNOWN analytics execution semantics distinct", () => {
    const baseSource: any = {
      source_id: "s1", source_name: "source", source_type: "manual_input", api_available: false,
      api_availability_basis: "UNKNOWN", real_time: false, execution_state: "VALIDATED", execution_verified: true,
      evidence_refs: [], provenance: { type: "INFERRED", decision_authority: "B08", timestamp: "2026-09-06T00:00:00Z" },
    };
    expect(providerExecutionClaim({ ...baseSource, source_mode: "REAL" })).toBe("EXECUTED_REAL");
    expect(providerExecutionClaim({ ...baseSource, source_mode: "MOCK" })).toBe("EXECUTED_MOCK");
    expect(providerExecutionClaim({ ...baseSource, source_mode: "SYNTHETIC" })).toBe("EXECUTED_SYNTHETIC");
    expect(providerExecutionClaim({ ...baseSource, source_mode: "UNKNOWN" })).toBe("EXECUTED_UNKNOWN");
  });

  it("permits explicit synthetic analytics for non-production simulation but never B09 learning", () => {
    const metrics: any[] = [{
      metric_id: "m1", kpi_id: "k1", metric_name: "views", source_id: "s1",
      aggregation_method: "sum", aggregation_window: "daily", data_quality_rules: [], evidence_refs: [],
      provenance: { type: "INFERRED", decision_authority: "B08", timestamp: "2026-09-06T00:00:00Z" }, definition_state: "DEFINED",
    }];
    const synthetic: any = {
      result_id: "synthetic-r1", metric_id: "m1", value: 12, unit: "count", period_start: "x", period_end: "y",
      state: "VALIDATED", source_mode: "SYNTHETIC",
      evidence_refs: [{ id: "se1", source: "simulator", status: "INFERRED", origin: "SYSTEM_DERIVATION", basis: "INFERRED", source_mode: "SYNTHETIC", production_eligible: false }],
    };
    expect(validateAnalyticsResult(synthetic, metrics).valid).toBe(true);
    const b08: any = { analytics_results: [synthetic], metrics, workflows: [] };
    expect(isLearningEligibleAnalyticsResult(synthetic, b08)).toBe(false);
    expect(generateLearningObservations(b08, {} as any)).toHaveLength(0);
  });

  it("allows B09 learning only from validated REAL analytics with eligible VERIFIED REAL evidence", () => {
    const metrics: any[] = [{
      metric_id: "m1", kpi_id: "k1", metric_name: "views", source_id: "s1",
      aggregation_method: "sum", aggregation_window: "daily", data_quality_rules: [], evidence_refs: [],
      provenance: { type: "INFERRED", decision_authority: "B08", timestamp: "2026-09-06T00:00:00Z" }, definition_state: "DEFINED",
    }];
    const real: any = {
      result_id: "real-r1", metric_id: "m1", value: 42, unit: "count", period_start: "x", period_end: "y",
      state: "VALIDATED", source_mode: "REAL",
      evidence_refs: [{ id: "re1", source: "provider:fixture", status: "VERIFIED", origin: "PROVIDER_DATA", basis: "OBSERVED", source_mode: "REAL", production_eligible: true }],
    };
    const b08: any = { analytics_results: [real], metrics, workflows: [] };
    expect(validateAnalyticsResult(real, metrics).valid).toBe(true);
    expect(isLearningEligibleAnalyticsResult(real, b08)).toBe(true);
    expect(generateLearningObservations(b08, {} as any)).toHaveLength(1);
  });

  it("retains framework defaults as DEFAULT/HEURISTIC rather than VERIFIED/observed", () => {
    const context: any = {
      brand_profile: { name: "Brand" },
      opportunities: [{ opportunity_id: "o1", description: "Opportunity", territories: ["t1"], evidence_refs: [] }],
      segments: [{ segment_id: "s1", segment_name: "Segment" }], territories: ["t1"], channels: [], territory_ontology: [], gaps: [],
    };
    const campaigns = synthesizeCampaigns(context, [{ alignment_id: "a1", opportunity_id: "o1", segment_id: "s1", alignment_score: 0.7, rationale: "x", evidence_refs: [] } as any]);
    expect(campaigns[0]?.timeline_basis).toBe("DEFAULT");
    expect(campaigns[0]?.confidence_basis).toBe("HEURISTIC");

    const angles = synthesizeCreativeAngles({ brand_name: "Brand", brand_positioning: "Position", campaigns, segments: context.segments } as any, { now: () => "2026-09-06T00:00:00Z" });
    expect(angles[0]?.confidence).toBe(0.65);
    expect(angles[0]?.confidence_basis).toBe("HEURISTIC_DEFAULT");
    expect(angles[0]?.derivation_basis).toBe("TEMPLATE");

    const schedules = createContentSchedules({} as any, [{ selection_id: "sel1", campaign_id: "c1", channel_id: "youtube", role: "primary_channel" } as any], { now: () => "2026-09-06T00:00:00Z" });
    expect(schedules[0]?.schedule_basis).toBe("DEFAULT");
    expect(schedules[0]?.timezone_adapted).toBe(false);
    expect(schedules[0]?.empirically_optimized).toBe(false);

    const success = defineSuccessMetrics({ campaigns: [{ campaign_id: "c1", campaign_name: "Campaign", primary_objective: "Objective" }] } as any, ["k1"], { now: () => "2026-09-06T00:00:00Z" });
    expect(success[0]?.threshold_definition.basis).toBe("DEFAULT");
    expect(success[0]?.threshold_definition.status).toBe("INFERRED");
  });
});
