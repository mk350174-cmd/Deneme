// R03 — voice provider abstraction proof tests: ElevenLabsProvider,
// VoiceboxClient/VoiceboxProvider, and the routing rules that will govern
// R04. All network I/O is via injected fixture seams — no real HTTP calls,
// no real ElevenLabs/Voicebox servers required.

import { describe, expect, it } from "vitest";
import { recordGateApproval } from "../src/gates.js";
import { GateStateError } from "../src/errors.js";
import { ElevenLabsProvider, readElevenLabsApiKey } from "../src/elevenlabsProvider.js";
import { VoiceboxClient, VoiceboxHttpError, type VoiceboxHttpFetch, type VoiceboxAudioFetch } from "../src/voiceboxClient.js";
import { VoiceboxProvider, computeGenerationKey } from "../src/voiceboxProvider.js";
import type { PostElevenLabsHttp, VoiceLock } from "../src/elevenlabs.js";
import type { MediaProbe } from "../src/assetValidation.js";

function approvedA5() {
  const a4 = recordGateApproval({
    gateId: "A4",
    stateBefore: "AWAITING_PRODUCTION_DELIVERY",
    actor: "user:x",
    objectVersionBeingApproved: "delivery_1",
    stateAfter: "PRODUCTION_DELIVERY_RECEIVED",
    downstreamOperationUnlocked: "P3.02",
  });
  const a5 = recordGateApproval({
    gateId: "A5",
    stateBefore: "PIPER_PREVIEW_GENERATED",
    actor: "user:x",
    objectVersionBeingApproved: "preview_1",
    stateAfter: "NARRATION_APPROVED_FOR_PRODUCTION",
    downstreamOperationUnlocked: "P3.05",
    history: [a4],
  });
  return [a4, a5];
}

// ---------------------------------------------------------------------------
// readElevenLabsApiKey — runtime-secret-only
// ---------------------------------------------------------------------------

