#!/usr/bin/env node
// Yeni video döngüsü:  npm run yeni-dongu -- "Taydula Hatun"
// work/cycle-NNN/ klasörünü açar ve başlangıç dosyalarını koyar. Var olan
// hiçbir dosyanın üzerine yazmaz. Kanal brief'i (work/brief.json) tüm
// döngülerde ortaktır; B'nin sürüm geçmişi work/b-store/ içinde birikir.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const work = join(root, "work");
const topic = process.argv.slice(2).join(" ").trim();
mkdirSync(join(work, "b-store"), { recursive: true });

const nums = (existsSync(work) ? readdirSync(work) : []).map((n) => /^cycle-(\d+)/.exec(n)?.[1]).filter(Boolean).map(Number);
const n = (nums.length ? Math.max(...nums) : 0) + 1;
const dir = join(work, `cycle-${String(n).padStart(3, "0")}`);
mkdirSync(dir, { recursive: true });

const ex = (f) => join(root, "docs/examples", f);
// Channel brief: shared by every cycle; first time it starts from the example.
if (!existsSync(join(work, "brief.json"))) copyFileSync(ex("brief.example.json"), join(work, "brief.json"));
copyFileSync(join(work, "brief.json"), join(dir, "brief.json"));

const p1 = JSON.parse(readFileSync(ex("p1_input.example.json"), "utf8"));
if (topic) {
  p1.topic = topic;
  p1.question = `<${topic} hakkında cevaplanacak ana soru>`;
  p1.queries = [{ query: `<${topic} — araştırma sorusu 1>`, dimension: "people" }];
  p1.findings = [];
  p1.verifications = [];
}
writeFileSync(join(dir, "p1_input.json"), JSON.stringify(p1, null, 2) + "\n");
copyFileSync(ex("p2_input.example.json"), join(dir, "p2_input.template.json"));
copyFileSync(ex("p3_input.example.json"), join(dir, "p3_input.json"));

console.log(`Yeni döngü: ${dir}
  brief.json            kanal brief'i (work/brief.json'dan kopya — kanal bilgisini orada güncelleyin)
  p1_input.json         araştırma girdisi${topic ? ` (konu: ${topic})` : ""} — bulguları ve kaynakları doldurun
  p2_input.template.json kreatif girdi örneği — P1 ve directive bitince p2_input.json olarak doldurun
  p3_input.json         anlatım sağlayıcısı (ElevenLabs voice_id / Voicebox profili)

Sıradaki: npm run unified -- p1-scope --input p1_input.json --out scope.json --review p1_scope.md   (klasör: ${dir})
Durum:    npm run unified -- status --dir ${dir}`);
