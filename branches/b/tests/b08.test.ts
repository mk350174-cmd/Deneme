// B08 Tests

import { describe, it, expect, beforeEach } from "vitest";
import {
  runB08,
  commitVersion,
  buildAnalyticsContext,
  defineDataSources,
  defineMetrics,
  defineAnalyticsWorkflows,
  detectAnalyticsConflicts,
  identifyAnalyticsGaps,
  calculateAnalyticsCompleteness,
  InMemoryB08Persistence,
} from "../src/b08/index.js";

describe("B08 — Analytics Strategy", () => {
  let persistence: InMemoryB08Persistence;

  beforeEach(() => {
    persistence = new InMemoryB08Persistence();
  });

  it("builds analytics context from upstream states", () => {
    const b07State = {
      kpi_definitions: [
        { kpi_id: "kpi_001", metric_name: "Watch Time", channel_id: "youtube" },
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
    const b01State = {
      campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch" }],
    };

    const context = buildAnalyticsContext(b07State, b06State, b01State);

    expect(context.kpis).toHaveLength(1);
    expect(context.channels).toHaveLength(1);
    expect(context.campaigns).toHaveLength(1);
  });

  it("defines data sources for channels", () => {
    const context = buildAnalyticsContext(
      { kpi_definitions: [{ kpi_id: "kpi_001", metric_name: "Watch Time", channel_id: "youtube" }] },
      { distribution_strategies: [{ campaign_id: "camp_001", channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }] }] },
      { campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch" }] },
    );

    const sources = defineDataSources(context);

    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0]).toHaveProperty("source_id");
    expect(sources[0]).toHaveProperty("api_available");
  });

  it("marks all sources as INFERRED", () => {
    const context = buildAnalyticsContext(
      { kpi_definitions: [{ kpi_id: "kpi_001", metric_name: "Watch Time", channel_id: "youtube" }] },
      { distribution_strategies: [{ campaign_id: "camp_001", channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }] }] },
      { campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch" }] },
    );

    const sources = defineDataSources(context);

    expect(sources[0].provenance.type).toBe("INFERRED");
  });

  it("defines metrics per KPI", () => {
    const context = buildAnalyticsContext(
      { kpi_definitions: [{ kpi_id: "kpi_001", metric_name: "Watch Time", channel_id: "youtube" }] },
      { distribution_strategies: [{ campaign_id: "camp_001", channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }] }] },
      { campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch" }] },
    );

    const sources = defineDataSources(context);
    const metrics = defineMetrics(context, sources);

    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics[0].kpi_id).toBe("kpi_001");
  });

  it("defines analytics workflows", () => {
    const context = buildAnalyticsContext(
      { kpi_definitions: [{ kpi_id: "kpi_001", metric_name: "Watch Time", channel_id: "youtube" }] },
      { distribution_strategies: [{ campaign_id: "camp_001", channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }] }] },
      { campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch" }] },
    );

    const sources = defineDataSources(context);
    const metrics = defineMetrics(context, sources);
    const workflows = defineAnalyticsWorkflows(context, sources, metrics);

    expect(workflows.length).toBeGreaterThan(0);
    expect(workflows[0]).toHaveProperty("workflow_id");
  });

  it("detects conflicts when no sources", () => {
    const context = buildAnalyticsContext(
      { kpi_definitions: [{ kpi_id: "kpi_001", metric_name: "Watch Time", channel_id: "youtube" }] },
      { distribution_strategies: [{ campaign_id: "camp_001", channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }] }] },
      { campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch" }] },
    );

    const conflicts = detectAnalyticsConflicts(context, 0, 5);

    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].severity).toBe("high");
  });

  it("identifies gaps when KPIs missing", () => {
    const context = buildAnalyticsContext({}, {}, {});

    const gaps = identifyAnalyticsGaps(context, 0, 0, 0);

    expect(gaps.some((g) => g.gap_id === "gap_kpis")).toBe(true);
  });

  it("scores completeness", () => {
    const context = buildAnalyticsContext(
      { kpi_definitions: [{ kpi_id: "kpi_001", metric_name: "Watch Time", channel_id: "youtube" }] },
      { distribution_strategies: [{ campaign_id: "camp_001", channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }] }] },
      { campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch" }] },
    );

    const sources = defineDataSources(context);
    const metrics = defineMetrics(context, sources);
    const workflows = defineAnalyticsWorkflows(context, sources, metrics);
    const gaps = identifyAnalyticsGaps(context, sources.length, metrics.length, workflows.length);

    const completeness = calculateAnalyticsCompleteness(context, sources.length, metrics.length, workflows.length, gaps);

    expect(completeness.score).toBeGreaterThan(0);
    expect(completeness.score).toBeLessThanOrEqual(100);
  });

  it("returns candidate state from runB08", async () => {
    const b07State = {
      kpi_definitions: [{ kpi_id: "kpi_001", metric_name: "Watch Time", channel_id: "youtube" }],
    };
    const b06State = {
      distribution_strategies: [
        {
          campaign_id: "camp_001",
          channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
        },
      ],
    };
    const b01State = {
      campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch" }],
    };

    const candidate = await runB08(b07State, b06State, b01State);

    expect(candidate.candidate_id).toBeDefined();
    expect(candidate.data_sources).toBeDefined();
    expect(candidate.metrics).toBeDefined();
  });

  it("creates immutable canonical state", async () => {
    const b07State = {
      kpi_definitions: [{ kpi_id: "kpi_001", metric_name: "Watch Time", channel_id: "youtube" }],
    };
    const b06State = {
      distribution_strategies: [
        {
          campaign_id: "camp_001",
          channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
        },
      ],
    };
    const b01State = {
      campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch" }],
    };

    const candidate = await runB08(b07State, b06State, b01State);
    const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);

    expect(canonical.version).toBe("v1.0");
    expect(canonical.cannot_be_modified_until_next_version).toBe(true);
  });

  it("rejects duplicate version", async () => {
    const b07State = {
      kpi_definitions: [{ kpi_id: "kpi_001", metric_name: "Watch Time", channel_id: "youtube" }],
    };
    const b06State = {
      distribution_strategies: [
        {
          campaign_id: "camp_001",
          channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
        },
      ],
    };
    const b01State = {
      campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch" }],
    };

    const candidate = await runB08(b07State, b06State, b01State);
    await commitVersion(candidate, "v1.0", "user@example.com", persistence);

    await expect(commitVersion(candidate, "v1.0", "user@example.com", persistence)).rejects.toThrow(/already exists/);
  });

  it("enforces semantic versioning", async () => {
    const b07State = {
      kpi_definitions: [{ kpi_id: "kpi_001", metric_name: "Watch Time", channel_id: "youtube" }],
    };
    const b06State = {
      distribution_strategies: [
        {
          campaign_id: "camp_001",
          channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
        },
      ],
    };
    const b01State = {
      campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch" }],
    };

    const candidate = await runB08(b07State, b06State, b01State);

    await expect(commitVersion(candidate, "invalid", "user@example.com", persistence)).rejects.toThrow(/Invalid semantic version/);
  });

  it("generates deterministic IDs", () => {
    const context = buildAnalyticsContext(
      { kpi_definitions: [{ kpi_id: "kpi_001", metric_name: "Watch Time", channel_id: "youtube" }] },
      { distribution_strategies: [{ campaign_id: "camp_001", channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }] }] },
      { campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch" }] },
    );

    const sources1 = defineDataSources(context);
    const sources2 = defineDataSources(context);

    expect(sources1[0].source_id).toBe(sources2[0].source_id);
  });

  it("does not mutate input state", async () => {
    const b07State = {
      kpi_definitions: [{ kpi_id: "kpi_001", metric_name: "Watch Time", channel_id: "youtube" }],
    };
    const b06State = {
      distribution_strategies: [
        {
          campaign_id: "camp_001",
          channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }],
        },
      ],
    };
    const b01State = {
      campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch" }],
    };

    const b07Copy = JSON.parse(JSON.stringify(b07State));

    await runB08(b07State, b06State, b01State);

    expect(b07State).toEqual(b07Copy);
  });

  it("evidence and provenance are separate", () => {
    const context = buildAnalyticsContext(
      { kpi_definitions: [{ kpi_id: "kpi_001", metric_name: "Watch Time", channel_id: "youtube" }] },
      { distribution_strategies: [{ campaign_id: "camp_001", channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }] }] },
      { campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch" }] },
    );

    const sources = defineDataSources(context);

    expect(Array.isArray(sources[0].evidence_refs)).toBe(true);
    expect(typeof sources[0].provenance).toBe("object");
    expect(sources[0].evidence_refs).not.toEqual(sources[0].provenance);
  });

  it("all inferred data marked INFERRED", () => {
    const context = buildAnalyticsContext(
      { kpi_definitions: [{ kpi_id: "kpi_001", metric_name: "Watch Time", channel_id: "youtube" }] },
      { distribution_strategies: [{ campaign_id: "camp_001", channel_selections: [{ channel_id: "youtube", channel_name: "YouTube" }] }] },
      { campaigns: [{ campaign_id: "camp_001", campaign_name: "Launch" }] },
    );

    const sources = defineDataSources(context);
    const metrics = defineMetrics(context, sources);
    const workflows = defineAnalyticsWorkflows(context, sources, metrics);

    sources.forEach((s) => expect(s.provenance.type).toBe("INFERRED"));
    metrics.forEach((m) => expect(m.provenance.type).toBe("INFERRED"));
    workflows.forEach((w) => expect(w.provenance.type).toBe("INFERRED"));
  });

  it("handles empty input gracefully", () => {
    const context = buildAnalyticsContext({}, {}, {});

    const sources = defineDataSources(context);
    const metrics = defineMetrics(context, sources);
    const workflows = defineAnalyticsWorkflows(context, sources, metrics);

    expect(sources).toHaveLength(0);
    expect(metrics).toHaveLength(0);
    expect(workflows).toHaveLength(0);
  });
});
