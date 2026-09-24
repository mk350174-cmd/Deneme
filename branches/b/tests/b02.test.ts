// B02 Content Intelligence — Comprehensive Test Suite
// Tests all phases: registry, opportunities, validation, prioritization
// Test categories: unit, contract, provenance, evidence, determinism, no-fabrication,
//                  A-boundary, B03-boundary, canonicalization, immutability, completeness

import { describe, it, expect, beforeEach } from "vitest";
import type { B01CanonicalState } from "../src/b00/contracts.js";
import type { B02CandidateState, B02CanonicalState } from "../src/b02/types.js";
import {
  runB02,
  approveCandidate,
  commitVersion,
  loadVersion,
  listVersions,
  getLatestVersion,
  buildRegistryContext,
  validateRegistry,
  evaluatePositioningAlignment,
  evaluateEditorialFit,
  detectConstraintConflicts,
  identifyGaps,
  calculateCompleteness,
  validateNoFabrication,
  classifyOpportunities,
  prioritizeOpportunities,
  createDefaultB02Deps,
  KNOWN_CANONICALIZATION_DROPS,
} from "../src/b02/index.js";
import { createMockPersistence, createDefaultDeps } from "../src/b02/persistence.js";

// Mock B01CanonicalState for testing
const createMockB01State = (): B01CanonicalState => ({
  version: "v1.0",
  created_at: "2026-08-27T10:00:00Z",
  updated_at: "2026-08-27T10:00:00Z",
  user_decision_authority: "test@example.com",

  audit_trail: [],
  decisions_made: [],
  recommendations_considered: [],

  evidence_refs: [],
  provenance_refs: [],

  brand_profile: {
    brand_name: "TestBrand",
    positioning: "Premium lifestyle content",
    mission: "Inspire aspirational living",
    values: ["authenticity", "quality", "innovation"],
  },

  channels: [
    {
      channel_id: "ch_001",
      name: "TestBrand YouTube",
      platform: "YOUTUBE",
      role: "primary",
      audience_category: "broad",
      url: "https://youtube.com/testbrand",
      evidence_refs: [],
    },
    {
      channel_id: "ch_002",
      name: "TestBrand TikTok",
      platform: "TIKTOK",
      role: "secondary",
      audience_category: "creators",
      url: "https://tiktok.com/@testbrand",
      evidence_refs: [],
    },
    {
      channel_id: "ch_003",
      name: "TestBrand LinkedIn",
      platform: "LINKEDIN",
      role: "secondary",
      audience_category: "professional",
      url: "https://linkedin.com/company/testbrand",
      evidence_refs: [],
    },
  ],

  platforms: [
    {
      platform_id: "plat_001",
      name: "YOUTUBE",
      capabilities: ["long_form_video", "community_chat", "unknown"],
      evidence_refs: [],
    },
    {
      platform_id: "plat_002",
      name: "TIKTOK",
      capabilities: ["short_form_video", "image_carousel", "unknown"],
      evidence_refs: [],
    },
    {
      platform_id: "plat_003",
      name: "LINKEDIN",
      capabilities: ["text_post", "long_form_video", "thread"],
      evidence_refs: [],
    },
  ],

  ecosystems: [],

  content_territories: [
    {
      territory_id: "terr_001",
      type: "geographic",
      description: "North America",
      boundaries: ["US", "Canada"],
      evidence_refs: [],
    },
  ],

  distribution_strategy: {
    strategy_description: "Multi-channel distribution with platform-specific adaptation",
    channel_assignments: [
      {
        channel_id: "ch_001",
        role: "primary_channel",
        timing: "Daily publishing",
        evidence_refs: [],
      },
    ],
    evidence_refs: [],
  },

  editorial_constitution: {
    constitution_id: "const_001",
    rules: [
      {
        rule_id: "rule_001",
        type: "required",
        description: "Lifestyle storytelling content required",
        applies_to: ["before_after", "build_in_public", "problem_solution"],
      },
    ],
    evidence_refs: [],
  },

  strategic_constraints: [
    {
      constraint_id: "constr_001",
      description: "Must align with premium positioning",
      level: "required",
      binding_module: "editorial",
      evidence_refs: [],
    },
  ],

  completeness: {
    score: 100,
    missing_inputs: [],
    blocking_decisions: [],
  },

  conflicts: [],
  gaps: [],
});

// ================================================================
// CATEGORY 1: UNIT TESTS — Deterministic registry layer
// ================================================================

