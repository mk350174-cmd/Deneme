import { describe, it, expect, beforeEach } from "vitest";
import {
  runB06,
  commitVersion,
  createMockPersistence,
  buildDistributionContext,
  selectChannelsForCampaigns,
  createContentSchedules,
  defineFormatRules,
  detectDistributionConflicts,
  identifyDistributionGaps,
  calculateDistributionCompleteness,
} from "../src/b06/index.js";

function createMockB01() {
  return {
    version: "v1.0",
    brand_profile: { brand_name: "TechBrand", positioning: "Enterprise AI leader" },
    channels: [
      { channel_id: "youtube", name: "YouTube", platform: "YOUTUBE", role: "primary" },
      { channel_id: "linkedin", name: "LinkedIn", platform: "LINKEDIN", role: "secondary" },
      { channel_id: "tiktok", name: "TikTok", platform: "TIKTOK", role: "secondary" },
    ],
  };
}

function createMockB03() {
  return {
    b01_canonical_version: "v1.0",
    audience_segments: [
      { segment_id: "cto_segment", segment_name: "CTO Audience", confidence: 0.9 },
      { segment_id: "dev_segment", segment_name: "Developer Audience", confidence: 0.85 },
    ],
  };
}

function createMockB04() {
  return {
    b01_version: "v1.0",
    campaigns: [
      {
        campaign_id: "camp1",
        campaign_name: "Q4 Enterprise CTOs",
        primary_objective: "Build thought leadership",
        target_segments: ["cto_segment"],
        territories: ["us"],
      },
      {
        campaign_id: "camp2",
        campaign_name: "Developer Engagement",
        primary_objective: "Drive adoption",
        target_segments: ["dev_segment"],
        territories: ["us"],
      },
    ],
  };
}

