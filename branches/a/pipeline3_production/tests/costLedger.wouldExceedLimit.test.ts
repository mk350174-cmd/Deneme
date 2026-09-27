// costLedger.ts — wouldExceedLimit(). Added so P3.09's orchestrator can use
// the REAL CostLedger for capacity/quota checks instead of a private
// placeholder class that always returned false regardless of actual spend.

import { describe, expect, it } from "vitest";
import { CostLedger } from "../src/costLedger.js";

describe("CostLedger.wouldExceedLimit", () => {
  it("returns false when neither a provider quota nor the overall budget is at risk", () => {
    const ledger = new CostLedger(1000);
    expect(ledger.wouldExceedLimit("kaggle_render", 10)).toBe(false);
  });

  it("returns true when the additional cost would exceed the overall budget", () => {
    const ledger = new CostLedger(100);
    ledger.log({ provider: "kaggle_render", operation: "render", units: 1, unit_cost: 90, cost: 90, accepted: true });
    expect(ledger.wouldExceedLimit("kaggle_render", 20)).toBe(true);
  });

  it("returns true when a provider-specific unit quota would be exceeded, even under overall budget", () => {
    const ledger = new CostLedger(100_000, { kaggle_render: 5 });
    ledger.log({ provider: "kaggle_render", operation: "render", units: 3, unit_cost: 1, cost: 3, accepted: true });
    // 3 units already used, quota is 5 -> +3 more would be 6, over quota,
    // even though the overall $100,000 budget is nowhere near exceeded.
    expect(ledger.wouldExceedLimit("kaggle_render", 3)).toBe(true);
  });

  it("with no budget cap (Infinity, the orchestrator's default), never reports exceeded absent a provider quota", () => {
    const ledger = new CostLedger(Number.POSITIVE_INFINITY);
    expect(ledger.wouldExceedLimit("kaggle_render", 1_000_000)).toBe(false);
  });
});
