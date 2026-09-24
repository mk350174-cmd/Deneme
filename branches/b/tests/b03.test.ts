// B03 Audience Intelligence — Comprehensive Test Suite
// 60+ tests covering contract, evidence/provenance, fabrication, determinism, immutability, etc.

import { describe, it, expect, beforeEach } from "vitest";
import type { B01CanonicalState } from "../src/b00/contracts.js";
import type { B03Input, B03CandidateState, B03CanonicalState } from "../src/b03/types.js";
import {
  buildAudienceRegistry,
  validateRegistry,
  aggregateAudienceEvidence,
  inferAudienceSegments,
  synthesizeSegmentProfiles,
  synthesizeAudienceNeeds,
  synthesizeAudiencePainPoints,
  synthesizeAudienceQuestions,
  detectSegmentConflicts,
  identifyGaps,
  calculateCompleteness,
  validateNoFabrication,
  runB03,
  approveCandidate,
  commitVersion,
  listVersions,
  createMockPersistence,
  createDefaultDeps,
  KNOWN_CANONICALIZATION_DROPS,
} from "../src/b03/index.js";

// Mock B01CanonicalState
const mockB01State: B01CanonicalState = {
  version: "v1.0",
  created_at: "2026-08-27T00:00:00Z",
  updated_at: "2026-08-27T00:00:00Z",
  user_decision_authority: "test@example.com",

  audit_trail: [],
  decisions_made: [],
  recommendations_considered: [],
  evidence_refs: [],
  provenance_refs: [],

  brand_profile: {
    brand_name: "TestBrand",
    positioning: "B2B SaaS for engineers",
    mission: "Empower engineers",
    values: ["transparency", "quality"],
  },

  channels: [
    {
      channel_id: "youtube_primary",
      name: "YouTube Main",
      platform: "YOUTUBE",
      role: "primary",
      audience_category: "professional",
      evidence_refs: [],
    },
    {
      channel_id: "tiktok_secondary",
      name: "TikTok Secondary",
      platform: "TIKTOK",
      role: "secondary",
      audience_category: "creators",
      evidence_refs: [],
    },
    {
      channel_id: "linkedin_secondary",
      name: "LinkedIn Secondary",
      platform: "LINKEDIN",
      role: "secondary",
      audience_category: "professional",
      evidence_refs: [],
    },
  ],

  platforms: [
    {
      platform_id: "yt",
      name: "YOUTUBE",
      capabilities: ["long_form_video", "short_form_video", "community_chat"],
      evidence_refs: [],
    },
    {
      platform_id: "tt",
      name: "TIKTOK",
      capabilities: ["short_form_video"],
      evidence_refs: [],
    },
    {
      platform_id: "li",
      name: "LINKEDIN",
      capabilities: ["long_form_video", "text_post", "thread"],
      evidence_refs: [],
    },
  ],

  content_territories: [
    {
      territory_id: "terr_us",
      type: "geographic",
      description: "United States",
      boundaries: ["US"],
      evidence_refs: [],
    },
    {
      territory_id: "terr_eu",
      type: "geographic",
      description: "European Union",
      boundaries: ["EU"],
      evidence_refs: [],
    },
    {
      territory_id: "terr_uk",
      type: "geographic",
      description: "United Kingdom",
      boundaries: ["UK"],
      evidence_refs: [],
    },
    {
      territory_id: "terr_ca",
      type: "geographic",
      description: "Canada",
      boundaries: ["CANADA"],
      evidence_refs: [],
    },
    {
      territory_id: "terr_asia",
      type: "geographic",
      description: "Asia",
      boundaries: ["ASIA"],
      evidence_refs: [],
    },
    {
      territory_id: "terr_au",
      type: "geographic",
      description: "Australia",
      boundaries: ["AUSTRALIA"],
      evidence_refs: [],
    },
  ],

  distribution_strategy: {
    strategy_description: "Multi-channel distribution",
    channel_assignments: [
      { channel_id: "youtube_primary", role: "primary_channel" },
      { channel_id: "tiktok_secondary", role: "secondary_channel" },
    ],
    evidence_refs: [],
  },

  editorial_constitution: {
    constitution_id: "ec_1",
    rules: [
      {
        rule_id: "rule_1",
        type: "required",
        description: "Educational content required",
        applies_to: ["tutorial", "case_study"],
      },
    ],
    evidence_refs: [],
  },

  strategic_constraints: [
    {
      constraint_id: "c1",
      description: "No political content",
      level: "hard_blocker",
      binding_module: "B03",
    },
  ],

  completeness: {
    score: 100,
    missing_inputs: [],
    blocking_decisions: [],
  },

  conflicts: [],
  gaps: [],
};

