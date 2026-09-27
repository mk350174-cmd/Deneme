# Birleşik Video Hattı — A + B + YouTube Agent (v2.1)

9:16 kaynak temelli belgesel kısa videoları araştırmadan yayına ve yayından sonraki öğrenmeye kadar tek hatta yürütür. Claude Code ile birlikte kullanılmak üzere hazırlanmıştır.

## Hızlı başlangıç

1. Zip'i bir klasöre açın ve klasörü **Claude Code** ile açın. Claude kendini tanıtır ve kurulumu teklif eder.
2. Ya da terminalde:
   ```bash
   npm run kur        # tek komut: önkoşul kontrolü + tüm paketler + harici araçlar + yapılandırma + testler
   npm run durum      # kurulum ve video döngülerinin durumu
   npm run yeni-dongu -- "Taydula Hatun"
   ```

Önkoşullar: **Node ≥ 20** ve **ffmpeg** (zorunlu). **git** ve **Python 3** önerilir: müzik/SFX/kelime zamanları, çevrimdışı Türkçe önizleme sesi (Piper) ve rakip taraması (yt-dlp) için. Kurulum eksikleri Türkçe söyler ve işletim sisteminize göre kurulum komutunu gösterir.

Gerçek üretim için ayrıca: ElevenLabs anahtarı (`branches/a/pipeline3_production/.env`) ve YouTube OAuth (`cd apps/youtube-agent && npm run walkthrough`).

## Hat

| Aşama | Ne olur | Sizin kararınız |
|---|---|---|
| **P1 araştırma** | Bulgular kaynaklarıyla yapılandırılır, doğrulama durumu (VERIFIED/INFERRED/UNKNOWN) atanır | Kapsam + paket onayı (A1) |
| **B strateji** | B01–B11 gerçek zinciri çalışır, önizleme `review.md` olarak gelir | Modül onayı + commit (G-B) |
| **P2 kreatif** | Sahneler, çekimler, Google Flow istemleri, anlatım; her sahne araştırmaya bağlı | Referans/sanat yönü (A2), paket (A3) |
| **P3 prodüksiyon** | Varlık listesi → Flow görselleri → anlatım (ElevenLabs/Voicebox) → Remotion render → QA | Teslim (A4), ses (A5/A6), final (A7) |
| **Bitirme** | Gömülü altyazı, lisanslı müzik, sidechain kısma | Bitmiş video (F1) |
| **YouTube** | Review Studio, SEO, yayın, analytics | Yayın onayı |
| **Öğrenme** | Gerçek ölçümler B08 üzerinden bir sonraki stratejiye | Gözlem incelemesi |

| Bileşen | Konum |
|---|---|
| A-Branch (P1 · P2 · P3) | `branches/a/` |
| B-Branch (B00–B12 + Agent Reach) | `branches/b/` |
| YouTube automation agent (v2.10.0) | `apps/youtube-agent/` |
| Köprüler, aşama komutları, CLI | `integration/bridges/` |
| Claude Code ayarları ve becerileri | `CLAUDE.md`, `.claude/` |

- Adım adım kullanım: [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
- Mimari ve sahiplik kararları: [`docs/UNIFIED_ARCHITECTURE.md`](docs/UNIFIED_ARCHITECTURE.md)
- Harici araçlar (toolkit, Voicebox, Agent Reach): [`docs/EXTENSIONS.md`](docs/EXTENSIONS.md)
- Doğrulama durumu, düzeltmeler ve riskler: [`MERGE_REPORT.md`](MERGE_REPORT.md)

A ve B kaynak kodunda yalnızca belgelenmiş düzeltmeler var: P3 Voicebox (Güncelleme 3), B-1/B-2/B-4 (Güncelleme 4 ve 6), P3Composition etiketi (Güncelleme 7). YouTube agent'a yalnızca eklemeli değişiklik yapıldı (`integration/`, `UNIFIED_PIPELINE_MODE` bayrağı).
