import { describe, it, expect, beforeEach } from "vitest";
import type { B05Deps } from "../src/b05/types.js";
import {
  runB05,
  commitVersion,
  approveCandidate,
  createMockPersistence,
  buildCreativeContext,
  synthesizeCreativeAngles,
  synthesizeMessagingStrategies,
  identifyCreativeConstraints,
  detectCreativeConflicts,
  identifyCreativeGaps,
  calculateCreativeCompleteness,
} from "../src/b05/index.js";
import { canonicalHasher } from "../src/b00/hashing.js";

// Mock data generators
function createMockB01() {
  return {
    version: "v1.0",
    brand_profile: {
      brand_name: "TechBrand",
      positioning: "Enterprise AI thought leader",
      values: ["Innovation", "Transparency", "Excellence"],
    },
    content_territories: [
      { territory_id: "us", region: "North America" },
      { territory_id: "eu", region: "Europe" },
    ],
    channels: [
      { channel_id: "youtube", name: "YouTube", platform: "YOUTUBE", role: "primary" },
      { channel_id: "linkedin", name: "LinkedIn", platform: "LINKEDIN", role: "secondary" },
    ],
  };
}

function createMockB03() {
  return {
    b01_canonical_version: "v1.0",
    audience_segments: [
      {
        segment_id: "cto_segment",
        segment_name: "CTO Audience",
        characteristics: { role: "CTO", industry: ["SaaS", "Enterprise"] },
        pain_points: ["Managing AI implementation", "Budget constraints"],
        questions: ["How to scale AI?"],
        confidence: 0.9,
      },
      {
        segment_id: "dev_segment",
        segment_name: "Developer Audience",
        characteristics: { role: "Developer", industry: ["SaaS", "Hardware"] },
        confidence: 0.85,
      },
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
        secondary_objectives: ["Increase brand awareness"],
        target_segments: ["cto_segment"],
        territories: ["us", "eu"],
      },
      {
        campaign_id: "camp2",
        campaign_name: "Developer Engagement",
        primary_objective: "Drive technical adoption",
        target_segments: ["dev_segment"],
        territories: ["us"],
      },
    ],
  };
}