describe("R04 ElevenLabs readiness: runtime secret only, never embedded", () => {
  it("reads the key from the environment when present", () => {
    expect(readElevenLabsApiKey({ ELEVENLABS_API_KEY: "sk_test_123" } as NodeJS.ProcessEnv)).toBe("sk_test_123");
  });

  it("returns undefined (not a placeholder) when unset", () => {
    expect(readElevenLabsApiKey({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("treats a blank value the same as unset", () => {
    expect(readElevenLabsApiKey({ ELEVENLABS_API_KEY: "   " } as NodeJS.ProcessEnv)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ElevenLabsProvider
// ---------------------------------------------------------------------------

describe("ElevenLabsProvider", () => {
  const voiceLock: VoiceLock = { providers: { elevenlabs: { voice_id: "v1", model: "m1" } } };

  it("availability() reports NOT_CONFIGURED with no API key, without any network call", async () => {
    let called = false;
    const postHttp: PostElevenLabsHttp = async () => {
      called = true;
      return { status: 200, bodyBytes: Buffer.alloc(0) };
    };
    const provider = new ElevenLabsProvider({ voiceId: "v1", modelId: "m1", voiceLock, listenCheck: async () => ({ ratio: 1, attempts: 1 }), apiKey: undefined, postHttp });
    const result = await provider.availability();
    expect(result.available).toBe(false);
    expect(result.status).toBe("NOT_CONFIGURED");
    expect(called).toBe(false);
  });

  it("availability() reports available when configured (configuration check only, no network probe)", async () => {
    const provider = new ElevenLabsProvider({ voiceId: "v1", modelId: "m1", voiceLock, listenCheck: async () => ({ ratio: 1, attempts: 1 }), apiKey: "sk_real" });
    const result = await provider.availability();
    expect(result.available).toBe(true);
  });

  it("R04 CRITICAL RULE: a governance failure (missing A5) hard-fails and is NOT caught as a provider condition", async () => {
    const provider = new ElevenLabsProvider({ voiceId: "v1", modelId: "m1", voiceLock, listenCheck: async () => ({ ratio: 1, attempts: 1 }), apiKey: "sk_real" });
    await expect(
      provider.generate({ text: "hello", voiceLineId: "vl_1", gates: [] }), // no A5 approval
    ).rejects.toThrow(GateStateError);
  });

  it("a genuine HTTP auth failure (401) is normalized to AUTH_FAILED, not thrown", async () => {
    const postHttp: PostElevenLabsHttp = async () => ({ status: 401, bodyBytes: Buffer.from(JSON.stringify({ detail: "unauthorized" })) });
    const provider = new ElevenLabsProvider({ voiceId: "v1", modelId: "m1", voiceLock, listenCheck: async () => ({ ratio: 1, attempts: 1 }), apiKey: "sk_real", postHttp });
    const result = await provider.generate({ text: "hello", voiceLineId: "vl_1", gates: approvedA5() });
    expect(result.status).toBe("AUTH_FAILED");
  });

  it("a genuine quota failure (429) is normalized to QUOTA_UNAVAILABLE", async () => {
    const postHttp: PostElevenLabsHttp = async () => ({ status: 429, bodyBytes: Buffer.from(JSON.stringify({ detail: "quota exceeded" })) });
    const provider = new ElevenLabsProvider({ voiceId: "v1", modelId: "m1", voiceLock, listenCheck: async () => ({ ratio: 1, attempts: 1 }), apiKey: "sk_real", postHttp });
    const result = await provider.generate({ text: "hello", voiceLineId: "vl_1", gates: approvedA5() });
    expect(result.status).toBe("QUOTA_UNAVAILABLE");
  });

  it("a successful generation reports SUCCESS with provider metadata attached", async () => {
    const pcmBytes = Buffer.alloc(4800, 1); // arbitrary PCM payload
    const postHttp: PostElevenLabsHttp = async () => ({ status: 200, bodyBytes: pcmBytes });
    const provider = new ElevenLabsProvider({
      voiceId: "v1", modelId: "m1", voiceLock, apiKey: "sk_real", postHttp,
      listenCheck: async () => ({ ratio: 0.98, attempts: 1 }),
    });
    const result = await provider.generate({ text: "hello world", voiceLineId: "vl_1", gates: approvedA5(), outputDir: "/tmp" });
    expect(result.status).toBe("SUCCESS");
    expect(result.voice!.provider).toBe("elevenlabs");
    expect(result.voice!.source_mode).toBe("REAL");
    expect(result.voice!.text_hash).toBeTruthy();
  });

  it("a voice-lock mismatch hard-fails and is NOT caught as a provider condition", async () => {
    const wrongLock: VoiceLock = { providers: { elevenlabs: { voice_id: "WRONG", model: "m1" } } };
    const provider = new ElevenLabsProvider({ voiceId: "v1", modelId: "m1", voiceLock: wrongLock, listenCheck: async () => ({ ratio: 1, attempts: 1 }), apiKey: "sk_real" });
    await expect(provider.generate({ text: "hello", voiceLineId: "vl_1", gates: approvedA5() })).rejects.toThrow(/voice_lock mismatch/);
  });
});

// ---------------------------------------------------------------------------
// VoiceboxClient
// ---------------------------------------------------------------------------

describe("VoiceboxClient (fixture HTTP seam, no real server)", () => {
  it("health() parses the confirmed /health response shape", async () => {
    const httpFetch: VoiceboxHttpFetch = async ({ url }) => {
      expect(url).toContain("/health");
      return { status: 200, bodyText: JSON.stringify({ status: "ok", backend_type: "mlx" }) };
    };
    const client = new VoiceboxClient({ httpFetch });
    const health = await client.health();
    expect(health.status).toBe("ok");
    expect(health.backend_type).toBe("mlx");
  });

  it("health() throws VoiceboxHttpError on a non-200 response", async () => {
    const httpFetch: VoiceboxHttpFetch = async () => ({ status: 503, bodyText: "" });
    const client = new VoiceboxClient({ httpFetch });
    await expect(client.health()).rejects.toThrow(VoiceboxHttpError);
  });

  it("resolveProfile() finds a profile by id from /profiles", async () => {
    const httpFetch: VoiceboxHttpFetch = async ({ url }) => {
      expect(url).toContain("/profiles");
      return { status: 200, bodyText: JSON.stringify([{ id: "p1", name: "Narrator", language: "en" }]) };
    };
    const client = new VoiceboxClient({ httpFetch });
    const profile = await client.resolveProfile("p1");
    expect(profile?.name).toBe("Narrator");
  });

  it("resolveProfile() returns undefined for an unknown profile id", async () => {
    const httpFetch: VoiceboxHttpFetch = async () => ({ status: 200, bodyText: JSON.stringify([{ id: "other", name: "X", language: "en" }]) });
    const client = new VoiceboxClient({ httpFetch });
    expect(await client.resolveProfile("nonexistent")).toBeUndefined();
  });

  it("generate() posts the confirmed request shape and returns the accepted job", async () => {
    let capturedBody: unknown;
    const httpFetch: VoiceboxHttpFetch = async ({ method, url, body }) => {
      expect(method).toBe("POST");
      expect(url).toContain("/generate");
      capturedBody = body;
      return { status: 200, bodyText: JSON.stringify({ id: "gen_1", status: "queued" }) };
    };
    const client = new VoiceboxClient({ httpFetch });
    const accepted = await client.generate({ text: "hi", profile_id: "p1", language: "en" });
    expect(accepted.id).toBe("gen_1");
    expect(capturedBody).toEqual({ text: "hi", profile_id: "p1", language: "en" });
  });

  it("getStatus() polls the /generate/{id}/status shape", async () => {
    const httpFetch: VoiceboxHttpFetch = async ({ url }) => {
      expect(url).toContain("/generate/gen_1/status");
      return { status: 200, bodyText: JSON.stringify({ id: "gen_1", status: "completed" }) };
    };
    const client = new VoiceboxClient({ httpFetch });
    const status = await client.getStatus("gen_1");
    expect(status.status).toBe("completed");
  });

  it("getAudio() fetches raw bytes via the separate binary seam", async () => {
    const audioFetch: VoiceboxAudioFetch = async (url) => {
      expect(url).toContain("gen_1");
      return { status: 200, bytes: Buffer.from("fake-audio") };
    };
    const client = new VoiceboxClient({ audioFetch });
    const bytes = await client.getAudio("gen_1");
    expect(bytes.toString()).toBe("fake-audio");
  });
});

// ---------------------------------------------------------------------------
// VoiceboxProvider
// ---------------------------------------------------------------------------

describe("VoiceboxProvider", () => {
  function fixtureProbe(durationS: number): MediaProbe {
    return async () => ({ decodable: true, duration_s: durationS });
  }

  function makeClient(overrides?: Partial<{ health: VoiceboxHttpFetch; profiles: unknown[]; genStatus: string }>) {
    const httpFetch: VoiceboxHttpFetch = async ({ method, url }) => {
      if (url.includes("/health")) return { status: 200, bodyText: JSON.stringify({ status: "ok" }) };
      if (url.includes("/profiles")) return { status: 200, bodyText: JSON.stringify(overrides?.profiles ?? [{ id: "p1", name: "Narrator", language: "en" }]) };
      if (method === "POST" && url.includes("/generate")) return { status: 200, bodyText: JSON.stringify({ id: "gen_1", status: "queued" }) };
      if (url.includes("/status")) return { status: 200, bodyText: JSON.stringify({ id: "gen_1", status: overrides?.genStatus ?? "completed" }) };
      throw new Error(`unexpected url ${url}`);
    };
    const audioFetch: VoiceboxAudioFetch = async () => ({ status: 200, bytes: Buffer.from("fake-wav-bytes") });
    return new VoiceboxClient({ httpFetch, audioFetch });
  }

  it("R04 CRITICAL RULE: governance failure (missing A5) hard-fails, never a provider condition", async () => {
    const provider = new VoiceboxProvider({ profileId: "p1", client: makeClient() });
    await expect(provider.generate({ text: "hello", voiceLineId: "vl_1", gates: [] })).rejects.toThrow(GateStateError);
  });

  it("A6 is required when material ambiguity was detected, exactly like ElevenLabsProvider", async () => {
    const provider = new VoiceboxProvider({ profileId: "p1", client: makeClient() });
    await expect(
      provider.generate({ text: "hello", voiceLineId: "vl_1", gates: approvedA5(), materialAmbiguityDetected: true }),
    ).rejects.toThrow(GateStateError);
  });

  it("a successful generation returns real, non-fabricated duration via the probe seam", async () => {
    const provider = new VoiceboxProvider({ profileId: "p1", client: makeClient(), probe: fixtureProbe(3.7), pollIntervalMs: 1 });
    const result = await provider.generate({ text: "hello world", voiceLineId: "vl_1", gates: approvedA5(), outputDir: "/tmp" });
    expect(result.status).toBe("SUCCESS");
    expect(result.voice!.duration_s).toBe(3.7);
    expect(result.voice!.provider).toBe("voicebox");
  });

  it("listen_check fields are the explicit not-performed sentinel (0/0), never a fabricated ratio", async () => {
    const provider = new VoiceboxProvider({ profileId: "p1", client: makeClient(), probe: fixtureProbe(1), pollIntervalMs: 1 });
    const result = await provider.generate({ text: "hi", voiceLineId: "vl_1", gates: approvedA5(), outputDir: "/tmp" });
    expect(result.voice!.listen_check_word_ratio).toBe(0);
    expect(result.voice!.listen_check_attempts).toBe(0);
  });

  it("an unknown profile_id is a genuine INVALID_REQUEST condition, not a hard failure", async () => {
    const provider = new VoiceboxProvider({ profileId: "nonexistent", client: makeClient() });
    const result = await provider.generate({ text: "hi", voiceLineId: "vl_1", gates: approvedA5() });
    expect(result.status).toBe("INVALID_REQUEST");
  });

  it("a generation that never completes within the poll timeout reports TIMEOUT", async () => {
    const provider = new VoiceboxProvider({ profileId: "p1", client: makeClient({ genStatus: "running" }), pollIntervalMs: 1, pollTimeoutMs: 5 });
    const result = await provider.generate({ text: "hi", voiceLineId: "vl_1", gates: approvedA5() });
    expect(result.status).toBe("TIMEOUT");
  });

  it("a failed generation is classified from its error message", async () => {
    const httpFetch: VoiceboxHttpFetch = async ({ method, url }) => {
      if (url.includes("/health")) return { status: 200, bodyText: JSON.stringify({ status: "ok" }) };
      if (url.includes("/profiles")) return { status: 200, bodyText: JSON.stringify([{ id: "p1", name: "N", language: "en" }]) };
      if (method === "POST" && url.includes("/generate")) return { status: 200, bodyText: JSON.stringify({ id: "gen_1", status: "queued" }) };
      if (url.includes("/status")) return { status: 200, bodyText: JSON.stringify({ id: "gen_1", status: "failed", error: "model out of memory" }) };
      throw new Error("unexpected");
    };
    const client = new VoiceboxClient({ httpFetch });
    const provider = new VoiceboxProvider({ profileId: "p1", client, pollIntervalMs: 1 });
    const result = await provider.generate({ text: "hi", voiceLineId: "vl_1", gates: approvedA5() });
    expect(result.status).toBe("PROVIDER_ERROR");
    expect(result.errorMessage).toContain("out of memory");
  });
});

// ---------------------------------------------------------------------------
// R03 cache/generation identity
// ---------------------------------------------------------------------------

describe("R03 generation_key covers every material input", () => {
  const base = { voiceLineId: "vl_1", text: "hello", language: "en", provider: "voicebox", profileId: "p1", engine: "qwen", configVersion: "v1" };

  it("is stable for identical inputs", () => {
    expect(computeGenerationKey(base)).toBe(computeGenerationKey({ ...base }));
  });

  it("changes when text changes", () => {
    expect(computeGenerationKey(base)).not.toBe(computeGenerationKey({ ...base, text: "different text" }));
  });

  it("changes when provider changes (NOT cached only by voice_line_id)", () => {
    expect(computeGenerationKey(base)).not.toBe(computeGenerationKey({ ...base, provider: "elevenlabs" }));
  });

  it("changes when profile changes", () => {
    expect(computeGenerationKey(base)).not.toBe(computeGenerationKey({ ...base, profileId: "p2" }));
  });

  it("changes when engine/model changes", () => {
    expect(computeGenerationKey(base)).not.toBe(computeGenerationKey({ ...base, engine: "luxtts" }));
  });

  it("changes when config version changes", () => {
    expect(computeGenerationKey(base)).not.toBe(computeGenerationKey({ ...base, configVersion: "v2" }));
  });

  it("changes when language changes", () => {
    expect(computeGenerationKey(base)).not.toBe(computeGenerationKey({ ...base, language: "es" }));
  });
});