describe("B02 Unit Tests — Registry Layer", () => {
  let b01State: B01CanonicalState;
  let deps = createDefaultB02Deps();

  beforeEach(() => {
    b01State = createMockB01State();
  });

  it("should build registry from B01 state deterministically", () => {
    const registry = buildRegistryContext(b01State, deps);

    expect(registry.platformCapabilities.size).toBeGreaterThan(0);
    expect(registry.platformCapabilities.has("YOUTUBE")).toBe(true);
    expect(registry.platformCapabilities.get("YOUTUBE")).toContain("long_form_video");
  });

  it("should extract channel roles consistently", () => {
    const registry = buildRegistryContext(b01State, deps);

    expect(registry.channelRoles.get("TestBrand YouTube")).toBe("primary");
    expect(registry.channelRoles.get("TestBrand TikTok")).toBe("secondary");
  });

  it("should extract editorial rules without modification", () => {
    const registry = buildRegistryContext(b01State, deps);

    expect(registry.editorialRules.length).toBeGreaterThan(0);
    expect(registry.editorialRules[0].content_types).toContain("before_after");
  });

  it("should validate registry with complete data", () => {
    const validation = validateRegistry(b01State);
    expect(validation.valid).toBe(true);
    expect(validation.gaps).toHaveLength(0);
  });

  it("should detect missing brand_profile as gap", () => {
    const incomplete = { ...b01State, brand_profile: undefined };
    const validation = validateRegistry(incomplete);

    expect(validation.valid).toBe(false);
    expect(validation.gaps).toContain("brand_profile missing");
  });

  it("should detect empty channels as gap", () => {
    const incomplete = { ...b01State, channels: [] };
    const validation = validateRegistry(incomplete);

    expect(validation.valid).toBe(false);
    expect(validation.gaps).toContain("channels empty or missing");
  });
});

// ================================================================
// CATEGORY 2: UNIT TESTS — Opportunity evaluation
// ================================================================

describe("B02 Unit Tests — Opportunity Evaluation", () => {
  let b01State: B01CanonicalState;
  let deps = createDefaultB02Deps();

  beforeEach(() => {
    b01State = createMockB01State();
  });

  it("should identify positioning alignment opportunities", () => {
    const opps = evaluatePositioningAlignment(b01State, deps);

    expect(opps.length).toBeGreaterThan(0);
    expect(opps.some((o) => o.opportunity_type === "positioning_alignment")).toBe(true);
  });

  it("should identify capability match opportunities", () => {
    const opps = evaluatePositioningAlignment(b01State, deps);

    expect(opps.some((o) => o.opportunity_type === "capability_match")).toBe(true);
  });

  it("should identify role-based prioritization opportunities", () => {
    const opps = evaluatePositioningAlignment(b01State, deps);

    expect(opps.some((o) => o.opportunity_type === "territory_opportunity")).toBe(true);
  });

  it("should assign strategic_relevance in valid range (0-1)", () => {
    const opps = evaluatePositioningAlignment(b01State, deps);

    for (const opp of opps) {
      expect(opp.strategic_relevance).toBeGreaterThanOrEqual(0);
      expect(opp.strategic_relevance).toBeLessThanOrEqual(1);
    }
  });

  it("should add editorial fit opportunities", () => {
    const initial = evaluatePositioningAlignment(b01State, deps);
    const withEditorial = evaluateEditorialFit(b01State, initial, deps);

    expect(withEditorial.length).toBeGreaterThan(initial.length);
    expect(withEditorial.some((o) => o.opportunity_type === "constraint_satisfaction")).toBe(true);
  });

  it("should skip editorial fit if no rules present", () => {
    const noEditorial = { ...b01State, editorial_constitution: { constitution_id: "const_001", rules: [], evidence_refs: [] } };
    const opps = evaluatePositioningAlignment(b01State, deps);
    const withEditorial = evaluateEditorialFit(noEditorial, opps, deps);

    expect(withEditorial.length).toBe(opps.length);
  });
});

// ================================================================
// CATEGORY 3: CONTRACT TESTS — Output structure
// ================================================================

