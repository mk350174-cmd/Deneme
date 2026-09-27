#!/usr/bin/env node
// Tek komutla tam kurulum:  npm run kur        (tam)
//                          npm run kur -- --hizli   (testleri atla)
//                          npm run kur -- --ekstrasiz  (toolkit / yt-dlp / Agent Reach kurma)
//
// Sırası: önkoşullar → paketler (her biri kendi lockfile'ıyla) + mühür anahtarı
// → harici araçlar (tools/, tools/.venv) → yapılandırma (.env şablonları, anahtar
// YAZILMAZ) → çalışma klasörü (work/) → doktor → tam doğrulama → kurulum kaydı.
// Tekrar çalıştırmak güvenlidir: .env, work/ ve anahtar dosyalarının üzerine yazmaz (yalnızca
// YouTube agent .env'de UNIFIED_PIPELINE_MODE=true yapılır; node_modules yeniden kurulur).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const WIN = process.platform === "win32";
const MAC = process.platform === "darwin";
const args = new Set(process.argv.slice(2));
const QUICK = args.has("--hizli") || args.has("--quick");
const NO_EXTRAS = args.has("--ekstrasiz") || args.has("--no-extras");

const results = [];
const step = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok === true ? "✔" : ok === "warn" ? "!" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const has = (cmd, a = ["--version"]) => {
  const r = spawnSync(cmd, a, { encoding: "utf8", shell: WIN, timeout: 15000 });
  return r.status === 0 ? (r.stdout || r.stderr).split("\n")[0].trim() : null;
};
const run = (cmd, a, opts = {}) => spawnSync(cmd, a, { cwd: root, stdio: "inherit", shell: WIN, ...opts }).status === 0;
const hint = (win, mac, linux) => (WIN ? win : MAC ? mac : linux);
const banner = (t) => console.log(`\n━━ ${t} ${"━".repeat(Math.max(0, 60 - t.length))}`);

console.log("Birleşik Video Hattı — tek seferde kurulum");
console.log(`Klasör: ${root}`);

// ─── 1. Önkoşullar ──────────────────────────────────────────────────────────
banner("1/7 Önkoşullar");
const nodeMajor = Number(process.versions.node.split(".")[0]);
step("Node.js ≥ 20", nodeMajor >= 20, `v${process.versions.node}`);
if (nodeMajor < 20) {
  console.log(`\nNode.js 20 veya üstü gerekli. Kurun: ${hint("winget install OpenJS.NodeJS.LTS", "brew install node", "https://nodejs.org (LTS) ya da nvm")}`);
  process.exit(1);
}
const git = has("git");
step("git", git ? true : "warn", git ?? `yok — harici araçlar için gerekli: ${hint("winget install Git.Git", "xcode-select --install", "sudo apt install git")}`);
const ff = has("ffmpeg", ["-version"]);
const fp = has("ffprobe", ["-version"]);
step("ffmpeg + ffprobe", !!(ff && fp), ff && fp ? ff.replace(/^ffmpeg version\s*/, "").split(" ")[0] : `yok — P3 render/bitirme ve testler için gerekli: ${hint("winget install Gyan.FFmpeg", "brew install ffmpeg", "sudo apt install ffmpeg")}`);
const PY = WIN ? "python" : "python3";
const py = has(PY);
step("Python 3", py ? true : "warn", py ?? `yok — müzik/SFX/altyazı zamanları ve rakip taraması için: ${hint("winget install Python.Python.3.12", "brew install python", "sudo apt install python3 python3-venv")}`);
if (!(ff && fp)) {
  console.log("\nffmpeg olmadan doğrulama geçemez. Yukarıdaki komutla kurup `npm run kur` komutunu tekrar çalıştırın.");
  process.exit(1);
}

// ─── 2. Paketler + mühür anahtarı ───────────────────────────────────────────
banner("2/7 Paketler (P1, P2, P3, B, YouTube agent, köprüler) + mühür anahtarı");
const setupOk = run("node", ["scripts/setup.mjs"]);
step("paketler kuruldu ve derlendi", setupOk);
if (!setupOk) {
  console.log("\nPaket kurulumu başarısız. İnternet bağlantısını kontrol edip tekrar deneyin; hata yukarıda.");
  process.exit(1);
}
step("mühür anahtarı", existsSync(join(root, ".unified", "seal.key")), ".unified/seal.key (yalnızca bu bilgisayarda; paylaşmayın)");

// ─── 3. Harici araçlar ──────────────────────────────────────────────────────
banner("3/7 Harici araçlar (isteğe bağlı üretim araçları)");
if (NO_EXTRAS) step("harici araçlar", "warn", "--ekstrasiz: atlandı (sonra: npm run setup:extras)");
else if (!git || !py) step("harici araçlar", "warn", "git ve Python gerekli — kurduktan sonra: npm run setup:extras");
else {
  const tk = run("node", ["scripts/setup-extras.mjs", "toolkit"]);
  step("video-toolkit (müzik, SFX, kelime zamanları)", tk ? true : "warn", tk ? "tools/video-toolkit + tools/.venv" : "kurulamadı — sonra: npm run setup:toolkit");
  const vc = run("node", ["scripts/setup-extras.mjs", "voice"]);
  step("Piper + Türkçe önizleme sesi, gTTS", vc ? true : "warn", vc ? "tools/piper + tools/.venv (Gate A5 önizlemesi çevrimdışı)" : "kurulamadı — sonra: npm run setup:voice");
  const rc = run("node", ["scripts/setup-extras.mjs", "reach"]);
  step("yt-dlp + feedparser + Agent Reach (B08)", rc ? true : "warn", rc ? "tools/.venv" : "kurulamadı — sonra: npm run setup:reach");
}

