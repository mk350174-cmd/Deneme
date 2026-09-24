# CLAUDE.md — Birleşik Video Hattı

Bu repo üç sistemin birleşimidir: A-Branch (P1 araştırma → P2 kreatif → P3 prodüksiyon), B-Branch (B00–B12 strateji) ve YouTube agent (inceleme, yayın, analytics). Kullanıcı 9:16 tarihî belgesel kısa videolar üretir (Google Flow görselleri, ElevenLabs anlatım, Remotion render). Mimari: `docs/UNIFIED_ARCHITECTURE.md`. Adım adım kullanım: `docs/RUNBOOK.md`. Durum ve riskler: `MERGE_REPORT.md`. Kullanıcıyla **Türkçe** konuş.

## Oturum açılışı

Oturum başında `scripts/durum.mjs --hook` çıktısı bağlama eklenir (`.claude/settings.json`). İlk yanıtında, kullanıcı başka bir şey sormasa bile, `/tanit` becerisindeki gibi kendini ve hattı kısaca tanıt, durumu söyle ve somut seçenekler sun.

- Kurulum yapılmamışsa (`.unified/installed.json` yok): tanıtımdan sonra `npm run kur`'u teklif et, onay gelirse `/kurulum` adımlarıyla çalıştır. Sistem paketlerini (Node, ffmpeg, git, Python) kullanıcı onayı olmadan kurma; işletim sistemine uygun komutu göster.
- Kurulum varsa: açık döngülerin aşamasını ve sıradaki adımı söyle; yeni video için `/yeni-video <konu>` öner.

Beceriler: `/tanit`, `/kurulum`, `/durum`, `/yeni-video` (`.claude/skills/`).

## Kurallar

- **İnsan kapıları senin yerine geçilmez.** Gate A1–A7, B commit (`decisions.json` → `authority`/`approve`), F1, YouTube agent'taki factual/rights/approval onayları ve B08 gözlem incelemeleri kullanıcının kararıdır. Kapı komutlarını (`p1-draft --scope-approved-by`, `p1-approve`, `b-commit`, `p2-approve`, `p2_input.json → approvals`, `p3-ingest`, `p3-approve-voice`, `p3-resolve-ambiguity`, `p3-approve`, `approve-f1`) yalnızca kullanıcı açıkça onayladıktan sonra, **kullanıcının verdiği adla** çalıştır. Ad uydurma; "PREVIEW", "system", yer tutucu kullanma (kod bunları zaten reddeder).
- Kaynak dürüstlüğü: P1 bulgularına kaynağı olmayan bilgi yazma. İki bağımsız kaynak = VERIFIED, tek kaynak = INFERRED, kaynak yok = UNKNOWN. UNKNOWN iddiayı videoda kesin bilgi gibi anlatma. TEMPLATE / HEURISTIC / DEFAULT maddeleri "kanıta dayalı" diye sunma. Simüle analytics B'ye gitmez.
- Dosyalar mühürlü ve bu kuruluma özgü anahtarla imzalıdır (`.unified/seal.key`, paylaşılmaz, okunmaz). Zarfları, `strategy.json`'u ya da `p3_state.json`'u elle düzenleme; kaynağından yeniden üret. Kontrol: `npm run unified -- status --dir work/cycle-NNN`.
- Anahtarlar yalnızca `.env` dosyalarında durur; anahtar değerini ekrana yazma, girdi JSON'larına koyma (CLI reddeder). Kullanıcı sohbete anahtar yapıştırırsa `.env`'ye yazabilirsin, tekrar gösterme, yenilemesini öner. `.unified/seal.key` kurulumun imza anahtarıdır: okuma, paylaşma; kullanıcıya yedeğini aldır.
- `branches/a/` ve `branches/b/` kaynak koduna dokunma. Belgelenmiş istisnalar: P3 Voicebox düzeltmesi (Güncelleme 3), B-1/B-2/B-4 (Güncelleme 4 ve 6), P3Composition hata ayıklama etiketi (Güncelleme 7). B'de kod değişirse `cd branches/b && npm run manifest && npm run verify:manifest`. Frozen kontratlar: P2.11 ProductionPackageHandoff, P3 `timeline.ts` / `render.ts` / `kaggle.ts`, P3Composition props, B01 ve B08 external kontratları. Yeni davranış `integration/bridges/` içinde yazılır.
- `npm run verify` sonucu `OVERALL: PASS (with documented B legacy KNOWN_RED)` normaldir; B'deki 10 eski test hatası `verification/known-failures.json` içinde isimleriyle kilitli. Test silme/atlama yapma.
- YouTube agent bu hatta `UNIFIED_PIPELINE_MODE=true` ile çalışır (kurulum ayarlar); kendi içerik üretimi ve strateji incelemesi kapalıdır. Yayın onayı Review Studio'da kullanıcıdadır.
- Harici araçlar (`docs/EXTENSIONS.md`): `tools/video-toolkit` yalnızca müzik (`music_gen.py`, `addmusic.py`), SFX (`sfx.py`) ve kelime zamanları (`scripts/word-timings.py`) için. **Filigran kaldırma yok:** `dewatermark.py` / `locate_watermark.py` kurulumda silinir; istenirse reddet ve nedenini söyle. Toolkit'in `/publish`, `youtube_upload.py` ve şablonları kullanılmaz.
- Agent Reach: yalnızca çerezsiz backend'ler (`unified reach` → yt-dlp arama, RSS). Çerez/tarayıcı oturumu isteyen kanalları yapılandırma, `agent-reach configure --from-browser` çalıştırma.
- Müzik lisans beyanını (`--music-license`, `--music-attested-by`) kullanıcı verir. F1'i kullanıcı bitmiş videoyu izledikten sonra verir.
- Ses: üretim anlatımı ElevenLabs ya da Voicebox (Türkçe için `chatterbox`); Piper/gTTS yalnızca önizleme. Ses klonlama yalnızca kullanıcının kendi sesi veya açık izinli seslerle.