describe("B06 Distribution Strategy", () => {
  let b01: any, b03: any, b04: any;

  beforeEach(() => {
    b01 = createMockB01();
    b03 = createMockB03();
    b04 = createMockB04();
  });

  describe("1. Context Building", () => {
    it("should build distribution context", () => {
      const context = buildDistributionContext(b01, b03, b04);
      expect(context.campaigns).toHaveLength(2);
      expect(context.channels).toHaveLength(3);
      expect(context.segments).toHaveLength(2);
    });

    it("should report gaps when missing channels", () => {
      const context = buildDistributionContext({ ...b01, channels: [] }, b03, b04);
      expect(context.gaps).toContain("no_channels_available");
    });
  });

  describe("2. Channel Selection", () => {
    it("should select channels for campaigns", () => {
      const context = buildDistributionContext(b01, b03, b04);
      const selections = selectChannelsForCampaigns(context);
      expect(selections.length).toBeGreaterThan(0);
      expect(selections[0]).toHaveProperty("campaign_id");
      expect(selections[0]).toHaveProperty("channel_id");
    });

    it("should mark selections as INFERRED", () => {
      const context = buildDistributionContext(b01, b03, b04);
      const selections = selectChannelsForCampaigns(context);
      expect(selections.every((s) => s.provenance.type === "INFERRED")).toBe(true);
    });

    it("should assign roles to channels", () => {
      const context = buildDistributionContext(b01, b03, b04);
      const selections = selectChannelsForCampaigns(context);
      expect(selections.some((s) => s.role === "primary_channel")).toBe(true);
    });

    it("should generate deterministic IDs", () => {
      const context = buildDistributionContext(b01, b03, b04);
      const sel1 = selectChannelsForCampaigns(context);
      const sel2 = selectChannelsForCampaigns(context);
      expect(sel1.map((s) => s.selection_id)).toEqual(sel2.map((s) => s.selection_id));
    });
  });

  describe("3. Content Scheduling", () => {
    it("should create schedules for selected channels", () => {
      const context = buildDistributionContext(b01, b03, b04);
      const selections = selectChannelsForCampaigns(context);
      const schedules = createContentSchedules(context, selections);
      expect(schedules.length).toBeGreaterThan(0);
    });

    it("should mark schedules as INFERRED", () => {
      const context = buildDistributionContext(b01, b03, b04);
      const selections = selectChannelsForCampaigns(context);
      const schedules = createContentSchedules(context, selections);
      expect(schedules.every((s) => s.provenance.type === "INFERRED")).toBe(true);
    });

    it("should include posting frequency", () => {
      const context = buildDistributionContext(b01, b03, b04);
      const selections = selectChannelsForCampaigns(context);
      const schedules = createContentSchedules(context, selections);
      expect(schedules.every((s) => s.posting_frequency)).toBe(true);
    });

    it("should include optimal posting times", () => {
      const context = buildDistributionContext(b01, b03, b04);
      const selections = selectChannelsForCampaigns(context);
      const schedules = createContentSchedules(context, selections);
      expect(schedules.every((s) => s.optimal_posting_times.length > 0)).toBe(true);
    });
  });

  describe("4. Format Rules", () => {
    it("should define format rules for channels", () => {
      const context = buildDistributionContext(b01, b03, b04);
      const selections = selectChannelsForCampaigns(context);
      const rules = defineFormatRules(selections);
      expect(rules.length).toBeGreaterThan(0);
    });

    it("should include preferred formats", () => {
      const context = buildDistributionContext(b01, b03, b04);
      const selections = selectChannelsForCampaigns(context);
      const rules = defineFormatRules(selections);
      expect(rules.every((r) => r.preferred_content_formats.length > 0)).toBe(true);
    });

    it("should include duration category", () => {
      const context = buildDistributionContext(b01, b03, b04);
      const selections = selectChannelsForCampaigns(context);
      const rules = defineFormatRules(selections);
      expect(rules.every((r) => r.duration_category)).toBe(true);
    });

    it("should mark rules as INFERRED", () => {
      const context = buildDistributionContext(b01, b03, b04);
      const selections = selectChannelsForCampaigns(context);
      const rules = defineFormatRules(selections);
      expect(rules.every((r) => r.provenance.type === "INFERRED")).toBe(true);
    });
  });

  describe("5. Validation & Conflict Detection", () => {
    it("should detect missing channels", () => {
      const context = buildDistributionContext(b01, b03, b04);
      const conflicts = detectDistributionConflicts(context, 0, 0);
      expect(conflicts.some((c) => c.description.includes("No channels"))).toBe(true);
    });

    it("should report missing campaigns as high gap", () => {
      const context = buildDistributionContext(b01, b03, { campaigns: [] });
      const gaps = identifyDistributionGaps(context, 0, 0, 0);
      expect(gaps.some((g) => g.gap_id === "gap_campaigns" && g.priority === "high")).toBe(true);
    });
  });

  describe("6. Completeness Scoring", () => {
    it("should score 0-100", async () => {
      const candidate = await runB06(b01, b03, b04);
      expect(candidate.completeness.score).toBeGreaterThanOrEqual(0);
      expect(candidate.completeness.score).toBeLessThanOrEqual(100);
    });

    it("should track blocking decisions", async () => {
      const candidate = await runB06(b01, b03, b04);
      expect(Array.isArray(candidate.completeness.blocking_decisions)).toBe(true);
    });
  });

  describe("7. Evidence & Provenance", () => {
    it("should preserve evidence separately from provenance", async () => {
      const candidate = await runB06(b01, b03, b04);
      const selection = candidate.channel_selections[0];
      expect(selection?.evidence_refs).toBeDefined();
      expect(selection?.provenance).toBeDefined();
      expect(Array.isArray(selection?.evidence_refs)).toBe(true);
      expect(typeof selection?.provenance).toBe("object");
    });

    it("should track provenance type", async () => {
      const candidate = await runB06(b01, b03, b04);
      expect(candidate.channel_selections.every((s) => s.provenance.type === "INFERRED")).toBe(true);
    });
  });

  describe("8. Candidate vs Canonical", () => {
    it("should return CandidateState from runB06", async () => {
      const candidate = await runB06(b01, b03, b04);
      expect(candidate).toHaveProperty("candidate_id");
      expect(candidate).not.toHaveProperty("version");
    });

    it("should require user decision for canonical", async () => {
      const candidate = await runB06(b01, b03, b04);
      const persistence = createMockPersistence();
      const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);
      expect(canonical.version).toBe("v1.0");
    });

    it("should filter to DECIDED for canonical", async () => {
      const candidate = await runB06(b01, b03, b04);
      const persistence = createMockPersistence();
      const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);
      expect(canonical.channel_selections.length).toBe(0); // No DECIDED in candidate
    });
  });

  describe("9. Immutable Versioning", () => {
    it("should enforce semantic versioning", async () => {
      const candidate = await runB06(b01, b03, b04);
      const persistence = createMockPersistence();
      await expect(
        commitVersion(candidate, "invalid", "user@example.com", persistence),
      ).rejects.toThrow("Invalid semantic version");
    });

    it("should prevent duplicate versions", async () => {
      const candidate = await runB06(b01, b03, b04);
      const persistence = createMockPersistence();
      await commitVersion(candidate, "v1.0", "user@example.com", persistence);
      await expect(
        commitVersion(candidate, "v1.0", "user@example.com", persistence),
      ).rejects.toThrow("already exists");
    });

    it("should create audit trail", async () => {
      const candidate = await runB06(b01, b03, b04);
      const persistence = createMockPersistence();
      const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);
      expect(canonical.audit_trail).toHaveLength(1);
      expect(canonical.audit_trail[0]?.version).toBe("v1.0");
    });
  });

  describe("10. Input Immutability", () => {
    it("should not mutate B01", async () => {
      const b01Copy = JSON.stringify(b01);
      await runB06(b01, b03, b04);
      expect(JSON.stringify(b01)).toBe(b01Copy);
    });

    it("should not mutate B04", async () => {
      const b04Copy = JSON.stringify(b04);
      await runB06(b01, b03, b04);
      expect(JSON.stringify(b04)).toBe(b04Copy);
    });
  });

  describe("11. Deterministic IDs", () => {
    it("should generate same IDs for same input", () => {
      const context = buildDistributionContext(b01, b03, b04);
      const sel1 = selectChannelsForCampaigns(context);
      const sel2 = selectChannelsForCampaigns(context);
      expect(sel1[0]?.selection_id).toBe(sel2[0]?.selection_id);
    });
  });

  describe("12. No Fabrication", () => {
    it("should not have empty channel IDs", async () => {
      const candidate = await runB06(b01, b03, b04);
      expect(candidate.channel_selections.every((s) => s.channel_id)).toBe(true);
    });

    it("should include evidence on selections", async () => {
      const candidate = await runB06(b01, b03, b04);
      expect(candidate.channel_selections.every((s) => s.evidence_refs.length > 0)).toBe(true);
    });
  });

  describe("13. A-Branch Boundary", () => {
    it("should produce strategic specs only", async () => {
      const candidate = await runB06(b01, b03, b04);
      const rule = candidate.format_rules[0];
      expect(rule?.duration_category).toBeDefined();
      expect(rule).not.toHaveProperty("video_bitrate");
    });
  });

  describe("14. No Auto-Promotion", () => {
    it("should never auto-promote to DECIDED", async () => {
      const candidate = await runB06(b01, b03, b04);
      expect(candidate.channel_selections.every((s) => s.provenance.type === "INFERRED")).toBe(true);
    });
  });
});