// ─── 4. Yapılandırma (.env şablonları; anahtar yazılmaz) ─────────────────────
banner("4/7 Yapılandırma");
const envTargets = [
  ["apps/youtube-agent/.env.example", "apps/youtube-agent/.env"],
  ["branches/a/pipeline1_research/.env.example", "branches/a/pipeline1_research/.env"],
  ["branches/a/pipeline2_creative/.env.example", "branches/a/pipeline2_creative/.env"],
  ["branches/a/pipeline3_production/.env.example", "branches/a/pipeline3_production/.env"],
];
for (const [from, to] of envTargets) {
  if (!existsSync(join(root, from))) continue;
  if (existsSync(join(root, to))) {
    step(to, true, "zaten var — dokunulmadı");
    continue;
  }
  copyFileSync(join(root, from), join(root, to));
  if (to.endsWith("pipeline3_production/.env")) {
    writeFileSync(join(root, to), `${readFileSync(join(root, to), "utf8").trimEnd()}\n\n# Birleşik hat: ElevenLabs anahtarınızı eşittir işaretinden sonra yazın (bu satırın başında # olmamalı).\n# Anahtarı kimseyle paylaşmayın; sohbete yapıştırdıysanız ElevenLabs panelinden yenileyin.\nELEVENLABS_API_KEY=\n`);
  }
  step(to, true, "şablondan oluşturuldu (anahtar alanları boş)");
}
{
  const p = join(root, "apps/youtube-agent/.env");
  const text = readFileSync(p, "utf8");
  if (/^UNIFIED_PIPELINE_MODE=true\s*$/m.test(text)) step("UNIFIED_PIPELINE_MODE=true", true, "YouTube agent birleşik hat modunda");
  else {
    const next = /^UNIFIED_PIPELINE_MODE=.*$/m.test(text) ? text.replace(/^UNIFIED_PIPELINE_MODE=.*$/m, "UNIFIED_PIPELINE_MODE=true") : `${text.trimEnd()}\nUNIFIED_PIPELINE_MODE=true\n`;
    writeFileSync(p, next);
    step("UNIFIED_PIPELINE_MODE=true", true, "ayarlandı (agent kendi içerik üretmez; A/B hattı üretir)");
  }
}

// ─── 5. Çalışma klasörü ─────────────────────────────────────────────────────
banner("5/7 Çalışma klasörü (work/)");
const work = join(root, "work");
mkdirSync(join(work, "b-store"), { recursive: true });
mkdirSync(join(work, "templates"), { recursive: true });
for (const f of ["brief.example.json", "reach_plan.example.json", "kpi_bindings.example.json"]) {
  const to = join(work, "templates", f);
  if (!existsSync(to)) copyFileSync(join(root, "docs/examples", f), to);
}
step("work/", true, "b-store/ (strateji sürüm geçmişi) + templates/ (brief, reach planı, KPI eşlemesi örnekleri)");

// ─── 6. Doktor ──────────────────────────────────────────────────────────────
banner("6/7 Doktor");
const doctorOk = run("node", ["scripts/doctor.mjs"]);
step("doğrulama önkoşulları", doctorOk);

// ─── 7. Tam doğrulama ───────────────────────────────────────────────────────
banner("7/7 Tam doğrulama (birkaç dakika sürer)");
let verify = { overall: "SKIPPED" };
if (QUICK) step("testler", "warn", "--hizli: atlandı (sonra: npm run verify)");
else {
  const ok = run("node", ["scripts/verify-all.mjs", "--render-optional"]);
  try {
    verify = JSON.parse(readFileSync(join(root, "verification/current/summary.json"), "utf8"));
  } catch {
    verify = { overall: "FAIL" };
  }
  step("tüm test takımları", ok, verify.overall);
  if (ok && verify.render_warning) step("gerçek Remotion render", "warn", "çalışmadı — Chrome indirmesi engelli ya da sistem kütüphaneleri eksik (Linux: sudo apt install libnss3 libgbm1 libasound2); sonra: npm run verify");
}

// ─── Kayıt + özet ───────────────────────────────────────────────────────────
const failed = results.filter((r) => r.ok === false);
const warnings = results.filter((r) => r.ok === "warn");
const record = {
  installed_at: new Date().toISOString(),
  node: process.versions.node,
  platform: `${process.platform}-${process.arch}`,
  quick: QUICK,
  extras: !NO_EXTRAS,
  verify: verify.overall,
  ok: failed.length === 0,
  warnings: warnings.map((w) => `${w.name}: ${w.detail}`),
};
mkdirSync(join(root, ".unified"), { recursive: true });
writeFileSync(join(root, ".unified", "installed.json"), JSON.stringify(record, null, 2) + "\n");

banner("Sonuç");
if (failed.length) {
  console.log("KURULUM TAMAMLANAMADI:");
  for (const f of failed) console.log(`  ✘ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  process.exit(1);
}
console.log("KURULUM TAMAM.");
if (warnings.length) {
  console.log("\nİsteğe bağlı eksikler (hattı engellemez):");
  for (const w of warnings) console.log(`  ! ${w.name} — ${w.detail}`);
}
console.log(`
Gerçek üretim için sizin eklemeniz gerekenler (anahtarlar yalnızca .env dosyalarına yazılır):
  • ElevenLabs anlatım:  branches/a/pipeline3_production/.env → ELEVENLABS_API_KEY
  • YouTube yayın/analytics:  cd apps/youtube-agent && npm run walkthrough   (OAuth)

Sonraki adım: Claude Code'da "yeni video" deyin (veya /yeni-video). Durum için: npm run durum`);