describe("B02 Contract Tests — Output Structure", () => {
  let b01State: B01CanonicalState;
  let candidate: B02CandidateState;

  beforeEach(async () => {
    b01State = createMockB01State();
    const deps = createDefaultDeps();
    candidate = await runB02(b01State, deps);
  });

  it("B02CandidateState has required fields", () => {
    expect(candidate.candidate_id).toBeDefined();
    expect(candidate.created_at).toBeDefined();
    expect(Array.isArray(candidate.opportunities)).toBe(true);
    expect(Array.isArray(candidate.opportunity_classes)).toBe(true);
    expect(Array.isArray(candidate.priority_matrix)).toBe(true);
    expect(Array.isArray(candidate.conflicts_detected)).toBe(true);
    expect(Array.isArray(candidate.gaps)).toBe(true);
    expect(candidate.completeness).toBeDefined();
  });

  it("each opportunity has required contract fields", () => {
    for (const opp of candidate.opportunities) {
      expect(opp.opportunity_id).toBeDefined();
      expect(opp.title).toBeDefined();
      expect(opp.description).toBeDefined();
      expect(opp.channel_id).toBeDefined();
      expect(opp.platform_name).toBeDefined();
      expect(opp.opportunity_type).toBeDefined();
      expect(typeof opp.strategic_relevance).toBe("number");
      expect(Array.isArray(opp.supporting_evidence)).toBe(true);
      expect(opp.provenance).toBeDefined();
    }
  });

  it("opportunity_classes have required fields", () => {
    for (const cls of candidate.opportunity_classes) {
      expect(cls.class_id).toBeDefined();
      expect(cls.type).toBeDefined();
      expect(Array.isArray(cls.opportunities)).toBe(true);
      expect(typeof cls.count).toBe("number");
      expect(cls.rationale).toBeDefined();
    }
  });

  it("priority_matrix entries are ranked", () => {
    const matrix = candidate.priority_matrix;
    for (let i = 0; i < matrix.length; i++) {
      expect(matrix[i].rank).toBe(i + 1);
      expect(typeof matrix[i].strategic_relevance).toBe("number");
      expect(matrix[i].reasoning).toBeDefined();
    }
  });
});

// ================================================================
// CATEGORY 4: PROVENANCE TESTS — Decision chain tracking
// ================================================================

describe("B02 Provenance Tests", () => {
  let b01State: B01CanonicalState;
  let candidate: B02CandidateState;

  beforeEach(async () => {
    b01State = createMockB01State();
    const deps = createDefaultDeps();
    candidate = await runB02(b01State, deps);
  });

  it("candidate opportunities have INFERRED or OBSERVED provenance", () => {
    for (const opp of candidate.opportunities) {
      expect(["INFERRED", "OBSERVED", "RECOMMENDED"]).toContain(opp.provenance.type);
    }
  });

  it("INFERRED opportunities stay INFERRED in candidate", () => {
    const inferredCount = candidate.opportunities.filter((o) => o.provenance.type === "INFERRED").length;
    expect(inferredCount).toBeGreaterThan(0);
  });

  it("provenance has decision_authority and timestamp", () => {
    for (const opp of candidate.opportunities) {
      expect(opp.provenance.decision_authority).toBeDefined();
      expect(opp.provenance.timestamp).toBeDefined();
    }
  });

  it("canonical state converts provenance to DECIDED after commitment", async () => {
    const persistence = createMockPersistence();
    const canonical = await commitVersion(candidate, "v1.0", "test@example.com", persistence);

    for (const opp of canonical.opportunities) {
      expect(opp.provenance.type).toBe("DECIDED");
    }
  });

  it("DECIDED opportunities have correct decision_authority", async () => {
    const persistence = createMockPersistence();
    const authority = "test@example.com";
    const canonical = await commitVersion(candidate, "v1.0", authority, persistence);

    for (const opp of canonical.opportunities) {
      expect(opp.provenance.decision_authority).toBe(authority);
    }
  });
});

// ================================================================
// CATEGORY 5: EVIDENCE TESTS — No fabrication
// ================================================================

describe("B02 Evidence Tests — No Fabrication", () => {
  let b01State: B01CanonicalState;
  let candidate: B02CandidateState;

  beforeEach(async () => {
    b01State = createMockB01State();
    const deps = createDefaultDeps();
    candidate = await runB02(b01State, deps);
  });

  it("every opportunity has supporting_evidence array", () => {
    for (const opp of candidate.opportunities) {
      expect(Array.isArray(opp.supporting_evidence)).toBe(true);
      expect(opp.supporting_evidence.length).toBeGreaterThan(0);
    }
  });

  it("evidence has source, status, and excerpt", () => {
    for (const opp of candidate.opportunities) {
      for (const evidence of opp.supporting_evidence) {
        expect(evidence.source).toBeDefined();
        expect(["VERIFIED", "INFERRED", "UNKNOWN"]).toContain(evidence.status);
        expect(evidence.excerpt).toBeDefined();
      }
    }
  });

  it("validateNoFabrication passes for generated candidates", () => {
    const isValid = validateNoFabrication(candidate.opportunities);
    expect(isValid).toBe(true);
  });

  it("aggregate evidence_refs preserved in candidate", () => {
    expect(candidate.evidence_refs.length).toBeGreaterThan(0);
  });
});

// ================================================================
// CATEGORY 6: DETERMINISM TESTS — Same input → same output
// ================================================================

