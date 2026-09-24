// P3.01 Ingest — three explicit, separately-testable validation layers
// (items 1, 2, 3): structural, integrity, referential consistency.

import { describe, expect, it } from "vitest";
import { HandoffValidationError } from "../src/errors.js";
import {
  parseProductionDelivery,
  parseProductionPackage,
  validateGateApproval,
  validateIntegrity,
  validateReferentialConsistency,
  validateStructural,
  validateStructuralDelivery,
} from "../src/ingest.js";
import { PRODUCTION_PACKAGE_FIXTURE } from "./fixtures/production_package.fixture.js";
import { PRODUCTION_DELIVERY_FIXTURE } from "./fixtures/production_delivery.fixture.js";

describe("P3.01 layer A — structural validation", () => {
  it("accepts the well-formed fixture", () => {
    const pkg = validateStructural(PRODUCTION_PACKAGE_FIXTURE);
    expect(pkg.package_id).toBe(PRODUCTION_PACKAGE_FIXTURE.package_id);
  });

  it("rejects a package missing a required field, naming the layer and field", () => {
    const malformed = { ...PRODUCTION_PACKAGE_FIXTURE } as Record<string, unknown>;
    delete malformed.scenes;
    try {
      validateStructural(malformed);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HandoffValidationError);
      expect((err as HandoffValidationError).layer).toBe("structural");
      expect((err as HandoffValidationError).field).toBe("scenes");
    }
  });

  it("rejects an asset_requirement missing its shot_id FK", () => {
    const malformed = {
      ...PRODUCTION_PACKAGE_FIXTURE,
      asset_requirements: [{ asset_requirement_id: "x", expected_media_type: "y" }],
    };
    expect(() => validateStructural(malformed)).toThrow(HandoffValidationError);
  });

  it("Production Delivery: accepts the well-formed fixture", () => {
    const delivery = validateStructuralDelivery(PRODUCTION_DELIVERY_FIXTURE);
    expect(delivery.asset_delivery_map).toHaveLength(2);
  });

  it("Production Delivery: rejects a missing asset_delivery_map (REQUIRED, no fallback)", () => {
    const malformed = { generated_assets: [] };
    expect(() => validateStructuralDelivery(malformed)).toThrow(HandoffValidationError);
  });

  it("Production Delivery: an empty asset_delivery_map is structurally valid (nothing delivered yet)", () => {
    expect(() => validateStructuralDelivery({ asset_delivery_map: [], generated_assets: [] })).not.toThrow();
  });
});

describe("P3.01 layer B — integrity validation", () => {
  it("accepts the well-formed fixture", () => {
    expect(() => validateIntegrity(PRODUCTION_PACKAGE_FIXTURE)).not.toThrow();
  });

  it("rejects a malformed package_sha256", () => {
    const malformed = { ...PRODUCTION_PACKAGE_FIXTURE, integrity_hashes: { ...PRODUCTION_PACKAGE_FIXTURE.integrity_hashes, package_sha256: "not-a-hash" } };
    expect(() => validateIntegrity(malformed)).toThrow(HandoffValidationError);
  });

  it("rejects an empty manifest", () => {
    const malformed = { ...PRODUCTION_PACKAGE_FIXTURE, manifest: [] };
    expect(() => validateIntegrity(malformed)).toThrow(HandoffValidationError);
  });
});

describe("P3.01 layer C — referential consistency validation", () => {
  it("accepts the well-formed fixture", () => {
    expect(() => validateReferentialConsistency(PRODUCTION_PACKAGE_FIXTURE)).not.toThrow();
  });

  it("rejects a shot referencing a nonexistent scene_id", () => {
    const malformed = {
      ...PRODUCTION_PACKAGE_FIXTURE,
      shots: [{ ...PRODUCTION_PACKAGE_FIXTURE.shots[0]!, scene_id: "scene_nonexistent" }, PRODUCTION_PACKAGE_FIXTURE.shots[1]!],
    };
    expect(() => validateReferentialConsistency(malformed)).toThrow(HandoffValidationError);
  });

  it("rejects an asset_requirement whose shot_id doesn't resolve", () => {
    const malformed = {
      ...PRODUCTION_PACKAGE_FIXTURE,
      asset_requirements: [{ ...PRODUCTION_PACKAGE_FIXTURE.asset_requirements[0]!, shot_id: "shot_nonexistent" }],
    };
    expect(() => validateReferentialConsistency(malformed)).toThrow(HandoffValidationError);
  });

  it("rejects a prompt tracing to a nonexistent decision_id", () => {
    const malformed = {
      ...PRODUCTION_PACKAGE_FIXTURE,
      prompts: [{ ...PRODUCTION_PACKAGE_FIXTURE.prompts[0]!, spec: { ...PRODUCTION_PACKAGE_FIXTURE.prompts[0]!.spec, traceable_to: { shot_id: "shot_wide_arch", decision_id: "dec_nonexistent" } } }],
    };
    expect(() => validateReferentialConsistency(malformed)).toThrow(HandoffValidationError);
  });
});

describe("AUDIT FIX §13.3 — Gate A3 approval verification", () => {
  it("accepts the well-formed fixture (has a valid A3 PRODUCTION_PACKAGE_APPROVED record)", () => {
    expect(() => validateGateApproval(PRODUCTION_PACKAGE_FIXTURE)).not.toThrow();
  });

  it("rejects a package with an empty user_approval_state", () => {
    const malformed = { ...PRODUCTION_PACKAGE_FIXTURE, user_approval_state: [] };
    try {
      validateGateApproval(malformed);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HandoffValidationError);
      expect((err as HandoffValidationError).layer).toBe("integrity");
      expect((err as HandoffValidationError).field).toBe("user_approval_state");
    }
  });

  it("rejects a package whose approvals exist but never reached A3/PRODUCTION_PACKAGE_APPROVED (e.g. only Gate A2 records)", () => {
    const malformed = {
      ...PRODUCTION_PACKAGE_FIXTURE,
      user_approval_state: PRODUCTION_PACKAGE_FIXTURE.user_approval_state.filter((g) => g.gate_id === "A2"),
    };
    expect(() => validateGateApproval(malformed)).toThrow(HandoffValidationError);
  });

  it("parseProductionPackage fails end-to-end when Gate A3 was never approved — no fallback, no silent acceptance", () => {
    const malformed = { ...PRODUCTION_PACKAGE_FIXTURE, user_approval_state: [] };
    expect(() => parseProductionPackage(malformed)).toThrow(HandoffValidationError);
  });
});

describe("parseProductionPackage / parseProductionDelivery (full pipeline)", () => {
  it("accepts both well-formed fixtures end-to-end", () => {
    expect(() => parseProductionPackage(PRODUCTION_PACKAGE_FIXTURE)).not.toThrow();
    expect(() => parseProductionDelivery(PRODUCTION_DELIVERY_FIXTURE)).not.toThrow();
  });
});
