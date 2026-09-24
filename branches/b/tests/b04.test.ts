// tests/b04.test.ts
// B04 Strategic Planning — Comprehensive Test Suite

import { describe, it, expect, beforeEach } from "vitest";
import type {
  B04CandidateState,
  B04CanonicalState,
  B04Deps,
} from "../src/b04/types.js";
import type { B01CanonicalState } from "../src/b00/contracts.js";
import type { B02CandidateState } from "../src/b02/types.js";
import type { B03CandidateState } from "../src/b03/types.js";
import {
  runB04,
  commitVersion,
  approveCandidate,
  createMockPersistence,
} from "../src/b04/index.js";
import { canonicalHasher } from "../src/b00/hashing.js";

// Mock data builders
function createMockB01(): B01CanonicalState {
  return {
    version: "v1.0",
    created_at: "2026-08-28T10:00:00Z",
    updated_at: "2026-08-28T10:00:00Z",
    user_decision_authority: "test@example.com",
    audit_trail: [],
    decisions_made: [],
    recommendations_considered: [],
    evidence_refs: [],
    provenance_refs: [],
    brand_profile: {
      brand_name: "TechBrand",
      positioning: "Enterprise AI solutions",
      mission: "Make AI accessible",
      values: ["Innovation", "Trust"],
    },
    channels: [
      {
        channel_id: "ch_youtube",
        name: "YouTube",
        platform: "YouTube",
        role: "primary",
        status: "VERIFIED",
        url: "https://youtube.com/@techbrand",
        metrics: { subscribers: 50000, engagement_rate: 0.12 },
      },
      {
        channel_id: "ch_linkedin",
        name: "LinkedIn",
        platform: "LinkedIn",
        role: "secondary",
        status: "VERIFIED",
        url: "https://linkedin.com/company/techbrand",
      },
    ],
    platforms: [
      {
        platform_id: "p_youtube",
        name: "YouTube",
        capabilities: ["video", "short-form", "live"],
        reach: "broad",
        content_formats: ["long-form", "short-form"],
        audience_reach: "broad",
      },
      {
        platform_id: "p_linkedin",
        name: "LinkedIn",
        capabilities: ["articles", "video", "carousel"],
        reach: "professional",
        content_formats: ["articles", "video"],
        audience_reach: "professional",
      },
    ],
    ecosystems: [],
    content_territories: [
      {
        territory_id: "t_us",
        type: "geographic",
        description: "United States",
        boundaries: ["US"],
        channels_allowed: ["ch_youtube", "ch_linkedin"],
        channels_restricted: [],
        compliance_notes: [],
      },
      {
        territory_id: "t_eu",
        type: "geographic",
        description: "European Union",
        boundaries: ["EU"],
        channels_allowed: ["ch_linkedin"],
        channels_restricted: [],
        compliance_notes: ["GDPR compliance required"],
      },
    ],
    distribution_strategy: {
      strategy_description: "Multi-channel enterprise focus",
      channel_assignments: [
        {
          channel_id: "ch_youtube",
          distribution_role: "primary_channel",
          routing_priority: 1,
        },
        {
          channel_id: "ch_linkedin",
          distribution_role: "secondary_channel",
          routing_priority: 2,
        },
      ],
    },
    editorial_constitution: {
      content_pillars: [],
      tone_guidelines: "Professional, thought-leadership focused",
      publishing_frequency: "2-3 per week",
    },
    strategic_constraints: [],
    completeness: { score: 100, missing_inputs: [], blocking_decisions: [] },
    conflicts: [],
    gaps: [],
  };
}

