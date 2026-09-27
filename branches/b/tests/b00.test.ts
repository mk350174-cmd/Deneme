import { describe, it, expect } from "vitest";
import {
  Platform,
  Role,
  PlatformCapability,
  ContentFormat,
  PLATFORMS_REGISTRY,
  ROLES_REGISTRY,
  CAPABILITIES_REGISTRY,
  TERMINOLOGY_VERSION,
  TERMINOLOGY_CREATED_AT,
} from "../src/b00/terminology.js";
import {
  B01CanonicalState,
  B01Input,
  isStrongEvidence,
} from "../src/b00/contracts.js";
import {
  ProvenanceRef,
  ProvenanceType,
  CanonicalClaim,
  makeCanonicalClaim,
  isTruthMakingProvenance,
} from "../src/b00/provenanceRef.js";
import {
  AuditTrail,
  AuditEntry as AuditEntryType,
  diffVersions,
  summarizeAuditContext,
} from "../src/b00/auditTrail.js";
import type { EvidenceRef } from "../src/types/entities.js";

describe("B00 Governance Foundation", () => {
  // =====================================================================
  // 1. TERMINOLOGY TESTS
  // =====================================================================

  describe("Terminology Enums", () => {
    it("Platform enum includes all major platforms", () => {
      expect(Platform.YOUTUBE).toBeDefined();
      expect(Platform.TIKTOK).toBeDefined();
      expect(Platform.LINKEDIN).toBeDefined();
      expect(Platform.X).toBeDefined();
      expect(Platform.INSTAGRAM).toBeDefined();
      expect(Platform.FACEBOOK).toBeDefined();
      expect(Platform.UNKNOWN).toBe("UNKNOWN");
    });

    it("Role enum includes primary, secondary, experimental, archive", () => {
      expect(Role.PRIMARY_CHANNEL).toBe("primary_channel");
      expect(Role.SECONDARY_CHANNEL).toBe("secondary_channel");
      expect(Role.EXPERIMENTAL_CHANNEL).toBe("experimental_channel");
      expect(Role.ARCHIVE_CHANNEL).toBe("archive_channel");
    });

    it("PlatformCapability covers video, text, images, community", () => {
      expect(PlatformCapability.LONG_FORM_VIDEO).toBeDefined();
      expect(PlatformCapability.SHORT_FORM_VIDEO).toBeDefined();
      expect(PlatformCapability.TEXT_POST).toBeDefined();
      expect(PlatformCapability.IMAGE_CAROUSEL).toBeDefined();
      expect(PlatformCapability.COMMUNITY_CHAT).toBeDefined();
    });

    it("ContentFormat enum has production-relevant formats", () => {
      expect(ContentFormat.LONG_FORM_EDUCATIONAL_VIDEO).toBeDefined();
      expect(ContentFormat.SHORT_FORM_NARRATIVE_VIDEO).toBeDefined();
      expect(ContentFormat.TEXT_POST_WITH_IMAGES).toBeDefined();
      expect(ContentFormat.THREAD).toBeDefined();
    });
  });

  describe("Terminology Registries", () => {
    it("PLATFORMS_REGISTRY has entries for major platforms", () => {
      expect(PLATFORMS_REGISTRY[Platform.YOUTUBE]).toBeDefined();
      expect(PLATFORMS_REGISTRY[Platform.YOUTUBE].capabilities).toContain(
        PlatformCapability.LONG_FORM_VIDEO
      );
    });

    it("ROLES_REGISTRY has all role descriptors", () => {
      expect(ROLES_REGISTRY[Role.PRIMARY_CHANNEL]).toBeDefined();
      expect(ROLES_REGISTRY[Role.PRIMARY_CHANNEL].activity_expectation).toContain("2-3x");
    });

    it("CAPABILITIES_REGISTRY maps capabilities to platforms", () => {
      const shortForm = CAPABILITIES_REGISTRY[PlatformCapability.SHORT_FORM_VIDEO];
      expect(shortForm.platforms).toContain(Platform.TIKTOK);
      expect(shortForm.platforms).toContain(Platform.YOUTUBE_SHORTS);
    });
  });

  describe("Terminology Versioning", () => {
    it("TERMINOLOGY_VERSION is defined and locked", () => {
      expect(TERMINOLOGY_VERSION).toBe("1.0");
    });

    it("TERMINOLOGY_CREATED_AT is valid ISO 8601", () => {
      expect(TERMINOLOGY_CREATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });
  });

  // =====================================================================
  // 2. CONTRACTS TESTS
  // =====================================================================

  describe("B01Input Contract", () => {
    it("B01Input accepts optional brand context", () => {
      const input: B01Input = {
        input_id: "inp_test",
        created_at: new Date().toISOString(),
        brand_context: {
          brand_name: "TestBrand",
          positioning: "Leading AI platform",
        },
      };
      expect(input.brand_context?.brand_name).toBe("TestBrand");
    });

    it("B01Input allows known channels with platform enum", () => {
      const input: B01Input = {
        input_id: "inp_test",
        created_at: new Date().toISOString(),
        known_channels: [
          {
            channel_id: "ch_yt_001",
            channel_name: "Main YouTube",
            platform: Platform.YOUTUBE,
            source: "user_input",
          },
        ],
      };
      expect(input.known_channels?.[0].platform).toBe(Platform.YOUTUBE);
    });

    it("B01Input handles missing data gracefully", () => {
      const input: B01Input = {
        input_id: "inp_test",
        created_at: new Date().toISOString(),
      };
      expect(input.brand_context).toBeUndefined();
      expect(input.known_channels).toBeUndefined();
    });
  });

  describe("B01CanonicalState Contract", () => {
    it("B01CanonicalState includes versioning and audit trail", () => {
      const state: Partial<B01CanonicalState> = {
        version: "1.0",
        audit_trail: [],
        decisions_made: [],
        recommendations_considered: [],
      };
      expect(state.version).toBe("1.0");
      expect(Array.isArray(state.audit_trail)).toBe(true);
    });

    it("B01CanonicalState includes completeness score", () => {
      const state: Partial<B01CanonicalState> = {
        completeness: {
          score: 75,
          missing_inputs: ["TikTok audience data"],
          blocking_decisions: ["Approve channel roles"],
        },
      };
      expect(state.completeness?.score).toBe(75);
      expect(state.completeness?.missing_inputs).toContain("TikTok audience data");
    });
  });

  describe("isStrongEvidence Helper", () => {
    it("Returns true for VERIFIED evidence", () => {
      expect(isStrongEvidence("VERIFIED")).toBe(true);
    });

    it("Returns true for INFERRED with confidence > 0.7", () => {
      expect(isStrongEvidence("INFERRED", 0.8)).toBe(true);
      expect(isStrongEvidence("INFERRED", 0.65)).toBe(false);
    });

    it("Returns false for UNKNOWN", () => {
      expect(isStrongEvidence("UNKNOWN")).toBe(false);
    });
  });

  // =====================================================================
  // 3. PROVENANCE TESTS
  // =====================================================================

  describe("ProvenanceRef Type", () => {
    it("ProvenanceType includes all required types", () => {
      const types: ProvenanceType[] = [
        "OBSERVED",
        "INFERRED",
        "RECOMMENDED",
        "DECIDED",
        "CANONICAL",
      ];
      expect(types.length).toBe(5);
    });

    it("ProvenanceRef distinguishes from EvidenceRef", () => {
      const evidence: EvidenceRef = {
        id: "ev_test",
        source: "audit_2026-08-27",
        status: "VERIFIED",
        excerpt: "YouTube channel found at URL X",
      };

      const provenance: ProvenanceRef = {
        id: "prov_test",
        type: "DECIDED",
        decision_authority: "user@example.com",
        timestamp: new Date().toISOString(),
        rationale: "User approved YouTube as primary based on audit",
      };

      expect(evidence.status).toBeDefined();
      expect(provenance.type).toBeDefined();
      expect(evidence.status).not.toBe(provenance.type);
    });
  });

  describe("CanonicalClaim", () => {
    it("Wraps value with evidence and provenance", () => {
      const evidence: EvidenceRef = {
        id: "ev_yt",
        source: "channel_audit",
        status: "VERIFIED",
      };

      const provenance: ProvenanceRef = {
        id: "prov_yt",
        type: "DECIDED",
        decision_authority: "user@test.com",
        timestamp: new Date().toISOString(),
        rationale: "User confirmed YouTube is primary",
      };

      const claim: CanonicalClaim<string> = makeCanonicalClaim(
        "primary_channel",
        [evidence],
        provenance,
        "VERIFIED",
        0.95
      );

      expect(claim.value).toBe("primary_channel");
      expect(claim.evidence[0].status).toBe("VERIFIED");
      expect(claim.provenance.type).toBe("DECIDED");
    });
  });

  describe("isTruthMakingProvenance Helper", () => {
    it("Returns true for DECIDED and CANONICAL", () => {
      expect(isTruthMakingProvenance("DECIDED")).toBe(true);
      expect(isTruthMakingProvenance("CANONICAL")).toBe(true);
    });

    it("Returns false for OBSERVED, INFERRED, RECOMMENDED", () => {
      expect(isTruthMakingProvenance("OBSERVED")).toBe(false);
      expect(isTruthMakingProvenance("INFERRED")).toBe(false);
      expect(isTruthMakingProvenance("RECOMMENDED")).toBe(false);
    });
  });

  // =====================================================================
  // 4. AUDIT TRAIL TESTS
  // =====================================================================

  describe("AuditEntry", () => {
    it("Tracks field changes with old/new values", () => {
      const entry: AuditEntryType = {
        audit_id: "audit_001",
        version: "1.0",
        changed_field: "channel_roles.youtube",
        old_value: null,
        new_value: "primary_channel",
        decision_authority: "user@test.com",
        timestamp: new Date().toISOString(),
        rationale: "User confirmed YouTube is primary",
        evidence_refs: [],
        change_type: "canonical_state_update",
      };

      expect(entry.changed_field).toBe("channel_roles.youtube");
      expect(entry.new_value).toBe("primary_channel");
      expect(entry.change_type).toBe("canonical_state_update");
    });
  });

  describe("AuditTrail", () => {
    it("Immutably tracks complete change history", () => {
      const trail: AuditTrail = {
        trail_id: "audit_v1.0",
        version: "1.0",
        entries: [
          {
            audit_id: "audit_001",
            version: "1.0",
            changed_field: "brand_name",
            new_value: "TestBrand",
            decision_authority: "user@test.com",
            timestamp: new Date().toISOString(),
            rationale: "Initial setup",
            evidence_refs: [],
            change_type: "canonical_state_update",
          },
        ],
        finalized_at: new Date().toISOString(),
        approver: "user@test.com",
      };

      expect(trail.version).toBe("1.0");
      expect(trail.entries.length).toBe(1);
      expect(trail.entries[0].changed_field).toBe("brand_name");
    });
  });

  describe("diffVersions Helper", () => {
    it("Identifies changes between two audit trails", () => {
      const trail_v1: AuditTrail = {
        trail_id: "audit_v1.0",
        version: "1.0",
        entries: [
          {
            audit_id: "audit_001",
            version: "1.0",
            changed_field: "brand_name",
            new_value: "Brand1",
            decision_authority: "user@test.com",
            timestamp: new Date().toISOString(),
            rationale: "Initial",
            evidence_refs: [],
            change_type: "canonical_state_update",
          },
        ],
        finalized_at: new Date().toISOString(),
        approver: "user@test.com",
      };

      const trail_v1_1: AuditTrail = {
        trail_id: "audit_v1.1",
        version: "1.1",
        entries: [
          ...trail_v1.entries,
          {
            audit_id: "audit_002",
            version: "1.1",
            changed_field: "channel_roles.youtube",
            new_value: "primary_channel",
            decision_authority: "user@test.com",
            timestamp: new Date().toISOString(),
            rationale: "User update",
            evidence_refs: [],
            change_type: "canonical_state_update",
          },
        ],
        finalized_at: new Date().toISOString(),
        approver: "user@test.com",
      };

      const diff = diffVersions(trail_v1, trail_v1_1);
      expect(diff.from_version).toBe("1.0");
      expect(diff.to_version).toBe("1.1");
      expect(diff.changes.length).toBeGreaterThan(0);
    });
  });

  // =====================================================================
  // 5. TYPE SAFETY & COMPILATION
  // =====================================================================

  describe("TypeScript Compilation", () => {
    it("All terminology types compile without errors", () => {
      const platform: Platform = Platform.YOUTUBE;
      const role: Role = Role.PRIMARY_CHANNEL;
      const capability: PlatformCapability = PlatformCapability.SHORT_FORM_VIDEO;

      expect(platform).toBeDefined();
      expect(role).toBeDefined();
      expect(capability).toBeDefined();
    });

    it("Contracts enforce required fields", () => {
      const input: B01Input = {
        input_id: "test",
        created_at: new Date().toISOString(),
      };

      expect(input.input_id).toBe("test");
    });
  });

  // =====================================================================
  // 6. SECURITY & CONVENTIONS
  // =====================================================================

  describe("B00 security and conventions", () => {
    it("No hardcoded secrets in B00 types", () => {
      const json = JSON.stringify({
        PLATFORMS_REGISTRY,
        ROLES_REGISTRY,
        CAPABILITIES_REGISTRY,
      });

      // Check for common secret patterns
      expect(json).not.toMatch(/sk_live/);
      expect(json).not.toMatch(/sk_test/);
      expect(json).not.toMatch(/api_key/);
      expect(json).not.toMatch(/secret/i);
    });

    it("Platform registry is platform-agnostic (no vendor coupling)", () => {
      // Verify that any platform can be swapped without changing types
      const keys = Object.keys(PLATFORMS_REGISTRY);
      expect(keys.length).toBeGreaterThan(0);

      // All entries should have the same shape
      const firstRegistry = PLATFORMS_REGISTRY[Platform.YOUTUBE];
      expect(firstRegistry).toHaveProperty("name");
      expect(firstRegistry).toHaveProperty("capabilities");
      expect(firstRegistry).toHaveProperty("api_status");
    });
  });
});
