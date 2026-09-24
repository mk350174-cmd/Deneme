#!/usr/bin/env node
// Environment check. Separates what `npm run verify` needs from what REAL
// production (Remotion render, ElevenLabs, Kaggle, YouTube, Agent Reach) needs.
// Never prints secret values — only whether they are set.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const WIN = process.platform === "win32";
const rows = [];
const add = (level, name, ok, detail) => rows.push({ level, name, ok, detail });

function has(cmd, args = ["--version"]) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: WIN, timeout: 15000 });
  return r.status === 0 ? (r.stdout || r.stderr).split("\n")[0].trim() : null;
}
function envFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1).trim()]));
}
const isSet = (v) => typeof v === "string" && v.length > 0 && !/your_|_here|<|example/i.test(v);

// ---- needed for install + verify
const major = Number(process.versions.node.split(".")[0]);
add("VERIFY", "Node.js ≥ 20", major >= 20, process.versions.node);
add("VERIFY", "npm", !!has("npm"), has("npm") ?? "not found");
const ff = has("ffmpeg", ["-version"]);
add("VERIFY", "ffmpeg (P3 merge + render tests)", !!ff, ff ?? "not found — install ffmpeg and put it on PATH");
const fp = has("ffprobe", ["-version"]);
add("VERIFY", "ffprobe (P3 asset validation tests)", !!fp, fp ?? "not found — ships with ffmpeg");
const installed = ["branches/a/pipeline1_research", "branches/a/pipeline2_creative", "branches/a/pipeline3_production", "branches/b", "apps/youtube-agent", "integration/bridges"].filter((d) => existsSync(join(root, d, "node_modules")));
add("VERIFY", "packages installed (npm run setup)", installed.length === 6, `${installed.length}/6`);
const remotionBrowser = process.env.REMOTION_BROWSER_EXECUTABLE || (existsSync(join(root, "branches/a/pipeline3_production/node_modules/.remotion/chrome-headless-shell")) ? "downloaded" : "");
add("VERIFY", "Remotion browser (P3 real-render test)", true, remotionBrowser ? `ok (${remotionBrowser})` : "not yet — Remotion downloads Chrome Headless Shell on first render (needs internet; on Linux also system libs such as libnss3)");

// ---- needed for real production only
const p3env = { ...envFile(join(root, "branches/a/pipeline3_production/.env")), ...process.env };
add("PRODUCTION", "ElevenLabs API key (P3.05)", isSet(p3env.ELEVENLABS_API_KEY), isSet(p3env.ELEVENLABS_API_KEY) ? "set" : "set ELEVENLABS_API_KEY (env or branches/a/pipeline3_production/.env)");
add("VERIFY", "seal key (.unified/seal.key)", existsSync(join(root, ".unified", "seal.key")), existsSync(join(root, ".unified", "seal.key")) ? "present (never share it)" : "created by npm run setup / npm run kur");
const py = has(WIN ? "python" : "python3");
add("PRODUCTION", "Python 3 (araç ortamı tools/.venv için)", !!py, py ?? "not found");
{
  const vpy = join(root, "tools", ".venv", WIN ? "Scripts" : "bin", WIN ? "python.exe" : "python");
  const pyBin = existsSync(vpy) ? vpy : py ? (WIN ? "python" : "python3") : null;
  const piperModel = join(root, "tools", "piper", "tr_TR-dfki-medium.onnx");
  if (pyBin) {
    add("PRODUCTION", "Piper + Türkçe ses (P3.04 önizleme, çevrimdışı)", spawnSync(pyBin, ["-c", "import piper"], { shell: WIN && pyBin !== vpy }).status === 0 && existsSync(piperModel), existsSync(piperModel) ? "tools/piper/tr_TR-dfki-medium.onnx" : "npm run setup:voice");
    add("PRODUCTION", "gTTS (önizleme yedeği)", spawnSync(pyBin, ["-c", "import gtts"], { shell: WIN && pyBin !== vpy }).status === 0, "npm run setup:voice");
  }
}
const kg = has("kaggle", ["--version"]);
add("PRODUCTION", "Kaggle CLI (P3.10 archive / distributed render)", !!kg, kg ?? "optional — pip install kaggle + ~/.kaggle/kaggle.json");
const yenv = envFile(join(root, "apps/youtube-agent/.env"));
add("PRODUCTION", "YouTube agent .env", existsSync(join(root, "apps/youtube-agent/.env")), "cd apps/youtube-agent && npm run walkthrough (OAuth + provider keys)");
const upm = String(process.env.UNIFIED_PIPELINE_MODE ?? yenv.UNIFIED_PIPELINE_MODE ?? "").trim().replace(/^["']|["']$/g, "").toLowerCase() === "true";
add("PRODUCTION", "UNIFIED_PIPELINE_MODE=true in YouTube agent", upm, upm ? "on" : "set UNIFIED_PIPELINE_MODE=true in apps/youtube-agent/.env");
const venvBin = (n) => { const p = join(root, "tools", ".venv", WIN ? "Scripts" : "bin", WIN ? `${n}.exe` : n); return existsSync(p) ? p : null; };
const yd = has(venvBin("yt-dlp") ?? "yt-dlp", ["--version"]);
add("PRODUCTION", "yt-dlp (B08 YouTube search — Agent Reach backend)", !!yd, yd ?? "npm run setup:reach");
{
  const rpy = venvBin("python") ?? (py ? (WIN ? "python" : "python3") : null);
  if (rpy) add("PRODUCTION", "feedparser (B08 RSS — Agent Reach backend)", spawnSync(rpy, ["-c", "import feedparser"], { shell: WIN && !venvBin("python") }).status === 0, "npm run setup:reach");
}
add("PRODUCTION", "video-toolkit (music / SFX / word timings for P3.F)", existsSync(join(root, "tools/video-toolkit/tools/music_gen.py")), existsSync(join(root, "tools/video-toolkit")) ? "present @ tools/video-toolkit" : "optional — npm run setup:toolkit");
let vb = null;
try {
  const res = await fetch(process.env.VOICEBOX_URL || "http://127.0.0.1:17493/health", { signal: AbortSignal.timeout(2000) });
  vb = res.ok ? (await res.json()).status ?? "ok" : null;
} catch {}
add("PRODUCTION", "Voicebox server (P3.05 alternative TTS; tr → engine chatterbox)", !!vb, vb ? `running (${vb})` : "optional — start the Voicebox app (default http://127.0.0.1:17493)");
const ar = has(process.env.AGENT_REACH_BIN || venvBin("agent-reach") || "agent-reach", ["--version"]);
add("PRODUCTION", "Agent Reach (B08 live web read)", !!ar, ar ?? "optional — see branches/b/docs/AGENT_REACH_INTEGRATION.md");

// ---- print
let verifyOk = true;
for (const level of ["VERIFY", "PRODUCTION"]) {
  console.log(level === "VERIFY" ? "\n== Required for `npm run setup` + `npm run verify`" : "\n== Required only for real production runs");
  for (const r of rows.filter((x) => x.level === level)) {
    console.log(`${r.ok ? "✔" : level === "VERIFY" ? "✘" : "·"} ${r.name} — ${r.detail}`);
    if (level === "VERIFY" && !r.ok) verifyOk = false;
  }
}
console.log(verifyOk ? "\nVERIFY PREREQUISITES: OK" : "\nVERIFY PREREQUISITES: MISSING (see ✘ above)");
process.exit(verifyOk ? 0 : 1);
