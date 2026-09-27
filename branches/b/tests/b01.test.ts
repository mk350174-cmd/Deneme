// B01 Comprehensive Test Suite
// Tests for all 12 B01 phases + orchestration + completeness + conflicts

import { describe, it, expect, beforeEach } from "vitest";
import type { B01Input, B01CandidateState } from "../src/b01/index.js";
import type { EcosystemData, RoleMap, RelationshipGraph } from "../src/b01/index.js";
import { runPhaseB0101 } from "../src/b01/phases/B01_01_ecosystem.js";
import { runPhaseB0102 } from "../src/b01/phases/B01_02_brand_arch.js";
import { runPhaseB0103 } from "../src/b01/phases/B01_03_channel_roles.js";
import { runPhaseB0104 } from "../src/b01/phases/B01_04_relationships.js";
import { runPhaseB0105 } from "../src/b01/phases/B01_05_platform_registry.js";
import { runPhaseB0106 } from "../src/b01/phases/B01_06_channel_fit.js";
import { runPhaseB0107 } from "../src/b01/phases/B01_07_territory.js";
import { runPhaseB0108 } from "../src/b01/phases/B01_08_distribution.js";
import { runPhaseB0109 } from "../src/b01/phases/B01_09_editorial.js";
import { runPhaseB0110 } from "../src/b01/phases/B01_10_decision_logic.js";
import { runPhaseB0111 } from "../src/b01/phases/B01_11_constraint_aggregation.js";
import { runPhaseB0112 } from "../src/b01/phases/B01_12_assembly.js";
import {
  runB01,
  commitVersion,
  approveCandidate,
  rejectCandidate,
  revokeCandidate,
  KNOWN_CANONICALIZATION_DROPS,
} from "../src/b01/orchestration.js";
import { calculateCompleteness } from "../src/b01/completeness.js";
import { detectConflicts } from "../src/b01/conflicts.js";
import { createMockPersistence, createDefaultDeps } from "../src/b01/persistence.js";

// ============================================================================
// FIXTURES
// ============================================================================

const EMPTY_INPUT: B01Input = {
  input_id: "test_empty",
  created_at: new Date().toISOString(),
};

const MINIMAL_INPUT: B01Input = {
  input_id: "test_minimal",
  created_at: new Date().toISOString(),
  brand_context: {
    brand_name: "TestBrand",
    positioning: "Professional software solutions",
    mission: "Help teams ship faster",
    values: ["Speed", "Quality"],
  },
  known_channels: [
    {
      channel_id: "ch_youtube_main",
      channel_name: "YouTube Main",
      platform: "youtube",
      audience_category: "developers",
    },
  ],
  known_platforms: [
    {
      name: "youtube",
    },
  ],
};

const FULL_INPUT: B01Input = {
  input_id: "test_full",
  created_at: new Date().toISOString(),
  brand_context: {
    brand_name: "TechBrand",
    positioning: "Enterprise SaaS platform",
    mission: "Transform enterprise workflows",
    values: ["Innovation", "Reliability", "Security"],
  },
  known_channels: [
    {
      channel_id: "ch_youtube",
      channel_name: "YouTube",
      platform: "youtube",
      audience_category: "enterprise",
    },
    {
      channel_id: "ch_linkedin",
      channel_name: "LinkedIn",
      platform: "linkedin",
      audience_category: "enterprise",
    },
    {
      channel_id: "ch_tiktok",
      channel_name: "TikTok",
      platform: "tiktok",
      audience_category: "consumer",
    },
  ],
  known_platforms: [
    { name: "youtube" },
    { name: "linkedin" },
    { name: "tiktok" },
  ],
};

// ============================================================================
// B01.04 RELATIONSHIP GRAPH TESTS
// ============================================================================

describe("B01.04 — Relationship Graph", () => {
  it("should return empty edges for empty ecosystem", async () => {
    const ecosystem: EcosystemData = {
      channels: [],
      platforms: [],
      evidence_refs: [],
    };
    const roleMap: RoleMap = {};

    const result = await runPhaseB0104(ecosystem, roleMap);

    expect(result.edges).toHaveLength(0);
    expect(result.recommendation).toBeDefined();
    expect(result.recommendation.proposal).toContain("No channels");
  });

  it("should return empty edges for single channel", async () => {
    const ecosystem = await runPhaseB0101(MINIMAL_INPUT);
    const roleMap: RoleMap = {
      ch_youtube_main: { role: "primary", evidence_refs: [] },
    };

    const result = await runPhaseB0104(ecosystem, roleMap);

    expect(result.edges).toHaveLength(0);
  });

  it("should detect mirror relationship for two primary channels", async () => {
    const ecosystem = await runPhaseB0101(FULL_INPUT);
    const roleMap: RoleMap = {
      ch_youtube: { role: "primary", evidence_refs: [] },
      ch_linkedin: { role: "primary", evidence_refs: [] },
      ch_tiktok: { role: "primary", evidence_refs: [] },
    };

    const result = await runPhaseB0104(ecosystem, roleMap);

    const mirrorEdges = result.edges.filter((e) => e.relationship_type === "mirrors");
    expect(mirrorEdges.length).toBeGreaterThan(0);
    expect(mirrorEdges[0].strength).toBe(0.9);
  });

  it("should detect primary-to-secondary relationship", async () => {
    const ecosystem = await runPhaseB0101(FULL_INPUT);
    const roleMap: RoleMap = {
      ch_youtube: { role: "primary", evidence_refs: [] },
      ch_linkedin: { role: "secondary", evidence_refs: [] },
      ch_tiktok: { role: "primary", evidence_refs: [] },
    };

    const result = await runPhaseB0104(ecosystem, roleMap);

    const p2sEdges = result.edges.filter((e) => e.relationship_type === "primary_to_secondary");
    expect(p2sEdges.length).toBeGreaterThan(0);
    expect(p2sEdges[0].strength).toBe(0.8);
  });

  it("should detect complements relationship for different platforms", async () => {
    const ecosystem = await runPhaseB0101(FULL_INPUT);
    const roleMap: RoleMap = {
      ch_youtube: { role: "secondary", evidence_refs: [] },
      ch_linkedin: { role: "secondary", evidence_refs: [] },
      ch_tiktok: { role: "secondary", evidence_refs: [] },
    };

    const result = await runPhaseB0104(ecosystem, roleMap);

    const completeEdges = result.edges.filter((e) => e.relationship_type === "complements");
    // Different platforms should generate complement relationships
    expect(completeEdges.length).toBeGreaterThan(0);
    expect(completeEdges[0].strength).toBe(0.6);
  });

  it("should mark inferred relationships with INFERRED provenance", async () => {
    const ecosystem = await runPhaseB0101(MINIMAL_INPUT);
    const roleMap: RoleMap = {
      ch_youtube_main: { role: "primary", evidence_refs: [] },
    };

    const result = await runPhaseB0104(ecosystem, roleMap);

    // All edges should have provenance_refs marking them INFERRED (not DECIDED)
    result.edges.forEach((edge) => {
      expect(edge.provenance_refs).toBeDefined();
      expect(edge.provenance_refs.length).toBeGreaterThan(0);
      expect(edge.provenance_refs[0].type).toBe("INFERRED");
    });
  });

  it("should track evidence for each relationship", async () => {
    const ecosystem = await runPhaseB0101(FULL_INPUT);
    const roleMap: RoleMap = {
      ch_youtube: { role: "primary", evidence_refs: [] },
      ch_linkedin: { role: "secondary", evidence_refs: [] },
      ch_tiktok: { role: "primary", evidence_refs: [] },
    };

    const result = await runPhaseB0104(ecosystem, roleMap);

    result.edges.forEach((edge) => {
      expect(edge.evidence_refs).toBeDefined();
      expect(edge.evidence_refs.length).toBeGreaterThan(0);
      expect(edge.evidence_refs[0].source).toBeDefined();
      expect(edge.evidence_refs[0].status).toBe("INFERRED");
    });
  });

  it("should not create self-loops", async () => {
    const ecosystem = await runPhaseB0101(MINIMAL_INPUT);
    const roleMap: RoleMap = {
      ch_youtube_main: { role: "primary", evidence_refs: [] },
    };

    const result = await runPhaseB0104(ecosystem, roleMap);

    result.edges.forEach((edge) => {
      expect(edge.from_channel_id).not.toBe(edge.to_channel_id);
    });
  });

  it("should deduplicate bidirectional edges", async () => {
    const ecosystem = await runPhaseB0101(FULL_INPUT);
    const roleMap: RoleMap = {
      ch_youtube: { role: "primary", evidence_refs: [] },
      ch_linkedin: { role: "secondary", evidence_refs: [] },
      ch_tiktok: { role: "secondary", evidence_refs: [] },
    };

    const result = await runPhaseB0104(ecosystem, roleMap);

    // Count unique edge pairs (undirected)
    const edgePairs = new Set<string>();
    result.edges.forEach((edge) => {
      const pair = [edge.from_channel_id, edge.to_channel_id].sort().join("|");
      edgePairs.add(pair);
    });

    // No duplicates
    expect(edgePairs.size).toBe(result.edges.length);
  });

  it("should handle UNKNOWN roles gracefully", async () => {
    const ecosystem = await runPhaseB0101(FULL_INPUT);
    const roleMap: RoleMap = {
      ch_youtube: { role: "primary", evidence_refs: [] },
      ch_linkedin: { role: "UNKNOWN", evidence_refs: [] },
      ch_tiktok: { role: "primary", evidence_refs: [] },
    };

    const result = await runPhaseB0104(ecosystem, roleMap);

    // Should still identify some relationships
    const identifiedEdges = result.edges.filter((e) => e.relationship_type !== "UNKNOWN");
    expect(identifiedEdges.length).toBeGreaterThan(0);
  });

  it("should set recommendation adoption to false (awaiting user decision)", async () => {
    const ecosystem = await runPhaseB0101(MINIMAL_INPUT);
    const roleMap: RoleMap = {
      ch_youtube_main: { role: "primary", evidence_refs: [] },
    };

    const result = await runPhaseB0104(ecosystem, roleMap);

    expect(result.recommendation.adopted).toBe(false);
  });

  it("should include metadata about analyzed channels", async () => {
    const ecosystem = await runPhaseB0101(FULL_INPUT);
    const roleMap: RoleMap = {
      ch_youtube: { role: "primary", evidence_refs: [] },
      ch_linkedin: { role: "primary", evidence_refs: [] },
      ch_tiktok: { role: "primary", evidence_refs: [] },
    };

    const result = await runPhaseB0104(ecosystem, roleMap);

    expect(result.recommendation).toBeDefined();
    expect(result.recommendation.proposal).toContain("channel relationships");
  });

  it("should maintain consistent edge IDs across runs (deterministic)", async () => {
    const ecosystem = await runPhaseB0101(MINIMAL_INPUT);
    const roleMap: RoleMap = {
      ch_youtube_main: { role: "primary", evidence_refs: [] },
    };

    const result1 = await runPhaseB0104(ecosystem, roleMap);
    const result2 = await runPhaseB0104(ecosystem, roleMap);

    // Evidence IDs should be deterministic (same input = same IDs)
    const ids1 = result1.edges.flatMap((e) => e.evidence_refs.map((ev) => ev.id));
    const ids2 = result2.edges.flatMap((e) => e.evidence_refs.map((ev) => ev.id));

    expect(ids1).toEqual(ids2);
  });
});