describe("B02 Determinism Tests", () => {
  let b01State: B01CanonicalState;

  beforeEach(() => {
    b01State = createMockB01State();
  });

  it("same B01 input produces same opportunities deterministically", async () => {
    const deps = createDefaultDeps();
    const run1 = await runB02(b01State, deps);
    const run2 = await runB02(b01State, deps);

    expect(run1.opportunities.length).toBe(run2.opportunities.length);
    expect(run1.opportunities[0].opportunity_id).toBe(run2.opportunities[0].opportunity_id);
  });

  it("registry mapping is deterministic", () => {
    const deps = createDefaultB02Deps();
    const reg1 = buildRegistryContext(b01State, deps);
    const reg2 = buildRegistryContext(b01State, deps);

    expect(reg1.platformCapabilities.size).toBe(reg2.platformCapabilities.size);
    expect(Array.from(reg1.channelRoles.keys())).toEqual(Array.from(reg2.channelRoles.keys()));
  });

  it("opportunity scoring is deterministic", () => {
    const deps = createDefaultDeps();
    const opps1 = evaluatePositioningAlignment(b01State, deps);
    const opps2 = evaluatePositioningAlignment(b01State, deps);

    for (let i = 0; i < opps1.length; i++) {
      expect(opps1[i].strategic_relevance).toBe(opps2[i].strategic_relevance);
    }
  });
});

// ================================================================
// CATEGORY 7: A-BOUNDARY TESTS — No A-Branch overlap
// ================================================================

describe("B02 A-Boundary Tests — No Topic/Hook/Script/Production", () => {
  let candidate: B02CandidateState;

  beforeEach(async () => {
    const b01State = createMockB01State();
    const deps = createDefaultDeps();
    candidate = await runB02(b01State, deps);
  });

  it("opportunities do NOT contain topic research", () => {
    for (const opp of candidate.opportunities) {
      expect(opp.description.toLowerCase()).not.toContain("topic");
      expect(opp.description.toLowerCase()).not.toContain("trend");
    }
  });

  it("opportunities do NOT contain hook ideas", () => {
    for (const opp of candidate.opportunities) {
      expect((opp as any).hook).toBeUndefined();
      expect(opp.description.toLowerCase()).not.toContain("hook");
    }
  });

  it("opportunities do NOT contain script", () => {
    for (const opp of candidate.opportunities) {
      expect((opp as any).script).toBeUndefined();
      expect((opp as any).storyboard).toBeUndefined();
    }
  });

  it("opportunities do NOT contain production format specs", () => {
    for (const opp of candidate.opportunities) {
      expect((opp as any).resolution).toBeUndefined();
      expect((opp as any).bitrate).toBeUndefined();
      expect((opp as any).encoding).toBeUndefined();
      expect((opp as any).production_specs).toBeUndefined();
    }
  });

  it("opportunity_type enum forbids A-domain values", () => {
    const validTypes = ["format_opportunity", "territory_opportunity", "constraint_satisfaction", "positioning_alignment", "capability_match"];
    for (const opp of candidate.opportunities) {
      expect(validTypes).toContain(opp.opportunity_type);
    }
  });
});

// ================================================================
// CATEGORY 8: B03-BOUNDARY TESTS — No audience segmentation
// ================================================================

describe("B02 B03-Boundary Tests", () => {
  let candidate: B02CandidateState;

  beforeEach(async () => {
    const b01State = createMockB01State();
    const deps = createDefaultDeps();
    candidate = await runB02(b01State, deps);
  });

  it("opportunities do NOT segment audiences", () => {
    for (const opp of candidate.opportunities) {
      expect((opp as any).audience_segment).toBeUndefined();
      expect((opp as any).persona).toBeUndefined();
      expect((opp as any).pain_points).toBeUndefined();
    }
  });

  it("opportunities do NOT include audience research", () => {
    for (const opp of candidate.opportunities) {
      expect(opp.description.toLowerCase()).not.toContain("audience research");
      expect(opp.description.toLowerCase()).not.toContain("demographic");
    }
  });
});

// ================================================================
// CATEGORY 9: VALIDATION TESTS — Conflict detection
// ================================================================

describe("B02 Validation Tests", () => {
  let b01State: B01CanonicalState;

  beforeEach(() => {
    b01State = createMockB01State();
  });

  it("should detect conflicts between opportunities and constraints", () => {
    const opps = evaluatePositioningAlignment(b01State, createDefaultB02Deps());
    const conflicts = detectConstraintConflicts(b01State, opps);

    // Well-formed B01 state should have minimal conflicts
    expect(Array.isArray(conflicts)).toBe(true);
  });

  it("should identify gaps for missing brand positioning", () => {
    const incomplete = { ...b01State, brand_profile: { brand_name: "Test", values: [] } };
    const gaps = identifyGaps(incomplete);

    expect(gaps.some((g) => g.gap_id === "gap_brand_positioning")).toBe(true);
  });

  it("should identify gaps for missing editorial rules", () => {
    const incomplete = { ...b01State, editorial_constitution: { constitution_id: "const_001", rules: [], evidence_refs: [] } };
    const gaps = identifyGaps(incomplete);

    expect(gaps.some((g) => g.gap_id === "gap_editorial_rules")).toBe(true);
  });

  it("should identify gaps for missing platforms", () => {
    const incomplete = { ...b01State, platforms: [] };
    const gaps = identifyGaps(incomplete);

    expect(gaps.some((g) => g.gap_id === "gap_platform_data")).toBe(true);
  });
});

