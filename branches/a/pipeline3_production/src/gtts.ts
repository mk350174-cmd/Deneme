// P3.04 gTTS Fallback — automatic fallback if Piper fails.
// Tier 2 (fallback only): gTTS generates narration when Piper unavailable/fails.
// Fallback chain: Piper → gTTS → FAIL (stop here, no automatic ElevenLabs).
// ElevenLabs remains production-only at Gate A5 (user explicit choice).

import type { GttsPreviewResult } from "./types.js";

// Raw I/O seam only — one real implementation (defaultExecGttsSubprocess),
// same "invariant 9" pattern as piper.ts/render.ts/kaggle.ts: tests
// substitute this low-level function, never a swappable "TTSProvider".
export type ExecGttsSubprocess = (params: { text: string; outputPath: string; language: string }) => Promise<{ measuredDurationS: number }>;

// Real implementation: the `gtts` Python package (Google Translate TTS),
// invoked via subprocess — mirrors piper.ts's spawn+stdin pattern (text
// piped via stdin, not a CLI arg, so long narration and special characters
// never hit shell/arg-length limits). Produces an actual MP3 file at
// outputPath, then measures its REAL duration via ffprobe (same
// real-content-measurement discipline as distribution.ts's
// downloadKaggleShard) rather than estimating from word count.
const GTTS_PYTHON_SCRIPT = [
  "import sys",
  "from gtts import gTTS",
  "text = sys.stdin.read()",
  "gTTS(text=text, lang=sys.argv[2]).save(sys.argv[1])",
].join("\n");

export const defaultExecGttsSubprocess: ExecGttsSubprocess = async ({ text, outputPath, language }) => {
  const { spawn, execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("python3", ["-c", GTTS_PYTHON_SCRIPT, outputPath, language]);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    proc.stdin.write(text);
    proc.stdin.end();
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`gtts exited with code ${code}: ${stderr}`))));
  });

  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", outputPath]);
  const measuredDurationS = parseFloat(stdout.trim());
  if (!Number.isFinite(measuredDurationS)) {
    throw new Error(`gtts: ffprobe could not determine a duration for ${outputPath} (got "${stdout.trim()}")`);
  }
  return { measuredDurationS };
};

const DEVIATION_THRESHOLD_PCT = 15; // same as Piper (reuse standard)

export async function runGttsPreview(
  params: { text: string; outputPath: string; language: string; targetDurationS: number },
  execGtts: ExecGttsSubprocess = defaultExecGttsSubprocess,
): Promise<GttsPreviewResult> {
  const { measuredDurationS } = await execGtts({
    text: params.text,
    outputPath: params.outputPath,
    language: params.language,
  });

  const deviation_pct =
    params.targetDurationS > 0
      ? Math.round(((measuredDurationS - params.targetDurationS) / params.targetDurationS) * 1000) / 10
      : 0;

  return {
    output_path: params.outputPath,
    measured_duration_s: measuredDurationS,
    target_duration_s: params.targetDurationS,
    deviation_pct,
    flagged: Math.abs(deviation_pct) >= DEVIATION_THRESHOLD_PCT,
    provider: "gtts",
    language: params.language,
  };
}