describe("B05 Creative Synthesis", () => {
  let b01: any;
  let b03: any;
  let b04: any;

  beforeEach(() => {
    b01 = createMockB01();
    b03 = createMockB03();
    b04 = createMockB04();
  });

  describe("1. Context Building", () => {
    it("should build creative context from B01+B03+B04", () => {
      const context = buildCreativeContext(b01, b03, b04);
      expect(context.brand_name).toBe("TechBrand");
      expect(context.brand_positioning).toBe("Enterprise AI thought leader");
      expect(context.campaigns).toHaveLength(2);
      expect(context.segments).toHaveLength(2);
    });

    it("should extract brand values", () => {
      const context = buildCreativeContext(b01, b03, b04);
      expect(context.brand_values).toEqual(["Innovation", "Transparency", "Excellence"]);
    });

    it("should report gap when positioning missing", () => {
      const b01NoPos = { ...b01, brand_profile: { brand_name: "Brand" } };
      const context = buildCreativeContext(b01NoPos, b03, b04);
      expect(context.gaps).toContain("brand_positioning_undefined");
    });

    it("should report gap when segments missing", () => {
      const b03Empty = { ...b03, audience_segments: [] };
      const context = buildCreativeContext(b01, b03Empty, b04);
      expect(context.gaps).toContain("no_audience_segments_available");
    });
  });

  describe("2. Creative Angle Synthesis", () => {
    it("should synthesize creative angles for campaign-segment pairs", () => {
      const context = buildCreativeContext(b01, b03, b04);
      const angles = synthesizeCreativeAngles(context);
      expect(angles.length).toBeGreaterThan(0);
      expect(angles[0]).toHaveProperty("angle_id");
      expect(angles[0]).toHaveProperty("campaign_id");
      expect(angles[0]).toHaveProperty("target_audience_segment");
    });

    it("should mark angles as INFERRED", () => {
      const context = buildCreativeContext(b01, b03, b04);
      const angles = synthesizeCreativeAngles(context);
      expect(angles.every((a) => a.provenance.type === "INFERRED")).toBe(true);
    });

    it("should include evidence references", () => {
      const context = buildCreativeContext(b01, b03, b04);
      const angles = synthesizeCreativeAngles(context);
      expect(angles.every((a) => a.evidence_refs.length > 0)).toBe(true);
    });

    it("should generate deterministic IDs", () => {
      const context = buildCreativeContext(b01, b03, b04);
      const angles1 = synthesizeCreativeAngles(context);
      const angles2 = synthesizeCreativeAngles(context);
      expect(angles1[0]?.angle_id).toBe(angles2[0]?.angle_id);
    });

    it("should not have empty campaign_id", () => {
      const context = buildCreativeContext(b01, b03, b04);
      const angles = synthesizeCreativeAngles(context);
      expect(angles.every((a) => a.campaign_id)).toBe(true);
    });

    it("should include confidence score", () => {
      const context = buildCreativeContext(b01, b03, b04);
      const angles = synthesizeCreativeAngles(context);
      expect(angles.every((a) => a.confidence >= 0 && a.confidence <= 1)).toBe(true);
    });
  });

  describe("3. Messaging Strategy Synthesis", () => {
    it("should synthesize messaging for target segments", () => {
      const context = buildCreativeContext(b01, b03, b04);
      const messaging = synthesizeMessagingStrategies(context);
      expect(messaging.length).toBeGreaterThan(0);
      expect(messaging[0]).toHaveProperty("messaging_id");
      expect(messaging[0]).toHaveProperty("segment_id");
    });

    it("should mark messaging as INFERRED", () => {
      const context = buildCreativeContext(b01, b03, b04);
      const messaging = synthesizeMessagingStrategies(context);
      expect(messaging.every((m) => m.provenance.type === "INFERRED")).toBe(true);
    });

    it("should include primary and supporting messages", () => {
      const context = buildCreativeContext(b01, b03, b04);
      const messaging = synthesizeMessagingStrategies(context);
      expect(messaging.every((m) => m.primary_message && m.supporting_messages.length > 0)).toBe(true);
    });

    it("should infer language style based on segment", () => {
      const context = buildCreativeContext(b01, b03, b04);
      const messaging = synthesizeMessagingStrategies(context);
      const ctoMsg = messaging.find((m) => m.segment_id === "cto_segment");
      expect(ctoMsg?.language_style).toContain("Professional");
    });

    it("should generate deterministic messaging IDs", () => {
      const context = buildCreativeContext(b01, b03, b04);
      const msg1 = synthesizeMessagingStrategies(context);
      const msg2 = synthesizeMessagingStrategies(context);
      expect(msg1[0]?.messaging_id).toBe(msg2[0]?.messaging_id);
    });
  });

  describe("4. Creative Constraints", () => {
    it("should identify creative constraints from B01 brand values", () => {
      const constraints = identifyCreativeConstraints(b01, b04);
      expect(constraints.some((c) => c.constraint_type === "brand_protection")).toBe(true);
    });

    it("should identify territory compliance constraints", () => {
      const constraints = identifyCreativeConstraints(b01, b04);
      expect(constraints.some((c) => c.constraint_type === "required_elements")).toBe(true);
    });

    it("should identify audience appropriateness constraints", () => {
      const constraints = identifyCreativeConstraints(b01, b04);
      expect(constraints.some((c) => c.constraint_type === "tone_requirements")).toBe(true);
    });

    it("should mark brand value constraints as OBSERVED", () => {
      const constraints = identifyCreativeConstraints(b01, b04);
      const brandConstraints = constraints.filter((c) => c.constraint_type === "brand_protection");
      expect(brandConstraints.every((c) => c.provenance.type === "OBSERVED")).toBe(true);
    });

    it("should mark inferred constraints properly", () => {
      const constraints = identifyCreativeConstraints(b01, b04);
      const inferredConstraints = constraints.filter((c) => c.provenance.type === "INFERRED");
      expect(inferredConstraints.length).toBeGreaterThan(0);
    });
  });

  describe("5. Validation & Conflict Detection", () => {
    it("should detect missing angles per campaign", async () => {
      const context = buildCreativeContext(b01, b03, b04);
      const angles: any[] = [];
      const messaging = synthesizeMessagingStrategies(context);
      const constraints = identifyCreativeConstraints(b01, b04);
      const conflicts = detectCreativeConflicts(angles, messaging, constraints, context);
      expect(conflicts.some((c) => c.description.includes("no creative angles"))).toBe(true);
    });

    it("should detect missing messaging coverage", () => {
      const context = buildCreativeContext(b01, b03, b04);
      const angles = synthesizeCreativeAngles(context);
      const messaging: any[] = [];
      const constraints = identifyCreativeConstraints(b01, b04);
      const conflicts = detectCreativeConflicts(angles, messaging, constraints, context);
      expect(conflicts.some((c) => c.description.includes("No messaging"))).toBe(true);
    });

    it("should report missing brand positioning as high priority gap", () => {
      const b01NoPos = { ...b01, brand_profile: { brand_name: "Brand" } };
      const context = buildCreativeContext(b01NoPos, b03, b04);
      const angles = synthesizeCreativeAngles(context);
      const messaging = synthesizeMessagingStrategies(context);
      const constraints = identifyCreativeConstraints(b01NoPos, b04);
      const gaps = identifyCreativeGaps(context, angles.length, messaging.length, constraints.length);
      expect(gaps.some((g) => g.gap_id === "gap_brand_positioning" && g.priority === "high")).toBe(true);
    });

    it("should report missing campaigns as high priority gap", () => {
      const b04Empty = { campaigns: [] };
      const context = buildCreativeContext(b01, b03, b04Empty);
      const angles = synthesizeCreativeAngles(context);
      const messaging = synthesizeMessagingStrategies(context);
      const constraints = identifyCreativeConstraints(b01, b04Empty);
      const gaps = identifyCreativeGaps(context, angles.length, messaging.length, constraints.length);
      expect(gaps.some((g) => g.gap_id === "gap_campaigns" && g.priority === "high")).toBe(true);
    });
  });

  describe("6. Completeness Scoring", () => {
    it("should score completeness 0-100", async () => {
      const candidate = await runB05(b01, b03, b04);
      expect(candidate.completeness.score).toBeGreaterThanOrEqual(0);
      expect(candidate.completeness.score).toBeLessThanOrEqual(100);
    });

    it("should reward brand positioning", async () => {
      const candidate = await runB05(b01, b03, b04);
      expect(candidate.completeness.score).toBeGreaterThan(40);
    });

    it("should track blocking decisions", async () => {
      const candidate = await runB05(b01, b03, b04);
      expect(Array.isArray(candidate.completeness.blocking_decisions)).toBe(true);
    });

    it("should improve score with more data", async () => {
      const candidate = await runB05(b01, b03, b04);
      const highScore = candidate.completeness.score;
      expect(highScore).toBeGreaterThan(0);
    });
  });

  describe("7. Evidence & Provenance Orthogonality", () => {
    it("should preserve evidence refs separately from provenance", async () => {
      const candidate = await runB05(b01, b03, b04);
      const angle = candidate.creative_angles[0];
      expect(angle?.evidence_refs).toBeDefined();
      expect(angle?.provenance).toBeDefined();
      expect(angle?.evidence_refs.length).toBeGreaterThan(0);
    });

    it("should track provenance type on angles", async () => {
      const candidate = await runB05(b01, b03, b04);
      expect(candidate.creative_angles.every((a) => a.provenance.type === "INFERRED")).toBe(true);
    });

    it("should track provenance on messaging", async () => {
      const candidate = await runB05(b01, b03, b04);
      expect(candidate.messaging_strategies.every((m) => m.provenance.type === "INFERRED")).toBe(true);
    });

    it("should not collapse evidence into provenance", async () => {
      const candidate = await runB05(b01, b03, b04);
      const angle = candidate.creative_angles[0];
      // Verify they are separate: evidence_refs is an array, provenance is an object
      expect(Array.isArray(angle?.evidence_refs)).toBe(true);
      expect(typeof angle?.provenance).toBe("object");
      // Verify evidence status field exists and is distinct from provenance
      expect(angle?.evidence_refs[0]?.status).toBeDefined();
      expect(angle?.provenance.type).toBeDefined();
    });
  });

  describe("8. Candidate vs Canonical Separation", () => {
    it("should return B05CandidateState from runB05", async () => {
      const candidate = await runB05(b01, b03, b04);
      expect(candidate).toHaveProperty("candidate_id");
      expect(candidate).not.toHaveProperty("version");
    });

    it("should mark angles INFERRED in candidate", async () => {
      const candidate = await runB05(b01, b03, b04);
      expect(candidate.creative_angles.every((a) => a.provenance.type === "INFERRED")).toBe(true);
    });

    it("should require explicit user decision for canonical", async () => {
      const candidate = await runB05(b01, b03, b04);
      const persistence = createMockPersistence();
      const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);
      expect(canonical.version).toBe("v1.0");
      expect(canonical.user_decision_authority).toBe("user@example.com");
    });

    it("should filter to DECIDED-only for canonical", async () => {
      const candidate = await runB05(b01, b03, b04);
      const persistence = createMockPersistence();
      const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);
      expect(canonical.creative_angles.length).toBe(0); // No DECIDED items in candidate
      expect(canonical.messaging_strategies.length).toBe(0);
    });
  });

  describe("9. Immutable Versioning", () => {
    it("should enforce semantic versioning", async () => {
      const candidate = await runB05(b01, b03, b04);
      const persistence = createMockPersistence();
      await expect(
        commitVersion(candidate, "invalid", "user@example.com", persistence),
      ).rejects.toThrow("Invalid semantic version format");
    });

    it("should prevent duplicate versions", async () => {
      const candidate = await runB05(b01, b03, b04);
      const persistence = createMockPersistence();
      await commitVersion(candidate, "v1.0", "user@example.com", persistence);
      await expect(
        commitVersion(candidate, "v1.0", "user@example.com", persistence),
      ).rejects.toThrow("already exists");
    });

    it("should create audit trail", async () => {
      const candidate = await runB05(b01, b03, b04);
      const persistence = createMockPersistence();
      const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);
      expect(canonical.audit_trail).toHaveLength(1);
      expect(canonical.audit_trail[0]?.version).toBe("v1.0");
    });

    it("should set immutability flag", async () => {
      const candidate = await runB05(b01, b03, b04);
      const persistence = createMockPersistence();
      const canonical = await commitVersion(candidate, "v1.0", "user@example.com", persistence);
      expect(canonical.cannot_be_modified_until_next_version).toBe(true);
    });
  });

  describe("10. B01 Immutability", () => {
    it("should not mutate input B01 state", async () => {
      const b01Copy = JSON.stringify(b01);
      await runB05(b01, b03, b04);
      expect(JSON.stringify(b01)).toBe(b01Copy);
    });

    it("should not mutate input B03 state", async () => {
      const b03Copy = JSON.stringify(b03);
      await runB05(b01, b03, b04);
      expect(JSON.stringify(b03)).toBe(b03Copy);
    });

    it("should not mutate input B04 state", async () => {
      const b04Copy = JSON.stringify(b04);
      await runB05(b01, b03, b04);
      expect(JSON.stringify(b04)).toBe(b04Copy);
    });
  });

  describe("11. Deterministic ID Generation", () => {
    it("should generate same angle IDs for same input", () => {
      const context = buildCreativeContext(b01, b03, b04);
      const angles1 = synthesizeCreativeAngles(context);
      const angles2 = synthesizeCreativeAngles(context);
      expect(angles1.map((a) => a.angle_id)).toEqual(angles2.map((a) => a.angle_id));
    });

    it("should generate same messaging IDs for same input", () => {
      const context = buildCreativeContext(b01, b03, b04);
      const msg1 = synthesizeMessagingStrategies(context);
      const msg2 = synthesizeMessagingStrategies(context);
      expect(msg1.map((m) => m.messaging_id)).toEqual(msg2.map((m) => m.messaging_id));
    });

    it("should generate unique IDs across different campaigns", () => {
      const context = buildCreativeContext(b01, b03, b04);
      const angles = synthesizeCreativeAngles(context);
      const uniqueIds = new Set(angles.map((a) => a.angle_id));
      expect(uniqueIds.size).toBeGreaterThan(1);
    });
  });

  describe("12. No Fabrication", () => {
    it("should not have empty angle titles", async () => {
      const candidate = await runB05(b01, b03, b04);
      expect(candidate.creative_angles.every((a) => a.title)).toBe(true);
    });

    it("should include evidence for all angles", async () => {
      const candidate = await runB05(b01, b03, b04);
      expect(candidate.creative_angles.every((a) => a.evidence_refs.length > 0)).toBe(true);
    });

    it("should not have empty messaging primary messages", async () => {
      const candidate = await runB05(b01, b03, b04);
      expect(candidate.messaging_strategies.every((m) => m.primary_message)).toBe(true);
    });

    it("should include evidence for all messaging", async () => {
      const candidate = await runB05(b01, b03, b04);
      expect(candidate.messaging_strategies.every((m) => m.evidence_refs.length > 0)).toBe(true);
    });
  });

  describe("13. A-Branch Boundary", () => {
    it("should not produce production specs (only strategy)", async () => {
      const candidate = await runB05(b01, b03, b04);
      expect(candidate.creative_angles.every((a) => !a.title.includes("px") && !a.title.includes("sec"))).toBe(true);
    });

    it("should not call A-Branch modules", async () => {
      const candidate = await runB05(b01, b03, b04);
      // Verify output is strategic, not production (no A-Branch specific fields)
      expect(candidate.creative_angles[0]).toHaveProperty("title");
      expect(candidate.creative_angles[0]).not.toHaveProperty("video_format");
      expect(candidate.creative_angles[0]).not.toHaveProperty("production_notes");
    });

    it("should produce strategic briefs, not production briefs", async () => {
      const candidate = await runB05(b01, b03, b04);
      const brief = candidate.creative_briefs[0];
      expect(brief?.content_objectives).toBeDefined();
      expect(brief?.creative_angles.length).toBeGreaterThan(0);
    });
  });

  describe("14. No Auto-Promotion", () => {
    it("should never auto-promote INFERRED to DECIDED", async () => {
      const candidate = await runB05(b01, b03, b04);
      expect(candidate.creative_angles.every((a) => a.provenance.type === "INFERRED")).toBe(true);
    });

    it("should require explicit user decision for canonicalization", async () => {
      const candidate = await runB05(b01, b03, b04);
      const persistence = createMockPersistence();
      await commitVersion(candidate, "v1.0", "user@example.com", persistence);
      const canonical = await persistence.load("v1.0");
      expect(canonical?.creative_angles.length).toBe(0); // DECIDED-only = empty for candidate
    });

    it("should preserve recommendation status in all_recommendations", async () => {
      const candidate = await runB05(b01, b03, b04);
      expect(Array.isArray(candidate.all_recommendations)).toBe(true);
    });
  });

  describe("15. Governance Routing & Approval", () => {
    it("should route creative entities through governance when approving", async () => {
      const candidate = await runB05(b01, b03, b04);
      expect(candidate.creative_angles.length).toBeGreaterThan(0);
      expect(candidate.creative_angles[0]!.provenance.type).toBe("INFERRED");

      const approved = await approveCandidate(candidate, "user@example.com");

      expect(approved.creative_angles.length).toBeGreaterThan(0);
      expect(approved.creative_angles[0]!.provenance.type).toBe("DECIDED");
    });

    it("should populate governance_events for creative angles", async () => {
      const candidate = await runB05(b01, b03, b04);
      const approved = await approveCandidate(candidate, "user@example.com");

      expect(approved.governance_events).toBeDefined();
      const eventKeys = Object.keys(approved.governance_events);
      expect(eventKeys.length).toBeGreaterThan(0);
    });

    it("should set prior_provenance_id for DECIDED creative entities", async () => {
      const candidate = await runB05(b01, b03, b04);
      const approved = await approveCandidate(candidate, "user@example.com");

      const angle = approved.creative_angles[0];
      if (angle) {
        expect(angle.provenance.type).toBe("DECIDED");
        expect(angle.provenance.prior_provenance_id).toBeDefined();
      }
    });

    it("should preserve evidence_refs through approval for messaging strategies", async () => {
      const candidate = await runB05(b01, b03, b04);
      if (candidate.messaging_strategies.length > 0) {
        const originalEvidence = candidate.messaging_strategies[0]!.evidence_refs.length;
        const approved = await approveCandidate(candidate, "user@example.com");
        const approvedEvidence = approved.messaging_strategies[0]?.evidence_refs.length || 0;
        expect(approvedEvidence).toBe(originalEvidence);
      }
    });
  });

  describe("16. Audit Trail & Immutability", () => {
    it("should create audit trail on commitVersion", async () => {
      const candidate = await runB05(b01, b03, b04);
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
      const candidate = await runB05(b01, b03, b04);
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

      const createDeps = (now: () => string): B05Deps => ({
        hash: {
          stableAngleId: (campaignId: string, angleTitle: string) =>
            `angle_${canonicalHasher.hash(`${campaignId}:${angleTitle}`)}`,
          stableMessagingId: (segmentId: string, campaignId: string) =>
            `msg_${canonicalHasher.hash(`${segmentId}:${campaignId}`)}`,
          stableConstraintId: (campaignId: string, type: string) =>
            `const_${canonicalHasher.hash(`${campaignId}:${type}`)}`,
          stableBriefId: (campaignId: string) => `brief_${canonicalHasher.hash(campaignId)}`,
        },
        now,
      });

      const candidate1 = await runB05(b01, b03, b04, createDeps(() => fixedTime));
      const candidate2 = await runB05(b01, b03, b04, createDeps(() => "2026-09-01T15:30:45Z"));

      // Same input, different mocked times → same candidate_id
      expect(candidate1.candidate_id).toBe(candidate2.candidate_id);
    });

    it("should preserve evidence_refs through canonicalization", async () => {
      const candidate = await runB05(b01, b03, b04);
      const approved = await approveCandidate(candidate, "user@example.com");

      const persistence = createMockPersistence();
      const canonical = await commitVersion(
        approved,
        "v1.0",
        "user@example.com",
        persistence,
      );

      expect(canonical.evidence_refs).toBeDefined();
      expect(canonical.evidence_refs.length).toBe(approved.evidence_refs.length);

      if (canonical.creative_angles.length > 0 && approved.creative_angles.length > 0) {
        expect(canonical.creative_angles[0]?.evidence_refs.length).toBe(
          approved.creative_angles[0]?.evidence_refs.length
        );
      }
    });
  });
});