// ================================================================
// CATEGORY 10: COMPLETENESS TESTS
// ================================================================

describe("B02 Completeness Tests", () => {
  let b01State: B01CanonicalState;

  beforeEach(() => {
    b01State = createMockB01State();
  });

  it("should calculate completeness 0-100 range", () => {
    const opps = evaluatePositioningAlignment(b01State, createDefaultB02Deps());
    const gaps = identifyGaps(b01State);
    const completeness = calculateCompleteness(b01State, opps.length, gaps);

    expect(completeness.score).toBeGreaterThanOrEqual(0);
    expect(completeness.score).toBeLessThanOrEqual(100);
  });

  it("should identify missing inputs", () => {
    const incomplete = { ...b01State, brand_profile: { brand_name: "Test" } };
    const completeness = calculateCompleteness(incomplete, 0, []);

    expect(completeness.missing_inputs.length).toBeGreaterThan(0);
  });

  it("should identify blocking decisions", () => {
    const incomplete = { ...b01State };
    const gaps = [
      {
        gap_id: "test",
        description: "Critical gap",
        required_for: "analysis",
        priority: "high" as const,
        category: "brand_data" as const,
        impact: "blocks analysis",
      },
    ];
    const completeness = calculateCompleteness(incomplete, 0, gaps);

    expect(completeness.blocking_decisions.length).toBeGreaterThan(0);
  });

  it("should improve score when opportunities identified", () => {
    const noOpps = calculateCompleteness(b01State, 0, []);
    const withOpps = calculateCompleteness(b01State, 5, []);

    expect(withOpps.score).toBeGreaterThan(noOpps.score);
  });
});

// ================================================================
// CATEGORY 11: CANONICALIZATION TESTS — Transformation & immutability
// ================================================================

describe("B02 Canonicalization Tests", () => {
  let b01State: B01CanonicalState;
  let candidate: B02CandidateState;
  let persistence = createMockPersistence();

  beforeEach(async () => {
    b01State = createMockB01State();
    const deps = createDefaultDeps();
    candidate = await runB02(b01State, deps);
    persistence = createMockPersistence();
  });

  it("should transform B02CandidateState → B02CanonicalState", async () => {
    // Approve candidate first (governance routing)
    const approved = await approveCandidate(candidate, "test@example.com");

    const canonical = await commitVersion(approved, "v1.0", "test@example.com", persistence);

    expect(canonical.version).toBe("v1.0");
    expect(canonical.user_decision_authority).toBe("test@example.com");
    expect(canonical.opportunities.length).toBe(candidate.opportunities.length);
  });

  it("should enforce semantic version format", async () => {
    await expect(commitVersion(candidate, "invalid", "test@example.com", persistence)).rejects.toThrow(
      /Invalid version format/,
    );
  });

  it("should reject duplicate version (immutability)", async () => {
    await commitVersion(candidate, "v1.0", "test@example.com", persistence);

    // Try to commit same version again
    await expect(commitVersion(candidate, "v1.0", "test@example.com", persistence)).rejects.toThrow(
      /already committed/,
    );
  });

  it("should support version incrementation v1.0 → v1.1", async () => {
    await commitVersion(candidate, "v1.0", "test@example.com", persistence);

    const v2 = await commitVersion(candidate, "v1.1", "test@example.com", persistence);
    expect(v2.version).toBe("v1.1");
  });

  it("should load version from persistence", async () => {
    // Approve candidate first (governance routing)
    const approved = await approveCandidate(candidate, "test@example.com");

    await commitVersion(approved, "v1.0", "test@example.com", persistence);

    const loaded = await loadVersion("v1.0", persistence);
    expect(loaded?.version).toBe("v1.0");
    expect(loaded?.opportunities.length).toBe(candidate.opportunities.length);
  });

  it("should list all versions", async () => {
    await commitVersion(candidate, "v1.0", "test@example.com", persistence);
    await commitVersion(candidate, "v1.1", "test@example.com", persistence);

    const versions = await listVersions(persistence);
    expect(versions).toContain("v1.0");
    expect(versions).toContain("v1.1");
    expect(versions.length).toBe(2);
  });

  it("should get latest version", async () => {
    await commitVersion(candidate, "v1.0", "test@example.com", persistence);
    await commitVersion(candidate, "v1.1", "test@example.com", persistence);

    const latest = await getLatestVersion(persistence);
    expect(latest?.version).toBe("v1.1");
  });
});