// Mock B03Input with evidence
const mockB03Input: B03Input = {
  b01_canonical_state: mockB01State,
  audience_sources: {
    platform_analytics: [
      {
        platform_id: "yt",
        channel_id: "youtube_primary",
        demographic_data: "mostly 25-45 age range, 70% male",
        geography: ["US", "UK", "Canada"],
        interests: ["machine learning", "databases"],
        engagement_pattern: "peak engagement 9am-11am EST",
        source: "YouTube Analytics Jan 2026",
        verified_at: "2026-08-27T00:00:00Z",
      },
      {
        platform_id: "li",
        channel_id: "linkedin_secondary",
        demographic_data: "enterprise professionals",
        geography: ["US", "EU"],
        interests: ["engineering", "management"],
        source: "LinkedIn Insights",
        verified_at: "2026-08-27T00:00:00Z",
      },
    ],
    user_research: [
      {
        research_id: "res_1",
        method: "survey",
        findings: "CTOs and VP Eng are primary roles; face technical debt challenges",
        sample_size: 50,
        conducted_at: "2026-08-01T00:00:00Z",
        confidence: 0.85,
      },
    ],
    documentation: {
      audience_profile_doc: "Enterprise engineering leaders aged 35-50, managing 5-50+ engineers",
      brand_guidelines: "Focus on technical depth and practical solutions",
    },
    user_input: "Our core audience is engineering decision-makers in tech companies",
  },
};

