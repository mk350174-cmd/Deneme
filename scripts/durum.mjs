#!/usr/bin/env node
// Durum özeti — `npm run durum` (kişi için) ve Claude Code SessionStart hook'u
// (`node scripts/durum.mjs --hook`, çıktısı Claude'un bağlamına eklenir).
// Hızlıdır, hiçbir şeyi değiştirmez ve her koşulda 0 ile çıkar.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const HOOK = process.argv.includes("--hook");
const L = [];
const read = (p) => {
  try {
    return JSON.parse(readFileSync(join(root, p), "utf8"));
  } catch {
    return null;
  }
};
const envHas = (p, key) => {
  try {
    const m = new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*(\\S[^\\r\\n]*)$`, "m").exec(readFileSync(join(root, p), "utf8"));
    return !!m && !/^<|your_|_here$|^x+$/i.test(m[1].trim().replace(/^['"]|['"]$/g, ""));
  } catch {
    return false;
  }
};

try {
  const installed = read(".unified/installed.json");
  const built = existsSync(join(root, "integration/bridges/dist/cli.js"));
  const pkg = read("package.json");

  L.push(`# Birleşik Video Hattı v${pkg?.version ?? "?"} — oturum durumu`);
  L.push("");
  L.push("Hat: P1 araştırma → B strateji (B00–B12) → P2 kreatif → P3 prodüksiyon (Google Flow görselleri, ElevenLabs anlatım, Remotion render) → bitirme (altyazı/müzik) → YouTube agent (inceleme, yayın, analytics) → öğrenme B'ye geri döner. Her insan kapısı (A1–A7, B commit, F1) kullanıcının adını ister.");
  L.push("");
  if (!installed || !built) {
    L.push("## Kurulum: YAPILMAMIŞ");
    L.push("Tek komut: `npm run kur` (önkoşul kontrolü + tüm paketler + harici araçlar + yapılandırma + testler; ~5–15 dk). Önkoşul: Node ≥ 20, ffmpeg; önerilen: git, Python 3.");
  } else {
    L.push(`## Kurulum: ${installed.ok ? "TAMAM" : "EKSİK"} (${installed.installed_at?.slice(0, 10)}, doğrulama: ${installed.verify})`);
    for (const w of installed.warnings ?? []) L.push(`- isteğe bağlı eksik: ${w}`);
    const keys = [];
    if (!envHas("branches/a/pipeline3_production/.env", "ELEVENLABS_API_KEY") && !process.env.ELEVENLABS_API_KEY) keys.push("ElevenLabs anahtarı yok (üretim anlatımı için; branches/a/pipeline3_production/.env → ELEVENLABS_API_KEY)");
    if (!existsSync(join(root, "apps/youtube-agent/config/tokens.json"))) keys.push("YouTube bağlantısı kurulmamış (yayın/analytics için: cd apps/youtube-agent && npm run walkthrough)");
    for (const k of keys) L.push(`- ${k}`);
  }

  // Döngüler
  const work = join(root, "work");
  const cycles = existsSync(work) ? readdirSync(work, { withFileTypes: true }).filter((d) => d.isDirectory() && /^cycle-\d+/.test(d.name)).map((d) => d.name).sort() : [];
  L.push("");
  if (!cycles.length) L.push("## Video döngüleri: henüz yok — başlamak için `npm run yeni-dongu -- \"<konu>\"` (ya da /yeni-video).");
  else {
    L.push(`## Video döngüleri (${cycles.length})`);
    const auditPath = join(root, "integration/bridges/dist/chainAudit.js");
    const audit = built && existsSync(auditPath) ? await import(pathToFileURL(auditPath).href) : null;
    for (const c of cycles.slice(-5)) {
      if (!audit) {
        L.push(`- ${c}`);
        continue;
      }
      try {
        const st = await audit.auditCycle(join(work, c));
        L.push(`- **${c}** — ${st.stage} · zincir ${st.ok ? "SAĞLAM" : "KIRIK"}`);
        L.push(`  sıradaki: ${st.next}`);
      } catch (e) {
        L.push(`- ${c} — durum okunamadı: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
} catch (e) {
  L.push(`(durum toplanırken hata: ${e instanceof Error ? e.message : e})`);
}

if (HOOK) {
  L.push("");
  L.push("## Claude için (oturum başı)");
  L.push("- Bu oturumdaki İLK yanıtında, kullanıcı başka bir şey sormadıysa bile, kendini ve bu çalışma alanını Türkçe, kısa ve sıcak bir dille tanıt: bu hattın ne yaptığını (yukarıdaki tek satır), şu anki kurulum ve döngü durumunu ve yapılabilecek 3–4 somut şeyi (/yeni-video, /durum, /kurulum, /tanit) söyle. Uzun liste yapma.");
  L.push("- Kurulum YAPILMAMIŞ ise: tanıtımdan hemen sonra `npm run kur` komutunu çalıştırmayı teklif et; kullanıcı onaylarsa çalıştır ve sonucu özetle. ffmpeg/Node gibi sistem paketleri eksikse kurulum komutunu (işletim sistemine göre) göster, izin almadan sistem paketi kurma.");
  L.push("- CLAUDE.md'deki kurallar geçerli: insan kapılarını asla kullanıcı yerine doldurma; filigran kaldırma yok; anahtarlar yalnızca .env içinde.");
}

console.log(L.join("\n"));
process.exit(0);
