// AUDIT FIX (P3 final closure pass, §13.4) — StageCache wired into real
// orchestration via runP304PiperPreview/runP305ElevenLabsProductionVoice.
// Regression tests: cache hit skips the seam AND skips charging; a cache
// hit can never bypass gate enforcement; cross-stage cache isolation.

import { describe, expect, it } from "vitest";
import { GateStateError } from "../src/errors.js";
import { StageCache } from "../src/checkpoint.js";
import { CostLedger } from "../src/costLedger.js";
import type { ExecPiperSubprocess } from "../src/piper.js";
import type { PostElevenLabsHttp, VoiceLock } from "../src/elevenlabs.js";
import { approvePiperPreview } from "../src/voiceApproval.js";
import { runP304PiperPreview, runP305ElevenLabsProductionVoice } from "../src/pipeline.js";
import type { PiperPreviewResult, ProductionVoiceResult } from "../src/types.js";
import { approvedA4Fixture } from "./helpers/gateFixtures.js";

const voiceLock: VoiceLock = { providers: { elevenlabs: { voice_id: "voice_1", model: "eleven_multilingual_v2" } } };
const listenCheck = async () => ({ ratio: 0.95, attempts: 1 });
const preview: PiperPreviewResult = { output_path: "p.wav", measured_duration_s: 3, target_duration_s: 3, deviation_pct: 0, flagged: false };

describe("runP304PiperPreview — cached orchestration wrapper", () => {
  it("a cache hit skips the seam entirely on a repeat call with identical inputs", async () => {
    const cache = new StageCache();
    const costLedger = new CostLedger(1_000_000);
    let seamCalls = 0;
    const seam: ExecPiperSubprocess = async () => {
      seamCalls += 1;
      return { measuredDurationS: 3 };
    };
    const params = { text: "hello", outputPath: "out.wav", modelPath: "tr_TR-dfki-medium.onnx", targetDurationS: 3 };

    const first = await runP304PiperPreview(params, cache, costLedger, seam);
    const second = await runP304PiperPreview(params, cache, costLedger, seam);

    expect(seamCalls).toBe(1);
    expect(second).toEqual(first);
    expect(costLedger.allEntries()).toHaveLength(1); // not re-charged on the hit
  });

  it("different targetDurationS produces a different fingerprint — no false cache hit", async () => {
    const cache = new StageCache();
    const costLedger = new CostLedger(1_000_000);
    let seamCalls = 0;
    const seam: ExecPiperSubprocess = async () => {
      seamCalls += 1;
      return { measuredDurationS: 3 };
    };
    await runP304PiperPreview({ text: "hello", outputPath: "out.wav", modelPath: "m.onnx", targetDurationS: 3 }, cache, costLedger, seam);
    await runP304PiperPreview({ text: "hello", outputPath: "out.wav", modelPath: "m.onnx", targetDurationS: 5 }, cache, costLedger, seam);
    expect(seamCalls).toBe(2);
  });
});