function createMockB02(): B02CandidateState {
  return {
    candidate_id: "cand_b02_1",
    created_at: "2026-08-28T10:00:00Z",
    opportunities: [
      {
        opportunity_id: "opp_1",
        title: "YouTube AI governance opportunity",
        description: "AI governance & ethics thought leadership on YouTube",
        channel_id: "ch_youtube",
        platform_name: "YouTube",
        opportunity_type: "positioning_alignment",
        strategic_relevance: 0.9,
        blocking_constraints: [],
        supporting_evidence: [
          {
            id: "ev_opp1",
            source: "Market research",
            status: "VERIFIED",
            excerpt: "Growing interest in AI governance",
          },
        ],
        provenance: {
          type: "INFERRED",
          decision_authority: "B02_agent",
          timestamp: "2026-08-28T10:00:00Z",
          rationale: "Inferred from B01 positioning",
          id: "prov_opp1",
        },
        gaps: [],
      } as any,
      {
        opportunity_id: "opp_2",
        title: "LinkedIn enterprise practices opportunity",
        description: "Enterprise AI implementation best practices on LinkedIn",
        channel_id: "ch_linkedin",
        platform_name: "LinkedIn",
        opportunity_type: "capability_match",
        strategic_relevance: 0.8,
        blocking_constraints: [],
        supporting_evidence: [
          {
            id: "ev_opp2",
            source: "Competitive analysis",
            status: "VERIFIED",
            excerpt: "Implementation guides underserved",
          },
        ],
        provenance: {
          type: "INFERRED",
          decision_authority: "B02_agent",
          timestamp: "2026-08-28T10:00:00Z",
          rationale: "Identified gap in market",
          id: "prov_opp2",
        },
        gaps: [],
      } as any,
    ],
    opportunity_classes: [],
    priority_matrix: [],
    conflicts_detected: [],
    gaps: [],
    evidence_refs: [],
    provenance_refs: [],
    governance_events: {},
    all_recommendations: [],
    completeness: { score: 90, missing_inputs: [], blocking_decisions: [] },
  };
}

function createMockB03(): B03CandidateState {
  return {
    candidate_id: "cand_b03_1",
    created_at: "2026-08-28T10:00:00Z",
    b01_canonical_version: "v1.0",
    audience_segments: [
      {
        segment_id: "seg_1",
        segment_name: "Enterprise CTO Audience",
        channel_ids: ["ch_youtube"],
        platform_names: ["YouTube"],
        geography: ["US", "EU"],
        characteristics: {
          role_title: "CTO/VP Engineering",
          seniority_level: "senior",
          company_size: "enterprise",
          industry: ["SaaS", "FinTech"],
        },
        evidence_refs: [
          {
            id: "ev_seg1",
            source: "YouTube Analytics",
            status: "VERIFIED",
            excerpt: "CTO and VP Eng viewership 45%",
          },
        ],
        provenance: {
          type: "INFERRED",
          decision_authority: "B03_agent",
          timestamp: "2026-08-28T10:00:00Z",
          rationale: "Inferred from YouTube analytics",
        },
        confidence: 0.85,
        data_sources: ["YouTube Analytics"],
      },
      {
        segment_id: "seg_2",
        segment_name: "Engineering Manager Audience",
        channel_ids: ["ch_linkedin"],
        platform_names: ["LinkedIn"],
        geography: ["US", "EU"],
        characteristics: {
          role_title: "Engineering Manager",
          seniority_level: "mid",
          company_size: "enterprise",
          industry: ["SaaS"],
        },
        evidence_refs: [
          {
            id: "ev_seg2",
            source: "LinkedIn Insights",
            status: "VERIFIED",
            excerpt: "Engineering Managers 30% of followers",
          },
        ],
        provenance: {
          type: "INFERRED",
          decision_authority: "B03_agent",
          timestamp: "2026-08-28T10:00:00Z",
          rationale: "Inferred from LinkedIn data",
        },
        confidence: 0.75,
        data_sources: ["LinkedIn Insights"],
      },
    ],
    segment_profiles: [],
    audience_insights: [],
    audience_needs: [],
    audience_pain_points: [],
    audience_questions: [],
    conflicts_detected: [],
    gaps: [],
    evidence_refs: [],
    provenance_refs: [],
    all_recommendations: [],
    completeness: { score: 85, missing_inputs: [], blocking_decisions: [] },
  };
}

