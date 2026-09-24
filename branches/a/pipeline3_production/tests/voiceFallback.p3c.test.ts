// P3.04 — REAL production tiered voice-preview policy
// (runP304VoicePreviewWithFallback in pipeline.ts), per docs/VOICE_PROVIDER_POLICY.md:
//   Tier 1: Piper (local, free) — always tried first.
//   Tier 2: gTTS (online, free) — tried automatically, ONLY if Piper throws.
//   Both fail: throws, listing both providers' errors.
//   NO automatic Tier-3 escalation to ElevenLabs, ever.
//
// This supersedes the informal simulation in voice.p3c.test.ts (which calls
// runPiperPreview/runGttsPreview directly, inside a try/catch written IN THE
// TEST, and says "the actual application error handling is tested at
// pipeline.ts level, not here" — but no such pipeline.ts function existed
// until this fix). These tests exercise the REAL orchestration function.

import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runP304VoicePreviewWithFallback } from "../src/pipeline.js";
import { StageCache } from "../src/checkpoint.js";
import { CostLedger } from "../src/costLedger.js";
import type { ExecPiperSubprocess } from "../src/piper.js";
import type { ExecGttsSubprocess } from "../src/gtts.js";

function tmpPath(name: string): string {
  return path.join(os.tmpdir(), `voice-fallback-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
}

const succeedingPiper: ExecPiperSubprocess = async () => ({ measuredDurationS: 5.0 });
const failingPiper: ExecPiperSubprocess = async () => {
  throw new Error("piper subprocess exited with code 1: model file not found");
};
const succeedingGtts: ExecGttsSubprocess = async () => ({ measuredDurationS: 5.1 });
const failingGtts: ExecGttsSubprocess = async () => {
  throw new Error("gtts exited with code 1: getaddrinfo ENOTFOUND translate.google.com");
};

const baseParams = {
  text: "Test narration for the tiered voice fallback policy.",
  piperOutputPath: tmpPath("piper.wav"),
  gttsOutputPath: tmpPath("gtts.mp3"),
  modelPath: "tr_TR-dfki-medium.onnx",
  language: "tr",
  targetDurationS: 5.0,
};

describe("runP304VoicePreviewWithFallback — real production tiered policy", () => {
  it("Tier 1 success: returns the Piper result; gTTS is never called", async () => {
    let gttsCalls = 0;
    const countingGtts: ExecGttsSubprocess = async (p) => {
      gttsCalls += 1;
      return succeedingGtts(p);
    };

    const result = await runP304VoicePreviewWithFallback(
      baseParams,
      new StageCache(),
      new CostLedger(1_000_000),
      succeedingPiper,
      countingGtts,
    );

    expect(result.output_path).toBe(baseParams.piperOutputPath);
    expect("provider" in result && result.provider === "gtts").toBe(false);
    expect(gttsCalls).toBe(0);
  });

  it("Tier 1 fails, Tier 2 succeeds: automatically falls back to gTTS and returns a tagged gTTS result", async () => {
    const result = await runP304VoicePreviewWithFallback(
      baseParams,
      new StageCache(),
      new CostLedger(1_000_000),
      failingPiper,
      succeedingGtts,
    );

    expect(result.output_path).toBe(baseParams.gttsOutputPath);
    expect("provider" in result && result.provider === "gtts").toBe(true);
    expect((result as { language: string }).language).toBe("tr");
  });

  it("both tiers fail: throws an error naming both providers, never silently succeeding", async () => {
    await expect(
      runP304VoicePreviewWithFallback(baseParams, new StageCache(), new CostLedger(1_000_000), failingPiper, failingGtts),
    ).rejects.toThrow(/Piper:.*model file not found.*gTTS:.*ENOTFOUND/s);
  });

  it("both tiers fail: the error explicitly states there is no automatic ElevenLabs fallback", async () => {
    await expect(
      runP304VoicePreviewWithFallback(baseParams, new StageCache(), new CostLedger(1_000_000), failingPiper, failingGtts),
    ).rejects.toThrow(/no automatic ElevenLabs fallback/i);
  });

  it("cost ledger logs the gTTS provider (not piper) when the fallback tier is used", async () => {
    const costLedger = new CostLedger(1_000_000);
    await runP304VoicePreviewWithFallback(baseParams, new StageCache(), costLedger, failingPiper, succeedingGtts);

    const entries = costLedger.allEntries();
    expect(entries.some((e) => e.provider === "gtts" && e.operation === "P3.04_gtts_fallback_preview")).toBe(true);
    expect(entries.some((e) => e.provider === "piper" && e.accepted)).toBe(false); // Piper never succeeded, nothing logged as accepted piper cost
  });

  it("cost ledger logs the piper provider when Tier 1 succeeds (gTTS never logged)", async () => {
    const costLedger = new CostLedger(1_000_000);
    await runP304VoicePreviewWithFallback(baseParams, new StageCache(), costLedger, succeedingPiper, succeedingGtts);

    const entries = costLedger.allEntries();
    expect(entries.some((e) => e.provider === "piper" && e.operation === "P3.04_piper_preview")).toBe(true);
    expect(entries.some((e) => e.provider === "gtts")).toBe(false);
  });
});

describe("runP304VoicePreviewWithFallback — REAL gTTS network call (not a fixture)", () => {
  it("Piper fails, and the REAL gTTS provider (network call to Google Translate TTS) produces a real, decodable audio file", async () => {
    const { defaultExecGttsSubprocess } = await import("../src/gtts.js");
    const outputPath = tmpPath("real-gtts-fallback.mp3");
    let networkReachable = true;
    try {
      await defaultExecGttsSubprocess({ text: "test", outputPath: tmpPath("probe.mp3"), language: "tr" });
    } catch {
      networkReachable = false;
    }
    if (!networkReachable) {
      // Environment has no outbound network access to Google Translate —
      // skip rather than fail; the fixture-based tests above already prove
      // the fallback wiring itself is correct.
      return;
    }

    const result = await runP304VoicePreviewWithFallback(
      { ...baseParams, gttsOutputPath: outputPath, text: "Merhaba, bu gerçek bir gTTS testidir." },
      new StageCache(),
      new CostLedger(1_000_000),
      failingPiper,
      defaultExecGttsSubprocess, // the REAL implementation, no fixture
    );

    expect("provider" in result && result.provider === "gtts").toBe(true);
    expect(result.measured_duration_s).toBeGreaterThan(0);

    const stat = await fs.stat(outputPath);
    expect(stat.size).toBeGreaterThan(0);
    // A real MP3 starts with either an ID3 tag ("ID3") or an MPEG frame
    // sync (0xFF Ex) — proves this is real audio, not an empty/placeholder file.
    const header = await fs.readFile(outputPath);
    const isId3 = header.subarray(0, 3).toString("ascii") === "ID3";
    const isMpegSync = header[0] === 0xff && (header[1] & 0xe0) === 0xe0;
    expect(isId3 || isMpegSync).toBe(true);
  });
});
