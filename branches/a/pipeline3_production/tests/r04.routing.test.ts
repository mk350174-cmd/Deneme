// R04 — provider routing proof tests. The critical rule under test:
// fallback happens ONLY for genuine provider conditions; governance
// failures always hard-fail regardless of which provider is tried first.

import { describe, expect, it } from "vitest";
import { recordGateApproval } from "../src/gates.js";
import { GateStateError } from "../src/errors.js";
import { generateWithFallback, isFallbackEligible } from "../src/voiceProviderRouting.js";
import type { ProductionVoiceProvider, ProviderResult, ProviderStatus } from "../src/voiceProviderTypes.js";

function approvedA5() {
  const a4 = recordGateApproval({
    gateId: "A4", stateBefore: "AWAITING_PRODUCTION_DELIVERY", actor: "user:x",
    objectVersionBeingApproved: "d1", stateAfter: "PRODUCTION_DELIVERY_RECEIVED",
    downstreamOperationUnlocked: "P3.02",
  });
  const a5 = recordGateApproval({
    gateId: "A5", stateBefore: "PIPER_PREVIEW_GENERATED", actor: "user:x",
    objectVersionBeingApproved: "prev1", stateAfter: "NARRATION_APPROVED_FOR_PRODUCTION",
    downstreamOperationUnlocked: "P3.05", history: [a4],
  });
  return [a4, a5];
}

// A minimal fake provider — behaves exactly like the real ones with respect
// to governance (checks A5 itself, throws GateStateError) but is otherwise
// scripted for the test.
function fakeProvider(opts: {
  name: "elevenlabs" | "voicebox";
  available: boolean;
  availabilityStatus?: ProviderStatus;
  result?: ProviderResult;
  onGenerateCalled?: () => void;
}): ProductionVoiceProvider {
  return {
    name: opts.name,
    async availability() {
      return { available: opts.available, status: opts.availabilityStatus ?? (opts.available ? "SUCCESS" : "UNAVAILABLE") };
    },
    async generate(params) {
      opts.onGenerateCalled?.();
      // Real governance check, exactly like the real providers.
      const { requireGateState } = await import("../src/gates.js");
      requireGateState(params.gates, "A5", "NARRATION_APPROVED_FOR_PRODUCTION");
      return opts.result ?? { status: "SUCCESS", voice: { audio_path: "x.wav", audio_hash: "h", duration_s: 1, character_count: 1, cost_units: 0, listen_check_word_ratio: 0, listen_check_attempts: 0 } };
    },
  };
}

describe("R04 isFallbackEligible", () => {
  it("genuine provider conditions are fallback-eligible", () => {
    for (const s of ["NOT_CONFIGURED", "UNAVAILABLE", "AUTH_FAILED", "QUOTA_UNAVAILABLE", "TIMEOUT", "PROVIDER_ERROR"] as ProviderStatus[]) {
      expect(isFallbackEligible(s)).toBe(true);
    }
  });

  it("INVALID_REQUEST is NOT fallback-eligible (a malformed request isn't a provider outage)", () => {
    expect(isFallbackEligible("INVALID_REQUEST")).toBe(false);
  });

  it("SUCCESS is not a fallback trigger (not meaningfully 'eligible')", () => {
    expect(isFallbackEligible("SUCCESS")).toBe(false);
  });
});

describe("R04 routing: ElevenLabs available -> used directly", () => {
  it("uses ElevenLabs and never calls Voicebox when ElevenLabs succeeds", async () => {
    let voiceboxCalled = false;
    const elevenLabs = fakeProvider({ name: "elevenlabs", available: true });
    const voicebox = fakeProvider({ name: "voicebox", available: true, onGenerateCalled: () => { voiceboxCalled = true; } });
    const outcome = await generateWithFallback({
      elevenLabs, voicebox,
      request: { text: "hello", voiceLineId: "vl_1", gates: approvedA5() },
    });
    expect(outcome.usedProvider).toBe("elevenlabs");
    expect(voiceboxCalled).toBe(false);
    expect(outcome.attempts).toHaveLength(1);
  });
});