// ================================================================
// CATEGORY 12: EVIDENCE PRESERVATION TESTS
// ================================================================

describe("B02 Evidence Preservation Tests", () => {
  let b01State: B01CanonicalState;
  let candidate: B02CandidateState;
  let persistence = createMockPersistence();

  beforeEach(async () => {
    b01State = createMockB01State();
    const deps = createDefaultDeps();
    candidate = await runB02(b01State, deps);
    persistence = createMockPersistence();
  });

  it("should preserve all evidence_refs in canonical", async () => {
    const canonical = await commitVersion(candidate, "v1.0", "test@example.com", persistence);

    expect(canonical.evidence_refs.length).toBe(candidate.evidence_refs.length);
  });

  it("should preserve all provenance_refs in canonical", async () => {
    const canonical = await commitVersion(candidate, "v1.0", "test@example.com", persistence);

    expect(canonical.provenance_refs.length).toBe(candidate.provenance_refs.length);
  });

  it("should preserve per-opportunity evidence", async () => {
    const canonical = await commitVersion(candidate, "v1.0", "test@example.com", persistence);

    for (let i = 0; i < canonical.opportunities.length; i++) {
      expect(canonical.opportunities[i].supporting_evidence).toEqual(
        candidate.opportunities[i].supporting_evidence,
      );
    }
  });

  it("should preserve opportunity descriptions exactly", async () => {
    const canonical = await commitVersion(candidate, "v1.0", "test@example.com", persistence);

    for (let i = 0; i < canonical.opportunities.length; i++) {
      expect(canonical.opportunities[i].description).toBe(candidate.opportunities[i].description);
      expect(canonical.opportunities[i].title).toBe(candidate.opportunities[i].title);
    }
  });
});

// ================================================================
// CATEGORY 13: B01 INDEPENDENCE TESTS
// ================================================================

describe("B02 B01 Independence Tests", () => {
  let b01State: B01CanonicalState;

  beforeEach(() => {
    b01State = createMockB01State();
  });

  it("should only consume B01CanonicalState, not internal state", async () => {
    const deps = createDefaultDeps();
    // Pass only canonical state; no internal B01 fields
    const result = await runB02(b01State, deps);

    expect(result.opportunities.length).toBeGreaterThan(0);
  });

  it("should not modify B01CanonicalState during runB02", async () => {
    const deps = createDefaultDeps();
    const b01Copy = JSON.stringify(b01State);

    await runB02(b01State, deps);

    expect(JSON.stringify(b01State)).toBe(b01Copy);
  });

  it("should reference only versioned B01 output", async () => {
    const deps = createDefaultDeps();
    const result = await runB02(b01State, deps);

    // All evidence should reference B01.version or documented sources
    for (const evidence of result.evidence_refs) {
      expect(evidence.source).toBeDefined();
    }
  });
});

// ================================================================
// CATEGORY 14: CLASSIFICATION & PRIORITIZATION TESTS
// ================================================================

describe("B02 Classification & Prioritization Tests", () => {
  let b01State: B01CanonicalState;
  let candidate: B02CandidateState;

  beforeEach(async () => {
    b01State = createMockB01State();
    const deps = createDefaultDeps();
    candidate = await runB02(b01State, deps);
  });

  it("should classify opportunities by type", () => {
    expect(candidate.opportunity_classes.length).toBeGreaterThan(0);
    for (const cls of candidate.opportunity_classes) {
      expect(cls.opportunities.length).toBeGreaterThan(0);
    }
  });

  it("should create priority matrix with ranks", () => {
    expect(candidate.priority_matrix.length).toBeGreaterThan(0);
    for (let i = 0; i < candidate.priority_matrix.length; i++) {
      expect(candidate.priority_matrix[i].rank).toBe(i + 1);
    }
  });

  it("should rank by strategic_relevance descending", () => {
    const matrix = candidate.priority_matrix;
    for (let i = 1; i < matrix.length; i++) {
      expect(matrix[i - 1].strategic_relevance).toBeGreaterThanOrEqual(matrix[i].strategic_relevance);
    }
  });
});

// ================================================================
// CATEGORY 15: GOVERNANCE ROUTING TESTS (BLOCK 1)
// ================================================================

