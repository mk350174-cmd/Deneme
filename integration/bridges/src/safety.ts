// Output safety: secrets never enter an envelope or a file the CLI writes,
// and file writes are atomic (temp file + rename) so a crash or Ctrl-C never
// leaves a half-written JSON that a later step would reject as "tampered".

import { rename, writeFile, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["ElevenLabs API key", /\bsk_[a-f0-9]{40,64}\b/i],
  ["OpenAI-style API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/],
  ["AWS access key id", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{30,}/],
  ["Google OAuth client secret", /\bGOCSPX-[0-9A-Za-z_-]{20,}\b/],
  ["OAuth refresh token", /\b1\/\/0[0-9A-Za-z_-]{30,}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["Bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["credential in URL query", /[?&](?:api[_-]?key|access[_-]?token|token|secret|password|sig|signature)=[^&\s"]{8,}/i],
  ["credential in URL userinfo", /\bhttps?:\/\/[^\s/:@"]+:[^\s/@"]+@/i],
];

export class SecretLeakError extends Error {
  constructor(readonly kind: string, readonly where: string) {
    super(`refusing to write: looks like a ${kind} at ${where}`);
    this.name = "SecretLeakError";
  }
}

/** Walks any JSON-like value; throws on the first string that looks like a credential. */
export function assertNoSecrets(value: unknown, where = "$"): void {
  if (typeof value === "string") {
    for (const [kind, re] of SECRET_PATTERNS) if (re.test(value)) throw new SecretLeakError(kind, where);
    return;
  }
  if (Array.isArray(value)) return value.forEach((v, i) => assertNoSecrets(v, `${where}[${i}]`));
  if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) assertNoSecrets(v, `${where}.${k}`);
}

