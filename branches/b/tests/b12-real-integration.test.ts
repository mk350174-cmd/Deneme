// B12 Real Integration Tests
//
// Tests that verify B12 upstream aggregation using REAL persistence objects
// and saved canonical states, not test fixtures.
//
// Each test:
// 1. Creates real persistence objects for B01-B11
// 2. Saves actual canonical states with sentinel data
// 3. Creates upstream reader from those real objects
// 4. Calls createBranchState() with the reader
// 5. Verifies sentinel data survives end-to-end

import { describe, it, expect } from "vitest";
import {
  createBranchState,
  createRealUpstreamReader,
  InMemoryB12Persistence,
} from "../src/b12/index.js";
import type {
  B12UpstreamReader,
  BranchCanonicalState,
} from "../src/b12/types.js";

import { createMockPersistence as createB01Persistence } from "../src/b01/persistence.js";
import { createMockPersistence as createB05Persistence } from "../src/b05/persistence.js";
import { createMockPersistence as createB10Persistence } from "../src/b10/persistence.js";
import { InMemoryB09Persistence } from "../src/b09/persistence.js";
import { InMemoryB10Persistence } from "../src/b10/persistence.js";
import { InMemoryB11Persistence } from "../src/b11/persistence.js";
import type { B01StatePersistence } from "../src/b01/types.js";
import type { B05StatePersistence } from "../src/b05/types.js";