describe("runP305ElevenLabsProductionVoice — cached orchestration wrapper", () => {
  it("a cache hit skips the HTTP seam AND skips charging on a repeat call with identical inputs", async () => {
    const cache = new StageCache();
    const costLedger = new CostLedger(1_000_000);
    const gate = approvePiperPreview(preview, "user:mk350174", [approvedA4Fixture()]);
    let httpCalls = 0;
    const seam: PostElevenLabsHttp = async () => {
      httpCalls += 1;
      return { status: 200, bodyBytes: Buffer.from("fake-audio-bytes") };
    };
    const params = { text: "hello", voiceId: "voice_1", modelId: "eleven_multilingual_v2", apiKey: "key", voiceLock, gates: [gate], listenCheck };

    const first: ProductionVoiceResult = await runP305ElevenLabsProductionVoice(params, cache, costLedger, seam);
    const second: ProductionVoiceResult = await runP305ElevenLabsProductionVoice(params, cache, costLedger, seam);

    expect(httpCalls).toBe(1);
    expect(second).toEqual(first);
    expect(costLedger.allEntries()).toHaveLength(1); // not re-charged on the hit
  });

  it("a pre-warmed cache hit can NOT bypass Gate A5 — the gate is checked before the cache is even consulted", async () => {
    const cache = new StageCache();
    const costLedger = new CostLedger(1_000_000);
    const gate = approvePiperPreview(preview, "user:mk350174", [approvedA4Fixture()]);
    let httpCalls = 0;
    const seam: PostElevenLabsHttp = async () => {
      httpCalls += 1;
      return { status: 200, bodyBytes: Buffer.from("fake-audio-bytes") };
    };
    const paramsWithGate = { text: "hello", voiceId: "voice_1", modelId: "eleven_multilingual_v2", apiKey: "key", voiceLock, gates: [gate], listenCheck };

    // Prime the cache under a valid gate.
    await runP305ElevenLabsProductionVoice(paramsWithGate, cache, costLedger, seam);
    expect(httpCalls).toBe(1);

    // Same exact inputs (same fingerprint), but this call carries NO gate.
    const paramsWithoutGate = { ...paramsWithGate, gates: [] };
    await expect(runP305ElevenLabsProductionVoice(paramsWithoutGate, cache, costLedger, seam)).rejects.toThrow(GateStateError);
    expect(httpCalls).toBe(1); // seam still never invoked for the failing call either — but the cache was never reached
  });

  it("a pre-warmed cache hit can NOT bypass Gate A6 when material ambiguity is flagged on this call", async () => {
    const cache = new StageCache();
    const costLedger = new CostLedger(1_000_000);
    const gateA5 = approvePiperPreview(preview, "user:mk350174", [approvedA4Fixture()]);
    let httpCalls = 0;
    const seam: PostElevenLabsHttp = async () => {
      httpCalls += 1;
      return { status: 200, bodyBytes: Buffer.from("fake-audio-bytes") };
    };
    const params = { text: "hello", voiceId: "voice_1", modelId: "eleven_multilingual_v2", apiKey: "key", voiceLock, gates: [gateA5], listenCheck };

    // Prime the cache WITHOUT ambiguity ever being flagged.
    await runP305ElevenLabsProductionVoice(params, cache, costLedger, seam);
    expect(httpCalls).toBe(1);

    // Same fingerprint inputs, but this call flags material ambiguity and
    // carries no Gate A6 — must be rejected even though a cache entry exists.
    await expect(
      runP305ElevenLabsProductionVoice({ ...params, materialAmbiguityDetected: true }, cache, costLedger, seam),
    ).rejects.toThrow(GateStateError);
    expect(httpCalls).toBe(1);
  });
});

describe("cross-stage cache isolation", () => {
  it("a Piper cache instance and an ElevenLabs cache instance never share entries, even with structurally similar inputs", async () => {
    const piperCache = new StageCache();
    const elevenlabsCache = new StageCache();
    const costLedger = new CostLedger(1_000_000);
    const gate = approvePiperPreview(preview, "user:mk350174", [approvedA4Fixture()]);

    await runP304PiperPreview(
      { text: "hello", outputPath: "out.wav", modelPath: "m.onnx", targetDurationS: 3 },
      piperCache, costLedger,
      async () => ({ measuredDurationS: 3 }),
    );
    await runP305ElevenLabsProductionVoice(
      { text: "hello", voiceId: "voice_1", modelId: "eleven_multilingual_v2", apiKey: "key", voiceLock, gates: [gate], listenCheck },
      elevenlabsCache, costLedger,
      async () => ({ status: 200, bodyBytes: Buffer.from("audio") }),
    );

    expect(piperCache.size()).toBe(1);
    expect(elevenlabsCache.size()).toBe(1);
    // Two genuinely separate Map-backed instances — an entry in one is
    // structurally invisible to the other regardless of fingerprint shape.
    expect(piperCache).not.toBe(elevenlabsCache);
  });
});