export async function atomicWrite(path: string, text: string): Promise<void> {
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, text, "utf8");
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** Turkish, action-oriented hints for every BridgeError code the CLI can surface. */
export const ERROR_HINTS: Record<string, string> = {
  RESEARCH_PACKAGE_REJECTED: "P1 paketi A1 onaysız ya da mühürden sonra değişmiş. P1'den onaylı paketi yeniden alın.",
  GATE_A1_MISSING: "P1 paketinde Gate A1 (PACKAGE_APPROVED) yok. P1'de paketi onaylayın.",
  P1_IDENTITY_MISSING: "Araştırma paketi eski/elle hazırlanmış görünüyor; gerçek P1 çıktısını kullanın.",
  ENVELOPE_TAMPERED: "Dosya mühürlendikten sonra değiştirilmiş. Elle düzenlemeyin; kaynağından yeniden üretin.",
  WRONG_ENVELOPE_TYPE: "Yanlış dosya verildi (ör. --bundle yerine directive). Komut parametrelerini kontrol edin.",
  MISSING_IDENTITY: "Dosya mühürlü bir zarf değil. Doğru adımın çıktısını verin.",
  BRANCH_NOT_COMMITTED: "B12 snapshot'ı commit edilmemiş. b-commit adımını tamamlayın.",
  NO_HUMAN_COMMIT: "B12 commit'i isimli bir kişi tarafından yapılmamış.",
  MODULE_BRANCH_MISMATCH: "Verilen B modülü commit edilen sürüm değil. strategy.json'u b-commit çıktısından kullanın.",
  MODULE_STATE_TAMPERED: "B modül durumu değiştirilmiş. strategy.json'u yeniden üretin.",
  COMPLIANCE_BLOCKED: "B11 bir kuralı NON_COMPLIANT buldu. Uyum sorununu B'de çözüp yeniden commit edin.",
  NO_USABLE_GOALS: "--strict modda kanıta dayalı/insan kararı hedef kalmadı. Brief'e owner_goals ekleyin.",
  NO_CHANNEL_SELECTED: "B06 kanal seçmedi. Brief'teki kanal bilgisini (audience_category) tamamlayın.",
  DIRECTIVE_RESEARCH_MISMATCH: "Directive başka bir araştırma paketi için. Aynı research.json ile yeniden üretin.",
  LINEAGE_BROKEN: "P2 paketi başka bir araştırmadan üretilmiş. P2'yi doğru paketle çalıştırın.",
  PRODUCTION_PACKAGE_REJECTED: "P2 üretim paketi A3 onaysız ya da değişmiş.",
  DELIVERY_PACKAGE_MISMATCH: "Final delivery bu üretim paketine ait değil.",
  FINAL_DELIVERY_TAMPERED: "Final delivery bölüm hash'leri tutmuyor. P3 çıktısını değiştirmeyin.",
  GATE_A7_MISSING: "P3'te final QA onayı (A7) yok.",
  QA_NOT_PASSED: "P3 otomatik QA geçmedi. Önce P3'te düzeltin.",
  RENDER_NOT_SUCCESSFUL: "Render başarısız görünüyor. P3.08'i yeniden çalıştırın.",
  MASTER_HASH_MISMATCH: "Diskteki MP4, P3'ün render ettiği dosya değil.",
  MASTER_NOT_FOUND: "Master MP4 bulunamadı. final_delivery.json'daki yolu kontrol edin.",
  MUSIC_LICENSE_REQUIRED: "Müzik için --music-source, --music-license ve --music-attested-by gerekli.",
  NOTHING_TO_FINISH: "--captions ve/veya --music verin.",
  FFMPEG_UNAVAILABLE: "ffmpeg bulunamadı. Kurup PATH'e ekleyin (npm run doctor).",
  AUTHORITY_REQUIRED: "Onaylayan kişinin adını yazın (decisions.json → authority / --actor).",
  RATIONALE_REQUIRED: "decisions.json → rationale alanını doldurun.",
  MODULES_NOT_APPROVED: "decisions.json'da onaylamadığınız modül var. Beğenmediyseniz brief'i değiştirip yeniden b-propose.",
  INPUT_CHANGED: "Brief/bundle/dış veri önizlemeden sonra değişmiş. Yeniden b-propose çalıştırın.",
  FINGERPRINT_MISMATCH: "Commit anındaki strateji incelediğinizden farklı çıktı. Yeniden b-propose.",
  STORE_CHANGED: "Strateji deposu önizlemeden sonra ilerlemiş. Yeniden b-propose.",
  STRATEGY_NOT_READY: "B boş strateji üretti. review.md → Engeller bölümündeki eksikleri brief'e ekleyin.",
  DECISIONS_FOR_OTHER_PROPOSAL: "decisions.json başka bir proposal için. b-propose'un ürettiği decisions.json'u kullanın.",
  F1_NOT_FOR_THIS_RECORD: "F1 onayı bu bitirme kaydına ait değil. approve-f1'i yeniden çalıştırın.",
  DIRECTIVE_BUNDLE_MISMATCH: "strategy.json başka bir bundle için commit edilmiş. Aynı döngünün bundle.json'unu verin.",
  OWNER_GOALS_TAMPERED: "strategy.json içindeki sahip hedefleri commit'ten sonra değişmiş. Hedefi brief'te değiştirip b-propose → b-commit ile yeniden onaylayın.",
  ENVELOPE_UNSIGNED: "Dosya bu kurulumun mühür anahtarıyla imzalanmamış (elle hazırlanmış ya da eski). Kaynağından yeniden üretin.",
  SIGNATURE_INVALID: "Dosya imzalandıktan sonra değiştirilmiş ve anahtarsız yeniden mühürlenmiş. Elle düzenlemeyin; kaynağından yeniden üretin.",
  SIGNED_WITH_OTHER_KEY: "Dosya başka bir kurulumda (başka bilgisayar/anahtar) üretilmiş. Bu bilgisayarda kaynağından yeniden üretin.",
  UNSIGNED: "strategy.json bu kurulumun anahtarıyla imzalanmamış. b-commit ile yeniden üretin.",
  GATE_ACTOR_INVALID: "Final delivery'deki bir onay kaydı isimli bir kişiye ait değil. P3'ü p3-* komutlarıyla yeniden onaylayın.",
  FINISHING_F1_PAIR: "Bitmiş videoyu göndermek için --finishing ve --f1 birlikte verilmeli (F1 onayı olmadan bitmiş dosya gönderilmez).",
  BAD_MUSIC_GAIN: "--music-gain -60 ile 0 arasında bir sayı olmalı (dB, varsayılan -18).",
  BAD_WORD_TIMING: "Kelime zamanları bozuk veya sırasız. scripts/word-timings.py çıktısını yeniden üretin.",
  REVIEWER_REQUIRED: "Gözlemi inceleyen kişinin adını yazın.",
  FINISHING_OF_OTHER_MASTER: "Bitirme kaydı başka bir master'dan. finish adımını yeniden çalıştırın.",
};