describe("R04 routing: genuine provider conditions trigger fallback", () => {
  it("ElevenLabs NOT_CONFIGURED (no key) -> falls back to Voicebox", async () => {
    const elevenLabs = fakeProvider({ name: "elevenlabs", available: false, availabilityStatus: "NOT_CONFIGURED" });
    const voicebox = fakeProvider({ name: "voicebox", available: true });
    const outcome = await generateWithFallback({
      elevenLabs, voicebox,
      request: { text: "hello", voiceLineId: "vl_1", gates: approvedA5() },
    });
    expect(outcome.usedProvider).toBe("voicebox");
    expect(outcome.attempts[0]!.result.status).toBe("NOT_CONFIGURED");
    expect(outcome.attempts[1]!.provider).toBe("voicebox");
  });

  it("ElevenLabs available but returns AUTH_FAILED -> falls back to Voicebox", async () => {
    const elevenLabs = fakeProvider({ name: "elevenlabs", available: true, result: { status: "AUTH_FAILED", errorMessage: "bad key" } });
    const voicebox = fakeProvider({ name: "voicebox", available: true });
    const outcome = await generateWithFallback({
      elevenLabs, voicebox,
      request: { text: "hello", voiceLineId: "vl_1", gates: approvedA5() },
    });
    expect(outcome.usedProvider).toBe("voicebox");
    expect(outcome.result.status).toBe("SUCCESS");
  });

  it("ElevenLabs QUOTA_UNAVAILABLE -> falls back to Voicebox", async () => {
    const elevenLabs = fakeProvider({ name: "elevenlabs", available: true, result: { status: "QUOTA_UNAVAILABLE" } });
    const voicebox = fakeProvider({ name: "voicebox", available: true });
    const outcome = await generateWithFallback({
      elevenLabs, voicebox,
      request: { text: "hello", voiceLineId: "vl_1", gates: approvedA5() },
    });
    expect(outcome.usedProvider).toBe("voicebox");
  });

  it("ElevenLabs TIMEOUT -> falls back to Voicebox", async () => {
    const elevenLabs = fakeProvider({ name: "elevenlabs", available: true, result: { status: "TIMEOUT" } });
    const voicebox = fakeProvider({ name: "voicebox", available: true });
    const outcome = await generateWithFallback({
      elevenLabs, voicebox,
      request: { text: "hello", voiceLineId: "vl_1", gates: approvedA5() },
    });
    expect(outcome.usedProvider).toBe("voicebox");
  });

  it("both providers unavailable -> the Voicebox failure is surfaced, not silently swallowed", async () => {
    const elevenLabs = fakeProvider({ name: "elevenlabs", available: false, availabilityStatus: "NOT_CONFIGURED" });
    const voicebox = fakeProvider({ name: "voicebox", available: true, result: { status: "UNAVAILABLE", errorMessage: "voicebox server not running" } });
    const outcome = await generateWithFallback({
      elevenLabs, voicebox,
      request: { text: "hello", voiceLineId: "vl_1", gates: approvedA5() },
    });
    expect(outcome.result.status).toBe("UNAVAILABLE");
    expect(outcome.usedProvider).toBe("voicebox");
  });
});

describe("R04 CRITICAL RULE: governance failures hard-fail, never trigger fallback", () => {
  it("missing A5 hard-fails on ElevenLabs and Voicebox is NEVER called", async () => {
    let voiceboxCalled = false;
    const elevenLabs = fakeProvider({ name: "elevenlabs", available: true });
    const voicebox = fakeProvider({ name: "voicebox", available: true, onGenerateCalled: () => { voiceboxCalled = true; } });
    await expect(
      generateWithFallback({ elevenLabs, voicebox, request: { text: "hello", voiceLineId: "vl_1", gates: [] } }),
    ).rejects.toThrow(GateStateError);
    expect(voiceboxCalled).toBe(false);
  });

  it("missing A5 hard-fails even when ElevenLabs is unavailable (fallback path also governance-checks)", async () => {
    const elevenLabs = fakeProvider({ name: "elevenlabs", available: false, availabilityStatus: "NOT_CONFIGURED" });
    const voicebox = fakeProvider({ name: "voicebox", available: true }); // would succeed if reached with valid gates
    await expect(
      generateWithFallback({ elevenLabs, voicebox, request: { text: "hello", voiceLineId: "vl_1", gates: [] } }),
    ).rejects.toThrow(GateStateError);
  });

  it("INVALID_REQUEST from ElevenLabs is surfaced directly, Voicebox is never tried", async () => {
    let voiceboxCalled = false;
    const elevenLabs = fakeProvider({ name: "elevenlabs", available: true, result: { status: "INVALID_REQUEST", errorMessage: "malformed text" } });
    const voicebox = fakeProvider({ name: "voicebox", available: true, onGenerateCalled: () => { voiceboxCalled = true; } });
    const outcome = await generateWithFallback({
      elevenLabs, voicebox,
      request: { text: "hello", voiceLineId: "vl_1", gates: approvedA5() },
    });
    expect(outcome.result.status).toBe("INVALID_REQUEST");
    expect(outcome.usedProvider).toBe("elevenlabs");
    expect(voiceboxCalled).toBe(false);
  });
});
