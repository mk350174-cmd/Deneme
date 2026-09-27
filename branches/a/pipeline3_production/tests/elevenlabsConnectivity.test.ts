// AUDIT FIX (P3 final closure pass, §13.7) — real PreflightCheckFns
// implementations, tested against a fixture GetElevenLabsHttp seam.
// Deterministic, offline, part of the normal hermetic suite — the real
// authenticated live check runs separately, outside vitest run.

import { describe, expect, it } from "vitest";
import { buildElevenLabsPreflightCheckFns } from "../src/elevenlabsConnectivity.js";
import type { GetElevenLabsHttp } from "../src/elevenlabsConnectivity.js";

const FIXTURE_KEY = "fixture-key-not-real";

function fixtureGet(responses: Record<string, { status: number; bodyJson: unknown }>): GetElevenLabsHttp {
  return async ({ url }) => {
    for (const [path, resp] of Object.entries(responses)) {
      if (url.includes(path)) return resp;
    }
    return { status: 404, bodyJson: undefined };
  };
}

describe("buildElevenLabsPreflightCheckFns — checkApiConnectivity", () => {
  it("true on a 200 from /user", async () => {
    const fns = buildElevenLabsPreflightCheckFns(FIXTURE_KEY, fixtureGet({ "/user": { status: 200, bodyJson: {} } }));
    expect(await fns.checkApiConnectivity()).toBe(true);
  });

  it("false on a 401 (invalid credential)", async () => {
    const fns = buildElevenLabsPreflightCheckFns(FIXTURE_KEY, fixtureGet({ "/user": { status: 401, bodyJson: undefined } }));
    expect(await fns.checkApiConnectivity()).toBe(false);
  });
});

describe("buildElevenLabsPreflightCheckFns — checkVoiceAvailability", () => {
  it("true when the specific voice GET returns 200", async () => {
    const fns = buildElevenLabsPreflightCheckFns(FIXTURE_KEY, fixtureGet({ "/voices/voice_1": { status: 200, bodyJson: {} } }));
    expect(await fns.checkVoiceAvailability("voice_1")).toBe(true);
  });

  it("false when the voice GET returns 404", async () => {
    const fns = buildElevenLabsPreflightCheckFns(FIXTURE_KEY, fixtureGet({ "/voices/voice_missing": { status: 404, bodyJson: undefined } }));
    expect(await fns.checkVoiceAvailability("voice_missing")).toBe(false);
  });
});

describe("buildElevenLabsPreflightCheckFns — checkModelAvailability", () => {
  it("true when the requested model_id is present in the /models list", async () => {
    const fns = buildElevenLabsPreflightCheckFns(
      FIXTURE_KEY,
      fixtureGet({ "/models": { status: 200, bodyJson: [{ model_id: "eleven_multilingual_v2" }, { model_id: "eleven_flash_v2" }] } }),
    );
    expect(await fns.checkModelAvailability("eleven_multilingual_v2")).toBe(true);
  });

  it("false when the requested model_id is absent from the /models list", async () => {
    const fns = buildElevenLabsPreflightCheckFns(FIXTURE_KEY, fixtureGet({ "/models": { status: 200, bodyJson: [{ model_id: "eleven_flash_v2" }] } }));
    expect(await fns.checkModelAvailability("eleven_multilingual_v2")).toBe(false);
  });

  it("false on a non-200 /models response, never throws", async () => {
    const fns = buildElevenLabsPreflightCheckFns(FIXTURE_KEY, fixtureGet({ "/models": { status: 500, bodyJson: undefined } }));
    await expect(fns.checkModelAvailability("eleven_multilingual_v2")).resolves.toBe(false);
  });
});

describe("buildElevenLabsPreflightCheckFns — getQuotaRemaining", () => {
  it("computes limit - used from the /user subscription fields", async () => {
    const fns = buildElevenLabsPreflightCheckFns(
      FIXTURE_KEY,
      fixtureGet({ "/user": { status: 200, bodyJson: { subscription: { character_limit: 10_000, character_count: 4_000 } } } }),
    );
    expect(await fns.getQuotaRemaining()).toBe(6_000);
  });

  it("returns 0 (never negative, never throws, never NaN) on a non-200 response", async () => {
    const fns = buildElevenLabsPreflightCheckFns(FIXTURE_KEY, fixtureGet({ "/user": { status: 500, bodyJson: undefined } }));
    expect(await fns.getQuotaRemaining()).toBe(0);
  });

  it("returns 0 when subscription fields are missing entirely, never NaN", async () => {
    const fns = buildElevenLabsPreflightCheckFns(FIXTURE_KEY, fixtureGet({ "/user": { status: 200, bodyJson: {} } }));
    const result = await fns.getQuotaRemaining();
    expect(result).toBe(0);
    expect(Number.isNaN(result)).toBe(false);
  });
});

describe("credential safety", () => {
  it("the fixture key value never appears in any thrown error or returned value", async () => {
    const fns = buildElevenLabsPreflightCheckFns(FIXTURE_KEY, fixtureGet({ "/user": { status: 200, bodyJson: { subscription: { character_limit: 100, character_count: 10 } } } }));
    const connectivity = await fns.checkApiConnectivity();
    const quota = await fns.getQuotaRemaining();
    expect(JSON.stringify({ connectivity, quota })).not.toContain(FIXTURE_KEY);
  });

  it("sends the key only via the xi-api-key header, never as a query param or body field", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const capturingGet: GetElevenLabsHttp = async ({ url, headers }) => {
      capturedHeaders = headers;
      expect(url).not.toContain(FIXTURE_KEY);
      return { status: 200, bodyJson: {} };
    };
    const fns = buildElevenLabsPreflightCheckFns(FIXTURE_KEY, capturingGet);
    await fns.checkApiConnectivity();
    expect(capturedHeaders?.["xi-api-key"]).toBe(FIXTURE_KEY);
    expect(capturedHeaders?.["Authorization"]).toBeUndefined();
  });
});
