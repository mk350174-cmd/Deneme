// Python helpers for P3.04 previews, run with the repo-local venv (tools/.venv,
// created by `npm run kur`) instead of P3's hard-coded "python3" — which does not
// exist on Windows and does not see venv-installed packages. Same scripts, same
// real-duration measurement as P3's own defaultExecGttsSubprocess /
// defaultExecPiperSubprocess (only the interpreter differs).
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ExecGttsSubprocess } from "pipeline3-production/dist/gtts.js";
import type { ExecPiperSubprocess } from "pipeline3-production/dist/piper.js";

const execFileAsync = promisify(execFile);
const WIN = process.platform === "win32";

export function pythonForTools(): string {
  const venv = join(fileURLToPath(new URL("../../../../tools/.venv", import.meta.url)), WIN ? "Scripts" : "bin", WIN ? "python.exe" : "python");
  return process.env.UNIFIED_PYTHON ?? (existsSync(venv) ? venv : WIN ? "python" : "python3");
}

function runPython(args: string[], stdinText: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonForTools(), args, { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (c) => (stderr += c));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${args[0] === "-m" ? args[1] : "python"} exited with code ${code}: ${stderr.slice(-500)}`))));
    proc.stdout.resume(); // drain, so a chatty interpreter never blocks
    proc.stdin.on("error", () => undefined); // EPIPE when the interpreter exits early; reported via "close"
    proc.stdin.end(stdinText);
  });
}

async function measure(path: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]);
  const d = parseFloat(stdout.trim());
  if (!Number.isFinite(d)) throw new Error(`ffprobe could not measure ${path}`);
  return d;
}

const GTTS = ["import sys", "from gtts import gTTS", "text = sys.stdin.read()", "gTTS(text=text, lang=sys.argv[2]).save(sys.argv[1])"].join("\n");

export const venvExecGtts: ExecGttsSubprocess = async ({ text, outputPath, language }) => {
  await runPython(["-c", GTTS, outputPath, language], text);
  return { measuredDurationS: await measure(outputPath) };
};

export const venvExecPiper: ExecPiperSubprocess = async ({ text, outputPath, modelPath }) => {
  await runPython(["-m", "piper", "--model", modelPath, "--output_file", outputPath], text);
  return { measuredDurationS: await measure(outputPath) };
};

/** Turkish Piper voice installed by `npm run setup:voice` (tools/piper), if present. */
export function defaultPiperModel(): string | undefined {
  const p = join(fileURLToPath(new URL("../../../../tools/piper", import.meta.url)), "tr_TR-dfki-medium.onnx");
  return existsSync(p) ? p : undefined;
}
