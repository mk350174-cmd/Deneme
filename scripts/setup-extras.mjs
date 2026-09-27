#!/usr/bin/env node
// Optional external tools, pinned to the commits reviewed on 2026-09-22.
// Nothing here is vendored into the repo; everything lands in tools/ (gitignored).
//
//   node scripts/setup-extras.mjs toolkit      claude-code-video-toolkit (music, SFX, word timings)
//   node scripts/setup-extras.mjs reach        yt-dlp + feedparser (+ Agent Reach CLI for `doctor`)
//   node scripts/setup-extras.mjs voice        Piper (offline Turkish preview voice, model pinned by SHA-256) + gTTS
//   node scripts/setup-extras.mjs all
//
// Voicebox is a desktop app/server (https://github.com/jamiepine/voicebox);
// install it from its releases, start it, then `npm run doctor` checks
// http://127.0.0.1:17493/health.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const WIN = process.platform === "win32";
const PY = WIN ? "python" : "python3";
const PINS = {
  toolkit: { repo: "https://github.com/digitalsamba/claude-code-video-toolkit.git", commit: "225c80a" },
  agentReach: { repo: "https://github.com/Panniantong/Agent-Reach", commit: "a19a171" },
};
// No shell: git and python are real executables. (With shell:true on Windows, paths with spaces
// split and "pkg>=1.0" becomes a redirect.)
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: false, windowsHide: true });
const what = process.argv[2] ?? "all";

// Repo-local virtualenv for every Python helper: works on Debian/Ubuntu/Homebrew
// (PEP 668) and inside other venvs, needs no PATH change; the bridges,
// scripts/word-timings.py and `doctor` find tools/.venv automatically.
const venv = join(root, "tools", ".venv");
const vpy = join(venv, WIN ? "Scripts" : "bin", WIN ? "python.exe" : "python");
function ensureVenv() {
  mkdirSync(join(root, "tools"), { recursive: true });
  // a venv left half-made (e.g. python3-venv missing) is recreated instead of failing forever
  const healthy = () => existsSync(vpy) && spawnSync(vpy, ["-m", "pip", "--version"], { stdio: "ignore" }).status === 0;
  if (!healthy()) {
    rmSync(venv, { recursive: true, force: true });
    run(PY, ["-m", "venv", venv]);
    if (!healthy()) throw new Error(`Python sanal ortamı kurulamadı (${venv}). Linux'ta: sudo apt install python3-venv`);
  }
  run(vpy, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "-U", "pip"]);
}

if (what === "toolkit" || what === "all") {
  const dir = join(root, "tools", "video-toolkit");
  mkdirSync(join(root, "tools"), { recursive: true });
  // an interrupted earlier clone leaves a folder without .git — start over
  if (existsSync(dir) && !existsSync(join(dir, ".git"))) rmSync(dir, { recursive: true, force: true });
  if (!existsSync(dir)) run("git", ["clone", "--filter=blob:none", PINS.toolkit.repo, dir]);
  try {
    run("git", ["checkout", "--quiet", PINS.toolkit.commit], dir);
  } catch {
    run("git", ["fetch", "--quiet", "origin"], dir);
    run("git", ["checkout", "--quiet", PINS.toolkit.commit], dir);
  }
  // Watermark removal is not part of this pipeline (CLAUDE.md): the scripts are removed from the local clone.
  for (const f of ["dewatermark.py", "locate_watermark.py"]) rmSync(join(dir, "tools", f), { force: true });
  // Only what the four allowed tools need (music_gen, addmusic, sfx, align_captions) — no torch, no cloud GPU.
  ensureVenv();
  run(vpy, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "elevenlabs>=1.0.0", "python-dotenv>=1.0.0", "requests>=2.28.0"]);
  console.log(`\nvideo-toolkit @ ${PINS.toolkit.commit} → tools/video-toolkit (Python deps → tools/.venv)`);
  console.log("Use ONLY: tools/music_gen.py, tools/addmusic.py, tools/sfx.py, tools/align_captions.py. Never dewatermark.py / locate_watermark.py (see CLAUDE.md).");
}
if (what === "voice" || what === "all") {
  // P3.04 narration PREVIEW only (Piper → gTTS). Production voice stays ElevenLabs / Voicebox.
  ensureVenv();
  run(vpy, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "piper-tts", "gTTS"]);
  const dir = join(root, "tools", "piper");
  mkdirSync(dir, { recursive: true });
  const base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/tr/tr_TR/dfki/medium/";
  const files = [
    ["tr_TR-dfki-medium.onnx", "2844717f524ab965d3fe86e60562cbb601d3e456836efcc2196cc3a14112a8fb"],
    ["tr_TR-dfki-medium.onnx.json", null],
  ];
  const { createHash } = await import("node:crypto");
  const { readFileSync, writeFileSync } = await import("node:fs");
  for (const [name, sha] of files) {
    const target = join(dir, name);
    const ok = () => existsSync(target) && (!sha || createHash("sha256").update(readFileSync(target)).digest("hex") === sha);
    if (ok()) continue;
    const res = await fetch(base + name, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok) throw new Error(`Piper voice download failed: ${name} (${res.status})`);
    const tmp = `${target}.part`;
    writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    const got = createHash("sha256").update(readFileSync(tmp)).digest("hex");
    if (sha && got !== sha) {
      rmSync(tmp, { force: true });
      throw new Error(`Piper voice ${name}: SHA-256 mismatch — refusing to use it`);
    }
    const { renameSync } = await import("node:fs");
    renameSync(tmp, target);
  }
  console.log("\nPiper + Türkçe ses (tr_TR-dfki-medium) → tools/piper; gTTS → tools/.venv (yalnızca önizleme).");
}
if (what === "reach" || what === "all") {
  ensureVenv();
  run(vpy, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "-U", "yt-dlp[default]", "feedparser"]);
  run(vpy, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", `git+${PINS.agentReach.repo}@${PINS.agentReach.commit}`]);
  console.log(`\nyt-dlp + feedparser + Agent Reach @ ${PINS.agentReach.commit} → tools/.venv (used automatically by 'unified reach' and 'doctor').`);
  console.log("Cookie/browser channels are intentionally NOT configured (see docs/EXTENSIONS.md).");
}
