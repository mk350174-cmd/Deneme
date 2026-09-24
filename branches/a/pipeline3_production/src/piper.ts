// P3.04 Piper Preview — ADAPT of scripts/preview_narration_piper.py: same
// subprocess-invocation shape, same stdlib-duration-measurement idea, same
// 15% deviation threshold. Piper is a LOCKED provider (no abstraction) —
// the only injectable seam is the raw subprocess-exec function
// (invariant 9), not a swappable "PiperEngine"/"TTSProvider".

import type { PiperPreviewResult } from "./types.js";

// Raw I/O seam: executes the piper CLI and returns the synthesized audio's
// measured duration in seconds. This is NOT a provider abstraction — there
// is exactly one real implementation (defaultExecPiperSubprocess); the
// parameter exists solely so tests can substitute the raw I/O call.
export type ExecPiperSubprocess = (params: { text: string; outputPath: string; modelPath: string }) => Promise<{ measuredDurationS: number }>;

export const defaultExecPiperSubprocess: ExecPiperSubprocess = async ({ text, outputPath, modelPath }) => {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("python3", ["-m", "piper", "--model", modelPath, "--output_file", outputPath]);
    proc.stdin.write(text);
    proc.stdin.end();
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`piper exited with code ${code}`))));
  });
  const { promises: fs } = await import("node:fs");
  const buf = await fs.readFile(outputPath);
  return { measuredDurationS: wavDurationFromBuffer(buf) };
};

// Minimal WAV header parser (mirrors Python stdlib `wave`'s
// getnframes()/getframerate() computation) — sample-rate + data-chunk-size
// derived duration, no external dependency.
function wavDurationFromBuffer(buf: Buffer): number {
  const byteRate = buf.readUInt32LE(28);
  const dataSize = buf.readUInt32LE(40);
  if (!byteRate) return 0;
  return dataSize / byteRate;
}

const DEVIATION_THRESHOLD_PCT = 15; // reused exactly from preview_narration_piper.py

export async function runPiperPreview(
  params: { text: string; outputPath: string; modelPath: string; targetDurationS: number },
  execPiper: ExecPiperSubprocess = defaultExecPiperSubprocess,
): Promise<PiperPreviewResult> {
  const { measuredDurationS } = await execPiper({
    text: params.text,
    outputPath: params.outputPath,
    modelPath: params.modelPath,
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
  };
}