## Komutlar

Tümü `npm run unified -- <komut>`; göreli yollar komutu yazdığınız klasöre göre çözülür (döngü klasöründen çalıştırın). Tam liste: `npm run unified -- help`. Onay kapısı komutları (`--actor`, `--scope-approved-by`, `b-commit`, `*-approve`, `approve-f1`) her seferinde kullanıcıya sorulur (`.claude/settings.json` → ask).

| Aşama | Komut |
|---|---|
| Kurulum / durum | `npm run kur` · `npm run durum` · `npm run yeni-dongu -- "<konu>"` |
| P1 araştırma (A1) | `p1-scope` → `p1-draft --scope-approved-by "<ad>" --review p1_review.md` → `p1-approve --review p1_review.md --actor "<ad>"` → research.json |
| B strateji (G-B) | `research-to-strategy` → `b-propose` → (kullanıcı decisions.json) → `b-commit` → `directive` |
| P2 kreatif (A2, A3) | `p2-draft --input p2_input.json --review p2_review.md` → `p2-approve --review p2_review.md --actor "<ad>"` → production_package.json |
| P3 prodüksiyon (A4–A7) | `p3-plan` → (Google Flow → assets/) → `p3-ingest` → `p3-preview` → `p3-approve-voice` → `p3-voice --config p3_input.json` → `p3-render` → `p3-approve` → final_delivery.json |
| Bitirme (F1) | `finish --captions [--music …]` → `approve-f1 --actor "<ad>"` |
| YouTube | `to-youtube` → `cd apps/youtube-agent && npm run unified:import -- <youtube_import.json>` |
| Öğrenme | `npm run unified:export-feed -- --channel … --project … --out …` (agent) → `feed-to-b` → sonraki `b-propose --intel` |
| Rakip / trend (B08) | `reach --plan reach_plan.json --out reach_intel.json` → `merge-intel` |
| Denetim | `status --dir <döngü>` · `p3-status --dir <döngü>` · `verify --file <zarf>` |

Çalışma dosyaları `work/` altında (git'e girmez): `work/brief.json` (kanal), `work/b-store/` (strateji sürüm geçmişi), `work/cycle-NNN/` (her video). Kod değişikliğinden sonra: ilgili paketin testleri + `npm run verify`. Her push'ta `.github/workflows/unified-ci.yml` tam doğrulamayı çalıştırır.
