// B12 Tests

import { describe, it, expect, beforeEach } from "vitest";
import {
  createBranchState,
  commitBranchState,
  loadBranchState,
  listBranchStates,
  getLatestBranchState,
  aggregateModuleVersions,
  trackStateTransition,
  validateBranchCompleteness,
  generateAuditTrail,
  InMemoryB12Persistence,
  KNOWN_CANONICALIZATION_DROPS,
} from "../src/b12/index.js";

describe("B12 — State Management", () => {
  let persistence: InMemoryB12Persistence;

  beforeEach(() => {
    persistence = new InMemoryB12Persistence();
  });

  it("aggregates module versions", () => {
    const versions = aggregateModuleVersions("v1.0", "v1.0", "v1.0");

    expect(versions.length).toBe(3);
    expect(versions[0].module).toBe("b01");
    expect(versions[0].version).toBe("v1.0");
  });

  it("filters out undefined versions", () => {
    const versions = aggregateModuleVersions("v1.0", undefined, "v1.0");

    expect(versions.length).toBe(2);
    expect(versions.every((v) => v.version)).toBe(true);
  });

  it("tracks state transitions", () => {
    const fromVersions = aggregateModuleVersions("v1.0");
    const toVersions = aggregateModuleVersions("v1.1");

    const transition = trackStateTransition(
      fromVersions,
      toVersions,
      "user_decision",
      "user@example.com",
      "Update b01 strategy",
    );

    expect(transition.transition_id).toBeDefined();
    expect(transition.triggered_by).toBe("user_decision");
    expect(transition.decision_authority).toBe("user@example.com");
  });

  it("validates branch completeness", () => {
    const versions = aggregateModuleVersions(
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
    );

    const completeness = validateBranchCompleteness(versions);

    expect(completeness.b01_ready).toBe(true);
    expect(completeness.b08_ready).toBe(true);
    expect(completeness.overall_completeness).toBe(100);
  });

  it("calculates partial completeness", () => {
    const versions = aggregateModuleVersions("v1.0", "v1.0", "v1.0");

    const completeness = validateBranchCompleteness(versions);

    expect(completeness.b01_ready).toBe(true);
    expect(completeness.b04_ready).toBe(false);
    expect(completeness.overall_completeness).toBeLessThan(100);
  });

  it("handles empty module versions", () => {
    const completeness = validateBranchCompleteness([]);

    expect(completeness.overall_completeness).toBe(0);
  });

  it("generates audit trail", () => {
    const versions = aggregateModuleVersions("v1.0", "v1.0");
    const trail = generateAuditTrail(versions, "user@example.com", "Update branch state");

    expect(trail.length).toBeGreaterThan(0);
    expect(trail[0].actor).toBe("user@example.com");
    expect(trail[0].affected_modules.length).toBe(2);
  });

  it("creates branch state", async () => {
    const state = await createBranchState("v1.0", "v1.0", "v1.0");

    expect(state.state_id).toBeDefined();
    expect(state.module_versions.length).toBe(3);
    expect(state.completeness_summary.overall_completeness).toBeGreaterThan(0);
  });

  it("commits branch state", async () => {
    const state = await createBranchState("v1.0");
    const committed = await commitBranchState(state, "user@example.com", "Initial commit", persistence);

    expect(committed.state_id).toBeDefined();
    expect(committed.last_decision.authority).toBe("user@example.com");
    expect(committed.audit_trail.length).toBeGreaterThan(1);
  });

  it("loads branch state", async () => {
    const state = await createBranchState("v1.0");
    const committed = await commitBranchState(state, "user@example.com", "Test", persistence);

    const loaded = await loadBranchState(committed.state_id, persistence);

    expect(loaded?.state_id).toBe(committed.state_id);
    expect(loaded?.module_versions.length).toBe(committed.module_versions.length);
  });

  it("lists branch states", async () => {
    const state1 = await createBranchState("v1.0");
    const state2 = await createBranchState("v1.1");

    const c1 = await commitBranchState(state1, "user@example.com", "First", persistence);
    const c2 = await commitBranchState(state2, "user@example.com", "Second", persistence);

    const states = await listBranchStates(persistence);

    expect(states).toContain(c1.state_id);
    expect(states).toContain(c2.state_id);
    expect(states.length).toBe(2);
  });

  it("retrieves latest branch state", async () => {
    const state1 = await createBranchState("v1.0");
    const state2 = await createBranchState("v1.1");

    const c1 = await commitBranchState(state1, "user@example.com", "First", persistence);
    const c2 = await commitBranchState(state2, "user@example.com", "Second", persistence);

    const latest = await getLatestBranchState(persistence);

    expect(latest).toBeDefined();
    expect([c1.state_id, c2.state_id]).toContain(latest?.state_id);
  });

  it("handles empty branch state list", async () => {
    const states = await listBranchStates(persistence);

    expect(states.length).toBe(0);
  });

  it("handles latest on empty persistence", async () => {
    const latest = await getLatestBranchState(persistence);

    expect(latest).toBeNull();
  });

  it("tracks decision authority", async () => {
    const state = await createBranchState("v1.0");
    const committed = await commitBranchState(state, "alice@example.com", "Alice's update", persistence);

    expect(committed.last_decision.authority).toBe("alice@example.com");
    expect(committed.last_decision.decision).toBe("Alice's update");
  });

  it("preserves completeness across commits", async () => {
    const state1 = await createBranchState("v1.0", "v1.0", "v1.0", "v1.0", "v1.0");
    const committed = await commitBranchState(state1, "user@example.com", "Commit", persistence);

    expect(committed.completeness_summary.overall_completeness).toBeGreaterThan(0);
  });

  it("audit trail grows with commits", async () => {
    const state1 = await createBranchState("v1.0");
    const c1 = await commitBranchState(state1, "user@example.com", "First commit", persistence);

    const state2 = await createBranchState("v1.1");
    const c2 = await commitBranchState(state2, "user@example.com", "Second commit", persistence);

    expect(c2.audit_trail.length).toBeGreaterThanOrEqual(c1.audit_trail.length);
  });

  it("state ID is deterministic: same semantic input produces same ID regardless of timestamp", async () => {
    const mockNow = "2026-01-01T00:00:00Z";
    const deps1 = { now: () => mockNow };
    const state1 = await createBranchState("v1.0", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, deps1);

    const deps2 = { now: () => "2026-01-02T12:34:56Z" }; // Different timestamp
    const state2 = await createBranchState("v1.0", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, deps2);

    // Same module versions → same state_id, regardless of wall-clock timestamp
    expect(state1.state_id).toBe(state2.state_id);
    // But timestamps differ
    expect(state1.created_at).not.toBe(state2.created_at);
  });

  it("marks complete state when all modules present", async () => {
    const state = await createBranchState(
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
    );

    expect(state.completeness_summary.b01_ready).toBe(true);
    expect(state.completeness_summary.b11_ready).toBe(true);
    expect(state.completeness_summary.overall_completeness).toBe(100);
  });

  it("module versions have canonical state IDs", () => {
    const versions = aggregateModuleVersions("v1.0");

    expect(versions[0].canonical_state_id).toBeDefined();
    expect(versions[0].canonical_state_id).toContain("state_");
  });

  it("transitions have provenance", () => {
    const fromVersions = aggregateModuleVersions("v1.0");
    const toVersions = aggregateModuleVersions("v1.1");

    const transition = trackStateTransition(
      fromVersions,
      toVersions,
      "user_decision",
      "user@example.com",
      "Test",
    );

    expect(transition.provenance).toBeDefined();
    expect(transition.provenance.type).toBe("INFERRED");
  });

  // ========================================================================
  // STEP 9: EVIDENCE/PROVENANCE/GOVERNANCE PROOF TESTS (SENTINEL FIXTURES)
  // ========================================================================

  it("creates branch state without upstream reader (graceful degradation)", async () => {
    const state = await createBranchState("v1.0", "v1.0", "v1.0");

    // Without upstream reader, aggregations should be empty
    expect(state.evidence_refs).toEqual([]);
    expect(state.provenance_refs).toEqual([]);
    expect(state.governance_events).toEqual({});
  });

  it("aggregates upstream evidence_refs when reader is provided", async () => {
    // Create sentinel upstream canonical states with unique evidence
    const upstreamB01 = {
      version: "v1.0",
      evidence_refs: [
        {
          id: "E-B01-SENTINEL-001",
          source: "brand_guidelines_doc",
          status: "VERIFIED" as const,
          reference: "https://docs.example.com/brand",
        },
      ],
      provenance_refs: [],
      governance_events: {},
      audit_trail: [],
    };

    const upstreamB02 = {
      version: "v1.0",
      evidence_refs: [
        {
          id: "E-B02-SENTINEL-001",
          source: "market_research",
          status: "INFERRED" as const,
          reference: "https://market.example.com/report",
        },
      ],
      provenance_refs: [],
      governance_events: {},
      audit_trail: [],
    };

    // Mock upstream reader
    const mockReader = {
      b01: {
        load: async () => upstreamB01,
        listVersions: async () => ["v1.0"],
        latest: async () => upstreamB01,
        save: async () => {},
      },
      b02: {
        load: async () => upstreamB02,
        listVersions: async () => ["v1.0"],
        latest: async () => upstreamB02,
        save: async () => {},
      },
      b03: {
        load: async () => null,
        listVersions: async () => [],
        latest: async () => null,
        save: async () => {},
      },
      b04: {
        load: async () => null,
        listVersions: async () => [],
        latest: async () => null,
        save: async () => {},
      },
      b05: {
        load: async () => null,
        listVersions: async () => [],
        latest: async () => null,
        save: async () => {},
      },
      b06: {
        load: async () => null,
        listVersions: async () => [],
        latest: async () => null,
        save: async () => {},
      },
      b07: {
        load: async () => null,
        listVersions: async () => [],
        latest: async () => null,
        save: async () => {},
      },
      b08: {
        load: async () => null,
        listVersions: async () => [],
        latest: async () => null,
        save: async () => {},
      },
      b09: {
        load: async () => null,
        listVersions: async () => [],
        latest: async () => null,
        save: async () => {},
      },
      b10: {
        load: async () => null,
        listVersions: async () => [],
        latest: async () => null,
        save: async () => {},
      },
      b11: {
        load: async () => null,
        listVersions: async () => [],
        latest: async () => null,
        save: async () => {},
      },
    };

    const state = await createBranchState("v1.0", "v1.0", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
      upstreamReader: mockReader,
    });

    // Sentinel evidence should be aggregated
    expect(state.evidence_refs.length).toBe(2);
    expect(state.evidence_refs.map((e) => e.id)).toContain("E-B01-SENTINEL-001");
    expect(state.evidence_refs.map((e) => e.id)).toContain("E-B02-SENTINEL-001");
  });

  it("aggregates upstream provenance_refs when reader is provided", async () => {
    const upstreamB01 = {
      version: "v1.0",
      evidence_refs: [],
      provenance_refs: [
        {
          id: "P-B01-SENTINEL-001",
          type: "INFERRED" as const,
          decision_authority: "B01_ecosystem",
          timestamp: "2026-01-01T00:00:00Z",
        },
      ],
      governance_events: {},
      audit_trail: [],
    };

    const mockReader = {
      b01: {
        load: async () => upstreamB01,
        listVersions: async () => ["v1.0"],
        latest: async () => upstreamB01,
        save: async () => {},
      },
      b02: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b03: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b04: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b05: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b06: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b07: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b08: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b09: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b10: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b11: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
    };

    const state = await createBranchState("v1.0", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
      upstreamReader: mockReader,
    });

    expect(state.provenance_refs.length).toBe(1);
    expect(state.provenance_refs[0].id).toBe("P-B01-SENTINEL-001");
    expect(state.provenance_refs[0].type).toBe("INFERRED");
  });

  // ========================================================================
  // STEP 10: UPSTREAM AUDIT PRESERVATION TEST
  // ========================================================================

  it("preserves upstream audit trail entries in merged audit trail", async () => {
    const upstreamB01 = {
      version: "v1.0",
      evidence_refs: [],
      provenance_refs: [],
      governance_events: {},
      audit_trail: [
        {
          version: "v1.0",
          changed_at: "2026-01-01T12:00:00Z",
          changed_by: "user@example.com",
          summary: "Initial B01 ecosystem discovery",
        },
      ],
    };

    const upstreamB05 = {
      version: "v1.0",
      evidence_refs: [],
      provenance_refs: [],
      governance_events: {},
      audit_trail: [
        {
          version: "v1.0",
          changed_at: "2026-01-01T13:00:00Z",
          changed_by: "user@example.com",
          summary: "B05 positioning framework established",
        },
      ],
    };

    const mockReader = {
      b01: {
        load: async () => upstreamB01,
        listVersions: async () => ["v1.0"],
        latest: async () => upstreamB01,
        save: async () => {},
      },
      b02: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b03: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b04: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b05: {
        load: async () => upstreamB05,
        listVersions: async () => ["v1.0"],
        latest: async () => upstreamB05,
        save: async () => {},
      },
      b06: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b07: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b08: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b09: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b10: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b11: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
    };

    const state = await createBranchState("v1.0", undefined, undefined, undefined, "v1.0", undefined, undefined, undefined, undefined, undefined, undefined, {
      upstreamReader: mockReader,
    });

    // Upstream audit entries should be in the merged trail
    expect(state.audit_trail.length).toBeGreaterThanOrEqual(2);

    // Find upstream entries by action text
    const b01Entry = state.audit_trail.find((a) => a.action.includes("b01") && a.action.includes("Initial B01 ecosystem discovery"));
    const b05Entry = state.audit_trail.find((a) => a.action.includes("b05") && a.action.includes("B05 positioning framework established"));

    expect(b01Entry).toBeDefined();
    expect(b05Entry).toBeDefined();
  });

  // ========================================================================
  // STEP 11: FULL LINEAGE TEST (B09→B10→B11→B12)
  // ========================================================================

  it("preserves complete B09→B10→B11→B12 lineage", async () => {
    // Create a realistic lineage chain with provenance tracking
    const upstreamB09 = {
      version: "v1.0",
      evidence_refs: [
        {
          id: "E-B09-OPTIMIZATION-001",
          source: "optimization_signal",
          status: "INFERRED" as const,
          reference: "continuous_learning_engine",
        },
      ],
      provenance_refs: [
        {
          id: "P-B09-PROPOSED-001",
          type: "RECOMMENDED" as const,
          decision_authority: "B09_optimizer",
          timestamp: "2026-01-01T08:00:00Z",
          rationale: "Detected optimization opportunity in content strategy",
        },
      ],
      governance_events: {},
      audit_trail: [
        {
          version: "v1.0",
          changed_at: "2026-01-01T08:00:00Z",
          changed_by: "optimization_engine",
          summary: "Optimization signals detected from B08 data streams",
        },
      ],
    };

    const upstreamB10 = {
      version: "v1.0",
      b09_version: "v1.0",
      evidence_refs: [
        {
          id: "E-B09-OPTIMIZATION-001",
          source: "optimization_signal",
          status: "INFERRED" as const,
          reference: "continuous_learning_engine",
        },
      ],
      provenance_refs: [
        {
          id: "P-B09-PROPOSED-001",
          type: "RECOMMENDED" as const,
          decision_authority: "B09_optimizer",
          timestamp: "2026-01-01T08:00:00Z",
          rationale: "Detected optimization opportunity in content strategy",
        },
        {
          id: "P-B10-DECIDED-001",
          type: "DECIDED" as const,
          decision_authority: "user@example.com",
          timestamp: "2026-01-01T09:00:00Z",
          prior_provenance_id: "P-B09-PROPOSED-001",
          rationale: "User approved B09 optimization recommendation",
        },
      ],
      governance_events: {
        "proposal_001": [
          {
            id: "G-B10-PROPOSED-001",
            timestamp: "2026-01-01T09:00:00Z",
            type: "PROPOSED",
            provenance: {
              id: "P-B10-EVENT-001",
              type: "INFERRED",
              timestamp: "2026-01-01T09:00:00Z",
            },
          },
          {
            id: "G-B10-APPROVED-001",
            timestamp: "2026-01-01T09:05:00Z",
            type: "APPROVED",
            provenance: {
              id: "P-B10-EVENT-002",
              type: "DECIDED",
              timestamp: "2026-01-01T09:05:00Z",
              prior_provenance_id: "P-B10-EVENT-001",
            },
          },
        ],
      },
      audit_trail: [
        {
          version: "v1.0",
          changed_at: "2026-01-01T09:00:00Z",
          changed_by: "user@example.com",
          summary: "Decision framework established from B09 optimization proposals",
        },
      ],
    };

    const upstreamB11 = {
      version: "v1.0",
      b10_version: "v1.0",
      evidence_refs: [
        {
          id: "E-B09-OPTIMIZATION-001",
          source: "optimization_signal",
          status: "INFERRED" as const,
          reference: "continuous_learning_engine",
        },
        {
          id: "E-B11-RISK-001",
          source: "risk_assessment",
          status: "INFERRED" as const,
          reference: "governance_policy_engine",
        },
      ],
      provenance_refs: [
        {
          id: "P-B09-PROPOSED-001",
          type: "RECOMMENDED" as const,
          decision_authority: "B09_optimizer",
          timestamp: "2026-01-01T08:00:00Z",
          rationale: "Detected optimization opportunity in content strategy",
        },
        {
          id: "P-B10-DECIDED-001",
          type: "DECIDED" as const,
          decision_authority: "user@example.com",
          timestamp: "2026-01-01T09:00:00Z",
          prior_provenance_id: "P-B09-PROPOSED-001",
          rationale: "User approved B09 optimization recommendation",
        },
        {
          id: "P-B11-DECIDED-001",
          type: "DECIDED" as const,
          decision_authority: "user@example.com",
          timestamp: "2026-01-01T10:00:00Z",
          prior_provenance_id: "P-B10-DECIDED-001",
          rationale: "Risk and compliance assessment completed for B10 decision",
        },
      ],
      governance_events: {
        "rule_001": [
          {
            id: "G-B11-PROPOSED-001",
            timestamp: "2026-01-01T10:00:00Z",
            type: "PROPOSED",
            provenance: {
              id: "P-B11-EVENT-001",
              type: "INFERRED",
              timestamp: "2026-01-01T10:00:00Z",
            },
          },
          {
            id: "G-B11-APPROVED-001",
            timestamp: "2026-01-01T10:05:00Z",
            type: "APPROVED",
            provenance: {
              id: "P-B11-EVENT-002",
              type: "DECIDED",
              timestamp: "2026-01-01T10:05:00Z",
              prior_provenance_id: "P-B11-EVENT-001",
            },
          },
        ],
      },
      audit_trail: [
        {
          version: "v1.0",
          changed_at: "2026-01-01T10:00:00Z",
          changed_by: "user@example.com",
          summary: "Compliance and risk assessment completed; governance rules established",
        },
      ],
    };

    const mockReader = {
      b01: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b02: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b03: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b04: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b05: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b06: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b07: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b08: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b09: {
        load: async () => upstreamB09,
        listVersions: async () => ["v1.0"],
        latest: async () => upstreamB09,
        save: async () => {},
      },
      b10: {
        load: async () => upstreamB10,
        listVersions: async () => ["v1.0"],
        latest: async () => upstreamB10,
        save: async () => {},
      },
      b11: {
        load: async () => upstreamB11,
        listVersions: async () => ["v1.0"],
        latest: async () => upstreamB11,
        save: async () => {},
      },
    };

    const state = await createBranchState(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "v1.0",
      "v1.0",
      "v1.0",
      { upstreamReader: mockReader },
    );

    // Verify complete lineage is preserved
    // Evidence: should have both B09 optimization signal and B11 risk assessment
    expect(state.evidence_refs.length).toBe(2);
    const eIds = state.evidence_refs.map((e) => e.id);
    expect(eIds).toContain("E-B09-OPTIMIZATION-001");
    expect(eIds).toContain("E-B11-RISK-001");

    // Provenance: should have B09 RECOMMENDED → B10 DECIDED → B11 DECIDED chain
    expect(state.provenance_refs.length).toBe(3);
    const pIds = state.provenance_refs.map((p) => p.id);
    expect(pIds).toContain("P-B09-PROPOSED-001");
    expect(pIds).toContain("P-B10-DECIDED-001");
    expect(pIds).toContain("P-B11-DECIDED-001");

    // Verify lineage chain: B10 should link back to B09, B11 should link back to B10
    const p10 = state.provenance_refs.find((p) => p.id === "P-B10-DECIDED-001");
    expect(p10?.prior_provenance_id).toBe("P-B09-PROPOSED-001");

    const p11 = state.provenance_refs.find((p) => p.id === "P-B11-DECIDED-001");
    expect(p11?.prior_provenance_id).toBe("P-B10-DECIDED-001");

    // Governance events: should have both B10 and B11 approval chains
    expect(Object.keys(state.governance_events).length).toBe(2); // "proposal_001" and "rule_001"
  });

  // ========================================================================
  // STEP 12: PARTIAL INPUT BEHAVIOR
  // ========================================================================

  it("handles partial upstream data (only B01 present)", async () => {
    const upstreamB01 = {
      version: "v1.0",
      evidence_refs: [
        {
          id: "E-B01-PARTIAL",
          source: "partial_test",
          status: "VERIFIED" as const,
          reference: "test_ref",
        },
      ],
      provenance_refs: [],
      governance_events: {},
      audit_trail: [],
    };

    const mockReader = {
      b01: {
        load: async () => upstreamB01,
        listVersions: async () => ["v1.0"],
        latest: async () => upstreamB01,
        save: async () => {},
      },
      b02: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b03: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b04: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b05: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b06: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b07: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b08: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b09: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b10: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b11: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
    };

    const state = await createBranchState("v1.0", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
      upstreamReader: mockReader,
    });

    // Completeness should reflect partial data
    expect(state.completeness_summary.b01_ready).toBe(true);
    expect(state.completeness_summary.b02_ready).toBe(false);
    expect(state.completeness_summary.overall_completeness).toBeLessThan(100);

    // Evidence should only include B01 data
    expect(state.evidence_refs.length).toBe(1);
    expect(state.evidence_refs[0].id).toBe("E-B01-PARTIAL");
  });

  it("deterministic audit trail ordering across multiple runs", async () => {
    const upstreamB01 = {
      version: "v1.0",
      evidence_refs: [],
      provenance_refs: [],
      governance_events: {},
      audit_trail: [
        {
          version: "v1.0",
          changed_at: "2026-01-01T10:00:00Z",
          changed_by: "user@example.com",
          summary: "B01 entry 1",
        },
        {
          version: "v1.0",
          changed_at: "2026-01-01T11:00:00Z",
          changed_by: "user@example.com",
          summary: "B01 entry 2",
        },
      ],
    };

    const mockReader = {
      b01: {
        load: async () => upstreamB01,
        listVersions: async () => ["v1.0"],
        latest: async () => upstreamB01,
        save: async () => {},
      },
      b02: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b03: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b04: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b05: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b06: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b07: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b08: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b09: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b10: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b11: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
    };

    const state1 = await createBranchState("v1.0", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
      upstreamReader: mockReader,
      now: () => "2026-01-01T15:00:00Z",
    });

    const state2 = await createBranchState("v1.0", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
      upstreamReader: mockReader,
      now: () => "2026-01-01T15:00:00Z",
    });

    // Audit trails should be identical (same semantic input, same mocked time)
    expect(state1.audit_trail.length).toBe(state2.audit_trail.length);

    // All upstream entries should appear in both
    const b01Entries1 = state1.audit_trail.filter((a) => a.action.includes("b01"));
    const b01Entries2 = state2.audit_trail.filter((a) => a.action.includes("b01"));

    expect(b01Entries1.length).toBe(2);
    expect(b01Entries2.length).toBe(2);
  });

  // ========================================================================
  // STEP 13: DETERMINISM (same input + different timestamps = same state_id)
  // ========================================================================

  it("state_id is deterministic regardless of B12 creation timestamps", async () => {
    const mockReader = {
      b01: {
        load: async () => ({
          version: "v1.0",
          evidence_refs: [],
          provenance_refs: [],
          governance_events: {},
          audit_trail: [],
        }),
        listVersions: async () => ["v1.0"],
        latest: async () => null,
        save: async () => {},
      },
      b02: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b03: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b04: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b05: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b06: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b07: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b08: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b09: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b10: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
      b11: { load: async () => null, listVersions: async () => [], latest: async () => null, save: async () => {} },
    };

    const state1 = await createBranchState("v1.0", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
      upstreamReader: mockReader,
      now: () => "2026-01-01T00:00:00Z",
    });

    const state2 = await createBranchState("v1.0", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
      upstreamReader: mockReader,
      now: () => "2035-12-31T23:59:59Z",
    });

    // state_id should be identical (content-derived, wall-clock independent)
    expect(state1.state_id).toBe(state2.state_id);

    // But metadata timestamps should differ
    expect(state1.created_at).not.toBe(state2.created_at);
  });

  // ========================================================================
  // STEP 14: TYPE SAFETY (no unjustified any casts)
  // ========================================================================

  it("branch state contains no untyped evidence_refs", async () => {
    const state = await createBranchState("v1.0");

    // evidence_refs should be a typed EvidenceRef[] (verify structure via has/type guards)
    expect(Array.isArray(state.evidence_refs)).toBe(true);

    if (state.evidence_refs.length > 0) {
      const ev = state.evidence_refs[0];
      expect(typeof ev.id).toBe("string");
      expect(typeof ev.source).toBe("string");
      expect(["VERIFIED", "INFERRED", "UNKNOWN"]).toContain(ev.status);
    }
  });

  it("branch state contains no untyped provenance_refs", async () => {
    const state = await createBranchState("v1.0");

    expect(Array.isArray(state.provenance_refs)).toBe(true);

    if (state.provenance_refs.length > 0) {
      const prov = state.provenance_refs[0];
      expect(typeof prov.id).toBe("string");
      expect(typeof prov.type).toBe("string");
      expect(["OBSERVED", "INFERRED", "RECOMMENDED", "DECIDED", "CANONICAL"]).toContain(prov.type);
    }
  });

  // ========================================================================
  // STEP 15: A/B BOUNDARY (no production specs in B12)
  // ========================================================================

  it("completeness_summary contains no production-specific fields", () => {
    // The completeness summary must be strategic only (readiness booleans + percentage)
    // Must NOT contain production specs like bitrate, resolution, codec, exact timing, etc.
    const versions = aggregateModuleVersions("v1.0", "v1.0", "v1.0", "v1.0", "v1.0", "v1.0", "v1.0", "v1.0", "v1.0", "v1.0", "v1.0");
    const completeness = validateBranchCompleteness(versions);

    // Should have strategic readiness booleans and percentage
    expect(typeof completeness.overall_completeness).toBe("number");
    expect(typeof completeness.b01_ready).toBe("boolean");

    // Should NOT have production specs (verify by checking field names)
    const keys = Object.keys(completeness);
    const prohibitedKeys = ["bitrate", "resolution", "codec", "frame_rate", "render_config", "production_prompt", "exact_timing", "execution_script"];

    prohibitedKeys.forEach((prohibited) => {
      expect(keys).not.toContain(prohibited);
    });
  });

  it("module_versions contains strategic data only", async () => {
    const state = await createBranchState("v1.0", "v1.0", "v1.0");

    // module_versions should contain strategic version/timestamp data
    // NOT production execution specs
    state.module_versions.forEach((mv) => {
      expect(typeof mv.module).toBe("string");
      expect(typeof mv.version).toBe("string");
      expect(typeof mv.created_at).toBe("string");
      expect(typeof mv.canonical_state_id).toBe("string");

      // Should NOT have production fields
      expect((mv as any).bitrate).toBeUndefined();
      expect((mv as any).resolution).toBeUndefined();
      expect((mv as any).render_config).toBeUndefined();
    });
  });

  it("canonicalization loss is documented and intentional", () => {
    // KNOWN_CANONICALIZATION_DROPS should explicitly document any intentional
    // loss of information during state construction
    expect(typeof KNOWN_CANONICALIZATION_DROPS).toBe("object");

    // Should have entries documenting upstream data handling
    const dropKeys = Object.keys(KNOWN_CANONICALIZATION_DROPS);
    expect(dropKeys.length).toBeGreaterThan(0);

    // Each documented drop should have a human-readable reason
    dropKeys.forEach((key) => {
      expect(typeof (KNOWN_CANONICALIZATION_DROPS as any)[key]).toBe("string");
      expect(((KNOWN_CANONICALIZATION_DROPS as any)[key] as string).length).toBeGreaterThan(0);
    });
  });

  it("tracks missing modules (requested version not found)", async () => {
    // Mock upstream reader that returns null for one module
    const mockReader = {
      b01: { load: async () => ({ evidence_refs: [], provenance_refs: [], governance_events: {} }) },
      b02: { load: async () => null }, // MISSING: returns null
      b03: { load: async () => ({ evidence_refs: [], provenance_refs: [], governance_events: {} }) },
    } as any;

    const state = await createBranchState(
      "v1.0",
      "v1.0",
      "v1.0",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { upstreamReader: mockReader },
    );

    expect(state.missing_modules).toContain("B02:v1.0");
    expect(state.failed_modules.length).toBe(0);
  });

  it("tracks failed modules (load throws error)", async () => {
    // Mock upstream reader that throws error for one module
    const mockReader = {
      b01: { load: async () => ({ evidence_refs: [], provenance_refs: [], governance_events: {} }) },
      b02: { load: async () => { throw new Error("Persistence unavailable"); } }, // FAILED: throws
      b03: { load: async () => ({ evidence_refs: [], provenance_refs: [], governance_events: {} }) },
    } as any;

    const state = await createBranchState(
      "v1.0",
      "v1.0",
      "v1.0",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { upstreamReader: mockReader },
    );

    expect(state.failed_modules).toContain("B02:v1.0");
    expect(state.missing_modules.length).toBe(0);
  });

  it("distinguishes missing from failed modules", async () => {
    // Mock upstream reader with both missing and failed modules
    const mockReader = {
      b01: { load: async () => ({ evidence_refs: [], provenance_refs: [], governance_events: {} }) },
      b02: { load: async () => null }, // MISSING
      b03: { load: async () => { throw new Error("Persistence error"); } }, // FAILED
      b04: { load: async () => ({ evidence_refs: [], provenance_refs: [], governance_events: {} }) },
    } as any;

    const state = await createBranchState(
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { upstreamReader: mockReader },
    );

    expect(state.missing_modules).toContain("B02:v1.0");
    expect(state.failed_modules).toContain("B03:v1.0");
    expect(state.missing_modules).not.toContain("B03:v1.0");
    expect(state.failed_modules).not.toContain("B02:v1.0");
  });

  it("preserves missing_modules and failed_modules on state commit", async () => {
    const state = await createBranchState(
      "v1.0",
      "v1.0",
      "v1.0",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    // Add missing/failed modules to the state for testing
    const testState: any = {
      ...state,
      missing_modules: ["B02:v1.0"],
      failed_modules: ["B03:v1.0"],
    };

    const committed = await commitBranchState(
      testState,
      "test-authority",
      "Testing state commit preserves error tracking",
      persistence,
    );

    expect(committed.missing_modules).toEqual(["B02:v1.0"]);
    expect(committed.failed_modules).toEqual(["B03:v1.0"]);
  });

  it("handles partial aggregation with upstream errors", async () => {
    // Test that B12 gracefully degrades when some upstream modules fail
    const mockReader = {
      b01: { load: async () => ({ evidence_refs: [{ id: "ev1", source: "test", status: "VERIFIED" as const }], provenance_refs: [], governance_events: {} }) },
      b02: { load: async () => null },
      b03: { load: async () => { throw new Error("DB unavailable"); } },
      b04: { load: async () => ({ evidence_refs: [], provenance_refs: [], governance_events: {} }) },
    } as any;

    const state = await createBranchState(
      "v1.0",
      "v1.0",
      "v1.0",
      "v1.0",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { upstreamReader: mockReader },
    );

    // Should still have evidence from successful modules
    expect(state.evidence_refs.length).toBeGreaterThan(0);
    // Should track failures
    expect(state.missing_modules).toContain("B02:v1.0");
    expect(state.failed_modules).toContain("B03:v1.0");
  });

  describe("GATE B Regression Tests — D-001 Upstream Reader Observable State", () => {
    it("scenario 1: no upstreamReader (reader unavailable) — missing_modules populated", async () => {
      // GATE B: When upstreamReader not provided, aggregation is incomplete and must be observable
      // This test verifies the fix: missing_modules contains all requested versions when reader unavailable
      const state = await createBranchState(
        "v1.0",
        "v1.0",
        "v1.0",
        "v1.0",
        "v1.0",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { /* no upstreamReader */ },
      );

      // Before GATE B fix: missing_modules would be empty, evidence/provenance empty with no indication
      // After GATE B fix: missing_modules contains all requested versions, making incomplete state observable
      expect(state.missing_modules.length).toBeGreaterThan(0);
      expect(state.missing_modules).toContain("B01:v1.0");
      expect(state.missing_modules).toContain("B02:v1.0");
      expect(state.missing_modules).toContain("B03:v1.0");
      expect(state.missing_modules).toContain("B04:v1.0");
      expect(state.missing_modules).toContain("B05:v1.0");

      // Evidence should be empty (as before)
      expect(state.evidence_refs.length).toBe(0);
      expect(state.provenance_refs.length).toBe(0);
      expect(Object.keys(state.governance_events).length).toBe(0);

      // But now downstream consumers can detect incomplete state
      expect(state.missing_modules.length > 0 || state.failed_modules.length > 0).toBe(true);
    });

    it("scenario 2: reader configured, module version missing (load returns null)", async () => {
      // When reader is available but specific module version not found
      const mockReader = {
        b01: { load: async () => ({ evidence_refs: [], provenance_refs: [], governance_events: {} }) },
        b02: { load: async () => null }, // Missing
        b03: { load: async () => ({ evidence_refs: [], provenance_refs: [], governance_events: {} }) },
        b04: { load: async () => ({ evidence_refs: [], provenance_refs: [], governance_events: {} }) },
      } as any;

      const state = await createBranchState(
        "v1.0",
        "v1.0",
        "v1.0",
        "v1.0",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { upstreamReader: mockReader },
      );

      expect(state.missing_modules).toContain("B02:v1.0");
      expect(state.failed_modules.length).toBe(0); // Not a failure, just missing
    });

    it("scenario 3: reader configured, module throws error (load throws)", async () => {
      // When reader is available but load throws error
      const mockReader = {
        b01: { load: async () => ({ evidence_refs: [], provenance_refs: [], governance_events: {} }) },
        b02: { load: async () => { throw new Error("DB connection failed"); } }, // Throws
        b03: { load: async () => ({ evidence_refs: [], provenance_refs: [], governance_events: {} }) },
        b04: { load: async () => ({ evidence_refs: [], provenance_refs: [], governance_events: {} }) },
      } as any;

      const state = await createBranchState(
        "v1.0",
        "v1.0",
        "v1.0",
        "v1.0",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { upstreamReader: mockReader },
      );

      expect(state.failed_modules).toContain("B02:v1.0");
      expect(state.missing_modules).not.toContain("B02:v1.0"); // Not missing, failed
    });

    it("scenario 4: successful partial aggregation (some modules available)", async () => {
      // When some upstream modules are successfully loaded
      const mockReader = {
        b01: { load: async () => ({ evidence_refs: [{ id: "ev1", source: "test", status: "VERIFIED" as const }], provenance_refs: [], governance_events: {} }) },
        b02: { load: async () => null }, // Missing
        b03: { load: async () => ({ evidence_refs: [], provenance_refs: [], governance_events: {} }) },
      } as any;

      const state = await createBranchState(
        "v1.0",
        "v1.0",
        "v1.0",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { upstreamReader: mockReader },
      );

      expect(state.evidence_refs.length).toBeGreaterThan(0); // Evidence from successful modules
      expect(state.missing_modules).toContain("B02:v1.0"); // Missing tracked
      expect(state.failed_modules.length).toBe(0); // No failures
    });

    it("scenario 5: mixed success + missing + failed modules", async () => {
      // Complex real-world scenario: some succeed, some missing, some fail
      const mockReader = {
        b01: { load: async () => ({ evidence_refs: [{ id: "ev1", source: "test", status: "VERIFIED" as const }], provenance_refs: [], governance_events: {} }) },
        b02: { load: async () => null }, // Missing
        b03: { load: async () => { throw new Error("Unavailable"); } }, // Failed
        b04: { load: async () => ({ evidence_refs: [], provenance_refs: [], governance_events: {} }) },
      } as any;

      const state = await createBranchState(
        "v1.0",
        "v1.0",
        "v1.0",
        "v1.0",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { upstreamReader: mockReader },
      );

      // All three conditions present
      expect(state.evidence_refs.length).toBeGreaterThan(0); // B01 success
      expect(state.missing_modules).toContain("B02:v1.0"); // B02 missing
      expect(state.failed_modules).toContain("B03:v1.0"); // B03 failed

      // Downstream can detect partial aggregation
      const isComplete = state.missing_modules.length === 0 && state.failed_modules.length === 0;
      expect(isComplete).toBe(false);
    });
  });
});
