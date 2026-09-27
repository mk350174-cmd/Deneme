// P3.05 ElevenLabs — item 12: rejection before Gate A5 approval (code-level,
// not just documented — the low-level HTTP seam must never even be
// invoked without the gate). Uses a fixture I/O-seam adapter.

import { describe, expect, it } from "vitest";
import { GateStateError } from "../src/errors.js";
import { generateProductionVoice } from "../src/elevenlabs.js";
import type { PostElevenLabsHttp, VoiceLock } from "../src/elevenlabs.js";
import { approveAmbiguityResolution } from "../src/pipeline.js";
import { approvePiperPreview } from "../src/voiceApproval.js";
import type { PiperPreviewResult } from "../src/types.js";
import { approvedA4Fixture } from "./helpers/gateFixtures.js";

const voiceLock: VoiceLock = { providers: { elevenlabs: { voice_id: "voice_1", model: "eleven_multilingual_v2" } } };
const listenCheck = async () => ({ ratio: 0.95, attempts: 1 });

describe("ElevenLabs production voice — gated on Gate A5 (item 12)", () => {
  it("rejects the call when Gate A5 was never passed, without invoking the HTTP seam", async () => {
    let httpCallCount = 0;
    const seam: PostElevenLabsHttp = async () => {
      httpCallCount += 1;
      return { status: 200, bodyBytes: Buffer.from("x") };
    };

    await expect(
      generateProductionVoice(
        { text: "hello", voiceId: "voice_1", modelId: "eleven_multilingual_v2", apiKey: "key", voiceLock, gates: [], listenCheck },
        seam,
      ),
    ).rejects.toThrow(GateStateError);

    expect(httpCallCount).toBe(0); // never contacted the (fixture) API
  });

  it("permits the call once Gate A5 is passed", async () => {
    const preview: PiperPreviewResult = { output_path: "p.wav", measured_duration_s: 3, target_duration_s: 3, deviation_pct: 0, flagged: false };
    const gate = approvePiperPreview(preview, "user:mk350174", [approvedA4Fixture()]);

    let httpCallCount = 0;
    const seam: PostElevenLabsHttp = async () => {
      httpCallCount += 1;
      return { status: 200, bodyBytes: Buffer.from("fake-audio-bytes") };
    };

    const result = await generateProductionVoice(
      { text: "hello", voiceId: "voice_1", modelId: "eleven_multilingual_v2", apiKey: "key", voiceLock, gates: [gate], listenCheck },
      seam,
    );

    expect(httpCallCount).toBe(1);
    expect(result.character_count).toBe(5);
    expect(result.listen_check_word_ratio).toBe(0.95);
  });

  it("rejects on a voice_lock mismatch even with Gate A5 passed", async () => {
    const preview: PiperPreviewResult = { output_path: "p.wav", measured_duration_s: 3, target_duration_s: 3, deviation_pct: 0, flagged: false };
    const gate = approvePiperPreview(preview, "user:mk350174", [approvedA4Fixture()]);
    const mismatchedLock: VoiceLock = { providers: { elevenlabs: { voice_id: "different_voice", model: "eleven_multilingual_v2" } } };

    await expect(
      generateProductionVoice(
        { text: "hello", voiceId: "voice_1", modelId: "eleven_multilingual_v2", apiKey: "key", voiceLock: mismatchedLock, gates: [gate], listenCheck },
        async () => ({ status: 200, bodyBytes: Buffer.from("x") }),
      ),
    ).rejects.toThrow();
  });
});

describe("AUDIT FIX §13 correction 4 — Gate A6 downstream enforcement (recorded but previously not enforced)", () => {
  const preview: PiperPreviewResult = { output_path: "p.wav", measured_duration_s: 3, target_duration_s: 3, deviation_pct: 0, flagged: false };

  it("rejects the call when material ambiguity was flagged and Gate A6 was never resolved, without invoking the HTTP seam", async () => {
    const gateA5 = approvePiperPreview(preview, "user:mk350174", [approvedA4Fixture()]);
    let httpCallCount = 0;
    const seam: PostElevenLabsHttp = async () => {
      httpCallCount += 1;
      return { status: 200, bodyBytes: Buffer.from("x") };
    };

    await expect(
      generateProductionVoice(
        {
          text: "hello", voiceId: "voice_1", modelId: "eleven_multilingual_v2", apiKey: "key",
          voiceLock, gates: [gateA5], listenCheck, materialAmbiguityDetected: true,
        },
        seam,
      ),
    ).rejects.toThrow(GateStateError);

    expect(httpCallCount).toBe(0); // MATERIAL_AMBIGUITY_DETECTED -> HUMAN RESOLUTION never happened -> call blocked
  });

  it("permits the call once Gate A6 (AMBIGUITY_RESOLVED) is also passed alongside Gate A5", async () => {
    const gateA5 = approvePiperPreview(preview, "user:mk350174", [approvedA4Fixture()]);
    const gateA6 = approveAmbiguityResolution("user:mk350174", "preflight_v1", [approvedA4Fixture(), gateA5]);
    let httpCallCount = 0;
    const seam: PostElevenLabsHttp = async () => {
      httpCallCount += 1;
      return { status: 200, bodyBytes: Buffer.from("fake-audio-bytes") };
    };

    const result = await generateProductionVoice(
      {
        text: "hello", voiceId: "voice_1", modelId: "eleven_multilingual_v2", apiKey: "key",
        voiceLock, gates: [gateA5, gateA6], listenCheck, materialAmbiguityDetected: true,
      },
      seam,
    );

    expect(httpCallCount).toBe(1);
    expect(result.character_count).toBe(5);
  });

  it("does not require Gate A6 when no material ambiguity was detected (default/unset behavior unchanged)", async () => {
    const gateA5 = approvePiperPreview(preview, "user:mk350174", [approvedA4Fixture()]);
    let httpCallCount = 0;
    const seam: PostElevenLabsHttp = async () => {
      httpCallCount += 1;
      return { status: 200, bodyBytes: Buffer.from("x") };
    };

    const result = await generateProductionVoice(
      { text: "hello", voiceId: "voice_1", modelId: "eleven_multilingual_v2", apiKey: "key", voiceLock, gates: [gateA5], listenCheck },
      seam,
    );
    expect(httpCallCount).toBe(1);
    expect(result.character_count).toBe(5);
  });
});
