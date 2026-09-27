// ElevenLabs preflight — items 13 (validation), 14 (cost-limit enforcement),
// 15 (pronunciation/number/date/unit validation), 16 (Gate A6 behavior).

import { describe, expect, it } from "vitest";
import { CostLedger } from "../src/costLedger.js";
import { runElevenLabsPreflight } from "../src/preflight.js";
import type { PreflightCheckFns } from "../src/preflight.js";
import type { PronunciationFlag } from "../src/types.js";

const allGoodFns: PreflightCheckFns = {
  checkApiConnectivity: async () => true,
  checkVoiceAvailability: async () => true,
  checkModelAvailability: async () => true,
  getQuotaRemaining: async () => 100000,
};

const flags: PronunciationFlag[] = [
  { token: "312 BC", flag_type: "date", note: "n" },
  { token: "Aqua Appia", flag_type: "special_terminology", note: "n" },
];

describe("ElevenLabs preflight (item 13)", () => {
  it("proceeds when all 9 checks pass and all flags are resolved", async () => {
    const ledger = new CostLedger(1000);
    const result = await runElevenLabsPreflight({
      text: "short text",
      voiceId: "v1",
      modelId: "m1",
      pronunciationFlags: flags,
      resolvedFlagTokens: new Set(["312 BC", "Aqua Appia"]),
      costLedger: ledger,
      provider: "elevenlabs",
      fns: allGoodFns,
    });
    expect(result.proceed).toBe(true);
    expect(result.material_ambiguity).toBe(false);
    expect(result.route_to_gate_a6).toBe(false);
  });

  it("fails connectivity/voice/model checks individually", async () => {
    const ledger = new CostLedger(1000);
    const result = await runElevenLabsPreflight({
      text: "short text",
      voiceId: "v1",
      modelId: "m1",
      pronunciationFlags: [],
      resolvedFlagTokens: new Set(),
      costLedger: ledger,
      provider: "elevenlabs",
      fns: { ...allGoodFns, checkApiConnectivity: async () => false },
    });
    expect(result.checks.api_connectivity).toBe(false);
    expect(result.material_ambiguity).toBe(true);
  });
});

describe("cost-limit enforcement (item 14)", () => {
  it("blocks when estimated usage exceeds remaining quota", async () => {
    const ledger = new CostLedger(1000);
    const result = await runElevenLabsPreflight({
      text: "a".repeat(500),
      voiceId: "v1",
      modelId: "m1",
      pronunciationFlags: [],
      resolvedFlagTokens: new Set(),
      costLedger: ledger,
      provider: "elevenlabs",
      fns: { ...allGoodFns, getQuotaRemaining: async () => 100 },
    });
    expect(result.checks.within_hard_cost_limit).toBe(false);
    expect(result.material_ambiguity).toBe(true);
  });

  it("blocks when the unified cost ledger's hard limit would be exceeded", async () => {
    const ledger = new CostLedger(50); // very low budget
    const result = await runElevenLabsPreflight({
      text: "a".repeat(500),
      voiceId: "v1",
      modelId: "m1",
      pronunciationFlags: [],
      resolvedFlagTokens: new Set(),
      costLedger: ledger,
      provider: "elevenlabs",
      fns: allGoodFns,
    });
    expect(result.checks.within_hard_cost_limit).toBe(false);
  });
});

describe("pronunciation/number/date/unit validation (item 15) — never silently normalized", () => {
  it("flags unresolved number/date/unit tokens as material ambiguity", async () => {
    const ledger = new CostLedger(1000);
    const result = await runElevenLabsPreflight({
      text: "text",
      voiceId: "v1",
      modelId: "m1",
      pronunciationFlags: flags,
      resolvedFlagTokens: new Set(), // nothing resolved
      costLedger: ledger,
      provider: "elevenlabs",
      fns: allGoodFns,
    });
    expect(result.checks.unresolved_number_date_unit_flags).toHaveLength(1);
    expect(result.checks.unresolved_terminology_flags).toHaveLength(1);
    expect(result.material_ambiguity).toBe(true);
  });
});

describe("Gate A6 routing (item 16)", () => {
  it("routes to Gate A6 exactly when material ambiguity remains", async () => {
    const ledger = new CostLedger(1000);
    const ambiguous = await runElevenLabsPreflight({
      text: "text",
      voiceId: "v1",
      modelId: "m1",
      pronunciationFlags: flags,
      resolvedFlagTokens: new Set(),
      costLedger: ledger,
      provider: "elevenlabs",
      fns: allGoodFns,
    });
    expect(ambiguous.route_to_gate_a6).toBe(true);

    const clean = await runElevenLabsPreflight({
      text: "text",
      voiceId: "v1",
      modelId: "m1",
      pronunciationFlags: flags,
      resolvedFlagTokens: new Set(["312 BC", "Aqua Appia"]),
      costLedger: ledger,
      provider: "elevenlabs",
      fns: allGoodFns,
    });
    expect(clean.route_to_gate_a6).toBe(false);
  });
});