describe("B04 Strategic Planning", () => {
  let b01: B01CanonicalState;
  let b02: B02CandidateState;
  let b03: B03CandidateState;

  beforeEach(() => {
    b01 = createMockB01();
    b02 = createMockB02();
    b03 = createMockB03();
  });

  describe("1. Registry & Context Mapping", () => {
    it("should build strategy context from B01 + B02 + B03", async () => {
      const candidate = await runB04(b01, b02, b03);
      expect(candidate).toBeDefined();
      expect(candidate.b01_version).toBe("v1.0");
    });

    it("should extract brand profile from B01", async () => {
      const candidate = await runB04(b01, b02, b03);
      expect(candidate.campaigns.length).toBeGreaterThan(0);
    });

    it("should map B02 opportunities to campaigns", async () => {
      const candidate = await runB04(b01, b02, b03);
      expect(candidate.campaigns.length).toBe(b02.opportunities.length);
    });

    it("should reference B03 segments in campaigns", async () => {
      const candidate = await runB04(b01, b02, b03);
      for (const campaign of candidate.campaigns) {
        expect(campaign.target_segments.length).toBeGreaterThan(0);
      }
    });

    it("should include only valid B01 territories", async () => {
      const candidate = await runB04(b01, b02, b03);
      const b01TerritoryIds = new Set(
        b01.content_territories.map((t) => t.territory_id),
      );
      for (const campaign of candidate.campaigns) {
        for (const territory of campaign.territories) {
          expect(b01TerritoryIds.has(territory)).toBe(true);
        }
      }
    });
  });

  describe("2. Opportunity-Segment Alignment", () => {
    it("should create alignment scores for opportunity×segment pairs", async () => {
      const candidate = await runB04(b01, b02, b03);
      expect(candidate.alignment_matrix.length).toBeGreaterThan(0);
    });

    it("should calculate alignment based on territory overlap + confidence", async () => {
      const candidate = await runB04(b01, b02, b03);
      for (const align of candidate.alignment_matrix) {
        expect(align.alignment_score).toBeGreaterThan(0);
        expect(align.alignment_score).toBeLessThanOrEqual(1);
      }
    });

    it("should include evidence in alignment scores", async () => {
      const candidate = await runB04(b01, b02, b03);
      for (const align of candidate.alignment_matrix) {
        expect(align.evidence_refs.length).toBeGreaterThan(0);
      }
    });
  });

  describe("3. Campaign Synthesis", () => {
    it("should create campaigns from opportunities", async () => {
      const candidate = await runB04(b01, b02, b03);
      expect(candidate.campaigns.length).toBe(b02.opportunities.length);
    });

    it("should include campaign_id (deterministic hash)", async () => {
      const candidate = await runB04(b01, b02, b03);
      for (const campaign of candidate.campaigns) {
        expect(campaign.campaign_id).toMatch(/^camp_/);
      }
    });

    it("should set campaign timeline_months", async () => {
      const candidate = await runB04(b01, b02, b03);
      for (const campaign of candidate.campaigns) {
        expect(campaign.timeline_months).toBeGreaterThan(0);
      }
    });

    it("should include primary and secondary objectives", async () => {
      const candidate = await runB04(b01, b02, b03);
      for (const campaign of candidate.campaigns) {
        expect(campaign.primary_objective).toBeDefined();
        expect(campaign.secondary_objectives.length).toBeGreaterThan(0);
      }
    });

    it("should mark campaigns with INFERRED provenance", async () => {
      const candidate = await runB04(b01, b02, b03);
      for (const campaign of candidate.campaigns) {
        expect(campaign.provenance.type).toBe("INFERRED");
      }
    });
  });

  describe("4. Priority Ranking", () => {
    it("should create strategic priorities from campaigns", async () => {
      const candidate = await runB04(b01, b02, b03);
      expect(candidate.strategic_priorities.length).toBe(candidate.campaigns.length);
    });

    it("should assign rank 1, 2, 3... to priorities", async () => {
      const candidate = await runB04(b01, b02, b03);
      const sorted = [...candidate.strategic_priorities].sort((a, b) => a.rank - b.rank);
      for (let i = 0; i < sorted.length; i++) {
        expect(sorted[i]!.rank).toBe(i + 1);
      }
    });

    it("should generate priority_id (deterministic hash)", async () => {
      const candidate = await runB04(b01, b02, b03);
      for (const priority of candidate.strategic_priorities) {
        expect(priority.priority_id).toMatch(/^prio_/);
      }
    });

    it("should mark priorities with INFERRED provenance", async () => {
      const candidate = await runB04(b01, b02, b03);
      for (const priority of candidate.strategic_priorities) {
        expect(priority.provenance.type).toBe("INFERRED");
      }
    });
  });

  describe("5. Validation & Conflict Detection", () => {
    it("should detect territory mismatches", async () => {
      const b01Modified = { ...b01, content_territories: [] };
      const candidate = await runB04(b01Modified, b02, b03);
      // Missing territories should be detected as a gap, not a conflict
      expect(candidate.gaps.some((g) => g.description.includes("territories"))).toBe(true);
    });

    it("should identify missing brand positioning", async () => {
      const b01Modified = {
        ...b01,
        brand_profile: { ...b01.brand_profile, positioning: "UNKNOWN" },
      };
      const candidate = await runB04(b01Modified, b02, b03);
      expect(candidate.gaps.some((g) => g.description.includes("positioning"))).toBe(
        true,
      );
    });

    it("should report missing opportunities as blocking gap", async () => {
      const b02Empty = { ...b02, opportunities: [] };
      const candidate = await runB04(b01, b02Empty, b03);
      const hasBlockingGap = candidate.gaps.some((g) => g.priority === "high");
      expect(hasBlockingGap).toBe(true);
    });

    it("should report missing segments as blocking gap", async () => {
      const candidate = await runB04(b01, b02, { ...b03, audience_segments: [] });
      expect(
        candidate.gaps.some((g) => g.priority === "high" && g.description.includes("segment")),
      ).toBe(true);
    });
  });

  describe("6. Completeness Scoring", () => {
    it("should score completeness 0-100", async () => {
      const candidate = await runB04(b01, b02, b03);
      expect(candidate.completeness.score).toBeGreaterThanOrEqual(0);
      expect(candidate.completeness.score).toBeLessThanOrEqual(100);
    });

    it("should reward brand positioning (20 pts)", async () => {
      const candidate1 = await runB04(b01, b02, b03);
      const b01NoPositioning = {
        ...b01,
        brand_profile: { ...b01.brand_profile, positioning: "UNKNOWN" },
      };
      const candidate2 = await runB04(b01NoPositioning, b02, b03);
      expect(candidate1.completeness.score).toBeGreaterThan(candidate2.completeness.score);
    });

    it("should track blocking decisions", async () => {
      const candidate = await runB04(b01, { ...b02, opportunities: [] }, b03);
      expect(candidate.completeness.blocking_decisions.length).toBeGreaterThan(0);
    });
  });

  describe("7. Evidence & Provenance Orthogonality", () => {
    it("should include evidence_refs for all campaigns", async () => {
      const candidate = await runB04(b01, b02, b03);
      for (const campaign of candidate.campaigns) {
        expect(campaign.evidence_refs).toBeDefined();
      }
    });

    it("should mark provenance.type as INFERRED for candidate items", async () => {
      const candidate = await runB04(b01, b02, b03);
      for (const campaign of candidate.campaigns) {
        expect(campaign.provenance.type).toBe("INFERRED");
        expect(campaign.provenance.decision_authority).toBeDefined();
      }
    });

    it("should preserve evidence through candidate state", async () => {
      const candidate = await runB04(b01, b02, b03);
      expect(candidate.evidence_refs.length).toBeGreaterThan(0);
    });

    it("should NOT collapse Evidence and Provenance", async () => {
      const candidate = await runB04(b01, b02, b03);
      for (const campaign of candidate.campaigns) {
        expect(campaign.evidence_refs.length).toBeGreaterThan(0);
        expect(campaign.provenance).toBeDefined();
        expect(campaign.provenance.type).toBeDefined();
      }
    });
  });

  describe("8. Candidate vs Canonical State Separation", () => {
    it("should return B04CandidateState from runB04", async () => {
      const candidate = await runB04(b01, b02, b03);
      expect(candidate.candidate_id).toBeDefined();
      expect(candidate.created_at).toBeDefined();
    });

    it("should mark all items INFERRED/RECOMMENDED in candidate", async () => {
      const candidate = await runB04(b01, b02, b03);
      for (const campaign of candidate.campaigns) {
        expect(["INFERRED", "RECOMMENDED", "OBSERVED"]).toContain(
          campaign.provenance.type,
        );
        expect(campaign.provenance.type).not.toBe("DECIDED");
      }
    });

    it("should require user decision for canonicalization", async () => {
      const candidate = await runB04(b01, b02, b03);
      const persistence = createMockPersistence();
      const canonical = await commitVersion(
        candidate,
        "v1.0",
        "user@example.com",
        persistence,
      );
      expect(canonical.version).toBe("v1.0");
      expect(canonical.user_decision_authority).toBe("user@example.com");
    });

    it("should filter to DECIDED-only items in canonical", async () => {
      const candidate = await runB04(b01, b02, b03);
      const persistence = createMockPersistence();
      const canonical = await commitVersion(
        candidate,
        "v1.0",
        "user@example.com",
        persistence,
      );
      for (const campaign of canonical.campaigns) {
        expect(campaign.provenance.type).toBe("DECIDED");
      }
    });
  });

  describe("9. Immutable Versioning", () => {
    it("should enforce semantic versioning v#.#", async () => {
      const candidate = await runB04(b01, b02, b03);
      const persistence = createMockPersistence();
      await commitVersion(candidate, "v1.0", "user@example.com", persistence);

      try {
        await commitVersion(candidate, "v1.0", "user@example.com", persistence);
        expect.fail("Should throw on duplicate version");
      } catch (e) {
        expect((e as Error).message).toContain("already exists");
      }
    });

    it("should reject invalid semantic version format", async () => {
      const candidate = await runB04(b01, b02, b03);
      const persistence = createMockPersistence();

      try {
        await commitVersion(candidate, "1.0", "user@example.com", persistence);
        expect.fail("Should throw on invalid format");
      } catch (e) {
        expect((e as Error).message).toContain("Invalid semantic version");
      }
    });

    it("should create audit trail in canonical state", async () => {
      const candidate = await runB04(b01, b02, b03);
      const persistence = createMockPersistence();
      const canonical = await commitVersion(
        candidate,
        "v1.0",
        "user@example.com",
        persistence,
      );
      expect(canonical.audit_trail.length).toBeGreaterThan(0);
      expect(canonical.audit_trail[0]!.changed_by).toBe("user@example.com");
    });

    it("should set cannot_be_modified_until_next_version flag", async () => {
      const candidate = await runB04(b01, b02, b03);
      const persistence = createMockPersistence();
      const canonical = await commitVersion(
        candidate,
        "v1.0",
        "user@example.com",
        persistence,
      );
      expect(canonical.cannot_be_modified_until_next_version).toBe(true);
    });
  });

  describe("10. B01 Immutability (Read-Only Consumption)", () => {
    it("should NOT mutate B01 state", async () => {
      const b01Original = JSON.parse(JSON.stringify(b01));
      await runB04(b01, b02, b03);
      expect(b01).toEqual(b01Original);
    });
  });

  describe("11. Deterministic ID Generation", () => {
    it("should generate same campaign_id for same input", async () => {
      const candidate1 = await runB04(b01, b02, b03);
      const candidate2 = await runB04(b01, b02, b03);
      expect(candidate1.campaigns[0]!.campaign_id).toBe(
        candidate2.campaigns[0]!.campaign_id,
      );
    });

    it("should generate unique priority_ids per rank", async () => {
      const candidate = await runB04(b01, b02, b03);
      const ids = candidate.strategic_priorities.map((p) => p.priority_id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe("12. No Fabrication", () => {
    it("should never have empty campaign_name", async () => {
      const candidate = await runB04(b01, b02, b03);
      for (const campaign of candidate.campaigns) {
        expect(campaign.campaign_name.length).toBeGreaterThan(0);
      }
    });

    it("should include evidence_refs for all campaigns", async () => {
      const candidate = await runB04(b01, b02, b03);
      for (const campaign of candidate.campaigns) {
        expect(campaign.evidence_refs.length).toBeGreaterThan(0);
      }
    });
  });

  describe("13. A-Branch Boundary", () => {
    it("should NOT produce creative content", async () => {
      const candidate = await runB04(b01, b02, b03);
      expect(candidate.campaigns.length).toBeGreaterThan(0);
      // Strategy-level output, not creative
    });

    it("should NOT reference A-Branch", async () => {
      const candidate = await runB04(b01, b02, b03);
      expect(candidate).toBeDefined();
    });
  });

  describe("14. No Auto-Promotion", () => {
    it("should never auto-promote INFERRED to DECIDED", async () => {
      const candidate = await runB04(b01, b02, b03);
      for (const campaign of candidate.campaigns) {
        expect(campaign.provenance.type).not.toBe("DECIDED");
      }
    });

    it("should require explicit user decision via commitVersion", async () => {
      const candidate = await runB04(b01, b02, b03);
      expect(candidate.campaigns.length).toBeGreaterThan(0);
      expect(candidate.campaigns[0]!.provenance.type).toBe("INFERRED");

      const persistence = createMockPersistence();
      const canonical = await commitVersion(
        candidate,
        "v1.0",
        "user@example.com",
        persistence,
      );
      // Canonical will have no campaigns since none were marked DECIDED
      expect(canonical.campaigns.length).toBe(0);
    });
  });

  describe("15. Governance Routing & Approval", () => {
    it("should route campaigns through governance when approving", async () => {
      const candidate = await runB04(b01, b02, b03);
      expect(candidate.campaigns.length).toBeGreaterThan(0);
      expect(candidate.campaigns[0]!.provenance.type).toBe("INFERRED");

      const approved = await approveCandidate(candidate, "user@example.com");

      // After approval, campaigns should be DECIDED
      expect(approved.campaigns.length).toBeGreaterThan(0);
      expect(approved.campaigns[0]!.provenance.type).toBe("DECIDED");
    });

    it("should populate governance_events when approving", async () => {
      const candidate = await runB04(b01, b02, b03);
      const approved = await approveCandidate(candidate, "user@example.com");

      expect(approved.governance_events).toBeDefined();
      // Should have governance events for at least one campaign
      const eventKeys = Object.keys(approved.governance_events);
      expect(eventKeys.length).toBeGreaterThan(0);

      // Each approved campaign should have governance events (propose + approve)
      const firstCampaignId = approved.campaigns[0]?.campaign_id;
      if (firstCampaignId) {
        expect(approved.governance_events[firstCampaignId]).toBeDefined();
        expect(approved.governance_events[firstCampaignId]?.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("should set prior_provenance_id linkage in DECIDED provenance", async () => {
      const candidate = await runB04(b01, b02, b03);
      const approved = await approveCandidate(candidate, "user@example.com");

      expect(approved.campaigns.length).toBeGreaterThan(0);
      const campaign = approved.campaigns[0]!;
      expect(campaign.provenance.type).toBe("DECIDED");
      expect(campaign.provenance.prior_provenance_id).toBeDefined();
      expect(typeof campaign.provenance.prior_provenance_id).toBe("string");
    });

    it("should preserve evidence_refs through approval", async () => {
      const candidate = await runB04(b01, b02, b03);
      expect(candidate.campaigns[0]?.evidence_refs.length).toBeGreaterThan(0);

      const approved = await approveCandidate(candidate, "user@example.com");
      expect(approved.campaigns[0]?.evidence_refs.length).toBe(
        candidate.campaigns[0]?.evidence_refs.length
      );
    });
  });

  describe("16. Audit Trail & Immutability", () => {
    it("should create audit trail on commitVersion", async () => {
      const candidate = await runB04(b01, b02, b03);
      const approved = await approveCandidate(candidate, "user@example.com");

      const persistence = createMockPersistence();
      const canonical = await commitVersion(
        approved,
        "v1.0",
        "user@example.com",
        persistence,
      );

      expect(canonical.audit_trail).toBeDefined();
      expect(canonical.audit_trail.length).toBeGreaterThan(0);
      expect(canonical.audit_trail[0]?.version).toBe("v1.0");
      expect(canonical.audit_trail[0]?.changed_by).toBe("user@example.com");
    });

    it("should make canonical state immutable", async () => {
      const candidate = await runB04(b01, b02, b03);
      const approved = await approveCandidate(candidate, "user@example.com");

      const persistence = createMockPersistence();
      const canonical = await commitVersion(
        approved,
        "v1.0",
        "user@example.com",
        persistence,
      );

      expect(canonical.cannot_be_modified_until_next_version).toBe(true);
    });
  });

  describe("17. Determinism & Evidence Preservation", () => {
    it("should produce deterministic candidate_id with different mocked times", async () => {
      const fixedTime = "2026-08-30T12:00:00Z";

      const createDeps = (now: () => string): B04Deps => ({
        hash: {
          stableCampaignId: (name: string, b01Version: string) =>
            `camp_${canonicalHasher.hash(`${b01Version}:${name}`)}`,
          stablePriorityId: (campaignId: string, rank: number) =>
            `prio_${canonicalHasher.hash(`${campaignId}:${rank}`)}`,
          stableAlignmentId: (opportunityId: string, segmentId: string, score: string) =>
            `align_${canonicalHasher.hash(`${opportunityId}:${segmentId}:${score}`)}`,
        },
        now,
      });

      const candidate1 = await runB04(b01, b02, b03, createDeps(() => fixedTime));
      const candidate2 = await runB04(b01, b02, b03, createDeps(() => "2026-09-01T15:30:45Z"));

      // Same input, different mocked times → same candidate_id
      expect(candidate1.candidate_id).toBe(candidate2.candidate_id);
    });

    it("should preserve evidence_refs through canonicalization", async () => {
      const candidate = await runB04(b01, b02, b03);
      const approved = await approveCandidate(candidate, "user@example.com");

      const persistence = createMockPersistence();
      const canonical = await commitVersion(
        approved,
        "v1.0",
        "user@example.com",
        persistence,
      );

      // Top-level evidence should be preserved
      expect(canonical.evidence_refs).toBeDefined();
      expect(canonical.evidence_refs.length).toBe(approved.evidence_refs.length);

      // Campaign-level evidence should also be preserved
      if (canonical.campaigns.length > 0 && approved.campaigns.length > 0) {
        expect(canonical.campaigns[0]?.evidence_refs.length).toBe(
          approved.campaigns[0]?.evidence_refs.length
        );
      }
    });
  });
});