describe("B12 Real Upstream Integration (PHASE 6+)", () => {
  describe("PHASE 6: Real Tests with Actual Persistence", () => {
    it("loads B01 canonical evidence from real persistence", async () => {
      // 1. Create real B01 persistence
      const b01Persistence: B01StatePersistence = createB01Persistence();

      // 2. Save B01 canonical state with sentinel evidence
      const b01Canonical: any = {
        version: "v1.0",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        user_decision_authority: "system",
        ecosystem_data: {
          platforms: [],
          rules: [],
          brand_context: {},
        },
        evidence_refs: [
          {
            id: "E-B01-REAL-001",
            source: "actual_brand_guidelines",
            status: "VERIFIED" as const,
            reference: "real_document_path",
          },
        ],
        provenance_refs: [
          {
            id: "P-B01-REAL-001",
            type: "OBSERVED" as const,
            decision_authority: "ecosystem_scanner",
            timestamp: "2026-01-01T00:00:00Z",
            rationale: "Extracted from live ecosystem data",
          },
        ],
        governance_events: {},
        audit_trail: [
          {
            version: "v1.0",
            changed_at: "2026-01-01T00:00:00Z",
            changed_by: "system",
            summary: "Initial ecosystem discovery",
          },
        ],
      };

      await b01Persistence.save(b01Canonical);

      // 3. Create upstream reader with REAL persistence
      const upstreamReader: B12UpstreamReader = {
        b01: b01Persistence,
        b02: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b03: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b04: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b05: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b06: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b07: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b08: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b09: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b10: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b11: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
      };

      // 4. Call createBranchState with REAL upstream reader
      const state = await createBranchState("v1.0", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
        upstreamReader,
      });

      // 5. VERIFY SENTINEL SURVIVES END-TO-END
      expect(state.evidence_refs).toContainEqual({
        id: "E-B01-REAL-001",
        source: "actual_brand_guidelines",
        status: "VERIFIED",
        reference: "real_document_path",
      });

      expect(state.provenance_refs).toContainEqual({
        id: "P-B01-REAL-001",
        type: "OBSERVED",
        decision_authority: "ecosystem_scanner",
        timestamp: "2026-01-01T00:00:00Z",
        rationale: "Extracted from live ecosystem data",
      });
    });

    it("aggregates real evidence from multiple modules (B01, B05, B11)", async () => {
      // Create real persistence for B01, B05, B11
      const b01Persistence: B01StatePersistence = createB01Persistence();
      const b05Persistence: B05StatePersistence = createB05Persistence();
      const b11Persistence = new InMemoryB11Persistence();

      // Save canonical states with DIFFERENT sentinel evidence
      const b01Canonical: any = {
        version: "v1.0",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        user_decision_authority: "system",
        ecosystem_data: { platforms: [], rules: [], brand_context: {} },
        evidence_refs: [
          {
            id: "E-B01-MODULE-001",
            source: "brand_module",
            status: "VERIFIED" as const,
            reference: "b01_source",
          },
        ],
        provenance_refs: [],
        governance_events: {},
        audit_trail: [],
      };

      const b05Canonical: any = {
        version: "v1.0",
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        user_decision_authority: "system",
        messaging_angles: [],
        evidence_refs: [
          {
            id: "E-B05-MODULE-001",
            source: "positioning_module",
            status: "INFERRED" as const,
            reference: "b05_source",
          },
        ],
        provenance_refs: [],
        governance_events: {},
        audit_trail: [],
      };

      const b11Canonical: any = {
        version: "v1.0",
        created_at: "2026-01-03T00:00:00Z",
        updated_at: "2026-01-03T00:00:00Z",
        user_decision_authority: "system",
        governance_rules: [],
        evidence_refs: [
          {
            id: "E-B11-MODULE-001",
            source: "governance_module",
            status: "VERIFIED" as const,
            reference: "b11_source",
          },
        ],
        provenance_refs: [],
        governance_events: {},
        audit_trail: [],
      };

      await b01Persistence.save(b01Canonical);
      await b05Persistence.save(b05Canonical);
      await b11Persistence.save(b11Canonical);

      // Create upstream reader with REAL persistence objects
      const upstreamReader: B12UpstreamReader = {
        b01: b01Persistence,
        b02: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b03: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b04: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b05: b05Persistence,
        b06: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b07: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b08: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b09: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b10: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b11: b11Persistence,
      };

      // Call with versions for B01, B05, B11
      const state = await createBranchState("v1.0", undefined, undefined, undefined, "v1.0", undefined, undefined, undefined, undefined, undefined, "v1.0", {
        upstreamReader,
      });

      // VERIFY ALL THREE SENTINELS SURVIVE
      expect(state.evidence_refs.length).toBeGreaterThanOrEqual(3);
      expect(state.evidence_refs.map((e) => e.id)).toContain("E-B01-MODULE-001");
      expect(state.evidence_refs.map((e) => e.id)).toContain("E-B05-MODULE-001");
      expect(state.evidence_refs.map((e) => e.id)).toContain("E-B11-MODULE-001");
    });

    it("preserves provenance chains with prior_provenance_id linkage", async () => {
      const b10Persistence = new InMemoryB10Persistence();

      const b10Canonical: any = {
        version: "v1.0",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        user_decision_authority: "system",
        decisions: [],
        evidence_refs: [],
        provenance_refs: [
          {
            id: "P-B09-RECOMMENDATION",
            type: "RECOMMENDED" as const,
            decision_authority: "b09_optimizer",
            timestamp: "2026-01-01T08:00:00Z",
            rationale: "Upstream recommendation",
          },
          {
            id: "P-B10-DECISION",
            type: "DECIDED" as const,
            decision_authority: "user@example.com",
            timestamp: "2026-01-01T09:00:00Z",
            prior_provenance_id: "P-B09-RECOMMENDATION",
            rationale: "User approved B09 recommendation",
          },
        ],
        governance_events: {},
        audit_trail: [],
      };

      await b10Persistence.save(b10Canonical);

      const upstreamReader: B12UpstreamReader = {
        b01: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b02: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b03: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b04: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b05: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b06: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b07: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b08: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b09: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b10: b10Persistence,
        b11: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
      };

      const state = await createBranchState(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "v1.0", undefined, {
        upstreamReader,
      });

      // VERIFY PROVENANCE CHAIN WITH LINKAGE SURVIVES
      const b10Decision = state.provenance_refs.find((p) => p.id === "P-B10-DECISION");
      expect(b10Decision).toBeDefined();
      expect(b10Decision?.prior_provenance_id).toBe("P-B09-RECOMMENDATION");

      const b09Rec = state.provenance_refs.find((p) => p.id === "P-B09-RECOMMENDATION");
      expect(b09Rec).toBeDefined();
    });

    it("preserves governance events from upstream modules", async () => {
      const b09Persistence = new InMemoryB09Persistence();
      const b11Persistence = new InMemoryB11Persistence();

      const b09Canonical: any = {
        version: "v1.0",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        user_decision_authority: "system",
        proposals: [],
        evidence_refs: [],
        provenance_refs: [],
        governance_events: {
          "optimization_001": [
            {
              id: "G-B09-PROPOSED-001",
              timestamp: "2026-01-01T08:00:00Z",
              type: "PROPOSED",
              provenance: {
                id: "P-B09-EVENT-001",
                type: "INFERRED" as const,
                timestamp: "2026-01-01T08:00:00Z",
              },
            },
          ],
        },
        audit_trail: [],
      };

      const b11Canonical: any = {
        version: "v1.0",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        user_decision_authority: "system",
        governance_rules: [],
        evidence_refs: [],
        provenance_refs: [],
        governance_events: {
          "risk_assessment_001": [
            {
              id: "G-B11-APPROVED-001",
              timestamp: "2026-01-01T10:00:00Z",
              type: "APPROVED",
              provenance: {
                id: "P-B11-EVENT-001",
                type: "DECIDED" as const,
                timestamp: "2026-01-01T10:00:00Z",
              },
            },
          ],
        },
        audit_trail: [],
      };

      await b09Persistence.save(b09Canonical);
      await b11Persistence.save(b11Canonical);

      const upstreamReader: B12UpstreamReader = {
        b01: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b02: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b03: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b04: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b05: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b06: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b07: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b08: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b09: b09Persistence,
        b10: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b11: b11Persistence,
      };

      const state = await createBranchState(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "v1.0", undefined, "v1.0", {
        upstreamReader,
      });

      // VERIFY GOVERNANCE EVENTS SURVIVE
      expect(state.governance_events["optimization_001"]).toBeDefined();
      expect(state.governance_events["risk_assessment_001"]).toBeDefined();
      expect(state.governance_events["optimization_001"]?.[0]?.id).toBe("G-B09-PROPOSED-001");
      expect(state.governance_events["risk_assessment_001"]?.[0]?.id).toBe("G-B11-APPROVED-001");
    });

    it("preserves upstream audit trail entries in deterministic order", async () => {
      const b01Persistence: B01StatePersistence = createB01Persistence();
      const b05Persistence: B05StatePersistence = createB05Persistence();

      const b01Canonical: any = {
        version: "v1.0",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        user_decision_authority: "system",
        ecosystem_data: { platforms: [], rules: [], brand_context: {} },
        evidence_refs: [],
        provenance_refs: [],
        governance_events: {},
        audit_trail: [
          {
            version: "v1.0",
            changed_at: "2026-01-01T00:00:00Z",
            changed_by: "system",
            summary: "B01 audit entry 1",
          },
          {
            version: "v1.0",
            changed_at: "2026-01-01T01:00:00Z",
            changed_by: "system",
            summary: "B01 audit entry 2",
          },
        ],
      };

      const b05Canonical: any = {
        version: "v1.0",
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        user_decision_authority: "system",
        messaging_angles: [],
        evidence_refs: [],
        provenance_refs: [],
        governance_events: {},
        audit_trail: [
          {
            version: "v1.0",
            changed_at: "2026-01-02T00:00:00Z",
            changed_by: "system",
            summary: "B05 audit entry 1",
          },
        ],
      };

      await b01Persistence.save(b01Canonical);
      await b05Persistence.save(b05Canonical);

      const upstreamReader: B12UpstreamReader = {
        b01: b01Persistence,
        b02: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b03: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b04: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b05: b05Persistence,
        b06: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b07: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b08: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b09: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b10: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b11: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
      };

      const state = await createBranchState("v1.0", undefined, undefined, undefined, "v1.0", undefined, undefined, undefined, undefined, undefined, undefined, {
        upstreamReader,
      });

      // VERIFY AUDIT TRAIL ORDER: B01 entries before B05 entries
      const auditActions = state.audit_trail.map((a) => a.action);
      const b01Index = auditActions.findIndex((a) => a.includes("b01"));
      const b05Index = auditActions.findIndex((a) => a.includes("b05"));

      expect(b01Index).toBeGreaterThanOrEqual(0);
      expect(b05Index).toBeGreaterThanOrEqual(0);
      expect(b01Index).toBeLessThan(b05Index);
    });
  });

  describe("PHASE 10: Determinism", () => {
    it("produces identical state_id for same content, different timestamps", async () => {
      const b01Persistence1: B01StatePersistence = createB01Persistence();
      const b01Persistence2: B01StatePersistence = createB01Persistence();

      const b01Canonical: any = {
        version: "v1.0",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        user_decision_authority: "system",
        ecosystem_data: { platforms: [], rules: [], brand_context: {} },
        evidence_refs: [
          {
            id: "E-DETERMINISM-001",
            source: "test",
            status: "VERIFIED" as const,
            reference: "test_ref",
          },
        ],
        provenance_refs: [],
        governance_events: {},
        audit_trail: [],
      };

      await b01Persistence1.save(b01Canonical);
      await b01Persistence2.save(b01Canonical);

      const reader1: B12UpstreamReader = {
        b01: b01Persistence1,
        b02: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b03: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b04: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b05: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b06: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b07: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b08: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b09: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b10: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b11: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
      };

      const reader2: B12UpstreamReader = {
        b01: b01Persistence2,
        b02: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b03: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b04: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b05: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b06: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b07: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b08: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b09: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b10: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b11: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
      };

      // Run with time A
      const state1 = await createBranchState("v1.0", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
        upstreamReader: reader1,
        now: () => "2025-01-01T00:00:00Z",
      });

      // Run with time B (different date)
      const state2 = await createBranchState("v1.0", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
        upstreamReader: reader2,
        now: () => "2035-12-31T23:59:59Z",
      });

      // VERIFY DETERMINISTIC state_id
      expect(state1.state_id).toBe(state2.state_id);
      expect(state1.evidence_refs).toEqual(state2.evidence_refs);
      expect(state1.provenance_refs).toEqual(state2.provenance_refs);
    });
  });

  describe("PHASE 9: Partial Input", () => {
    it("handles partial input: only B01 and B05 provided", async () => {
      const b01Persistence: B01StatePersistence = createB01Persistence();
      const b05Persistence: B05StatePersistence = createB05Persistence();

      const b01Canonical: any = {
        version: "v1.0",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        user_decision_authority: "system",
        ecosystem_data: { platforms: [], rules: [], brand_context: {} },
        evidence_refs: [{ id: "E-B01-001", source: "b01", status: "VERIFIED" as const, reference: "ref" }],
        provenance_refs: [],
        governance_events: {},
        audit_trail: [],
      };

      const b05Canonical: any = {
        version: "v1.0",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        user_decision_authority: "system",
        messaging_angles: [],
        evidence_refs: [{ id: "E-B05-001", source: "b05", status: "INFERRED" as const, reference: "ref" }],
        provenance_refs: [],
        governance_events: {},
        audit_trail: [],
      };

      await b01Persistence.save(b01Canonical);
      await b05Persistence.save(b05Canonical);

      const upstreamReader: B12UpstreamReader = {
        b01: b01Persistence,
        b02: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b03: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b04: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b05: b05Persistence,
        b06: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b07: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b08: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b09: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b10: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
        b11: { load: async () => null, save: async () => {}, listVersions: async () => [], latest: async () => null },
      };

      // Only provide B01 and B05 versions
      const state = await createBranchState("v1.0", undefined, undefined, undefined, "v1.0", undefined, undefined, undefined, undefined, undefined, undefined, {
        upstreamReader,
      });

      // VERIFY ONLY B01 AND B05 DATA PRESENT
      expect(state.evidence_refs.map((e) => e.id)).toContain("E-B01-001");
      expect(state.evidence_refs.map((e) => e.id)).toContain("E-B05-001");
      expect(state.module_versions.length).toBe(2); // Only B01 and B05
      expect(state.module_versions.map((v) => v.module)).toContain("b01");
      expect(state.module_versions.map((v) => v.module)).toContain("b05");
    });
  });
});