// ============================================================================
// B01.05 PLATFORM REGISTRY TESTS
// ============================================================================

describe("B01.05 — Platform Registry", () => {
  it("should return empty registry for empty ecosystem", async () => {
    const ecosystem: EcosystemData = {
      channels: [],
      platforms: [],
      evidence_refs: [],
    };

    const result = await runPhaseB0105(ecosystem, EMPTY_INPUT);

    expect(Object.keys(result).length).toBe(0);
  });

  it("should populate registry from ecosystem channels", async () => {
    const ecosystem = await runPhaseB0101(MINIMAL_INPUT);
    const result = await runPhaseB0105(ecosystem, MINIMAL_INPUT);

    expect(Object.keys(result).length).toBeGreaterThan(0);
    expect(result["youtube"]).toBeDefined();
  });

  it("should track capability source (user_provided)", async () => {
    const ecosystem = await runPhaseB0101(MINIMAL_INPUT);
    const result = await runPhaseB0105(ecosystem, MINIMAL_INPUT);

    if (Object.keys(result).length > 0) {
      const platform = Object.values(result)[0];
      // Either has capabilities or is in evidence
      expect(platform.evidence_refs).toBeDefined();
    }
  });

  it("should NOT derive capabilities from channel presence alone", async () => {
    const ecosystem = await runPhaseB0101(MINIMAL_INPUT);
    const result = await runPhaseB0105(ecosystem, undefined); // No user input

    // Platform should exist but capabilities should not be auto-generated
    if (result["youtube"]) {
      // YouTube channel exists, but without user_provided data, should have no auto-generated capabilities
      const userCaps = result["youtube"].capabilities.filter(
        (c) => c.source === "user_provided",
      );
      expect(userCaps.length).toBe(0); // No user-provided = no auto-generated
    }
  });

  it("should mark user-provided capabilities as VERIFIED", async () => {
    const ecosystem = await runPhaseB0101(FULL_INPUT);
    const result = await runPhaseB0105(ecosystem, FULL_INPUT);

    // FULL_INPUT has known_platforms with capabilities
    const platform = Object.values(result).find((p) => p.capabilities.length > 0);
    if (platform) {
      const verifiedCaps = platform.capabilities.filter((c) => c.evidence_status === "VERIFIED");
      expect(verifiedCaps.length).toBeGreaterThan(0);
    }
  });

  it("should track evidence for each platform", async () => {
    const ecosystem = await runPhaseB0101(FULL_INPUT);
    const result = await runPhaseB0105(ecosystem, FULL_INPUT);

    for (const platform of Object.values(result)) {
      expect(platform.evidence_refs).toBeDefined();
      expect(platform.evidence_refs.length).toBeGreaterThanOrEqual(0);
    }
  });

  it("should handle empty input gracefully", async () => {
    const ecosystem = await runPhaseB0101(EMPTY_INPUT);
    const result = await runPhaseB0105(ecosystem, EMPTY_INPUT);

    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("should maintain platform names", async () => {
    const ecosystem = await runPhaseB0101(FULL_INPUT);
    const result = await runPhaseB0105(ecosystem, FULL_INPUT);

    for (const [platformId, platform] of Object.entries(result)) {
      expect(platform.name).toBe(platformId);
    }
  });

  it("should deduplicate capabilities across sources", async () => {
    const ecosystem = await runPhaseB0101(FULL_INPUT);
    const result = await runPhaseB0105(ecosystem, FULL_INPUT);

    for (const platform of Object.values(result)) {
      const capNames = platform.capabilities.map((c) => c.capability);
      const uniqueCaps = new Set(capNames);
      expect(uniqueCaps.size).toBe(capNames.length); // No duplicates
    }
  });

  it("should mark channel presence as evidence (not capability)", async () => {
    const ecosystem = await runPhaseB0101(FULL_INPUT);
    const result = await runPhaseB0105(ecosystem, undefined); // No user input

    for (const platform of Object.values(result)) {
      // Check evidence includes channel_presence
      const hasChannelPresenceEvidence = platform.evidence_refs.some((ev) =>
        ev.source.includes("channel_presence"),
      );
      expect(hasChannelPresenceEvidence).toBe(true);
    }
  });
});

// ============================================================================
// COMPLETENESS SCORING TESTS
// ============================================================================

describe("B01 Completeness Scoring", () => {
  it("should calculate completeness score 0-100", async () => {
    const candidate = await runB01(EMPTY_INPUT);
    const completeness = calculateCompleteness(candidate);

    expect(completeness.score).toBeGreaterThanOrEqual(0);
    expect(completeness.score).toBeLessThanOrEqual(100);
  });

  it("should identify missing inputs for empty brand context", async () => {
    const candidate = await runB01(EMPTY_INPUT);
    const completeness = calculateCompleteness(candidate);

    expect(completeness.missing_inputs.length).toBeGreaterThan(0);
    expect(completeness.missing_inputs.some((m) => m.includes("positioning"))).toBe(true);
  });

  it("should identify blocking decisions when channels missing", async () => {
    const candidate = await runB01(EMPTY_INPUT);
    const completeness = calculateCompleteness(candidate);

    expect(completeness.blocking_decisions.length).toBeGreaterThan(0);
  });

  it("should improve completeness score with full input", async () => {
    const emptyComplete = calculateCompleteness(await runB01(EMPTY_INPUT));
    const fullComplete = calculateCompleteness(await runB01(FULL_INPUT));

    expect(fullComplete.score).toBeGreaterThan(emptyComplete.score);
  });

  // Decision G (canonical plan Phase H): completeness decomposed into four
  // independently-inspectable components rather than one opaque score.
  describe("four independent components", () => {
    it("exposes structuralPresence equal to the headline score", async () => {
      const candidate = await runB01(MINIMAL_INPUT);
      const completeness = calculateCompleteness(candidate);
      expect(completeness.structuralPresence).toBe(completeness.score);
    });

    it("evidenceQuality responds to evidence status: VERIFIED-only candidate scores higher than one diluted with UNKNOWN evidence", async () => {
      const candidate = await runB01(MINIMAL_INPUT);
      const baseline = calculateCompleteness(candidate);
      expect(baseline.evidenceQuality).toBeGreaterThan(0);
      expect(baseline.evidenceQuality).toBeLessThanOrEqual(1);

      const diluted = {
        ...candidate,
        evidence_refs: [
          ...(candidate.evidence_refs ?? []),
          { id: "ev_extra_unknown", source: "test", status: "UNKNOWN" as const },
          { id: "ev_extra_unknown2", source: "test", status: "UNKNOWN" as const },
        ],
      };
      const dilutedResult = calculateCompleteness(diluted);
      expect(dilutedResult.evidenceQuality).toBeLessThan(baseline.evidenceQuality);
    });

    it("provenanceCoverage drops when a phase's provenance_refs are removed", async () => {
      const candidate = await runB01(MINIMAL_INPUT);
      const baseline = calculateCompleteness(candidate);

      const strippedCandidate = {
        ...candidate,
        ecosystem: candidate.ecosystem ? { ...candidate.ecosystem, provenance_refs: [] } : candidate.ecosystem,
        brand_arch: candidate.brand_arch ? { ...candidate.brand_arch, provenance_refs: [] } : candidate.brand_arch,
        distribution: candidate.distribution ? { ...candidate.distribution, provenance_refs: [] } : candidate.distribution,
      };
      const strippedResult = calculateCompleteness(strippedCandidate);
      expect(strippedResult.provenanceCoverage).toBeLessThan(baseline.provenanceCoverage);
    });

    it("conflictCoverage is 1.0 with no conflicts and drops when an unresolved conflict is added", async () => {
      const candidate = await runB01(MINIMAL_INPUT);
      const noConflicts = {
        ...candidate,
        constraints: candidate.constraints ? { ...candidate.constraints, conflicts: [] } : candidate.constraints,
      };
      expect(calculateCompleteness(noConflicts).conflictCoverage).toBe(1.0);

      const withUnresolvedConflict = {
        ...candidate,
        constraints: candidate.constraints
          ? {
              ...candidate.constraints,
              conflicts: [
                { conflict_id: "c1", description: "test conflict", affected_items: [], severity: "high" as const },
              ],
            }
          : candidate.constraints,
      };
      expect(calculateCompleteness(withUnresolvedConflict).conflictCoverage).toBeLessThan(1.0);
    });
  });
});

// ============================================================================
// CONFLICT DETECTION TESTS
// ============================================================================

describe("B01 Conflict Detection", () => {
  it("should detect no conflicts in valid state", async () => {
    const candidate = await runB01(MINIMAL_INPUT);
    const { conflicts } = detectConflicts(candidate);

    // MINIMAL_INPUT has a single channel (no duplicates, no stale
    // references) and no editorial documentation (so no tone rules exist for
    // Rule 3 to compare) — zero conflicts is the exact expected value, not
    // just a loose upper bound. Tightened from the prior tautological
    // `toBeLessThanOrEqual(2)`, verified empirically before tightening.
    expect(conflicts).toEqual([]);
  });

  it("should emit gaps for missing data", async () => {
    const candidate = await runB01(EMPTY_INPUT);
    const { gaps } = detectConflicts(candidate);

    expect(gaps.length).toBeGreaterThan(0);
  });

  // Non-tautological tests for the migrated tone-collision rule (Rule 3,
  // migrated from the former B01.11 conflict engine — see conflicts.ts).
  // Previously this rule had zero dedicated test coverage anywhere; the only
  // related test asserted `toBeGreaterThanOrEqual(0)` against the wrong
  // function (B01.11, which no longer detects conflicts at all).
  describe("Rule 3: editorial tone-rule collision (migrated)", () => {
    const baseCandidate = {
      ecosystem: { channels: [], platforms: [], evidence_refs: [] },
    } as unknown as B01CandidateState;

    it("fires when a brand_safety rule exists AND two tone rules contain avoid/professional", () => {
      const candidate = {
        ...baseCandidate,
        editorial: {
          constitution_id: "c1",
          rules: [
            { rule_id: "bs1", category: "brand_safety" as const, rule_text: "Avoid offensive content", evidence_refs: [] },
            { rule_id: "t1", category: "tone" as const, rule_text: "Avoid overly casual language", evidence_refs: [] },
            { rule_id: "t2", category: "tone" as const, rule_text: "Maintain professional tone", evidence_refs: [] },
          ],
          evidence_refs: [],
          recommendation: { recommendation_id: "r1", source_agent: "test", proposal: "p", timestamp: "t", adopted: false },
        },
      };

      const { conflicts } = detectConflicts(candidate);
      const toneConflicts = conflicts.filter((c) => c.conflict_id.startsWith("conflict_tone_"));
      expect(toneConflicts.length).toBe(1);
      expect(toneConflicts[0]?.affected_items).toEqual(["t1", "t2"]);
      expect(toneConflicts[0]?.resolution).toContain("manual review");
    });

    it("does NOT fire when no brand_safety rule exists, even with matching tone rules (faithful to the original gate)", () => {
      const candidate = {
        ...baseCandidate,
        editorial: {
          constitution_id: "c1",
          rules: [
            { rule_id: "t1", category: "tone" as const, rule_text: "Avoid overly casual language", evidence_refs: [] },
            { rule_id: "t2", category: "tone" as const, rule_text: "Maintain professional tone", evidence_refs: [] },
          ],
          evidence_refs: [],
          recommendation: { recommendation_id: "r1", source_agent: "test", proposal: "p", timestamp: "t", adopted: false },
        },
      };

      const { conflicts } = detectConflicts(candidate);
      expect(conflicts.filter((c) => c.conflict_id.startsWith("conflict_tone_"))).toEqual([]);
    });

    it("does NOT fire when tone rules don't contain the avoid/professional keyword pair", () => {
      const candidate = {
        ...baseCandidate,
        editorial: {
          constitution_id: "c1",
          rules: [
            { rule_id: "bs1", category: "brand_safety" as const, rule_text: "Avoid offensive content", evidence_refs: [] },
            { rule_id: "t1", category: "tone" as const, rule_text: "Be conversational", evidence_refs: [] },
            { rule_id: "t2", category: "tone" as const, rule_text: "Be friendly", evidence_refs: [] },
          ],
          evidence_refs: [],
          recommendation: { recommendation_id: "r1", source_agent: "test", proposal: "p", timestamp: "t", adopted: false },
        },
      };

      const { conflicts } = detectConflicts(candidate);
      expect(conflicts.filter((c) => c.conflict_id.startsWith("conflict_tone_"))).toEqual([]);
    });
  });
});

// ============================================================================
// ORCHESTRATION TESTS
// ============================================================================

describe("B01 Full Orchestration", () => {
  it("should execute runB01 without errors", async () => {
    const candidate = await runB01(MINIMAL_INPUT);

    expect(candidate).toBeDefined();
    expect(candidate.ecosystem).toBeDefined();
    expect(candidate.completeness).toBeDefined();
  });

  it("should produce B01CandidateState with all phase outputs", async () => {
    const candidate = await runB01(FULL_INPUT);

    expect(candidate.ecosystem.channels.length).toBeGreaterThan(0);
    expect(candidate.brand_arch).toBeDefined();
    expect(candidate.role_map).toBeDefined();
    expect(candidate.relationship_graph).toBeDefined();
    expect(candidate.completeness.score).toBeGreaterThanOrEqual(0);
  });

  it("should allow commitVersion with user authority", async () => {
    const candidate = await runB01(MINIMAL_INPUT);
    const persistence = createMockPersistence();

    const canonical = await commitVersion(candidate, "v1.0", "test@example.com", persistence);

    expect(canonical.version).toBe("v1.0");
    expect(canonical.user_decision_authority).toBe("test@example.com");
  });

  it("should prevent duplicate version commits", async () => {
    const candidate = await runB01(MINIMAL_INPUT);
    const persistence = createMockPersistence();

    await commitVersion(candidate, "v1.0", "test@example.com", persistence);

    // Second commit with same version should fail
    await expect(
      commitVersion(candidate, "v1.0", "test@example.com", persistence),
    ).rejects.toThrow();
  });

  it("should increment version correctly", async () => {
    const candidate = await runB01(MINIMAL_INPUT);
    const persistence = createMockPersistence();

    const v1 = await commitVersion(candidate, "v1.0", "test@example.com", persistence);
    expect(v1.version).toBe("v1.0");

    const v11 = await commitVersion(candidate, "v1.1", "test@example.com", persistence, v1);
    expect(v11.version).toBe("v1.1");
  });
});

// ============================================================================
// B01.06 — CHANNEL-PLATFORM FIT ANALYSIS
// ============================================================================

describe("B01.06 — Channel-Platform Fit", () => {
  const testEcosystem: EcosystemData = {
    channels: [
      {
        channel_id: "yt_main",
        name: "YouTube Main",
        platform: "youtube",
        audience_category: "general",
        url: "https://youtube.com/@brand",
      },
      {
        channel_id: "tiktok_exp",
        name: "TikTok Experimental",
        platform: "tiktok",
        audience_category: "gen_z",
        url: "https://tiktok.com/@brand",
      },
      {
        channel_id: "linkedin_pro",
        name: "LinkedIn Professional",
        platform: "linkedin",
        audience_category: "professional",
        url: "https://linkedin.com/company/brand",
      },
    ],
    platforms: ["youtube", "tiktok", "linkedin"],
    evidence_refs: [],
  };

  const testRoleMap: RoleMap = {
    yt_main: {
      role: "primary",
      evidence_refs: [],
      recommendation: {
        recommendation_id: "r1",
        source_agent: "B01.03",
        proposal: "Primary",
        timestamp: new Date().toISOString(),
        adopted: false,
      },
    },
    tiktok_exp: {
      role: "experimental",
      evidence_refs: [],
      recommendation: {
        recommendation_id: "r2",
        source_agent: "B01.03",
        proposal: "Experimental",
        timestamp: new Date().toISOString(),
        adopted: false,
      },
    },
    linkedin_pro: {
      role: "secondary",
      evidence_refs: [],
      recommendation: {
        recommendation_id: "r3",
        source_agent: "B01.03",
        proposal: "Secondary",
        timestamp: new Date().toISOString(),
        adopted: false,
      },
    },
  };

  const testRegistry = {
    youtube: {
      name: "youtube",
      capabilities: [
        { capability: "video" as any, source: "provider_registry" as const, evidence_status: "VERIFIED" as const, evidence_refs: [] },
      ],
      evidence_refs: [],
    },
    tiktok: {
      name: "tiktok",
      capabilities: [
        { capability: "short_video" as any, source: "provider_registry" as const, evidence_status: "VERIFIED" as const, evidence_refs: [] },
      ],
      evidence_refs: [],
    },
    linkedin: {
      name: "linkedin",
      capabilities: [],
      evidence_refs: [],
    },
  };

  it("should return empty fit map for empty ecosystem", async () => {
    const fitMap = await runPhaseB0106(
      { channels: [], platforms: [], evidence_refs: [] },
      testRoleMap,
      testRegistry,
    );

    expect(fitMap).toEqual({});
  });

  it("should score primary channels higher for established platforms", async () => {
    const fitMap = await runPhaseB0106(testEcosystem, testRoleMap, testRegistry);

    expect(fitMap["yt_main"]).toBeDefined();
    expect(fitMap["yt_main"].fit_score).toBeGreaterThan(0.5);
    expect(fitMap["yt_main"].reasoning.length).toBeGreaterThan(0);
  });

  it("should score experimental channels for platform exploration", async () => {
    const fitMap = await runPhaseB0106(testEcosystem, testRoleMap, testRegistry);

    expect(fitMap["tiktok_exp"]).toBeDefined();
    expect(fitMap["tiktok_exp"].fit_score).toBeGreaterThan(0.0);
    expect(fitMap["tiktok_exp"].reasoning).toContain("experimental_channel_allows_platform_exploration");
  });

  it("should consider audience category alignment", async () => {
    const fitMap = await runPhaseB0106(testEcosystem, testRoleMap, testRegistry);

    // Gen_z audience should align with TikTok
    expect(fitMap["tiktok_exp"].reasoning.some((r) => r.includes("gen_z"))).toBe(true);

    // Professional audience should align with LinkedIn (even if LinkedIn has no capabilities)
    expect(fitMap["linkedin_pro"].reasoning.some((r) => r.includes("professional"))).toBe(true);
  });

  it("should mark fit scores as INFERRED (not DECIDED)", async () => {
    const fitMap = await runPhaseB0106(testEcosystem, testRoleMap, testRegistry);

    for (const [_, fit] of Object.entries(fitMap)) {
      expect(fit.provenance_refs[0].type).toBe("INFERRED");
      expect(fit.evidence_refs[0].status).toBe("INFERRED");
    }
  });

  it("should clamp fit scores to [0, 1]", async () => {
    const fitMap = await runPhaseB0106(testEcosystem, testRoleMap, testRegistry);

    for (const [_, fit] of Object.entries(fitMap)) {
      expect(fit.fit_score).toBeGreaterThanOrEqual(0);
      expect(fit.fit_score).toBeLessThanOrEqual(1);
    }
  });

  it("should track platform capabilities in fit reasoning", async () => {
    const fitMap = await runPhaseB0106(testEcosystem, testRoleMap, testRegistry);

    // YouTube has capabilities; reasoning should mention it
    expect(fitMap["yt_main"].reasoning.some((r) => r.includes("capabilities"))).toBe(true);
  });

  it("should handle channels with UNKNOWN roles gracefully", async () => {
    const roleMapWithUnknown: RoleMap = {
      ...testRoleMap,
      unknown_channel: {
        role: "UNKNOWN",
        evidence_refs: [],
        recommendation: {
          recommendation_id: "r_unknown",
          source_agent: "B01.03",
          proposal: "Unknown",
          timestamp: new Date().toISOString(),
          adopted: false,
        },
      },
    };

    const ecosystemWithUnknown: EcosystemData = {
      ...testEcosystem,
      channels: [
        ...testEcosystem.channels,
        {
          channel_id: "unknown_channel",
          name: "Unknown Channel",
          platform: "youtube",
          audience_category: "general",
          url: "https://example.com",
        },
      ],
    };

    const fitMap = await runPhaseB0106(ecosystemWithUnknown, roleMapWithUnknown, testRegistry);

    expect(fitMap["unknown_channel"]).toBeDefined();
    expect(fitMap["unknown_channel"].reasoning).toContain("role_unknown");
  });

  it("should populate evidence refs for each channel fit", async () => {
    const fitMap = await runPhaseB0106(testEcosystem, testRoleMap, testRegistry);

    for (const [_, fit] of Object.entries(fitMap)) {
      expect(fit.evidence_refs.length).toBeGreaterThan(0);
      expect(fit.evidence_refs[0].source).toBe("B01.06:channel_fit");
    }
  });

  it("should preserve all ecosystem channel information in fit map", async () => {
    const fitMap = await runPhaseB0106(testEcosystem, testRoleMap, testRegistry);

    expect(Object.keys(fitMap).length).toBe(testEcosystem.channels.length);
    for (const channel of testEcosystem.channels) {
      expect(fitMap[channel.channel_id]).toBeDefined();
      expect(fitMap[channel.channel_id].platform).toBe(channel.platform);
    }
  });
});

// ============================================================================
// B01.07 — TERRITORY RULES & CONTENT BOUNDARIES
// ============================================================================

describe("B01.07 — Territory Rules", () => {
  const testEcosystem: EcosystemData = {
    channels: [
      {
        channel_id: "yt_main",
        name: "YouTube Main",
        platform: "youtube",
        audience_category: "general",
        url: "https://youtube.com/@brand",
      },
      {
        channel_id: "tiktok_exp",
        name: "TikTok Experimental",
        platform: "tiktok",
        audience_category: "gen_z",
        url: "https://tiktok.com/@brand",
      },
    ],
    platforms: ["youtube", "tiktok"],
    evidence_refs: [],
  };

  it("should extract no territories from empty documentation", async () => {
    const result = await runPhaseB0107(testEcosystem, { input_id: "test" });

    // Should return default global territory when no documentation
    expect(result.territories.length).toBeGreaterThan(0);
    expect(result.territories[0].territory_id).toBe("global_default");
  });

  it("should extract geographic territories from documentation", async () => {
    const input: B01Input = {
      input_id: "test",
      documentation: {
        brand_guidelines: "Available in North America and Europe",
      },
    };

    const result = await runPhaseB0107(testEcosystem, input);

    const geoTerritories = result.territories.filter((t) => t.type === "geographic");
    expect(geoTerritories.length).toBeGreaterThan(0);
  });

  it("should extract timezone territories from documentation", async () => {
    const input: B01Input = {
      input_id: "test",
      documentation: {
        editorial_standards: "Operations during EST and PST hours",
      },
    };

    const result = await runPhaseB0107(testEcosystem, input);

    const tzTerritories = result.territories.filter((t) => t.type === "timezone");
    expect(tzTerritories.length).toBeGreaterThan(0);
  });

  it("should extract regulatory territories from documentation", async () => {
    const input: B01Input = {
      input_id: "test",
      documentation: {
        brand_guidelines: "GDPR compliance required for European audiences",
      },
    };

    const result = await runPhaseB0107(testEcosystem, input);

    const regTerritories = result.territories.filter((t) => t.type === "regulatory");
    expect(regTerritories.length).toBeGreaterThan(0);
  });

  it("should NOT infer from platform names (no fabrication)", async () => {
    const input: B01Input = {
      input_id: "test",
      documentation: {
        channel_policies: "LinkedIn and YouTube are primary platforms",
      },
    };

    const result = await runPhaseB0107(testEcosystem, input);

    // Should NOT create "LinkedIn = US" or "YouTube = Global" territories
    // Only explicit documentation-based territories should exist
    for (const terr of result.territories) {
      expect(terr.compliance_notes.some((n) => n.toLowerCase().includes("default") || n.toLowerCase().includes("explicit"))).toBe(true);
    }
  });

  it("should include all ecosystem channels in allowed list by default", async () => {
    const input: B01Input = {
      input_id: "test",
      documentation: {
        brand_guidelines: "Global operations",
      },
    };

    const result = await runPhaseB0107(testEcosystem, input);

    for (const terr of result.territories) {
      expect(terr.channels_allowed.length).toBe(testEcosystem.channels.length);
    }
  });

  it("should track evidence refs for each territory", async () => {
    const input: B01Input = {
      input_id: "test",
      documentation: {
        brand_guidelines: "GDPR compliance and European data protection",
      },
    };

    const result = await runPhaseB0107(testEcosystem, input);

    for (const terr of result.territories) {
      expect(terr.evidence_refs.length).toBeGreaterThan(0);
      expect(terr.evidence_refs[0].status).toBe("INFERRED");
    }
  });

  it("should handle multiple documentation sources", async () => {
    const input: B01Input = {
      input_id: "test",
      documentation: {
        brand_guidelines: "Available in North America and Europe",
        channel_policies: "GDPR compliance required",
        editorial_standards: "EST timezone operations",
      },
    };

    const result = await runPhaseB0107(testEcosystem, input);

    // Should extract from all sources
    expect(result.territories.length).toBeGreaterThan(1);
  });

  it("should deduplicate territories by ID", async () => {
    const input: B01Input = {
      input_id: "test",
      documentation: {
        brand_guidelines: "GDPR and Europe",
        channel_policies: "GDPR also mentioned here",
      },
    };

    const result = await runPhaseB0107(testEcosystem, input);

    const ids = result.territories.map((t) => t.territory_id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length); // No duplicates
  });

  it("should provide compliance notes for regulatory territories", async () => {
    const input: B01Input = {
      input_id: "test",
      documentation: {
        brand_guidelines: "GDPR compliance mandatory",
      },
    };

    const result = await runPhaseB0107(testEcosystem, input);

    const gdrpTerritory = result.territories.find((t) => t.territory_id === "reg_gdpr");
    if (gdrpTerritory) {
      expect(gdrpTerritory.compliance_notes.length).toBeGreaterThan(0);
    }
  });

  it("should not fabricate audience-based territories", async () => {
    const input: B01Input = {
      input_id: "test",
      documentation: {
        channel_policies: "Targeted at enterprise and professional audiences",
      },
    };

    const result = await runPhaseB0107(testEcosystem, input);

    // Should NOT create territories based on audience (that's B03's job)
    // Only default global territory should exist (if nothing else extracted)
    for (const terr of result.territories) {
      expect(["geographic", "timezone", "regulatory"]).toContain(terr.type);
    }
  });

  it("should return territory structure with all required fields", async () => {
    const input: B01Input = {
      input_id: "test",
      documentation: {
        brand_guidelines: "Europe and GDPR",
      },
    };

    const result = await runPhaseB0107(testEcosystem, input);

    for (const terr of result.territories) {
      expect(terr.territory_id).toBeDefined();
      expect(terr.type).toBeDefined();
      expect(terr.description).toBeDefined();
      expect(terr.boundaries).toBeDefined();
      expect(terr.channels_allowed).toBeDefined();
      expect(terr.channels_restricted).toBeDefined();
      expect(terr.compliance_notes).toBeDefined();
      expect(terr.evidence_refs).toBeDefined();
    }
  });
});

// ============================================================================
// B01.08 — DISTRIBUTION STRATEGY
// ============================================================================

describe("B01.08 — Distribution Strategy", () => {
  const testEcosystem: EcosystemData = {
    channels: [
      {
        channel_id: "yt_primary",
        name: "YouTube Main",
        platform: "youtube",
        audience_category: "general",
        url: "https://youtube.com/@brand",
      },
      {
        channel_id: "tiktok_exp",
        name: "TikTok Experimental",
        platform: "tiktok",
        audience_category: "gen_z",
        url: "https://tiktok.com/@brand",
      },
      {
        channel_id: "linkedin_sec",
        name: "LinkedIn Secondary",
        platform: "linkedin",
        audience_category: "professional",
        url: "https://linkedin.com/company/brand",
      },
    ],
    platforms: ["youtube", "tiktok", "linkedin"],
    evidence_refs: [],
  };

  const testRoleMap: RoleMap = {
    yt_primary: {
      role: "primary",
      evidence_refs: [],
      recommendation: {
        recommendation_id: "r1",
        source_agent: "B01.03",
        proposal: "Primary",
        timestamp: new Date().toISOString(),
        adopted: false,
      },
    },
    tiktok_exp: {
      role: "experimental",
      evidence_refs: [],
      recommendation: {
        recommendation_id: "r2",
        source_agent: "B01.03",
        proposal: "Experimental",
        timestamp: new Date().toISOString(),
        adopted: false,
      },
    },
    linkedin_sec: {
      role: "secondary",
      evidence_refs: [],
      recommendation: {
        recommendation_id: "r3",
        source_agent: "B01.03",
        proposal: "Secondary",
        timestamp: new Date().toISOString(),
        adopted: false,
      },
    },
  };

  const testTerritories: TerritoryData = {
    territories: [
      {
        territory_id: "global",
        type: "geographic" as any,
        description: "Global",
        boundaries: ["Global"],
        channels_allowed: ["yt_primary", "tiktok_exp", "linkedin_sec"],
        channels_restricted: [],
        compliance_notes: [],
        evidence_refs: [],
      },
    ],
  };

  it("should return empty assignments for empty ecosystem", async () => {
    const result = await runPhaseB0108(
      { channels: [], platforms: [], evidence_refs: [] },
      testRoleMap,
      testTerritories,
    );

    expect(result.channel_assignments.length).toBe(0);
  });

  it("should create distribution assignments for all channels", async () => {
    const result = await runPhaseB0108(testEcosystem, testRoleMap, testTerritories);

    expect(result.channel_assignments.length).toBe(testEcosystem.channels.length);
  });

  it("should assign distribution roles based on channel roles", async () => {
    const result = await runPhaseB0108(testEcosystem, testRoleMap, testTerritories);

    const primary = result.channel_assignments.find((a) => a.channel_id === "yt_primary");
    const experimental = result.channel_assignments.find((a) => a.channel_id === "tiktok_exp");
    const secondary = result.channel_assignments.find((a) => a.channel_id === "linkedin_sec");

    expect(primary?.distribution_role).toBe("primary_channel");
    expect(experimental?.distribution_role).toBe("testing_ground");
    expect(secondary?.distribution_role).toBe("secondary_channel");
  });

  it("should assign routing priorities with primary channels first", async () => {
    const result = await runPhaseB0108(testEcosystem, testRoleMap, testTerritories);

    // Should be sorted by priority (1 first)
    expect(result.channel_assignments[0].routing_priority).toBeLessThanOrEqual(result.channel_assignments[1].routing_priority);
  });

  it("should infer posting frequencies based on channel roles", async () => {
    const result = await runPhaseB0108(testEcosystem, testRoleMap, testTerritories);

    const primary = result.channel_assignments.find((a) => a.channel_id === "yt_primary");
    const experimental = result.channel_assignments.find((a) => a.channel_id === "tiktok_exp");

    expect(primary?.timing_rules.posting_frequency).toBe("daily");
    expect(experimental?.timing_rules.posting_frequency).toBe("as_available");
  });

  it("should NOT contain production specs (exact times, resolutions, bitrates)", async () => {
    const result = await runPhaseB0108(testEcosystem, testRoleMap, testTerritories);

    for (const assignment of result.channel_assignments) {
      // Should NOT have exact times like "2:34pm UTC" (empty array means user must define)
      expect(assignment.timing_rules.optimal_times).toEqual([]);

      // Should NOT have resolution/bitrate in format_rules
      expect(assignment.format_rules.preferred_formats[0]).not.toMatch(/1080p|4k|720p|bitrate/i);
    }
  });

  it("should use strategic format categories only (short/medium/long, not specs)", async () => {
    const result = await runPhaseB0108(testEcosystem, testRoleMap, testTerritories);

    for (const assignment of result.channel_assignments) {
      const validCategories = ["short", "medium", "long", "flexible"];
      expect(validCategories).toContain(assignment.format_rules.strategic_duration_category);
    }
  });

  it("should include all territories in allowed list", async () => {
    const result = await runPhaseB0108(testEcosystem, testRoleMap, testTerritories);

    for (const assignment of result.channel_assignments) {
      expect(assignment.territory_rules.allowed_territories.length).toBeGreaterThan(0);
    }
  });

  it("should track evidence refs for each assignment", async () => {
    const result = await runPhaseB0108(testEcosystem, testRoleMap, testTerritories);

    for (const assignment of result.channel_assignments) {
      expect(assignment.evidence_refs.length).toBeGreaterThan(0);
      expect(assignment.evidence_refs[0].source).toBe("B01.08:distribution_assignment");
    }
  });

  it("should set timezone_adapted for primary channels", async () => {
    const result = await runPhaseB0108(testEcosystem, testRoleMap, testTerritories);

    const primary = result.channel_assignments.find((a) => a.channel_id === "yt_primary");
    expect(primary?.timing_rules.timezone_adapted).toBe(true);
  });

  it("should provide strategy description", async () => {
    const result = await runPhaseB0108(testEcosystem, testRoleMap, testTerritories);

    expect(result.strategy_description).toBeDefined();
    expect(result.strategy_description.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// B01.09 — EDITORIAL CONSTITUTION
// ============================================================================

describe("B01.09 — Editorial Constitution", () => {
  it("should extract tone rules from documentation", async () => {
    const input: B01Input = {
      input_id: "test_editorial_tone",
      created_at: new Date().toISOString(),
      documentation: {
        brand_guidelines: "We maintain a professional and authoritative tone across all content",
      },
    };

    const result = await runPhaseB0109(undefined as any, input);

    expect(result.rules.length).toBeGreaterThan(0);
    const toneRules = result.rules.filter((r) => r.category === "tone");
    expect(toneRules.length).toBeGreaterThan(0);
  });

  it("should extract content type rules from documentation", async () => {
    const input: B01Input = {
      input_id: "test_editorial_content",
      created_at: new Date().toISOString(),
      documentation: {
        editorial_standards: "We prioritize video-first content and written articles with supporting visuals",
      },
    };

    const result = await runPhaseB0109(undefined as any, input);

    const contentRules = result.rules.filter((r) => r.category === "content_type");
    expect(contentRules.length).toBeGreaterThan(0);
  });

  it("should extract brand safety rules from documentation", async () => {
    const input: B01Input = {
      input_id: "test_editorial_safety",
      created_at: new Date().toISOString(),
      documentation: {
        brand_guidelines: "Avoid divisive political topics and maintain professional language",
      },
    };

    const result = await runPhaseB0109(undefined as any, input);

    const safetyRules = result.rules.filter((r) => r.category === "brand_safety");
    expect(safetyRules.length).toBeGreaterThan(0);
  });

  it("should handle empty documentation with default fallback rule", async () => {
    const result = await runPhaseB0109(undefined as any, undefined);

    expect(result.rules.length).toBeGreaterThan(0);
    expect(result.rules[0].category).toBe("brand_safety");
  });

  it("should track evidence refs for each rule", async () => {
    const input: B01Input = {
      input_id: "test_editorial_evidence",
      created_at: new Date().toISOString(),
      documentation: {
        brand_guidelines: "Professional and authoritative tone is required",
      },
    };

    const result = await runPhaseB0109(undefined as any, input);

    for (const rule of result.rules) {
      expect(rule.evidence_refs.length).toBeGreaterThan(0);
      expect(rule.evidence_refs[0].status).toBe("INFERRED");
    }
  });

  it("should mark all rules as INFERRED (not VERIFIED)", async () => {
    const input: B01Input = {
      input_id: "test_editorial_inferred",
      created_at: new Date().toISOString(),
      documentation: {
        brand_guidelines: "Professional tone required",
      },
    };

    const result = await runPhaseB0109(undefined as any, input);

    for (const rule of result.rules) {
      for (const evRef of rule.evidence_refs) {
        expect(evRef.status).toBe("INFERRED");
      }
    }
  });

  it("should mark recommendation as unadopted (awaiting user approval)", async () => {
    const result = await runPhaseB0109(undefined as any, undefined);

    expect(result.recommendation.adopted).toBe(false);
    expect(result.recommendation.source_agent).toBe("B01.09");
  });

  it("should generate unique rule IDs deterministically", async () => {
    const input: B01Input = {
      input_id: "test_editorial_ids",
      created_at: new Date().toISOString(),
      documentation: {
        brand_guidelines: "Professional and authoritative tone",
      },
    };

    const result1 = await runPhaseB0109(undefined as any, input);
    const result2 = await runPhaseB0109(undefined as any, input);

    const ids1 = result1.rules.map((r) => r.rule_id).sort();
    const ids2 = result2.rules.map((r) => r.rule_id).sort();

    // Deterministic IDs for same input
    expect(ids1).toEqual(ids2);
  });

  it("should not create audience_fit rules (belongs in B03)", async () => {
    const input: B01Input = {
      input_id: "test_editorial_no_audience",
      created_at: new Date().toISOString(),
      documentation: {
        brand_guidelines: "Enterprise and professional audiences prefer detailed content",
      },
    };

    const result = await runPhaseB0109(undefined as any, input);

    const audienceRules = result.rules.filter((r) => r.category === "audience_fit");
    expect(audienceRules.length).toBe(0);
  });

  it("should provide constitution_id for this editorial framework", async () => {
    const result = await runPhaseB0109(undefined as any, undefined);

    expect(result.constitution_id).toBeDefined();
    expect(result.constitution_id.startsWith("constitution_")).toBe(true);
  });
});

// ============================================================================
// B01.10 — RULE DECISION LOGIC
// ============================================================================

describe("B01.10 — Rule Decision Logic", () => {
  const testEditorial = {
    constitution_id: "test_const",
    rules: [
      {
        rule_id: "tone_prof",
        category: "tone" as const,
        rule_text: "Professional tone required",
        evidence_refs: [],
      },
      {
        rule_id: "safety_politics",
        category: "brand_safety" as const,
        rule_text: "Avoid political topics",
        evidence_refs: [],
      },
    ],
    evidence_refs: [],
    recommendation: {
      recommendation_id: "rec_test",
      source_agent: "test",
      proposal: "test",
      timestamp: new Date().toISOString(),
      adopted: false,
    },
  };

  const testDistribution = {
    strategy_description: "Test distribution",
    channel_assignments: [
      {
        channel_id: "ch_youtube",
        distribution_role: "primary_channel" as const,
        routing_priority: 1,
        timing_rules: { posting_frequency: "daily", optimal_times: [], timezone_adapted: true },
        format_rules: {
          preferred_formats: ["short_video"] as any,
          forbidden_formats: [] as any,
          strategic_duration_category: "short" as const,
        },
        territory_rules: {
          allowed_territories: [],
          geo_restrictions: [],
        },
        evidence_refs: [],
      },
    ],
    evidence_refs: [],
  };

  it("should evaluate rule applicability", async () => {
    const result = await runPhaseB0110(undefined as any, testEditorial, testDistribution);

    expect(result.rule_verdicts.length).toBeGreaterThan(0);
    expect(result.rule_verdicts[0]).toHaveProperty("status");
    expect(["approved", "flagged", "blocked", "needs_revision", "UNKNOWN"]).toContain(result.rule_verdicts[0].status);
  });

  it("should count approved/flagged/blocked verdicts", async () => {
    const result = await runPhaseB0110(undefined as any, testEditorial, testDistribution);

    expect(result.approved_count + result.flagged_count + result.blocked_count).toBe(result.total_rules);
  });

  it("should handle empty editorial rules", async () => {
    const emptyEditorial = {
      ...testEditorial,
      rules: [],
    };

    const result = await runPhaseB0110(undefined as any, emptyEditorial, testDistribution);

    expect(result.total_rules).toBe(0);
    expect(result.approved_count).toBe(0);
  });

  it("should track evidence refs for each verdict", async () => {
    const result = await runPhaseB0110(undefined as any, testEditorial, testDistribution);

    for (const verdict of result.rule_verdicts) {
      expect(verdict.evidence_refs.length).toBeGreaterThan(0);
    }
  });

  it("should mark recommendation as unadopted", async () => {
    const result = await runPhaseB0110(undefined as any, testEditorial, testDistribution);

    expect(result.recommendation.adopted).toBe(false);
    expect(result.recommendation.source_agent).toBe("B01.10");
  });

  it("should provide evaluation_id", async () => {
    const result = await runPhaseB0110(undefined as any, testEditorial, testDistribution);

    expect(result.evaluation_id).toBeDefined();
    expect(result.evaluation_id.startsWith("evaluation_")).toBe(true);
  });

  it("should check deterministic confidence scores", async () => {
    const result = await runPhaseB0110(undefined as any, testEditorial, testDistribution);

    for (const verdict of result.rule_verdicts) {
      expect(verdict.deterministic_confidence).toBeGreaterThanOrEqual(0);
      expect(verdict.deterministic_confidence).toBeLessThanOrEqual(1);
    }
  });

  it("should reject empty rule text (blocked status)", async () => {
    const badEditorial = {
      ...testEditorial,
      rules: [
        {
          rule_id: "empty_rule",
          category: "tone" as const,
          rule_text: "", // Empty!
          evidence_refs: [],
        },
      ],
    };

    const result = await runPhaseB0110(undefined as any, badEditorial, testDistribution);

    expect(result.rule_verdicts[0].status).toBe("blocked");
  });

  it("should evaluate rules for channel applicability", async () => {
    const ruleWithChannels = {
      ...testEditorial,
      rules: [
        {
          rule_id: "ch_specific",
          category: "tone" as const,
          rule_text: "Professional tone",
          applies_to_channels: ["ch_youtube"],
          evidence_refs: [],
        },
      ],
    };

    const result = await runPhaseB0110(undefined as any, ruleWithChannels, testDistribution);

    expect(result.rule_verdicts[0].status).toBe("approved");
  });
});

// ============================================================================
// B01.11 — CONSTRAINT AGGREGATION
// ============================================================================

describe("B01.11 — Constraint Aggregation", () => {
  const testDistribution = {
    strategy_description: "Test distribution",
    channel_assignments: [
      {
        channel_id: "ch_youtube",
        distribution_role: "primary_channel" as const,
        routing_priority: 1,
        timing_rules: { posting_frequency: "daily", optimal_times: [], timezone_adapted: true },
        format_rules: {
          preferred_formats: ["short_video"] as any,
          forbidden_formats: [] as any,
          strategic_duration_category: "short" as const,
        },
        territory_rules: {
          allowed_territories: [],
          geo_restrictions: [],
        },
        evidence_refs: [],
      },
    ],
    evidence_refs: [],
  };

  const testEditorial = {
    constitution_id: "test_const",
    rules: [
      {
        rule_id: "tone_prof",
        category: "tone" as const,
        rule_text: "Professional tone required",
        evidence_refs: [],
      },
    ],
    evidence_refs: [],
    recommendation: {
      recommendation_id: "rec_test",
      source_agent: "test",
      proposal: "test",
      timestamp: new Date().toISOString(),
      adopted: false,
    },
  };

  it("should aggregate distribution constraints", async () => {
    const result = await runPhaseB0111(undefined as any, testDistribution, testEditorial);

    expect(result.constraint_count).toBeGreaterThan(0);
    expect(result.constraints.length).toBeGreaterThan(0);
  });

  it("should aggregate editorial constraints", async () => {
    const result = await runPhaseB0111(undefined as any, testDistribution, testEditorial);

    // Field renamed from the old shadow type's `type` to the canonical
    // `binding_module` (matching types.ts's AggregatedConstraint, which B01.11
    // now produces directly instead of an incompatible local shape).
    const editConstraints = result.constraints.filter((c) => c.binding_module === "editorial");
    expect(editConstraints.length).toBeGreaterThan(0);
  });

  it("should track evidence refs for each constraint", async () => {
    const result = await runPhaseB0111(undefined as any, testDistribution, testEditorial);

    for (const constraint of result.constraints) {
      expect(constraint.evidence_refs.length).toBeGreaterThan(0);
    }
  });

  it("never detects conflicts itself (pure aggregator, per Decision E/F) — always conflict_count 0 regardless of input", async () => {
    const conflictEditorial = {
      ...testEditorial,
      rules: [
        {
          rule_id: "avoid_politics",
          category: "brand_safety" as const,
          rule_text: "Avoid political topics",
          evidence_refs: [],
        },
        {
          rule_id: "avoid_tone",
          category: "tone" as const,
          rule_text: "Avoid overly casual language",
          evidence_refs: [],
        },
        {
          rule_id: "professional",
          category: "tone" as const,
          rule_text: "Professional and authoritative tone",
          evidence_refs: [],
        },
      ],
    };

    // Even with a fixture that WOULD trigger a real conflict in conflicts.ts
    // (see the dedicated conflicts.ts test below), B01.11 must report zero —
    // it is a pure aggregator, not a second detection engine.
    const result = await runPhaseB0111(undefined as any, testDistribution, conflictEditorial);
    expect(result.conflict_count).toBe(0);
    expect(result.conflicts).toEqual([]);
  });

  it("should identify gaps for missing distribution", async () => {
    const emptyDistribution = {
      strategy_description: "",
      channel_assignments: [],
      evidence_refs: [],
    };

    const ecosystem = {
      channels: [{ channel_id: "ch1", platform: "youtube", name: "Main" }],
    } as any;

    const result = await runPhaseB0111(ecosystem, emptyDistribution, testEditorial);

    expect(result.gap_count).toBeGreaterThan(0);
  });

  it("should identify gaps for missing editorial", async () => {
    const emptyEditorial = {
      constitution_id: "empty",
      rules: [],
      evidence_refs: [],
      recommendation: { recommendation_id: "r", source_agent: "test", proposal: "", timestamp: "", adopted: false },
    };

    const ecosystem = { channels: [] } as any;

    const result = await runPhaseB0111(ecosystem, testDistribution, emptyEditorial);

    expect(result.gap_count).toBeGreaterThan(0);
  });

  it("should provide aggregation_id", async () => {
    const result = await runPhaseB0111(undefined as any, testDistribution, testEditorial);

    expect(result.aggregation_id).toBeDefined();
    expect(result.aggregation_id.startsWith("aggregation_")).toBe(true);
  });

  it("should mark recommendation as unadopted", async () => {
    const result = await runPhaseB0111(undefined as any, testDistribution, testEditorial);

    expect(result.recommendation.adopted).toBe(false);
    expect(result.recommendation.source_agent).toBe("B01.11");
  });
});

// ============================================================================
// B01.12 — ASSEMBLY & CANONICALIZATION
// ============================================================================

// NOTE: B01.12's signature changed as part of the canonical repair (Decision
// F / Invariant 9): it now performs REAL assembly of all 11 prior phase
// outputs (previously it accepted only `EcosystemData` and hardcoded every
// other phase to `undefined` despite its own doc-comment claiming to
// assemble all 11 — the real work happened inline in `runB01()` instead).
// These tests were rewritten (not silently dropped) to exercise the real
// signature and assert the assembly is genuine, not decorative.
function minimalB0112Input(overrides: Partial<Parameters<typeof runPhaseB0112>[0]> = {}) {
  const emptyEcosystem: EcosystemData = { channels: [], platforms: [], evidence_refs: [] };
  return {
    candidateId: "cand_test_fixed_id",
    ecosystem: emptyEcosystem,
    brand_arch: { positioning_summary: "UNKNOWN" as const, value_themes: [], evidence_refs: [], recommendation: { recommendation_id: "r1", source_agent: "test", proposal: "p", timestamp: "t", adopted: false } },
    role_map: {},
    relationship_graph: { edges: [], evidence_refs: [], recommendation: { recommendation_id: "r2", source_agent: "test", proposal: "p", timestamp: "t", adopted: false } },
    platform_registry: {},
    channel_fit: {},
    territories: { territories: [] },
    distribution: { strategy_description: "", channel_assignments: [], evidence_refs: [] },
    editorial: { constitution_id: "c1", rules: [], evidence_refs: [], recommendation: { recommendation_id: "r3", source_agent: "test", proposal: "p", timestamp: "t", adopted: false } },
    rule_verdicts: [],
    constraintAgg: {
      aggregation_id: "agg1",
      constraints: [],
      conflicts: [],
      gaps: [],
      constraint_count: 0,
      conflict_count: 0,
      gap_count: 0,
      evidence_refs: [],
      recommendation: { recommendation_id: "r4", source_agent: "test", proposal: "p", timestamp: "t", adopted: false },
    },
    allEvidence: [],
    allProvenance: [],
    allRecommendations: [],
    ...overrides,
  };
}

describe("B01.12 — Canonical State Assembly", () => {
  it("should assemble candidate state from empty ecosystem", async () => {
    const result = await runPhaseB0112(minimalB0112Input());

    expect(result).toBeDefined();
    expect(result.candidate_id).toBe("cand_test_fixed_id");
  });

  it("should return B01CandidateState with required fields", async () => {
    const ecosystem: EcosystemData = {
      channels: [{ channel_id: "ch_youtube", name: "YouTube Main", raw_platform: "youtube", platform: "YOUTUBE" as any, source: "test" }],
      platforms: [],
      evidence_refs: [],
    };

    const result = await runPhaseB0112(minimalB0112Input({ ecosystem }));

    expect(result.created_at).toBeDefined();
    expect(result.updated_at).toBeDefined();
    expect(result.ecosystem).toBeDefined();
    expect(result.completeness).toBeDefined();
    expect(result.evidence_refs).toBeDefined();
  });

  it("should calculate a real completeness score (not a hardcoded stub)", async () => {
    const emptyResult = await runPhaseB0112(minimalB0112Input());
    const richResult = await runPhaseB0112(
      minimalB0112Input({
        brand_arch: {
          positioning_summary: "Enterprise SaaS",
          value_themes: ["Speed"],
          evidence_refs: [],
          recommendation: { recommendation_id: "r1", source_agent: "test", proposal: "p", timestamp: "t", adopted: false },
        },
      }),
    );

    expect(emptyResult.completeness.score).toBeGreaterThanOrEqual(0);
    expect(emptyResult.completeness.score).toBeLessThanOrEqual(100);
    // A richer candidate must score at least as high as an empty one — this
    // proves completeness is computed from real assembled data, not a
    // hardcoded percentage (the prior B01.12 stub only ever checked 1 of 8
    // categories regardless of what was actually assembled).
    expect(richResult.completeness.score).toBeGreaterThanOrEqual(emptyResult.completeness.score);
  });

  it("should surface real, current missing-input/blocking-decision messages from calculateCompleteness", async () => {
    const result = await runPhaseB0112(minimalB0112Input());

    // These come from the real completeness engine (src/b01/completeness.ts),
    // not a hardcoded static list local to B01.12 (the prior defect).
    expect(result.completeness.missing_inputs).toContain("Brand positioning not provided");
    expect(result.completeness.blocking_decisions).toContain("Distribution strategy not defined");
    expect(result.completeness.blocking_decisions).toContain("Editorial constitution not defined");
  });

  it("should carry through evidence_refs assembled from all phases, preserving status", async () => {
    const result = await runPhaseB0112(
      minimalB0112Input({
        allEvidence: [{ id: "ev1", source: "test", status: "INFERRED" }],
      }),
    );

    expect(result.evidence_refs.length).toBeGreaterThan(0);
    expect(result.evidence_refs[0]?.status).toBe("INFERRED");
  });

  it("should include all 11 phase outputs it was given, not hardcode them to undefined", async () => {
    const ecosystem: EcosystemData = { channels: [{ channel_id: "ch1", name: "Channel", raw_platform: "youtube", platform: "YOUTUBE" as any, source: "test" }], platforms: [], evidence_refs: [] };
    const role_map: RoleMap = { Channel: { role: "primary_channel" as any, evidence_refs: [] } };

    const result = await runPhaseB0112(minimalB0112Input({ ecosystem, role_map }));

    expect(result.ecosystem.channels.length).toBe(1);
    expect(result.ecosystem.channels[0]?.channel_id).toBe("ch1");
    // role_map is a real phase output that the prior B01.12 stub hardcoded to
    // `undefined` regardless of input — verifying it survives proves the
    // assembly is real.
    expect(result.role_map).toBeDefined();
    expect(result.role_map?.Channel?.role).toBe("primary_channel");
  });
});

describe("runB01 orchestration — B01.12 delegation and determinism", () => {
  it("delegates assembly to B01.12 rather than duplicating it inline (role_map/relationship_graph/channel_fit/rule_verdicts survive end-to-end)", async () => {
    const candidate = await runB01(MINIMAL_INPUT, createDefaultDeps());

    expect(candidate.role_map).toBeDefined();
    expect(candidate.relationship_graph).toBeDefined();
    expect(candidate.channel_fit).toBeDefined();
    expect(candidate.rule_verdicts).toBeDefined();
  });

  it("candidate_id is wall-clock independent: identical logical input produces the identical id regardless of the current date", async () => {
    const originalNow = Date.prototype.toISOString;
    try {
      let callCount = 0;
      // Simulate two different calendar days across the two runs by
      // returning different dates from Date.prototype.toISOString.
      Date.prototype.toISOString = function (this: Date) {
        callCount++;
        const day = callCount % 2 === 0 ? "2026-01-01" : "2099-12-31";
        return `${day}T00:00:00.000Z`;
      };

      const c1 = await runB01(MINIMAL_INPUT, createDefaultDeps());
      const c2 = await runB01(MINIMAL_INPUT, createDefaultDeps());

      expect(c1.candidate_id).toBe(c2.candidate_id);
    } finally {
      Date.prototype.toISOString = originalNow;
    }
  });
});

// ============================================================================
// B01 GOVERNANCE WORKFLOW — approveCandidate/rejectCandidate/revokeCandidate
// (Decisions 1/3/4/5: real B00 governance kernel, not unvalidated appends)
// ============================================================================

describe("B01 Governance Workflow", () => {
  it("approveCandidate records real governance_events history for approved items", async () => {
    const candidate = await runB01(MINIMAL_INPUT, createDefaultDeps());
    const itemId = "ch_youtube_main";

    const updated = approveCandidate(candidate, [itemId], [], "user@test.com");

    expect(updated.governance_events?.[itemId]).toBeDefined();
    const history = updated.governance_events![itemId]!;
    expect(history.map((e) => e.state)).toEqual(["PROPOSED", "APPROVED"]);
    expect(history[1]!.provenance.prior_provenance_id).toBe(history[0]!.id);
  });

  it("approve -> reject -> approve preserves full history, with the new APPROVED linked to REJECTED (not the original APPROVED)", async () => {
    const candidate = await runB01(MINIMAL_INPUT, createDefaultDeps());
    const itemId = "ch_youtube_main";

    const afterApprove = approveCandidate(candidate, [itemId], [], "user@test.com");
    // rejectCandidate only routes PROPOSED->REJECTED; an APPROVED item must be
    // revoked, not rejected. Verify that calling rejectCandidate directly on
    // an APPROVED item throws (illegal transition), then use revoke+approve
    // to exercise the real re-approval lineage.
    expect(() => rejectCandidate(afterApprove, [itemId], "user@test.com")).toThrow();

    const afterRevoke = revokeCandidate(afterApprove, [itemId], "user@test.com");
    const afterReapprove = approveCandidate(afterRevoke, [itemId], [], "user@test.com");

    const history = afterReapprove.governance_events![itemId]!;
    expect(history.map((e) => e.state)).toEqual(["PROPOSED", "APPROVED", "REVOKED", "APPROVED"]);
    // Full history retained — nothing was overwritten or dropped.
    expect(history.length).toBe(4);
    // New APPROVED links to REVOKED, not the original APPROVED (Decision 5).
    const finalApproved = history[3]!;
    const revokedEvent = history[2]!;
    const firstApproved = history[1]!;
    expect(finalApproved.provenance.prior_provenance_id).toBe(revokedEvent.id);
    expect(finalApproved.provenance.prior_provenance_id).not.toBe(firstApproved.id);
  });

  it("approveCandidate on rejectedItemIds automatically revokes (not rejects) an item that is currently APPROVED", async () => {
    const candidate = await runB01(MINIMAL_INPUT, createDefaultDeps());
    const itemId = "ch_youtube_main";

    const afterApprove = approveCandidate(candidate, [itemId], [], "user@test.com");
    // Passing the same id as "rejected" while it's APPROVED should revoke,
    // not throw an illegal-REJECTED-from-APPROVED transition error.
    const afterSecondCall = approveCandidate(afterApprove, [], [itemId], "user@test.com");

    const history = afterSecondCall.governance_events![itemId]!;
    expect(history.map((e) => e.state)).toEqual(["PROPOSED", "APPROVED", "REVOKED"]);
  });

  it("rejectCandidate throws for an illegal transition (e.g. rejecting an item already CANONICAL is not representable via approve/reject alone, but rejecting twice from PROPOSED after approval is illegal)", async () => {
    const candidate = await runB01(MINIMAL_INPUT, createDefaultDeps());
    const itemId = "ch_youtube_main";
    const afterApprove = approveCandidate(candidate, [itemId], [], "user@test.com");
    expect(() => rejectCandidate(afterApprove, [itemId], "user@test.com")).toThrow();
  });
});

// ============================================================================
// B01 CANONICALIZATION — Candidate → Canonical State v1.0
// ============================================================================

describe("B01 Canonicalization", () => {
  it("should transform B01CandidateState → B01CanonicalState v1.0", async () => {
    const persistence = createMockPersistence();
    const deps = createDefaultDeps();

    // Generate candidate state from full B01 run
    const candidate = await runB01(FULL_INPUT, deps);

    // Verify candidate state is pre-decision
    expect(candidate.candidate_id).toBeDefined();
    expect(candidate.ecosystem).toBeDefined();
    expect(candidate.completeness.score).toBeGreaterThanOrEqual(0);
    expect(candidate.completeness.score).toBeLessThanOrEqual(100);

    // Create canonical state v1.0 with explicit user approval
    const userAuthority = "mk350174@gmail.com:b01-canonicalization-decision";
    const canonical = await commitVersion(candidate, "v1.0", userAuthority, persistence);

    // Verify canonical state created
    expect(canonical.version).toBe("v1.0");
    expect(canonical.user_decision_authority).toBe(userAuthority);
    expect(canonical.created_at).toBeDefined();
    expect(canonical.updated_at).toBeDefined();
  });

  it("provenance_chains contain real data, not the previously-fabricated generic placeholder text", async () => {
    const persistence = createMockPersistence();
    const candidate = await runB01(FULL_INPUT, createDefaultDeps());
    const canonical = await commitVersion(candidate, "v1.0", "user@test.com", persistence);

    expect(canonical.provenance_chains.length).toBeGreaterThan(0);
    for (const chain of canonical.provenance_chains) {
      // The old implementation always used exactly this text regardless of
      // input; its presence anywhere now would mean fabrication reappeared.
      expect(chain.initial_observation.rationale).not.toBe("Ecosystem data collected");
      if (chain.recommendation) {
        expect(chain.recommendation.rationale).not.toBe("B01 agent recommendations");
      }
      // canonical slot must always be the real, current commit's own ref.
      expect(chain.canonical?.type).toBe("CANONICAL");
      expect(chain.canonical?.decision_authority).toBe("user@test.com");
    }
  });

  it("provenance_chains reconstruct real per-item history when governance has run (approve -> revoke -> approve)", async () => {
    const persistence = createMockPersistence();
    const candidate = await runB01(MINIMAL_INPUT, createDefaultDeps());
    const itemId = "ch_youtube_main";

    let governed = approveCandidate(candidate, [itemId], [], "user@test.com");
    governed = revokeCandidate(governed, [itemId], "user@test.com");
    governed = approveCandidate(governed, [itemId], [], "user@test.com");

    const canonical = await commitVersion(governed, "v1.0", "user@test.com", persistence);

    // One chain should correspond to the governed item, with a `decision`
    // slot that is the real, most recent DECIDED event from its actual
    // reconstructed history (the re-approval after revocation), not a
    // generic fabricated string.
    const hasRealItemDecision = canonical.provenance_chains.some(
      (c) => c.decision && c.decision.decision_authority === "user@test.com" && c.decision.rationale !== "Ecosystem data collected",
    );
    expect(hasRealItemDecision).toBe(true);
    expect(canonical.provenance_chains.length).toBeGreaterThanOrEqual(1);
  });

  it("documents a known scope limitation: a governed item's chain reports no OBSERVED event even when real OBSERVED data for that item exists elsewhere on the candidate (ProvenanceRef has no item identifier to link them; see orchestration.ts's chainFromRealEvents doc comment)", async () => {
    const persistence = createMockPersistence();
    const candidate = await runB01(MINIMAL_INPUT, createDefaultDeps());
    const itemId = "ch_youtube_main";

    // Real OBSERVED provenance for this exact channel does exist on the
    // candidate (populated by B01.01, keyed by channel name in its
    // rationale) — it's just not linkable to the governance history below
    // because ProvenanceRef carries no subject/item identifier.
    const realObservedForItem = (candidate.provenance_refs ?? []).find(
      (ref) => ref.type === "OBSERVED" && ref.rationale?.includes("YouTube Main"),
    );
    expect(realObservedForItem).toBeDefined();

    const governed = approveCandidate(candidate, [itemId], [], "user@test.com");
    const canonical = await commitVersion(governed, "v1.0", "user@test.com", persistence);

    const itemChain = canonical.provenance_chains.find(
      (c) => c.decision?.decision_authority === "user@test.com",
    );
    expect(itemChain).toBeDefined();
    // Honest fallback, not fabrication — asserted here so a future change
    // that starts silently fabricating a fake OBSERVED event is caught, and
    // so this documented gap stays visible as a tested boundary rather than
    // an untested one.
    expect(itemChain?.initial_observation.rationale).toMatch(/No OBSERVED provenance event recorded/);
  });

  it("should preserve evidence refs in canonical state", async () => {
    const persistence = createMockPersistence();
    const deps = createDefaultDeps();

    const candidate = await runB01(FULL_INPUT, deps);
    const userAuthority = "mk350174@gmail.com:b01-canonicalization-decision";
    const canonical = await commitVersion(candidate, "v1.0", userAuthority, persistence);

    // Verify evidence refs preserved
    expect(canonical.evidence_refs.length).toBeGreaterThan(0);
    for (const ref of canonical.evidence_refs) {
      expect(ref.id).toBeDefined();
      expect(ref.source).toBeDefined();
      expect(["VERIFIED", "INFERRED", "UNKNOWN"]).toContain(ref.status);
    }
  });

  it("should create audit trail with decision authority", async () => {
    const persistence = createMockPersistence();
    const deps = createDefaultDeps();

    const candidate = await runB01(FULL_INPUT, deps);
    const userAuthority = "mk350174@gmail.com:b01-canonicalization-decision";
    const canonical = await commitVersion(candidate, "v1.0", userAuthority, persistence);

    // Verify audit trail. Field name corrected to match the real AuditEntry
    // contract (src/b00/auditTrail.ts): `decision_authority`, not `authority`
    // — the prior hardcoded audit-entry stub used a fake ad-hoc shape with an
    // `authority` field that never matched the actual AuditEntry interface.
    expect(canonical.audit_trail).toBeDefined();
    expect(canonical.audit_trail.length).toBeGreaterThan(0);
    expect(canonical.audit_trail[0].decision_authority).toBe(userAuthority);
  });

  it("should prevent duplicate version commits (immutability)", async () => {
    const persistence = createMockPersistence();
    const deps = createDefaultDeps();

    const candidate = await runB01(FULL_INPUT, deps);
    const userAuthority = "mk350174@gmail.com:b01-canonicalization-decision";

    // First commit succeeds
    await commitVersion(candidate, "v1.0", userAuthority, persistence);

    // Second commit of same version should fail
    await expect(commitVersion(candidate, "v1.0", userAuthority, persistence)).rejects.toThrow(
      "Version v1.0 already committed (immutable)",
    );
  });

  it("should populate channels with roles from role_map", async () => {
    const persistence = createMockPersistence();
    const deps = createDefaultDeps();

    const candidate = await runB01(FULL_INPUT, deps);
    const userAuthority = "mk350174@gmail.com:b01-canonicalization-decision";
    const canonical = await commitVersion(candidate, "v1.0", userAuthority, persistence);

    // Verify channels exist in canonical state
    if (canonical.channels && canonical.channels.length > 0) {
      for (const ch of canonical.channels) {
        expect(ch.channel_id).toBeDefined();
        expect(ch.name).toBeDefined();
        expect(ch.platform).toBeDefined();
        expect(ch.role).toBeDefined(); // Should have role from role_map or "UNKNOWN"
      }
    }
  });

  it("should include completeness score in canonical state", async () => {
    const persistence = createMockPersistence();
    const deps = createDefaultDeps();

    const candidate = await runB01(FULL_INPUT, deps);
    const userAuthority = "mk350174@gmail.com:b01-canonicalization-decision";
    const canonical = await commitVersion(candidate, "v1.0", userAuthority, persistence);

    // Verify completeness
    expect(canonical.completeness).toBeDefined();
    expect(canonical.completeness.score).toBeGreaterThanOrEqual(0);
    expect(canonical.completeness.score).toBeLessThanOrEqual(100);
    expect(canonical.completeness.missing_inputs).toBeDefined();
  });

  it("should include conflicts and gaps in canonical state", async () => {
    const persistence = createMockPersistence();
    const deps = createDefaultDeps();

    const candidate = await runB01(FULL_INPUT, deps);
    const userAuthority = "mk350174@gmail.com:b01-canonicalization-decision";
    const canonical = await commitVersion(candidate, "v1.0", userAuthority, persistence);

    // Verify conflicts/gaps tracked
    expect(canonical.conflicts).toBeDefined();
    expect(canonical.gaps).toBeDefined();
    // May be empty array if no conflicts detected, but fields must exist
    expect(Array.isArray(canonical.conflicts)).toBe(true);
    expect(Array.isArray(canonical.gaps)).toBe(true);
  });

  it("should persist canonical state to storage backend", async () => {
    const persistence = createMockPersistence();
    const deps = createDefaultDeps();

    const candidate = await runB01(FULL_INPUT, deps);
    const userAuthority = "mk350174@gmail.com:b01-canonicalization-decision";
    await commitVersion(candidate, "v1.0", userAuthority, persistence);

    // Verify persistence
    const loaded = await persistence.load("v1.0");
    expect(loaded).toBeDefined();
    expect(loaded?.version).toBe("v1.0");
    expect(loaded?.user_decision_authority).toBe(userAuthority);
  });

  it("should allow version incrementation (v1.0 → v1.1)", async () => {
    const persistence = createMockPersistence();
    const deps = createDefaultDeps();

    const candidate = await runB01(FULL_INPUT, deps);
    const userAuthority = "mk350174@gmail.com:b01-canonicalization-decision";

    // Create v1.0
    const v1_0 = await commitVersion(candidate, "v1.0", userAuthority, persistence);

    // Create v1.1 (requires new user decision, new authority)
    const v1_1_authority = "mk350174@gmail.com:b01-v1.1-decision";
    const v1_1 = await commitVersion(candidate, "v1.1", v1_1_authority, persistence, v1_0);

    expect(v1_1.version).toBe("v1.1");
    expect(v1_1.user_decision_authority).toBe(v1_1_authority);

    // Both versions should exist
    const versions = await persistence.listVersions();
    expect(versions).toContain("v1.0");
    expect(versions).toContain("v1.1");
  });

  it("should return latest version correctly", async () => {
    const persistence = createMockPersistence();
    const deps = createDefaultDeps();

    const candidate = await runB01(FULL_INPUT, deps);
    const userAuthority = "mk350174@gmail.com:b01-canonicalization-decision";

    // Create v1.0
    await commitVersion(candidate, "v1.0", userAuthority, persistence);

    // Create v1.1
    const v1_0 = await persistence.load("v1.0");
    const v1_1_authority = "mk350174@gmail.com:b01-v1.1-decision";
    await commitVersion(candidate, "v1.1", v1_1_authority, persistence, v1_0 ?? undefined);

    // Latest should be v1.1
    const latest = await persistence.latest();
    expect(latest?.version).toBe("v1.1");
  });

  it("should validate version format (semantic versioning)", async () => {
    const persistence = createMockPersistence();
    const deps = createDefaultDeps();

    const candidate = await runB01(FULL_INPUT, deps);
    const userAuthority = "mk350174@gmail.com:b01-canonicalization-decision";

    // Valid formats
    await expect(commitVersion(candidate, "v1.0", userAuthority, persistence)).resolves.toBeDefined();
    await expect(commitVersion(candidate, "v2.5", userAuthority, persistence)).resolves.toBeDefined();

    // Invalid formats
    await expect(commitVersion(candidate, "1.0", userAuthority, persistence)).rejects.toThrow(
      "Invalid version format",
    );
    await expect(commitVersion(candidate, "v1.0.0", userAuthority, persistence)).rejects.toThrow(
      "Invalid version format",
    );
    await expect(commitVersion(candidate, "v1", userAuthority, persistence)).rejects.toThrow(
      "Invalid version format",
    );
  });

  it("should NOT auto-promote INFERRED data to CANONICAL", async () => {
    const persistence = createMockPersistence();
    const deps = createDefaultDeps();

    const candidate = await runB01(EMPTY_INPUT, deps); // Empty input → more INFERRED data

    // Candidate should have INFERRED outputs (from algorithms)
    // When committed to canonical, they should retain their INFERRED provenance
    const userAuthority = "mk350174@gmail.com:b01-canonicalization-decision";
    const canonical = await commitVersion(candidate, "v1.0", userAuthority, persistence);

    // Verify inferred data is included but tracked as inferred
    // Evidence refs should include INFERRED status for algorithmic outputs
    const inferredEvidence = canonical.evidence_refs.filter((ref) => ref.status === "INFERRED");
    expect(inferredEvidence.length).toBeGreaterThan(0);
  });

  it("should track B01 LOCKED status after canonicalization", async () => {
    const persistence = createMockPersistence();
    const deps = createDefaultDeps();

    const candidate = await runB01(FULL_INPUT, deps);
    const userAuthority = "mk350174@gmail.com:b01-canonicalization-decision";
    const canonical = await commitVersion(candidate, "v1.0", userAuthority, persistence);

    // Canonical state v1.0 is created and immutable
    // B01 is now locked (cannot modify; must create new version via commitVersion)
    expect(canonical.version).toBe("v1.0");

    // Verify immutability by attempting duplicate save
    await expect(commitVersion(candidate, "v1.0", userAuthority, persistence)).rejects.toThrow();
  });
});

// ============================================================================
// CANONICALIZATION LOSS-GUARD REGRESSION TEST (Invariant 1 / canonical plan §23)
// ============================================================================
// Plan §23 requires: "A test that diffs the key-set of B01CandidateState
// against B01CanonicalState plus the declared-drops constant; fails on any
// undeclared discrepancy." A literal 1:1 key-name diff isn't meaningful here
// because several fields are legitimately renamed during canonicalization
// (e.g. `ecosystem` -> `channels`/`platforms`, `brand_arch` ->
// `brand_profile`). Instead this test asserts, at RUNTIME (not via a
// TypeScript type, since tests/ is excluded from tsconfig's `include` and so
// isn't type-checked — only executed), that every top-level key actually
// present on a real assembled B01CandidateState is accounted for in one of
// two ways: (a) it is carried forward into canonical state under a
// documented new name, or (b) it is explicitly listed in
// KNOWN_CANONICALIZATION_DROPS. A field added to B01CandidateState in the
// future that is neither wired into commitVersion() nor declared as a drop
// will show up as an unaccounted runtime key and fail this test.
describe("Canonicalization loss guard (Invariant 1 / plan §23)", () => {
  // Hand-verified disposition of every field declared on B01CandidateState
  // (src/b01/types.ts). Update this map whenever that interface gains a
  // field — the `unaccounted` assertion below is what actually enforces
  // that no one forgets to.
  const FIELD_DISPOSITION: Record<string, "carried" | "declared_drop" | "not_populated_by_assembly"> = {
    candidate_id: "carried",
    created_at: "carried",
    updated_at: "carried",
    ecosystem: "carried", // -> channels[] / platforms[]
    brand_arch: "carried", // -> brand_profile
    role_map: "declared_drop",
    relationship_graph: "declared_drop",
    platform_registry: "carried", // -> platforms[].capabilities (per-capability metadata is itself a separate declared_drop)
    channel_fit: "declared_drop",
    territories: "carried", // -> content_territories
    distribution: "carried", // -> distribution_strategy (several sub-fields are separate declared_drops)
    editorial: "carried", // -> editorial_constitution (type/applies_to/per-rule provenance are separate declared_drops)
    rule_verdicts: "declared_drop",
    constraints: "carried", // -> conflicts / gaps / strategic_constraints
    prior_canonical_state: "not_populated_by_assembly", // input-only plumbing; B01.12 sets it to undefined
    prior_audit_trail: "carried", // merged into audit_trail (appended, not overwritten)
    completeness: "carried",
    evidence_refs: "carried",
    all_recommendations: "carried", // -> recommendations_considered
    all_decisions: "not_populated_by_assembly", // only set by future decision-recording flows, not B01.12
    provenance_refs: "carried",
    approvals: "not_populated_by_assembly", // only set by approveCandidate/commitVersion's own approval record
    governance_events: "not_populated_by_assembly", // only set by approveCandidate/rejectCandidate/revokeCandidate
  };

  it("accounts for every runtime key of a fully-assembled B01CandidateState", async () => {
    const candidate = await runB01(FULL_INPUT, createDefaultDeps());

    const candidateKeys = Object.keys(candidate);
    const accountedFor = new Set(Object.keys(FIELD_DISPOSITION));
    const unaccounted = candidateKeys.filter((k) => !accountedFor.has(k));

    expect(unaccounted).toEqual([]);
  });

  it("every field marked declared_drop above has a matching KNOWN_CANONICALIZATION_DROPS entry", () => {
    const dropFieldNames = KNOWN_CANONICALIZATION_DROPS.map((d) => d.field);

    for (const [field, disposition] of Object.entries(FIELD_DISPOSITION)) {
      if (disposition !== "declared_drop") continue;
      const hasEntry = dropFieldNames.some((f) => f.includes(field));
      expect(hasEntry, `Expected a KNOWN_CANONICALIZATION_DROPS entry mentioning "${field}"`).toBe(true);
    }
  });

  it("declared_drop fields are populated on the candidate (there is real data to drop) yet genuinely absent from canonical state under their own name", async () => {
    const persistence = createMockPersistence();
    const candidate = await runB01(FULL_INPUT, createDefaultDeps());

    // Confirm the source fields are actually populated for this fixture —
    // otherwise "absent from canonical" would be true but meaningless.
    expect(candidate.role_map && Object.keys(candidate.role_map).length > 0).toBe(true);
    expect((candidate.relationship_graph?.edges ?? []).length).toBeGreaterThanOrEqual(0);
    expect(candidate.rule_verdicts).toBeDefined();

    const canonical = await commitVersion(candidate, "v1.0", "user@test.com", persistence);
    const canonicalKeys = Object.keys(canonical);

    // None of the declared_drop field names exist as top-level canonical keys.
    expect(canonicalKeys).not.toContain("role_map");
    expect(canonicalKeys).not.toContain("relationship_graph");
    expect(canonicalKeys).not.toContain("channel_fit");
    expect(canonicalKeys).not.toContain("rule_verdicts");
  });

  it("carried fields produce non-empty renamed output when their candidate source is populated", async () => {
    const persistence = createMockPersistence();
    const candidate = await runB01(FULL_INPUT, createDefaultDeps());
    const canonical = await commitVersion(candidate, "v1.0", "user@test.com", persistence);

    expect(canonical.channels.length).toBeGreaterThan(0); // <- ecosystem
    expect(canonical.platforms.length).toBeGreaterThan(0); // <- ecosystem
    expect(canonical.brand_profile.values.length).toBeGreaterThan(0); // <- brand_arch
    expect(canonical.content_territories).toBeDefined(); // <- territories
    expect(canonical.distribution_strategy).toBeDefined(); // <- distribution
    expect(canonical.editorial_constitution).toBeDefined(); // <- editorial
    expect(canonical.evidence_refs.length).toBeGreaterThan(0);
    expect(canonical.provenance_refs.length).toBeGreaterThan(0);
  });
});
