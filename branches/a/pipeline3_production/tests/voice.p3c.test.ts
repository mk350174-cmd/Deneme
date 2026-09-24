// NOTE: these tests exercise runPiperPreview/runGttsPreview DIRECTLY, in
// isolation, and several "Fallback chain" tests below simulate the
// try/catch fallback logic manually inside the test itself rather than
// calling a real orchestration function — they prove the two provider
// functions individually, not the production fallback policy. The REAL
// integrated policy (Piper → gTTS automatic fallback → fail, no ElevenLabs)
// is implemented in runP304VoicePreviewWithFallback (pipeline.ts) and
// proven end-to-end in voiceFallback.p3c.test.ts, including one real
// (non-fixture) network call to gTTS.

import { describe, expect, it } from "vitest";
import { runPiperPreview } from "../src/piper.js";
import { runGttsPreview } from "../src/gtts.js";
import type { ExecPiperSubprocess } from "../src/piper.js";
import type { ExecGttsSubprocess } from "../src/gtts.js";

describe("P3-C: Voice Provider Fallback (Piper → gTTS, NOT auto ElevenLabs)", () => {
  // Mock Piper success
  const mockPiperSuccess: ExecPiperSubprocess = async ({ text }) => {
    const estimatedDurationS = (text.split(/\s+/).length / 150) * 60;
    return { measuredDurationS: estimatedDurationS };
  };

  // Mock Piper failure
  const mockPiperFail: ExecPiperSubprocess = async () => {
    throw new Error("Piper subprocess failed: model not found");
  };

  // Mock gTTS success
  const mockGttsSuccess: ExecGttsSubprocess = async ({ text }) => {
    const estimatedDurationS = (text.split(/\s+/).length / 150) * 60;
    return { measuredDurationS: estimatedDurationS };
  };

  // Mock gTTS failure
  const mockGttsFail: ExecGttsSubprocess = async () => {
    throw new Error("gTTS API error: network unreachable");
  };

  it("Tier 1 (Piper): generates preview successfully", async () => {
    const result = await runPiperPreview(
      { text: "Test narration text", outputPath: "piper.wav", modelPath: "model.onnx", targetDurationS: 10 },
      mockPiperSuccess,
    );

    expect(result.output_path).toBe("piper.wav");
    expect(result.measured_duration_s).toBeGreaterThan(0);
    expect(result.provider).toBeUndefined(); // Piper doesn't set provider field (default is Piper)
  });

  it("Tier 2 (gTTS): generates preview when called directly", async () => {
    const result = await runGttsPreview(
      { text: "Test narration text", outputPath: "gtts.wav", language: "tr", targetDurationS: 10 },
      mockGttsSuccess,
    );

    expect(result.output_path).toBe("gtts.wav");
    expect(result.measured_duration_s).toBeGreaterThan(0);
    expect(result.provider).toBe("gtts");
    expect(result.language).toBe("tr");
  });

  it("Fallback chain: Piper success → return Piper result (no gTTS attempt)", async () => {
    const piperResult = await runPiperPreview(
      { text: "Success case", outputPath: "piper.wav", modelPath: "model.onnx", targetDurationS: 5 },
      mockPiperSuccess,
    );

    expect(piperResult.output_path).toBe("piper.wav");
    // No provider field = Piper (default)
    expect(piperResult.provider).toBeUndefined();
  });

  it("Fallback chain: Piper fails → try gTTS fallback → success", async () => {
    // Simulate: Piper throws → catch → try gTTS
    let piperThrown = false;
    let gttsUsed = false;

    try {
      await runPiperPreview(
        { text: "Fallback case", outputPath: "piper.wav", modelPath: "model.onnx", targetDurationS: 5 },
        mockPiperFail,
      );
    } catch (e) {
      piperThrown = true;
      // Now try fallback
      const gttsResult = await runGttsPreview(
        { text: "Fallback case", outputPath: "gtts.wav", language: "tr", targetDurationS: 5 },
        mockGttsSuccess,
      );
      gttsUsed = true;
      expect(gttsResult.provider).toBe("gtts");
      expect(gttsResult.output_path).toBe("gtts.wav");
    }

    expect(piperThrown).toBe(true);
    expect(gttsUsed).toBe(true);
  });

  it("Fallback chain: Both Piper and gTTS fail → error (NO auto ElevenLabs)", async () => {
    let piperError: Error | null = null;
    let gttsError: Error | null = null;

    try {
      await runPiperPreview(
        { text: "Both fail case", outputPath: "piper.wav", modelPath: "model.onnx", targetDurationS: 5 },
        mockPiperFail,
      );
    } catch (e) {
      piperError = e as Error;
    }

    try {
      await runGttsPreview(
        { text: "Both fail case", outputPath: "gtts.wav", language: "tr", targetDurationS: 5 },
        mockGttsFail,
      );
    } catch (e) {
      gttsError = e as Error;
    }

    // Both failed
    expect(piperError).not.toBeNull();
    expect(gttsError).not.toBeNull();

    // The application logic would now throw: "Both providers failed, no automatic ElevenLabs cascade"
    // (The actual application error handling is tested at pipeline.ts level, not here)
  });

  it("Piper preview flags duration deviation ±15%", async () => {
    const mockPiperWithDeviation: ExecPiperSubprocess = async () => {
      return { measuredDurationS: 5.8 }; // Target 5s, measured 5.8s = +16% deviation
    };

    const result = await runPiperPreview(
      { text: "Test", outputPath: "piper.wav", modelPath: "model.onnx", targetDurationS: 5 },
      mockPiperWithDeviation,
    );

    expect(result.flagged).toBe(true); // 16% > 15% threshold
    expect(result.deviation_pct).toBeGreaterThan(15);
  });

  it("gTTS preview flags duration deviation ±15%", async () => {
    const mockGttsWithDeviation: ExecGttsSubprocess = async () => {
      return { measuredDurationS: 4.2 }; // Target 5s, measured 4.2s = -16% deviation
    };

    const result = await runGttsPreview(
      { text: "Test", outputPath: "gtts.wav", language: "tr", targetDurationS: 5 },
      mockGttsWithDeviation,
    );

    expect(result.flagged).toBe(true); // 16% > 15% threshold
    expect(result.deviation_pct).toBeLessThan(-15);
  });

  it("gTTS result includes language field for production voice selection", async () => {
    const result = await runGttsPreview(
      { text: "Turkish text", outputPath: "gtts.wav", language: "tr", targetDurationS: 5 },
      mockGttsSuccess,
    );

    expect(result.language).toBe("tr");
    expect(result.provider).toBe("gtts");
  });

  it("Piper and gTTS results are distinguishable for production voice path selection", async () => {
    const piperResult = await runPiperPreview(
      { text: "Test", outputPath: "piper.wav", modelPath: "model.onnx", targetDurationS: 5 },
      mockPiperSuccess,
    );

    const gttsResult = await runGttsPreview(
      { text: "Test", outputPath: "gtts.wav", language: "tr", targetDurationS: 5 },
      mockGttsSuccess,
    );

    // At P3.05 production voice selection, system checks:
    // if ("provider" in preview && preview.provider === "gtts") → use gTTS
    // else → use Piper (default)

    const isPiper = !("provider" in piperResult) || piperResult.provider !== "gtts";
    const isGtts = "provider" in gttsResult && gttsResult.provider === "gtts";

    expect(isPiper).toBe(true);
    expect(isGtts).toBe(true);
  });

  it("Fallback scenario: Turkish narration with Piper → gTTS → error flow", async () => {
    const script = "Osmanlı İmparatorluğu'nun yükselişi ve çöküşü hakkında kısa bir anlatı.";
    const targetDurationS = 30;

    // Step 1: Try Piper (fails)
    let preview = null;
    try {
      preview = await runPiperPreview(
        { text: script, outputPath: "piper.wav", modelPath: "tr_TR.onnx", targetDurationS },
        mockPiperFail,
      );
    } catch (e) {
      // Step 2: Try gTTS fallback
      try {
        preview = await runGttsPreview(
          { text: script, outputPath: "gtts.wav", language: "tr", targetDurationS },
          mockGttsSuccess,
        );
      } catch (e2) {
        // Step 3: Both failed — error (no ElevenLabs auto-escalation)
        expect.fail("Should have succeeded with gTTS fallback");
      }
    }

    // Should have gTTS preview
    expect(preview).not.toBeNull();
    expect(preview!.provider).toBe("gtts");
    expect(preview!.language).toBe("tr");
  });
});