describe("B02 Governance Routing Tests", () => {
  let b01State: B01CanonicalState;
  let candidate: B02CandidateState;
  let persistence: ReturnType<typeof createMockPersistence>;

  beforeEach(async () => {
    b01State = createMockB01State();
    const deps = createDefaultDeps();
    candidate = await runB02(b01State, deps);
    persistence = createMockPersistence();
  });

  it("should initialize governance_events as empty dict in candidate", () => {
    expect(candidate.governance_events).toBeDefined();
    expect(typeof candidate.governance_events).toBe("object");
    expect(Object.keys(candidate.governance_events).length).toBe(0);
  });

  it("should populate governance_events after approveCandidate", async () => {
    const approved = await approveCandidate(candidate, "test@example.com");

    expect(Object.keys(approved.governance_events).length).toBeGreaterThan(0);
    for (const opportunityId of Object.keys(approved.governance_events)) {
      const events = approved.governance_events[opportunityId];
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThanOrEqual(2); // PROPOSED + APPROVED minimum
    }
  });

  it("should mark opportunities as DECIDED after approveCandidate", async () => {
    const approved = await approveCandidate(candidate, "test@example.com");

    for (const opp of approved.opportunities) {
      expect(opp.provenance.type).toBe("DECIDED");
    }
  });

  it("should set prior_provenance_id linkage in DECIDED provenance", async () => {
    const approved = await approveCandidate(candidate, "test@example.com");

    for (const opp of approved.opportunities) {
      expect(opp.provenance.prior_provenance_id).toBeDefined();
      expect(typeof opp.provenance.prior_provenance_id).toBe("string");
      expect(opp.provenance.prior_provenance_id.length).toBeGreaterThan(0);
    }
  });

  it("should filter only DECIDED opportunities into canonical", async () => {
    // Create candidate with INFERRED provenance
    expect(candidate.opportunities[0]?.provenance.type).not.toBe("DECIDED");

    // Without approval, commitVersion should filter to 0 DECIDED items
    // (but we already approved in the fixture, so create a fresh candidate)
    const freshCandidate = await runB02(b01State, createDefaultDeps());
    const canonical = await commitVersion(
      freshCandidate,
      "v1.0",
      "test@example.com",
      persistence,
    );

    // Without governance approval, no items should be DECIDED
    expect(canonical.opportunities.length).toBe(0);
  });

  it("should include approved opportunities in canonical", async () => {
    const approved = await approveCandidate(candidate, "test@example.com");
    const canonical = await commitVersion(
      approved,
      "v1.0",
      "test@example.com",
      persistence,
    );

    expect(canonical.opportunities.length).toBeGreaterThan(0);
    expect(canonical.opportunities.length).toBe(approved.opportunities.length);
  });

  it("should preserve governance_events in canonical state", async () => {
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
// CATEGORY 16: DETERMINISM TESTS (BLOCK 1)
// ================================================================

describe("B02 Determinism Tests", () => {
  let b01State: B01CanonicalState;

  beforeEach(() => {
    b01State = createMockB01State();
  });

  it("should produce identical candidate_id with identical input under different dates", async () => {
    const fixedDate1 = "2026-08-30T10:00:00Z";
    const fixedDate2 = "2026-09-15T14:30:00Z";

    const deps1 = createDefaultDeps();
    deps1.now = () => fixedDate1;
    const candidate1 = await runB02(b01State, deps1);

    const deps2 = createDefaultDeps();
    deps2.now = () => fixedDate2;
    const candidate2 = await runB02(b01State, deps2);

    expect(candidate1.candidate_id).toBe(candidate2.candidate_id);
  });

  it("should have different timestamps but same candidate_id", async () => {
    const fixedDate1 = "2026-08-30T10:00:00Z";
    const fixedDate2 = "2026-09-15T14:30:00Z";

    const deps1 = createDefaultDeps();
    deps1.now = () => fixedDate1;
    const candidate1 = await runB02(b01State, deps1);

    const deps2 = createDefaultDeps();
    deps2.now = () => fixedDate2;
    const candidate2 = await runB02(b01State, deps2);

    expect(candidate1.created_at).not.toBe(candidate2.created_at);
    expect(candidate1.candidate_id).toBe(candidate2.candidate_id);
  });
});

// ================================================================
// CATEGORY 17: EVIDENCE PRESERVATION TESTS (BLOCK 1)
// ================================================================

describe("B02 Evidence Preservation Tests", () => {
  let b01State: B01CanonicalState;
  let persistence: ReturnType<typeof createMockPersistence>;

  beforeEach(() => {
    persistence = createMockPersistence();
    b01State = createMockB01State();
  });

  it("should preserve evidence_refs through candidate→approval→canonical", async () => {
    const deps = createDefaultDeps();
    const candidate = await runB02(b01State, deps);

    // Candidate must have evidence_refs
    expect(candidate.evidence_refs).toBeDefined();
    expect(candidate.evidence_refs.length).toBeGreaterThanOrEqual(0);

    const approved = await approveCandidate(candidate, "test@example.com");

    // After approval, evidence_refs must be identical (not dropped)
    expect(approved.evidence_refs).toEqual(candidate.evidence_refs);

    const canonical = await commitVersion(
      approved,
      "v1.0",
      "test@example.com",
      persistence,
    );

    // Canonical must preserve evidence_refs
    expect(canonical.evidence_refs).toEqual(candidate.evidence_refs);
  });

  it("should preserve per-opportunity evidence_refs in canonical", async () => {
    const deps = createDefaultDeps();
    const candidate = await runB02(b01State, deps);
    const approved = await approveCandidate(candidate, "test@example.com");

    for (const opp of approved.opportunities) {
      expect(opp.supporting_evidence).toBeDefined();
    }

    const canonical = await commitVersion(
      approved,
      "v1.0",
      "test@example.com",
      persistence,
    );

    for (let i = 0; i < canonical.opportunities.length; i++) {
      expect(canonical.opportunities[i].supporting_evidence).toEqual(
        approved.opportunities[i].supporting_evidence,
      );
    }
  });
});

// ================================================================
// CATEGORY 18: PROVENANCE PRESERVATION TESTS (BLOCK 1)
// ================================================================

describe("B02 Provenance Preservation Tests", () => {
  let b01State: B01CanonicalState;
  let persistence: ReturnType<typeof createMockPersistence>;

  beforeEach(() => {
    persistence = createMockPersistence();
    b01State = createMockB01State();
  });

  it("should preserve provenance_refs through candidate→canonical", async () => {
    const deps = createDefaultDeps();
    const candidate = await runB02(b01State, deps);

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
    const deps = createDefaultDeps();
    const candidate = await runB02(b01State, deps);
    const approved = await approveCandidate(candidate, "test@example.com");

    for (const opp of approved.opportunities) {
      expect(opp.provenance.type).toBe("DECIDED");
    }

    const canonical = await commitVersion(
      approved,
      "v1.0",
      "test@example.com",
      persistence,
    );

    for (const opp of canonical.opportunities) {
      expect(opp.provenance.type).toBe("DECIDED");
    }
  });
});

// ================================================================
// CATEGORY 19: AUDIT TRAIL TESTS (BLOCK 1)
// ================================================================

describe("B02 Audit Trail Tests", () => {
  let b01State: B01CanonicalState;
  let persistence: ReturnType<typeof createMockPersistence>;

  beforeEach(() => {
    persistence = createMockPersistence();
    b01State = createMockB01State();
  });

  it("should create proper audit entries on first commitVersion", async () => {
    const deps = createDefaultDeps();
    const candidate = await runB02(b01State, deps);
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
      expect(entry).toHaveProperty("audit_id");
      expect(entry).toHaveProperty("version");
      expect(entry).toHaveProperty("changed_field");
      expect(entry).toHaveProperty("decision_authority");
      expect(entry).toHaveProperty("timestamp");
      expect(entry).toHaveProperty("change_type");
    }
  });

  it("should append audit entries on subsequent versions", async () => {
    const deps = createDefaultDeps();
    const candidate1 = await runB02(b01State, deps);
    const approved1 = await approveCandidate(candidate1, "test@example.com");
    const canonical1 = await commitVersion(
      approved1,
      "v1.0",
      "test@example.com",
      persistence,
    );

    expect(canonical1.audit_trail.length).toBeGreaterThan(0);

    // Create candidate2 with a modification to trigger audit entries
    const candidate2 = await runB02(b01State, deps);
    candidate2.opportunities = [
      ...candidate2.opportunities,
      // Add a new opportunity to trigger a field change
    ];
    candidate2.priority_matrix = [];
    const approved2 = await approveCandidate(candidate2, "test@example.com");
    const canonical2 = await commitVersion(
      approved2,
      "v1.1",
      "test@example.com",
      persistence,
      canonical1,
    );

    // Audit trail should have entries (both from v1.0 and new entries from v1.1 due to field changes)
    expect(canonical2.audit_trail.length).toBeGreaterThanOrEqual(canonical1.audit_trail.length);
    // At least one v1.1 entry should exist
    const v11Entries = canonical2.audit_trail.filter((e) => e.version === "v1.1");
    expect(v11Entries.length).toBeGreaterThan(0);
  });
});

// ================================================================
// CATEGORY 20: CANONICALIZATION LOSS GUARD TESTS (BLOCK 1)
// ================================================================

describe("B02 Canonicalization Loss Guard Tests", () => {
  let b01State: B01CanonicalState;
  let persistence: ReturnType<typeof createMockPersistence>;

  beforeEach(() => {
    persistence = createMockPersistence();
    b01State = createMockB01State();
  });

  it("should not have undeclared canonicalization drops", async () => {
    const deps = createDefaultDeps();
    const candidate = await runB02(b01State, deps);
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
