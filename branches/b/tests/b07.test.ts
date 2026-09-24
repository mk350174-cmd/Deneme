// B07 — Performance Framework Tests

import { describe, it, expect, beforeEach } from "vitest";
import type { B07CandidateState, B07Deps } from "../src/b07/types.js";
import {
  runB07,
  commitVersion,
  loadVersion,
  listVersions,
  getLatestVersion,
  buildPerformanceContext,
  defineKPIs,
  createMeasurementPlans,
  defineSuccessMetrics,
  detectPerformanceConflicts,
  identifyPerformanceGaps,
  calculatePerformanceCompleteness,
  InMemoryB07Persistence,
} from "../src/b07/index.js";

describe("B07 — Performance Framework", () => {
  let persistence: InMemoryB07Persistence;

  beforeEach(() => {
    persistence = new InMemoryB07Persistence();
  });

  // ========== CONTEXT BUILDING ==========

  it("builds performance context from B04 and B06 state", () => {
    const b04State = {
      campaigns: [
        {
          campaign_id: "camp_001",
          campaign_name: "Product Launch",
          primary_objective: "Awareness",
        },
      ],
    };

    const b06State = {
      distribution_strategies: [
        {
          campaign_id: "camp_001",
          channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
        },
      ],
    };

    const context = buildPerformanceContext(b04State, b06State);

    expect(context.campaigns).toHaveLength(1);
    expect(context.campaigns[0].campaign_id).toBe("camp_001");
    expect(context.channels).toHaveLength(1);
    expect(context.channels[0].channel_id).toBe("youtube");
  });

  it("handles missing B04 campaigns gracefully", () => {
    const b06State = {
      channel_assignments: [{ channel_id: "yt_001", channel_name: "YouTube" }],
    };

    const context = buildPerformanceContext({}, b06State);

    expect(context.campaigns).toHaveLength(0);
    expect(context.gaps).toContain("no_campaigns_available");
  });

  it("handles missing B06 channels gracefully", () => {
    const b04State = {
      campaigns: [
        {
          campaign_id: "camp_001",
          campaign_name: "Product Launch",
          primary_objective: "Awareness",
        },
      ],
    };

    const b06State = { distribution_strategies: [] };

    const context = buildPerformanceContext(b04State, b06State);

    expect(context.channels).toHaveLength(0);
    expect(context.gaps).toContain("no_channels_in_distribution");
  });

  // ========== KPI DEFINITION ==========

  it("defines KPIs for campaigns and channels", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [
          { campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" },
        ],
      },
      {
        distribution_strategies: [
          {
            campaign_id: "camp_001",
            channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
          },
        ],
      },
    );

    const kpis = defineKPIs(context);

    expect(kpis.length).toBeGreaterThan(0);
    expect(kpis[0]).toHaveProperty("kpi_id");
    expect(kpis[0]).toHaveProperty("campaign_id");
    expect(kpis[0]).toHaveProperty("channel_id");
    expect(kpis[0]).toHaveProperty("metric_name");
  });

  it("uses channel-specific KPI templates", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
      },
      {
        distribution_strategies: [
          {
            campaign_id: "camp_001",
            channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
          },
        ],
      },
    );

    const kpis = defineKPIs(context);
    const youtubeKpis = kpis.filter((k) => k.channel_id === "youtube");

    expect(youtubeKpis.length).toBeGreaterThan(0);
    expect(youtubeKpis[0].metric_name).toMatch(/watch time|click-through|subscriber/i);
  });

  it("infers KPI metrics fallback when channel not recognized", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
      },
      {
        distribution_strategies: [
          {
            campaign_id: "camp_001",
            channel_selections: [{ channel_id: "unknown_channel", channel_name: "Unknown" }],
          },
        ],
      },
    );

    const kpis = defineKPIs(context);

    expect(kpis.length).toBeGreaterThan(0);
    expect(kpis[0].metric_name).toMatch(/views|engagement/i);
  });

  it("marks all KPIs as INFERRED with provenance tracking", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
      },
      {
        distribution_strategies: [
          {
            campaign_id: "camp_001",
            channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
          },
        ],
      },
    );

    const kpis = defineKPIs(context);

    expect(kpis[0].provenance).toEqual({
      type: "INFERRED",
      decision_authority: "B07_02:defineKPIs",
      timestamp: expect.any(String),
      rationale: expect.any(String),
    });
  });

  // ========== MEASUREMENT PLANS ==========

  it("creates measurement plans per campaign", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [
          { campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" },
          { campaign_id: "camp_002", campaign_name: "Retention", primary_objective: "Engagement" },
        ],
      },
      {
        distribution_strategies: [
          {
            campaign_id: "camp_001",
            channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
          },
        ],
      },
    );

    const plans = createMeasurementPlans(context, 3);

    expect(plans).toHaveLength(2);
    expect(plans[0]).toHaveProperty("plan_id");
    expect(plans[0]).toHaveProperty("measurement_frequency");
  });

  it("measurement plans include deterministic tracking and reporting", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
      },
      {
        distribution_strategies: [
          {
            campaign_id: "camp_001",
            channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
          },
        ],
      },
    );

    const plans = createMeasurementPlans(context, 1);

    expect(plans[0].measurement_frequency).toBe("daily");
    expect(plans[0].reporting_cadence).toContain("weekly");
    expect(plans[0].data_collection_method).toContain("API");
  });

  // ========== SUCCESS METRICS ==========

  it("defines success metrics per campaign", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [
          { campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" },
        ],
      },
      {
        distribution_strategies: [
          {
            campaign_id: "camp_001",
            channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
          },
        ],
      },
    );

    const metrics = defineSuccessMetrics(context, ["kpi_001", "kpi_002"]);

    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toHaveProperty("metric_id");
    expect(metrics[0]).toHaveProperty("campaign_id");
    expect(metrics[0].success_threshold).toBe(80);
  });

  it("success metrics include primary and supporting KPIs", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
      },
      {
        distribution_strategies: [
          {
            campaign_id: "camp_001",
            channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
          },
        ],
      },
    );

    const metrics = defineSuccessMetrics(context, ["kpi_001", "kpi_002", "kpi_003", "kpi_004"]);

    expect(metrics[0].primary_kpi_id).toBe("kpi_001");
    expect(metrics[0].supporting_indicators).toHaveLength(3);
  });

  // ========== CONFLICT DETECTION ==========

  it("detects high-severity conflict when no KPIs defined", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
      },
      {
        distribution_strategies: [
          {
            campaign_id: "camp_001",
            channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
          },
        ],
      },
    );

    const conflicts = detectPerformanceConflicts(context, 0);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe("high");
    expect(conflicts[0].conflict_id).toBe("conf_no_kpis");
  });

  it("returns no conflicts when KPIs are defined", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
      },
      {
        distribution_strategies: [
          {
            campaign_id: "camp_001",
            channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
          },
        ],
      },
    );

    const conflicts = detectPerformanceConflicts(context, 3);

    expect(conflicts).toHaveLength(0);
  });

  // ========== GAP IDENTIFICATION ==========

  it("identifies gaps when no campaigns exist", () => {
    const context = buildPerformanceContext({}, {});

    const gaps = identifyPerformanceGaps(context, 0, 0, 0);

    expect(gaps.some((g) => g.gap_id === "gap_campaigns")).toBe(true);
  });

  it("identifies gaps when no channels exist", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
      },
      {},
    );

    const gaps = identifyPerformanceGaps(context, 0, 0, 0);

    expect(gaps.some((g) => g.gap_id === "gap_channels")).toBe(true);
  });

  it("identifies KPI gap when campaigns but no KPIs", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
      },
      {
        distribution_strategies: [
          {
            campaign_id: "camp_001",
            channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
          },
        ],
      },
    );

    const gaps = identifyPerformanceGaps(context, 0, 0, 0);

    expect(gaps.some((g) => g.gap_id === "gap_kpis")).toBe(true);
  });

  it("identifies measurement plan gap when KPIs but no plans", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
      },
      {
        distribution_strategies: [
          {
            campaign_id: "camp_001",
            channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
          },
        ],
      },
    );

    const gaps = identifyPerformanceGaps(context, 3, 0, 0);

    expect(gaps.some((g) => g.gap_id === "gap_measurement_plan")).toBe(true);
  });

  // ========== COMPLETENESS SCORING ==========

  it("scores completeness based on presence of components", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
      },
      {
        distribution_strategies: [
          {
            campaign_id: "camp_001",
            channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
          },
        ],
      },
    );

    const gaps: any[] = [];
    const completeness = calculatePerformanceCompleteness(context, 3, 1, 1, gaps);

    expect(completeness.score).toBeGreaterThan(0);
    expect(completeness.score).toBeLessThanOrEqual(100);
  });

  it("completeness score is 0 when nothing is defined", () => {
    const context = buildPerformanceContext({}, {});
    const gaps: any[] = [];

    const completeness = calculatePerformanceCompleteness(context, 0, 0, 0, gaps);

    expect(completeness.score).toBe(0);
  });

  it("completeness includes blocking decisions from high-priority gaps", () => {
    const context = buildPerformanceContext({}, {});
    const gaps = identifyPerformanceGaps(context, 0, 0, 0);

    const completeness = calculatePerformanceCompleteness(context, 0, 0, 0, gaps);

    expect(completeness.blocking_decisions).toHaveLength(gaps.length);
  });

  // ========== EVIDENCE & PROVENANCE ==========

  it("KPIs include evidence and provenance separately", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
      },
      {
        distribution_strategies: [
          {
            campaign_id: "camp_001",
            channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
          },
        ],
      },
    );

    const kpis = defineKPIs(context);

    expect(kpis[0].evidence_refs).toBeDefined();
    expect(Array.isArray(kpis[0].evidence_refs)).toBe(true);
    expect(kpis[0].provenance).toBeDefined();
    expect(kpis[0].provenance.type).toBe("INFERRED");
  });

  it("evidence and provenance are orthogonal concepts", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
      },
      {
        distribution_strategies: [
          {
            campaign_id: "camp_001",
            channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
          },
        ],
      },
    );

    const kpis = defineKPIs(context);

    // Evidence = where data came from (EvidenceRef)
    // Provenance = who decided it (ProvenanceRef)
    // They're separate structures, not different views of same data
    expect(typeof kpis[0].evidence_refs).toBe("object");
    expect(typeof kpis[0].provenance).toBe("object");
    expect(kpis[0].evidence_refs).not.toEqual(kpis[0].provenance);
  });

  // ========== CANDIDATE VS CANONICAL ==========

  it("runB07 returns candidate state (pre-decision)", async () => {
    const b04State = {
      campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
    };
    const b06State = {
      channel_assignments: [{ channel_id: "youtube", channel_name: "YouTube" }],
    };

    const candidate = await runB07(b04State, b06State);

    expect(candidate.candidate_id).toBeDefined();
    expect(candidate.created_at).toBeDefined();
    expect(candidate.kpi_definitions).toBeDefined();
    expect(candidate.measurement_plans).toBeDefined();
    expect(candidate.success_metrics).toBeDefined();
  });

  it("commitVersion creates immutable canonical state", async () => {
    const b04State = {
      campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
    };
    const b06State = {
      channel_assignments: [{ channel_id: "youtube", channel_name: "YouTube" }],
    };

    const candidate = await runB07(b04State, b06State);
    const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);

    expect(canonical.version).toBe("v1.0");
    expect(canonical.user_decision_authority).toBe("user@example.com");
    expect(canonical.created_at).toBeDefined();
    expect(canonical.cannot_be_modified_until_next_version).toBe(true);
  });

  it("rejects duplicate version (immutability)", async () => {
    const b04State = {
      campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
    };
    const b06State = {
      channel_assignments: [{ channel_id: "youtube", channel_name: "YouTube" }],
    };

    const candidate = await runB07(b04State, b06State);
    await commitVersion(candidate, "v1.0", "user@example.com", persistence);

    // Try to commit same version again
    await expect(commitVersion(candidate, "v1.0", "user@example.com", persistence)).rejects.toThrow(
      /already exists/,
    );
  });

  // ========== VERSIONING ==========

  it("loads specific version from persistence", async () => {
    const b04State = {
      campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
    };
    const b06State = {
      channel_assignments: [{ channel_id: "youtube", channel_name: "YouTube" }],
    };

    const candidate = await runB07(b04State, b06State);
    await commitVersion(candidate, "v1.0", "user@example.com", persistence);

    const loaded = await loadVersion("v1.0", persistence);

    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe("v1.0");
  });

  it("lists all versions", async () => {
    const b04State = {
      campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
    };
    const b06State = {
      channel_assignments: [{ channel_id: "youtube", channel_name: "YouTube" }],
    };

    const candidate = await runB07(b04State, b06State);
    await commitVersion(candidate, "v1.0", "user@example.com", persistence);
    await commitVersion(candidate, "v1.1", "user@example.com", persistence);

    const versions = await listVersions(persistence);

    expect(versions).toContain("v1.0");
    expect(versions).toContain("v1.1");
  });

  it("gets latest version in semantic order", async () => {
    const b04State = {
      campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
    };
    const b06State = {
      channel_assignments: [{ channel_id: "youtube", channel_name: "YouTube" }],
    };

    const candidate = await runB07(b04State, b06State);
    await commitVersion(candidate, "v1.0", "user@example.com", persistence);
    await commitVersion(candidate, "v1.1", "user@example.com", persistence);

    const latest = await getLatestVersion(persistence);

    expect(latest?.version).toBe("v1.1");
  });

  // ========== SEMANTIC VERSIONING ==========

  it("rejects invalid semantic version format", async () => {
    const b04State = {
      campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
    };
    const b06State = {
      channel_assignments: [{ channel_id: "youtube", channel_name: "YouTube" }],
    };

    const candidate = await runB07(b04State, b06State);

    await expect(commitVersion(candidate, "1.0", "user@example.com", persistence)).rejects.toThrow(
      /Invalid semantic version/,
    );
    await expect(commitVersion(candidate, "v1", "user@example.com", persistence)).rejects.toThrow(
      /Invalid semantic version/,
    );
  });

  // ========== A-BRANCH BOUNDARY ==========

  it("B07 does not import or depend on A-Branch modules", async () => {
    // Verify no A-Branch references in B07
    const b07Module = await import("../src/b07/index.js");

    const moduleKeys = Object.keys(b07Module);
    // Check for A-Branch specific patterns: a_ prefix, a-branch, A-Branch module references
    const hasABranchDependency = moduleKeys.some((key) =>
      key.startsWith("a_") ||
      key.includes("a_branch") ||
      key.includes("A_Branch") ||
      /^A[A-Z]/.test(key) // A-Branch modules would start with capital A followed by another capital letter
    );

    expect(hasABranchDependency).toBe(false);
  });

  // ========== NO FABRICATION ==========

  it("B07 marks inferred data as INFERRED, never VERIFIED", async () => {
    const b04State = {
      campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
    };
    const b06State = {
      channel_assignments: [{ channel_id: "youtube", channel_name: "YouTube" }],
    };

    const candidate = await runB07(b04State, b06State);

    // All KPIs should be INFERRED (agent-generated)
    candidate.kpi_definitions.forEach((kpi) => {
      expect(kpi.provenance.type).toBe("INFERRED");
      kpi.evidence_refs.forEach((ref) => {
        expect(ref.status).toBe("INFERRED");
      });
    });
  });

  // ========== INPUT IMMUTABILITY ==========

  it("does not mutate input state", async () => {
    const b04State = {
      campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
    };
    const b06State = {
      channel_assignments: [{ channel_id: "youtube", channel_name: "YouTube" }],
    };

    const b04Copy = JSON.parse(JSON.stringify(b04State));

    await runB07(b04State, b06State);

    expect(b04State).toEqual(b04Copy);
  });

  // ========== DETERMINISTIC ID GENERATION ==========

  it("generates deterministic IDs for KPIs", () => {
    const context = buildPerformanceContext(
      {
        campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch", primary_objective: "Growth" }],
      },
      {
        distribution_strategies: [
          {
            campaign_id: "camp_001",
            channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
          },
        ],
      },
    );

    const kpis1 = defineKPIs(context);
    const kpis2 = defineKPIs(context);

    expect(kpis1[0].kpi_id).toBe(kpis2[0].kpi_id);
  });
});