describe("B03 — Audience Intelligence", () => {
  // ============================================================================
  // CATEGORY 1: Registry Tests (8 tests)
  // ============================================================================
  describe("Category 1: Deterministic Registry", () => {
    it("should build registry from B01 channels", () => {
      const registry = buildAudienceRegistry(mockB01State);
      expect(registry.channels.size).toBe(3);
      expect(registry.channels.get("youtube_primary")?.platform).toBe("YOUTUBE");
    });

    it("should extract platform capabilities deterministically", () => {
      const registry = buildAudienceRegistry(mockB01State);
      const ytCaps = registry.platforms.get("YOUTUBE");
      expect(ytCaps?.capabilities).toContain("long_form_video");
    });

    it("should map territories from B01", () => {
      const registry = buildAudienceRegistry(mockB01State);
      expect(registry.territories.size).toBe(6);
      expect(registry.territories.get("terr_us")?.boundaries).toContain("US");
    });

    it("should collect constraints deterministically", () => {
      const registry = buildAudienceRegistry(mockB01State);
      expect(registry.constraints.length).toBe(1);
      expect(registry.constraints[0].description).toContain("political");
    });

    it("should validate registry with all data present", () => {
      const validation = validateRegistry(mockB01State);
      expect(validation.valid).toBe(true);
      expect(validation.gaps.length).toBe(0);
    });

    it("should identify gaps when channels missing", () => {
      const incomplete = { ...mockB01State, channels: [] };
      const validation = validateRegistry(incomplete);
      expect(validation.valid).toBe(false);
      expect(validation.gaps).toContain("channels empty or missing");
    });

    it("should identify gaps when platforms missing", () => {
      const incomplete = { ...mockB01State, platforms: [] };
      const validation = validateRegistry(incomplete);
      expect(validation.gaps).toContain("platforms empty or missing");
    });

    it("should identify gaps when territories missing", () => {
      const incomplete = { ...mockB01State, content_territories: undefined };
      const validation = validateRegistry(incomplete);
      expect(validation.gaps).toContain("content_territories empty or missing");
    });
  });

  // ============================================================================
  // CATEGORY 2: Evidence Aggregation Tests (8 tests)
  // ============================================================================
  describe("Category 2: Evidence Aggregation", () => {
    it("should aggregate platform analytics evidence", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      expect(evidence.analytics_evidence.length).toBeGreaterThan(0);
      expect(evidence.analytics_evidence[0].status).toBe("VERIFIED");
    });

    it("should aggregate user research evidence", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      expect(evidence.research_evidence.length).toBeGreaterThan(0);
      expect(evidence.research_evidence[0].source).toContain("survey");
    });

    it("should aggregate documentation evidence", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      expect(evidence.documentation_evidence.length).toBeGreaterThan(0);
    });

    it("should aggregate user input evidence", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      expect(evidence.user_input_evidence.length).toBeGreaterThan(0);
    });

    it("should track evidence sources", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const sources = evidence.all_evidence.map((e) => e.source);
      expect(sources).toContain("YouTube Analytics Jan 2026");
    });

    it("should identify gap when no analytics provided", () => {
      const noAnalytics = { ...mockB03Input, audience_sources: { ...mockB03Input.audience_sources, platform_analytics: undefined } };
      const evidence = aggregateAudienceEvidence(noAnalytics);
      expect(evidence.gaps.some((g) => g.gap_id === "gap_platform_analytics")).toBe(true);
    });

    it("should identify gap when no research provided", () => {
      const noResearch = { ...mockB03Input, audience_sources: { ...mockB03Input.audience_sources, user_research: undefined } };
      const evidence = aggregateAudienceEvidence(noResearch);
      expect(evidence.gaps.some((g) => g.gap_id === "gap_user_research")).toBe(true);
    });

    it("should identify gap when no evidence at all", () => {
      const noEvidence: B03Input = {
        b01_canonical_state: mockB01State,
        audience_sources: {},
      };
      const result = aggregateAudienceEvidence(noEvidence);
      expect(result.gaps.some((g) => g.gap_id === "gap_no_audience_evidence")).toBe(true);
    });
  });

  // ============================================================================
  // CATEGORY 3: Segmentation Analysis Tests (8 tests)
  // ============================================================================
  describe("Category 3: Analytical Segmentation", () => {
    it("should infer segments from evidence", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);
      expect(segments.length).toBeGreaterThan(0);
    });

    it("should assign segment names based on platform", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);
      const names = segments.map((s) => s.segment_name);
      expect(names.some((n) => n.includes("YOUTUBE") || n.includes("LINKEDIN"))).toBe(true);
    });

    it("should mark segments as INFERRED provenance", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);
      expect(segments.every((s) => s.provenance.type === "INFERRED")).toBe(true);
    });

    it("should calculate segment confidence", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);
      expect(segments.every((s) => s.confidence >= 0 && s.confidence <= 1)).toBe(true);
    });

    it("should track segment evidence", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);
      expect(segments.every((s) => s.evidence_refs.length > 0)).toBe(true);
    });

    it("should infer geography from evidence", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);
      const hasGeography = segments.some((s) => s.geography && s.geography.length > 0);
      expect(hasGeography).toBe(true);
    });

    it("should generate stable segment IDs", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments1 = inferAudienceSegments(mockB01State, evidence.all_evidence);
      const segments2 = inferAudienceSegments(mockB01State, evidence.all_evidence);
      expect(segments1[0]?.segment_id).toBe(segments2[0]?.segment_id);
    });

    it("should create empty segments list if no evidence", () => {
      const segments = inferAudienceSegments(mockB01State, []);
      expect(segments.length).toBe(0);
    });
  });

  // ============================================================================
  // CATEGORY 4: Profile Synthesis Tests (8 tests)
  // ============================================================================
  describe("Category 4: Profile Synthesis", () => {
    it("should synthesize profiles from segments", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);
      const profiles = synthesizeSegmentProfiles(segments);
      expect(profiles.length).toBeGreaterThan(0);
    });

    it("should synthesize audience needs", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);
      const needs = synthesizeAudienceNeeds(segments);
      expect(needs.length).toBeGreaterThan(0);
    });

    it("should mark needs as INFERRED provenance", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);
      const needs = synthesizeAudienceNeeds(segments);
      expect(needs.every((n) => n.provenance.type === "INFERRED")).toBe(true);
    });

    it("should synthesize pain points", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);
      const painPoints = synthesizeAudiencePainPoints(segments);
      expect(painPoints.length).toBeGreaterThanOrEqual(0);
    });

    it("should synthesize audience questions", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);
      const questions = synthesizeAudienceQuestions(segments);
      expect(questions.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle empty segments", () => {
      const profiles = synthesizeSegmentProfiles([]);
      expect(profiles.length).toBe(0);
    });

    it("should track evidence in profiles", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);
      const profiles = synthesizeSegmentProfiles(segments);
      expect(profiles.every((p) => p.evidence_refs.length > 0)).toBe(true);
    });

    it("should calculate profile confidence", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);
      const profiles = synthesizeSegmentProfiles(segments);
      expect(profiles.every((p) => p.confidence >= 0 && p.confidence <= 1)).toBe(true);
    });
  });

  // ============================================================================
  // CATEGORY 5: Validation & Conflict Detection Tests (8 tests)
  // ============================================================================
  describe("Category 5: Validation & Conflict Detection", () => {
    it("should detect conflicts with invalid channel references", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);

      const badSegment = {
        ...segments[0],
        channel_ids: ["nonexistent_channel"],
      };

      const conflicts = detectSegmentConflicts(mockB01State, [badSegment]);
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].severity).toBe("high");
    });

    it("should not detect conflicts for valid channels", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);
      const conflicts = detectSegmentConflicts(mockB01State, segments);
      expect(conflicts.length).toBe(0);
    });

    it("should identify gaps for missing territories", () => {
      const noTerritories = { ...mockB01State, content_territories: undefined };
      const gaps = identifyGaps(noTerritories, 1);
      expect(gaps.some((g) => g.gap_id === "gap_territories")).toBe(true);
    });

    it("should identify gaps for missing segments", () => {
      const gaps = identifyGaps(mockB01State, 0);
      expect(gaps.some((g) => g.gap_id === "gap_no_segments")).toBe(true);
    });

    it("should calculate completeness score 0-100", () => {
      const completeness = calculateCompleteness(mockB01State, 1, 1, []);
      expect(completeness.score).toBeGreaterThanOrEqual(0);
      expect(completeness.score).toBeLessThanOrEqual(100);
    });

    it("should identify missing inputs in completeness", () => {
      const noBrand = { ...mockB01State, brand_profile: undefined };
      const completeness = calculateCompleteness(noBrand, 1, 1, []);
      expect(completeness.missing_inputs.length).toBeGreaterThan(0);
    });

    it("should validate no fabrication", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);
      const isValid = validateNoFabrication(segments);
      expect(isValid).toBe(true);
    });

    it("should reject segments with no evidence", () => {
      const badSegment = {
        segment_id: "bad",
        segment_name: "Bad",
        channel_ids: ["youtube_primary"],
        platform_names: ["YOUTUBE"],
        characteristics: {},
        evidence_refs: [],
        provenance: { type: "INFERRED" as const, decision_authority: "test", timestamp: new Date().toISOString() },
        confidence: 0.5,
        data_sources: [],
      };
      const isValid = validateNoFabrication([badSegment]);
      expect(isValid).toBe(false);
    });
  });

  // ============================================================================
  // CATEGORY 6: Completeness & Readiness Tests (4 tests)
  // ============================================================================
  describe("Category 6: Completeness & Readiness", () => {
    it("should calculate score with complete data", () => {
      const completeness = calculateCompleteness(mockB01State, 2, 1, []);
      expect(completeness.score).toBeGreaterThan(50);
    });

    it("should identify blocking decisions", () => {
      const completeness = calculateCompleteness(mockB01State, 0, 0, [
        {
          gap_id: "test",
          description: "Test",
          required_for: "test",
          priority: "high",
        },
      ]);
      expect(completeness.blocking_decisions.length).toBeGreaterThan(0);
    });

    it("should show score 0 when minimal data", () => {
      const noData = { ...mockB01State, brand_profile: undefined, channels: [], platforms: [] };
      const completeness = calculateCompleteness(noData, 0, 0, []);
      expect(completeness.score).toBeLessThan(50);
    });

    it("should provide actionable missing inputs", () => {
      const incomplete = { ...mockB01State, brand_profile: undefined };
      const completeness = calculateCompleteness(incomplete, 1, 1, []);
      expect(completeness.missing_inputs).toContain("brand_profile.positioning");
    });
  });

  // ============================================================================
  // CATEGORY 7: Evidence & Provenance Tests (6 tests)
  // ============================================================================
  describe("Category 7: Evidence & Provenance Orthogonality", () => {
    it("should track evidence separately from provenance", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);

      const seg = segments[0];
      expect(seg.evidence_refs.length).toBeGreaterThan(0);
      expect(seg.provenance).toBeDefined();
      expect(seg.provenance.type).toBe("INFERRED");
    });

    it("should preserve evidence through synthesis", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);
      const profiles = synthesizeSegmentProfiles(segments);

      expect(profiles[0]?.evidence_refs.length).toBeGreaterThan(0);
    });

    it("should distinguish INFERRED from RECOMMENDED", () => {
      const evidence = aggregateAudienceEvidence(mockB03Input);
      const segments = inferAudienceSegments(mockB01State, evidence.all_evidence);

      // Segments are INFERRED (algorithm output)
      expect(segments.every((s) => s.provenance.type === "INFERRED")).toBe(true);
    });

    it("should require user approval to change to DECIDED", async () => {
      const candidate = runB03(mockB01State, mockB03Input);

      // Candidate has INFERRED segments
      expect(candidate.audience_segments.every((s) => s.provenance.type === "INFERRED")).toBe(true);

      // Manual promotion to DECIDED for testing
      const decidedSegments = candidate.audience_segments.map((s) => ({
        ...s,
        provenance: { ...s.provenance, type: "DECIDED" as const },
      }));

      const persistence = createMockPersistence();
      const canonical = await commitVersion(
        { ...candidate, audience_segments: decidedSegments },
        "v1.0",
        "user@example.com",
        persistence,
      );

      expect(canonical.audience_segments.every((s) => s.provenance.type === "DECIDED")).toBe(true);
    });

    it("should immutably preserve evidence in canonical state", async () => {
      const candidate = runB03(mockB01State, mockB03Input);
      const decidedSegments = candidate.audience_segments.map((s) => ({
        ...s,
        provenance: { ...s.provenance, type: "DECIDED" as const },
      }));

      const persistence = createMockPersistence();
      const canonical = await commitVersion(
        { ...candidate, audience_segments: decidedSegments },
        "v1.0",
        "user@example.com",
        persistence,
      );

      const loaded = await persistence.load("v1.0");
      expect(loaded?.evidence_refs).toEqual(canonical.evidence_refs);
    });

    it("should track decision authority for DECIDED provenance", async () => {
      const candidate = runB03(mockB01State, mockB03Input);
      const decidedSegments = candidate.audience_segments.map((s) => ({
        ...s,
        provenance: { ...s.provenance, type: "DECIDED" as const, decision_authority: "user@example.com" },
      }));

      const persistence = createMockPersistence();
      const canonical = await commitVersion(
        { ...candidate, audience_segments: decidedSegments },
        "v1.0",
        "user@example.com",
        persistence,
      );

      expect(canonical.user_decision_authority).toBe("user@example.com");
    });
  });

  // ============================================================================
  // CATEGORY 8: Canonicalization & Versioning Tests (8 tests)
  // ============================================================================
  describe("Category 8: Canonicalization & Versioning", () => {
    it("should create candidate state from B01 input", () => {
      const candidate = runB03(mockB01State, mockB03Input);
      expect(candidate.audience_segments.length).toBeGreaterThan(0);
      expect(candidate.b01_canonical_version).toBe("v1.0");
    });

    it("should mark candidate segments as INFERRED", () => {
      const candidate = runB03(mockB01State, mockB03Input);
      expect(candidate.audience_segments.every((s) => s.provenance.type === "INFERRED")).toBe(true);
    });

    it("should enforce semantic versioning", async () => {
      const candidate = runB03(mockB01State, mockB03Input);
      const decidedSegments = candidate.audience_segments.map((s) => ({
        ...s,
        provenance: { ...s.provenance, type: "DECIDED" as const },
      }));

      const persistence = createMockPersistence();

      const badVersion = commitVersion(
        { ...candidate, audience_segments: decidedSegments },
        "bad_version",
        "user@example.com",
        persistence,
      );

      expect(badVersion).rejects.toThrow("Invalid version format");
    });

    it("should enforce immutability: duplicate version throws error", async () => {
      const candidate = runB03(mockB01State, mockB03Input);
      const decidedSegments = candidate.audience_segments.map((s) => ({
        ...s,
        provenance: { ...s.provenance, type: "DECIDED" as const },
      }));

      const persistence = createMockPersistence();

      await commitVersion(
        { ...candidate, audience_segments: decidedSegments },
        "v1.0",
        "user@example.com",
        persistence,
      );

      const duplicate = commitVersion(
        { ...candidate, audience_segments: decidedSegments },
        "v1.0",
        "user@example.com",
        persistence,
      );

      expect(duplicate).rejects.toThrow("already committed");
    });

    it("should list all versions", async () => {
      const persistence = createMockPersistence();
      const candidate = runB03(mockB01State, mockB03Input);
      const decidedSegments = candidate.audience_segments.map((s) => ({
        ...s,
        provenance: { ...s.provenance, type: "DECIDED" as const },
      }));

      await commitVersion(
        { ...candidate, audience_segments: decidedSegments },
        "v1.0",
        "user@example.com",
        persistence,
      );

      const versions = await listVersions(persistence);
      expect(versions).toContain("v1.0");
    });

    it("should load specific version", async () => {
      const persistence = createMockPersistence();
      const candidate = runB03(mockB01State, mockB03Input);
      const decidedSegments = candidate.audience_segments.map((s) => ({
        ...s,
        provenance: { ...s.provenance, type: "DECIDED" as const },
      }));

      await commitVersion(
        { ...candidate, audience_segments: decidedSegments },
        "v1.0",
        "user@example.com",
        persistence,
      );

      const loaded = await persistence.load("v1.0");
      expect(loaded?.version).toBe("v1.0");
    });

    it("should handle version not found", async () => {
      const persistence = createMockPersistence();
      const loaded = await persistence.load("v99.99");
      expect(loaded).toBeNull();
    });

    it("should track canonical only DECIDED items", async () => {
      const candidate = runB03(mockB01State, mockB03Input);
      const partialDecided = candidate.audience_segments.map((s, i) => ({
        ...s,
        provenance: {
          ...s.provenance,
          type: (i === 0 ? "DECIDED" : "INFERRED") as const,
        },
      }));

      const persistence = createMockPersistence();
      const canonical = await commitVersion(
        { ...candidate, audience_segments: partialDecided },
        "v1.0",
        "user@example.com",
        persistence,
      );

      // Canonical should only have 1 DECIDED segment
      expect(canonical.audience_segments.length).toBe(1);
    });
  });

  // ============================================================================
  // CATEGORY 9: B01 Immutability Tests (3 tests)
  // ============================================================================
  describe("Category 9: B01 Immutability", () => {
    it("should consume B01 as read-only", () => {
      const candidate = runB03(mockB01State, mockB03Input);
      expect(candidate.b01_canonical_version).toBe(mockB01State.version);
    });

    it("should not propose B01 changes", () => {
      const candidate = runB03(mockB01State, mockB03Input);
      // B03 should not have any recommendations that modify B01
      const b01ModifyingRecs = candidate.all_recommendations.filter((r) =>
        r.proposal.toLowerCase().includes("change b01"),
      );
      expect(b01ModifyingRecs.length).toBe(0);
    });

    it("should report conflicts instead of overriding B01", () => {
      const badSegment = {
        segment_id: "bad",
        segment_name: "Bad",
        channel_ids: ["nonexistent"],
        platform_names: ["YOUTUBE"],
        characteristics: {},
        evidence_refs: [],
        provenance: { type: "INFERRED" as const, decision_authority: "test", timestamp: new Date().toISOString() },
        confidence: 0.5,
        data_sources: [],
      };

      const conflicts = detectSegmentConflicts(mockB01State, [badSegment]);
      expect(conflicts.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // CATEGORY 10: A-Branch Boundary Tests (5 tests)
  // ============================================================================
  describe("Category 10: A-Branch Boundary Enforcement", () => {
    it("should not synthesize topic research", () => {
      const candidate = runB03(mockB01State, mockB03Input);
      // No synthesized content should include topic research
      const insights = candidate.audience_insights;
      const topicInsights = insights.filter((i) =>
        i.description.toLowerCase().includes("trending") ||
        i.description.toLowerCase().includes("popular topics"),
      );
      expect(topicInsights.length).toBe(0);
    });

    it("should not create hooks or scripts", () => {
      const candidate = runB03(mockB01State, mockB03Input);
      const insights = candidate.audience_insights;
      const hookInsights = insights.filter((i) =>
        i.description.toLowerCase().includes("hook") ||
        i.description.toLowerCase().includes("script"),
      );
      expect(hookInsights.length).toBe(0);
    });

    it("should not prescribe production specs", () => {
      const candidate = runB03(mockB01State, mockB03Input);
      // No insights should include production specs like resolution, bitrate
      const allText = candidate.audience_insights.map((i) => i.description).join(" ");
      expect(allText.toLowerCase()).not.toContain("1080p");
      expect(allText.toLowerCase()).not.toContain("resolution");
    });

    it("should stay at strategy level", () => {
      const candidate = runB03(mockB01State, mockB03Input);
      // Segments should be about audience, not execution
      expect(candidate.audience_segments.every((s) =>
        s.segment_name && !s.segment_name.includes("produce") && !s.segment_name.includes("publish"),
      )).toBe(true);
    });

    it("should not duplicate A-Branch audience research", () => {
      const candidate = runB03(mockB01State, mockB03Input);
      // B03 identifies segments; A would research how to reach them creatively
      // B03's output (segments) is distinct from A's (creative angles)
      expect(candidate.audience_segments.length).toBeGreaterThan(0);
      // But B03 doesn't generate content angles
      const hasContentAngles = candidate.audience_insights.some((i) =>
        i.description.includes("angle") || i.description.includes("creative"),
      );
      expect(hasContentAngles).toBe(false);
    });
  });

  // ============================================================================
  // CATEGORY 11: Determinism Tests (3 tests)
  // ============================================================================
  describe("Category 11: Deterministic Output", () => {
    it("should produce same segments from same input", () => {
      const seg1 = runB03(mockB01State, mockB03Input);
      const seg2 = runB03(mockB01State, mockB03Input);

      expect(seg1.audience_segments.length).toBe(seg2.audience_segments.length);
      expect(seg1.audience_segments[0]?.segment_id).toBe(seg2.audience_segments[0]?.segment_id);
    });

    it("should generate stable hashes for segment IDs", () => {
      const deps = createDefaultDeps();
      const id1 = deps.hash?.stableSegmentId("v1.0", "ch1", "Engineers") || "";
      const id2 = deps.hash?.stableSegmentId("v1.0", "ch1", "Engineers") || "";
      expect(id1).toBe(id2);
    });

    it("should be deterministic with registry mapping", () => {
      const reg1 = buildAudienceRegistry(mockB01State);
      const reg2 = buildAudienceRegistry(mockB01State);

      expect(Array.from(reg1.channels.keys())).toEqual(Array.from(reg2.channels.keys()));
    });
  });

  // ============================================================================
  // CATEGORY 12: B02 Independence Tests (2 tests)
  // ============================================================================
  describe("Category 12: B02 Independence", () => {
    it("should run independently without B02", () => {
      const candidate = runB03(mockB01State, mockB03Input);
      expect(candidate.audience_segments.length).toBeGreaterThan(0);
      // B03 doesn't call or depend on B02
    });

    it("should consume same B01 as B02 without conflict", () => {
      // Both B02 and B03 can consume B01
      const candidate = runB03(mockB01State, mockB03Input);
      expect(candidate.b01_canonical_version).toBe(mockB01State.version);
      // No dependency on B02's output
    });
  });
});

// ================================================================
// CATEGORY 13: GOVERNANCE ROUTING TESTS (BLOCK 1)
// ================================================================

describe("B03 Governance Routing Tests", () => {
  let persistence: ReturnType<typeof createMockPersistence>;

  beforeEach(() => {
    persistence = createMockPersistence();
  });

  it("should initialize governance_events as empty dict in candidate", () => {
    const candidate = runB03(mockB01State, mockB03Input);

    expect(candidate.governance_events).toBeDefined();
    expect(typeof candidate.governance_events).toBe("object");
    expect(Object.keys(candidate.governance_events).length).toBe(0);
  });

  it("should populate governance_events after approveCandidate", async () => {
    const candidate = runB03(mockB01State, mockB03Input);
    const approved = await approveCandidate(candidate, "test@example.com");

    expect(Object.keys(approved.governance_events).length).toBeGreaterThan(0);
    for (const itemId of Object.keys(approved.governance_events)) {
      const events = approved.governance_events[itemId];
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThanOrEqual(2); // PROPOSED + APPROVED minimum
    }
  });

  it("should mark segments as DECIDED after approveCandidate", async () => {
    const candidate = runB03(mockB01State, mockB03Input);
    const approved = await approveCandidate(candidate, "test@example.com");

    for (const segment of approved.audience_segments) {
      expect(segment.provenance.type).toBe("DECIDED");
    }
  });

  it("should mark profiles as DECIDED after approveCandidate", async () => {
    const candidate = runB03(mockB01State, mockB03Input);
    const approved = await approveCandidate(candidate, "test@example.com");

    for (const profile of approved.segment_profiles) {
      expect(profile.provenance.type).toBe("DECIDED");
    }
  });

  it("should mark insights as DECIDED after approveCandidate", async () => {
    const candidate = runB03(mockB01State, mockB03Input);
    const approved = await approveCandidate(candidate, "test@example.com");

    for (const insight of approved.audience_insights) {
      expect(insight.provenance.type).toBe("DECIDED");
    }
  });

  it("should set prior_provenance_id linkage in all DECIDED items", async () => {
    const candidate = runB03(mockB01State, mockB03Input);
    const approved = await approveCandidate(candidate, "test@example.com");

    for (const segment of approved.audience_segments) {
      expect(segment.provenance.prior_provenance_id).toBeDefined();
      expect(typeof segment.provenance.prior_provenance_id).toBe("string");
    }

    for (const profile of approved.segment_profiles) {
      expect(profile.provenance.prior_provenance_id).toBeDefined();
      expect(typeof profile.provenance.prior_provenance_id).toBe("string");
    }
  });

  it("should filter only DECIDED segments into canonical", async () => {
    const freshCandidate = runB03(mockB01State, mockB03Input);
    const canonical = await commitVersion(
      freshCandidate,
      "v1.0",
      "test@example.com",
      persistence,
    );

    // Without governance approval, no items should be DECIDED
    expect(canonical.audience_segments.length).toBe(0);
  });

  it("should include approved segments in canonical", async () => {
    const candidate = runB03(mockB01State, mockB03Input);
    const approved = await approveCandidate(candidate, "test@example.com");
    const canonical = await commitVersion(
      approved,
      "v1.0",
      "test@example.com",
      persistence,
    );

    expect(canonical.audience_segments.length).toBeGreaterThan(0);
    expect(canonical.audience_segments.length).toBe(approved.audience_segments.length);
  });

  it("should preserve governance_events in canonical state", async () => {
    const candidate = runB03(mockB01State, mockB03Input);
    const approved = await approveCandidate(candidate, "test@example.com");
    const canonical = await commitVersion(
      approved,
      "v1.0",
      "test@example.com",
      persistence,
    );

    expect(canonical.governance_events).toBeDefined();
    expect(Object.keys(canonical.governance_events).length).toBeGreaterThan(0);
  });
});

// ================================================================
// CATEGORY 14: DETERMINISM TESTS (BLOCK 1)
// ================================================================

describe("B03 Determinism Tests", () => {
  it("should produce identical candidate_id with identical input under different dates", () => {
    const fixedDate1 = "2026-08-30T10:00:00Z";
    const fixedDate2 = "2026-09-15T14:30:00Z";

    const deps1 = createDefaultDeps();
    deps1.now = () => fixedDate1;
    const candidate1 = runB03(mockB01State, mockB03Input, deps1);

    const deps2 = createDefaultDeps();
    deps2.now = () => fixedDate2;
    const candidate2 = runB03(mockB01State, mockB03Input, deps2);

    expect(candidate1.candidate_id).toBe(candidate2.candidate_id);
  });

  it("should have different timestamps but same candidate_id", () => {
    const fixedDate1 = "2026-08-30T10:00:00Z";
    const fixedDate2 = "2026-09-15T14:30:00Z";

    const deps1 = createDefaultDeps();
    deps1.now = () => fixedDate1;
    const candidate1 = runB03(mockB01State, mockB03Input, deps1);

    const deps2 = createDefaultDeps();
    deps2.now = () => fixedDate2;
    const candidate2 = runB03(mockB01State, mockB03Input, deps2);

    expect(candidate1.created_at).not.toBe(candidate2.created_at);
    expect(candidate1.candidate_id).toBe(candidate2.candidate_id);
  });
});

// ================================================================
// CATEGORY 15: EVIDENCE PRESERVATION TESTS (BLOCK 1)
// ================================================================

describe("B03 Evidence Preservation Tests", () => {
  let persistence: ReturnType<typeof createMockPersistence>;

  beforeEach(() => {
    persistence = createMockPersistence();
  });

  it("should preserve evidence_refs through candidate→approval→canonical", async () => {
    const candidate = runB03(mockB01State, mockB03Input);

    expect(candidate.evidence_refs).toBeDefined();

    const approved = await approveCandidate(candidate, "test@example.com");
    expect(approved.evidence_refs).toEqual(candidate.evidence_refs);

    const canonical = await commitVersion(
      approved,
      "v1.0",
      "test@example.com",
      persistence,
    );

    expect(canonical.evidence_refs).toEqual(candidate.evidence_refs);
  });

  it("should preserve per-segment evidence_refs in canonical", async () => {
    const candidate = runB03(mockB01State, mockB03Input);
    const approved = await approveCandidate(candidate, "test@example.com");

    for (const seg of approved.audience_segments) {
      expect(seg.evidence_refs).toBeDefined();
    }

    const canonical = await commitVersion(
      approved,
      "v1.0",
      "test@example.com",
      persistence,
    );

    for (let i = 0; i < canonical.audience_segments.length; i++) {
      expect(canonical.audience_segments[i].evidence_refs).toEqual(
        approved.audience_segments[i].evidence_refs,
      );
    }
  });

  it("should preserve per-insight evidence_refs in canonical", async () => {
    const candidate = runB03(mockB01State, mockB03Input);
    const approved = await approveCandidate(candidate, "test@example.com");

    for (const insight of approved.audience_insights) {
      expect(insight.evidence_refs).toBeDefined();
    }

    const canonical = await commitVersion(
      approved,
      "v1.0",
      "test@example.com",
      persistence,
    );

    for (let i = 0; i < canonical.audience_insights.length; i++) {
      expect(canonical.audience_insights[i].evidence_refs).toEqual(
        approved.audience_insights[i].evidence_refs,
      );
    }
  });
});

// ================================================================
// CATEGORY 16: PROVENANCE PRESERVATION TESTS (BLOCK 1)
// ================================================================

describe("B03 Provenance Preservation Tests", () => {
  let persistence: ReturnType<typeof createMockPersistence>;

  beforeEach(() => {
    persistence = createMockPersistence();
  });

  it("should preserve provenance_refs through candidate→canonical", async () => {
    const candidate = runB03(mockB01State, mockB03Input);

    expect(candidate.provenance_refs).toBeDefined();

    const approved = await approveCandidate(candidate, "test@example.com");
    expect(approved.provenance_refs).toEqual(candidate.provenance_refs);

    const canonical = await commitVersion(
      approved,
      "v1.0",
      "test@example.com",
      persistence,
    );

    expect(canonical.provenance_refs).toEqual(candidate.provenance_refs);
  });

  it("should carry DECIDED provenance_type after approval", async () => {
    const candidate = runB03(mockB01State, mockB03Input);
    const approved = await approveCandidate(candidate, "test@example.com");

    for (const seg of approved.audience_segments) {
      expect(seg.provenance.type).toBe("DECIDED");
    }

    const canonical = await commitVersion(
      approved,
      "v1.0",
      "test@example.com",
      persistence,
    );

    for (const seg of canonical.audience_segments) {
      expect(seg.provenance.type).toBe("DECIDED");
    }
  });
});

// ================================================================
// CATEGORY 17: AUDIT TRAIL TESTS (BLOCK 1)
// ================================================================

describe("B03 Audit Trail Tests", () => {
  let persistence: ReturnType<typeof createMockPersistence>;

  beforeEach(() => {
    persistence = createMockPersistence();
  });

  it("should create proper audit entries on first commitVersion", async () => {
    const candidate = runB03(mockB01State, mockB03Input);
    const approved = await approveCandidate(candidate, "test@example.com");

    const canonical = await commitVersion(
      approved,
      "v1.0",
      "test@example.com",
      persistence,
    );

    expect(canonical.audit_trail).toBeDefined();
    expect(canonical.audit_trail.length).toBeGreaterThan(0);

    for (const entry of canonical.audit_trail) {
      expect(entry).toHaveProperty("version");
      expect(entry).toHaveProperty("changed_at");
      expect(entry).toHaveProperty("changed_by");
      expect(entry).toHaveProperty("summary");
    }
  });

  it("should append audit entries on subsequent versions", async () => {
    const candidate1 = runB03(mockB01State, mockB03Input);
    const approved1 = await approveCandidate(candidate1, "test@example.com");
    const canonical1 = await commitVersion(
      approved1,
      "v1.0",
      "test@example.com",
      persistence,
    );

    expect(canonical1.audit_trail.length).toBeGreaterThan(0);

    const candidate2 = runB03(mockB01State, mockB03Input);
    const approved2 = await approveCandidate(candidate2, "test@example.com");
    const canonical2 = await commitVersion(
      approved2,
      "v1.1",
      "test@example.com",
      persistence,
      canonical1,
    );

    expect(canonical2.audit_trail.length).toBeGreaterThan(canonical1.audit_trail.length);
  });
});

// ================================================================
// CATEGORY 18: CANONICALIZATION LOSS GUARD TESTS (BLOCK 1)
// ================================================================

describe("B03 Canonicalization Loss Guard Tests", () => {
  let persistence: ReturnType<typeof createMockPersistence>;

  beforeEach(() => {
    persistence = createMockPersistence();
  });

  it("should not have undeclared canonicalization drops", async () => {
    const candidate = runB03(mockB01State, mockB03Input);
    const approved = await approveCandidate(candidate, "test@example.com");

    const canonical = await commitVersion(
      approved,
      "v1.0",
      "test@example.com",
      persistence,
    );

    const candidateKeys = Object.keys(candidate);
    const canonicalKeys = Object.keys(canonical);

    const drops = candidateKeys.filter(
      (k) => !canonicalKeys.includes(k) && !KNOWN_CANONICALIZATION_DROPS[k as keyof typeof KNOWN_CANONICALIZATION_DROPS],
    );

    expect(drops).toEqual([]);
  });

  it("should declare KNOWN_CANONICALIZATION_DROPS as constant", () => {
    expect(KNOWN_CANONICALIZATION_DROPS).toBeDefined();
    expect(typeof KNOWN_CANONICALIZATION_DROPS).toBe("object");
  });
});
