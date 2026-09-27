// P3.04 Piper preview contract (item 10). Uses a fixture I/O-seam adapter —
// never a real Piper subprocess.

import { describe, expect, it } from "vitest";
import { runPiperPreview } from "../src/piper.js";
import type { ExecPiperSubprocess } from "../src/piper.js";

const fixtureExecPiper: ExecPiperSubprocess = async ({ text }) => {
  // Deterministic reference adapter: ~2.5 words/sec reading rate, no real
  // subprocess or audio file involved.
  const words = text.trim().split(/\s+/).length;
  return { measuredDurationS: words / 2.5 };
};

describe("Piper preview (fixture adapter, item 10)", () => {
  it("returns a preview result shaped per the architecture contract", async () => {
    const result = await runPiperPreview(
      { text: "The Aqua Appia was completed in 312 BC.", outputPath: "preview.wav", modelPath: "tr_TR-dfki-medium.onnx", targetDurationS: 3 },
      fixtureExecPiper,
    );
    expect(result.output_path).toBe("preview.wav");
    expect(result.measured_duration_s).toBeGreaterThan(0);
    expect(result.target_duration_s).toBe(3);
    expect(typeof result.deviation_pct).toBe("number");
  });

  it("flags when deviation exceeds 15%", async () => {
    const result = await runPiperPreview(
      { text: "one two three four five six seven eight nine ten", outputPath: "p.wav", modelPath: "m.onnx", targetDurationS: 1 },
      fixtureExecPiper,
    );
    expect(result.flagged).toBe(true);
  });

  it("does not flag when deviation is within 15%", async () => {
    const result = await runPiperPreview(
      { text: "one two three", outputPath: "p.wav", modelPath: "m.onnx", targetDurationS: 3 / 2.5 },
      fixtureExecPiper,
    );
    expect(result.flagged).toBe(false);
  });
});
