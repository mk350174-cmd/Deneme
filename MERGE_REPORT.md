# Birleştirme Raporu — 2026-09-22

## Girdiler

| Arşiv | İçerik | Başlangıç test durumu (bu ortamda yeniden çalıştırıldı) |
|---|---|---|
| `A_BRANCH_FINAL_20260906_GPT56.zip` | P1 · P2 · P3 (TypeScript) | 124 + 133 + 427 = **684/684** |
| `B_BRANCH_V5_FINAL_WITH_AGENT_REACH_20260906.zip` | B00–B12 + Agent Reach (TypeScript) | **758/768** — 10 legacy hata, teslim edilen sürümün kendi raporunda belgeli |
| `youtube-automation-agent-master.zip` | AgentTube v2.10.0 (Node/CommonJS, SQLite) | **46/46** |

## Birleştirme sonrası doğrulama (`npm run verify`)

| Takım | Sonuç |
|---|---|
| A · P1 research | 124/124 |
| A · P2 creative | 133/133 |
| A · P3 production | 433/433 (427 orijinal + 6 Voicebox) |
| B · strategy | 764/774 (758 orijinal + 4 B-1/B-2 + 2 B-4) — **KNOWN_RED**: aynı 10 legacy test, isim bazında değişmedi |
| YouTube agent (orijinal takım) | 46/46 |
| YouTube agent · unified entegrasyon (yeni) | 8/8 |
| Köprüler, aşama komutları, zincir denetimi, imzalar (yeni) | bkz. son `npm run verify` — gerçek B01→B12, gerçek ffmpeg, gerçek Remotion render, tüm komut zinciri gerçek CLI ile |

Genel: **PASS** (B'nin önceden var olan legacy kırmızısı belgelendiği şekliyle). Ham çıktılar her çalıştırmada `verification/current/` altına yerel olarak yazılır (git'e girmez).

## Kaynak değişikliği sınırı

- `branches/b/`: orijinal arşivle aynı, **B-1/B-2/B-4 düzeltmeleri hariç** (Güncelleme 4 ve 6; B manifest'i yeniden üretildi, `verify:manifest` PASS). `branches/a/`: iki belgelenmiş istisna dışında aynı — P3 Voicebox adaptörü gerçek API'ye göre düzeltildi (Güncelleme 3; `voiceboxClient.ts`, `voiceboxProvider.ts`, yeni `tests/r08.voiceboxRealApi.test.ts`) ve `remotion/P3Composition.tsx` hata ayıklama etiketi (Güncelleme 7).
- `apps/youtube-agent/`: yalnızca eklemeli — `integration/` (yeni), `schedules/daily-automation.js` (bayrakla korunan iki erken dönüş), `.env.example` (bayrak açıklaması), `package.json` (3 script).
- Yeni: `integration/bridges/` (köprüler + A-Branch aşama komutları), `docs/`, `scripts/`, `.claude/`, `.github/`, `verification/known-failures.json`, kök `package.json`.

## Neler gerçekten test edildi, neler fixture

| Parça | Durum |
|---|---|
| P1 → Köprü 1 → B01 | **Gerçek** P1 kodu (ManualResearchEngine, ağ yok) ve **gerçek** `runB01` |
| B canonical state'ler → B12 | B00 kimlik otoritesiyle oluşturulan canonical state'ler (B'nin kendi integration-fixture tekniği) + **gerçek** `createBranchState` / `commitBranchState` |
| Directive → P2 | **Gerçek** `decideFormat` / `buildFormatDecisionMatrix` |
| P2 paketi | P3'ün mühürlü fixture'ı, gerçek P1 paketine yönlendirilip P3'ün kendi sealer'ı ile yeniden mühürlendi |
| P3 final delivery | **Gerçek** P3 aşamaları (A4–A7) ve **gerçek Remotion 9:16 render** (Güncelleme 7, her `verify`'da); ElevenLabs/Voicebox anlatımı test ikameleriyle (anahtar/sunucu yok) |
| YouTube import/export | **Gerçek** SQLite, gerçek dosyalar, agent'ın kendi Database/Provenance/Operator/Discoverability sınıfları |
| Feed → B08 → B07 | **Gerçek** `AgentReachAdapter`, `externalObservations`, `runB07`; bağımsız review B00 governance ile |
| Canlı YouTube upload/Analytics API, gerçek ElevenLabs/Voicebox anlatımı | **Doğrulanmadı** (anahtar/hesap gerekir). Agent Reach canlı yt-dlp araması ve gerçek Piper önizlemesi burada çalıştırıldı |

## Açık riskler ve kararlar

1. **B legacy kırmızısı (orta).** 10 test B'nin güncel güvenli davranışıyla eski beklentiler arasındaki farktan kaynaklanıyor; B'nin raporu bunları "kanıtsız davranışı geri getirmeden migrate et" olarak işaretliyor. Birleşik doğrulama bu seti isim bazında kilitledi: yeni hata da, sessizce "düzelen" test de gate'i kırar.
2. **B01 ↔ bundle bağı (orta).** B01 canonical state `input_id` saklamıyor; bu yüzden B01'in hangi bundle ile çalıştırıldığı hash eşitliği + çağıran beyanıyla bağlanıyor. Kalıcı çözüm B01 kontrat evrimi.
3. **B orkestratörü eklendi (güncelleme 2).** `b-propose` / `b-commit` gerçek B01→B11 zincirini ve B12 commit'ini iki adımlı insan onayıyla yürütür (parmak izi eşleşmesi, atomik yazım, sürüm artırma). Test edilen: gerçek B kodu uçtan uca, 2 döngü (v1.0 → v1.1), boş strateji reddi, değişen girdi reddi.
4. **Sahneler kilitli (bilinçli).** YouTube agent'ın Scene Repair Studio'su içe aktarılan videoda yeniden üretim yapamaz; düzeltmeler P2/P3'te yapılır. Retention analizi için sahne süreleri korunur.
5. **YouTube agent README'si** başlıkta bir kripto token adresi ve Telegram bağlantısı içeriyor. Kodda buna bağlı bir çağrı bulunmadı; telemetri varsayılan kapalı (yalnızca `ANONYMOUS_TELEMETRY_ENABLED=true` + HTTPS endpoint ile açılır). Dış URL'ler yalnızca yapılandırılan AI/video/TTS sağlayıcıları.
6. **Lisans.** YouTube agent MIT; A ve B private/UNLICENSED. Birleşik repo private tutulmalı; agent'ın `LICENSE` dosyası korunmuştur.

## Güncelleme 2 — B orkestratörü sırasında bulunan B-Branch kusurları

Bunlar B kaynak kodunda; orkestratör etkilerini görünür kılar (B-1 ve B-2 Güncelleme 4'te düzeltildi):

| # | Konum | Kusur | Etki | Birleşik sistemdeki önlem |
|---|---|---|---|---|
| B-1 | `b01/orchestration.ts` (commitVersion, satır ~306 ve ~671) | `brand_profile.brand_name` sabit `"UNKNOWN"` yazılıyor ("Would extract from input") | Marka adı canonical state'e hiç girmiyor | **Düzeltildi — Güncelleme 4** |
| B-2 | `b01/phases/B01_07_territory.ts` | Bölge çıkarımı alt-dize araması: `"us"` her kelimede (focus, thus…) → Kuzey Amerika; `"eu"` → Avrupa; `"restricted"` → Çin | Belgede geçmeyen bölgeler üretilebilir | **Düzeltildi — Güncelleme 4** |
| B-3 | B04/B05 sentezi | Kampanya hedefleri ve açılar sabit şablon metinleri | Canonical onaylı olsa da içerik kanıta dayanmıyor | Köprü 2 bunları `TEMPLATE` etiketler; `owner_goals` ayrı `USER_DEFINED` kanal |
| B-4 | B11 → B12 | B11 provenance `MISSING_SUBJECT_BINDING`; B12 `semantic_validity: INVALID` | Her gerçek zincirde görülür | **Düzeltildi — Güncelleme 6** |

B-1 ve B-2 Güncelleme 4'te, B-4 Güncelleme 6'da düzeltildi; B-3 açık (şablon metinler; köprü bunları `TEMPLATE` etiketiyle taşır).

## Güncelleme 3 — Voicebox, Agent-Reach, claude-code-video-toolkit

Ayrıntılı inceleme ve kararlar: `docs/EXTENSIONS.md`.

| Değişiklik | Kanıt | Test |
|---|---|---|
| **A-P3 Voicebox düzeltmesi** (A kaynağında ilk değişiklik): SSE durum akışı okunuyor, ses `/audio/{id}`'den alınıyor, `tr` → `chatterbox`, dili desteklemeyen motor reddediliyor | `jamiepine/voicebox@51f49de` `backend/routes/generations.py`, `audio.py`, `backends/__init__.py` | `r08.voiceboxRealApi.test.ts` (6) — gerçek sunucu davranışını taklit eden yerel HTTP sunucusu; mevcut 427 P3 testi de geçiyor |
| **B08 taşıyıcıları** (B değişmedi): yt-dlp YouTube araması, feedparser RSS | `Panniantong/Agent-Reach@a19a171` `channels/youtube.py`, `rss.py` | `reach.test.ts` (5 + 1 canlı); canlı yt-dlp araması bu ortamda B08'den geçti |
| **P3.F bitirme + Gate F1** (yeni): gömülü altyazı, lisans beyanlı müzik yatağı, sidechain kısma; Köprü 3 ve YouTube import bitmiş dosyayı taşır | ffmpeg/libass, toolkit `transcribe_words` | `finishing.test.ts` (5) — gerçek ffmpeg ile üretilen 9:16 master; 1080×1920 kare gözle kontrol edildi |
| Orkestratör: `verified_at` eksikliği kök neden olarak raporlanıyor | B03 tarihsiz analitiğe 0 güven veriyor | `reach.test.ts` |
| `setup:extras`, `doctor` kontrolleri, `scripts/word-timings.py`, `CLAUDE.md` kuralları | — | fresh bootstrap |

Dahil edilmeyenler: Agent Reach çerez/tarayıcı kanalları; toolkit `dewatermark.py`/`locate_watermark.py` (filigran kaldırma — yasak), `qwen3_tts.py` (Türkçe yok), `youtube_upload.py` (yayın agent'ta).

## Güncelleme 4 — Sağlamlaştırma

| Değişiklik | Ne sağlar | Test |
|---|---|---|
| **B-1 düzeltildi** — `B01_02_brand_arch` marka adı/misyonunu taşır; `brand_profile.brand_name` artık `"UNKNOWN"` değil | Marka adı canonical state'e girer | `branches/b/tests/unified/b01-fixes.test.ts` |
| **B-2 düzeltildi** — B01_07 bölge çıkarımı Unicode tam-kelime eşleşmesi; `focus`/`thus` Kuzey Amerika, `restricted` Çin üretmez | Belgede olmayan bölge çıkmaz | aynı dosya (4 test toplam); B: 762/772, aynı 10 legacy hata; `verify:manifest`, `lint:policy`, `verify:critical` PASS |
| **`unified status --dir <klasör>`** — dosyaları içeriğe göre tanır, her halkayı (mühür, ebeveyn kimliği, araştırma/strateji/kanal bağı) doğrular, aşamayı ve sonraki komutu Türkçe söyler; kırıksa çıkış 2 | Yanlış döngüden gelen / elle düzenlenmiş dosya anında yakalanır | `audit.test.ts` |
| **Sır koruması** — CLI, API anahtarı, Bearer token, özel anahtar, URL içi parola/`api_key` içeren zarfı yazmaz | `.env` dışına anahtar sızmaz | `audit.test.ts` |
| **Atomik yazım** — tüm çıktılar ve B store geçici dosya + rename | Yarım kalmış JSON olmaz | `audit.test.ts` |
| **Türkçe hata ipuçları** — her köprü hata kodu için "→ Ne yapmalı: …" | Hata mesajından doğrudan eyleme | `audit.test.ts` |
| **CI** — `.github/workflows/unified-ci.yml` (Node 22, ffmpeg, setup + doctor + verify) | Her push'ta tam doğrulama | — |

## Güncelleme 5 — Son gözden geçirme (bağımsız inceleme)

Üç ayrı inceleyici (kod, dokümanlar, kurulum/entegrasyon) repoyu işi yapmamış biri gözüyle taradı. Bulunan ve düzeltilen gerçek sorunlar:

| # | Sorun | Düzeltme | Test |
|---|---|---|---|
| 1 | `strategy.json` mühürsüzdü: `owner_goals` elle değiştirilirse onaysız hedef `USER_DEFINED` olarak P2'ye gidebiliyordu | Sahip hedeflerinin ve bundle'ın hash'i, isimli kişinin commit ettiği mühürlü B12 kararına yazılır; directive ve `status` bunu kontrol eder (`OWNER_GOALS_TAMPERED`) | `hardening.test.ts` |
| 2 | `directive`, başka bir döngünün bundle'ıyla eşleştirilebiliyordu | `DIRECTIVE_BUNDLE_MISMATCH` | `audit.test.ts` |
| 3 | `status`: silinmiş ara dosya ya da bozuk JSON varken "SAĞLAM" diyebiliyordu | Ara halka eksikse ve okunamayan JSON varsa FAIL; alt klasörler yok sayılır | `hardening.test.ts` |
| 4 | İnsan kapıları "PREVIEW", "System", " <adınız>" gibi değerleri kabul edebiliyordu | Tek ortak kural (`assertHumanAuthority`): B12 commit, directive, F1, B08 inceleme | `hardening.test.ts` |
| 5 | Sır koruması `review.md`, SRT ve B store'u kapsamıyordu; AWS/Slack/GitHub-PAT kalıpları eksikti | Brief baştan taranır (hiçbir dosya yazılmadan), kalıplar eklendi | `hardening.test.ts` |
| 6 | P3.F: göreli master yolu yanlış klasöre göre çözülüyordu; altyazıdaki `{…}` libass komutu sayılıyordu; sırasız kelime zamanları; geçersiz müzik kazancı | Mutlak yol, `{}` → `()`, sıra ve -60…0 dB kontrolü | `hardening.test.ts`, `finishing.test.ts` |
| 7 | `--f1` `--finishing` olmadan sessizce yok sayılıyordu | İkisi birlikte zorunlu | `hardening.test.ts` |
| 8 | Bozuk B store `index.json` boş depo sanılıp v1.0'a dönebiliyordu | Açık hata | `hardening.test.ts` |
| 9 | YouTube import yarıda kesilirse bir daha tamamlanamıyordu | İnceleme kaydı yoksa kaldığı yerden devam | `test-integration.js` (8) |
| 10 | `verify`: çöken bir takım eski rapordan PASS alabiliyordu; yüklenemeyen test dosyası ve "ffmpeg yok" diye atlanan testler görünmüyordu | Rapor her çalıştırmada silinir, çıkış kodu ve dosya yükleme hataları sayılır, yalnızca izinli canlı test atlanabilir, zaman aşımı eklendi | — |
| 11 | `.env`, `kaggle.json`, medya dosyaları kök `.gitignore` kapsamında değildi; eski test raporları repoya girmişti | Kapsam genişletildi, raporlar çıkarıldı | `git check-ignore` |
| 12 | `setup:reach` `pip --user` Ubuntu 23+/Homebrew'da (PEP 668) başarısız oluyordu | Repo içi `tools/.venv`; köprüler ve `doctor` onu kendiliğinden bulur | bu ortamda kuruldu, `doctor` ✔ |
| 13 | Dokümanlarda eski ifadeler (A/B hiç değişmedi, eksik `export-feed` parametreleri, `verify --file` her dosya için) | Düzeltildi | — |

O sırada açık bırakılan iki nokta Güncelleme 7'de kapatıldı: zarflar artık kuruluma özgü anahtarla (HMAC) imzalı; RSS taşıyıcısı yerel/özel ağ adreslerine gitmez.

## Güncelleme 6 — B-4 düzeltildi

**Kök neden.** B11, uyum kuralı / risk / kontrol maddelerinin provenance kayıtlarını hiçbir nesneye bağlamadan state'e kopyalıyordu. Yardımcı fonksiyon (`bindUnboundProvenanceRefs`) B11'de import edilmiş ama hiç çağrılmamıştı. Commit sırasında da onaylanmış maddelerin değil, adayın eski kayıtları yazılıyordu. B12, B00'ın `validateSubjectBoundProvenance` kuralıyla bunu `MISSING_SUBJECT_BINDING` olarak yakalıyor ve **her gerçek zinciri** `semantic_validity: INVALID` işaretliyordu.

**Düzeltme** (`branches/b/src/b11/orchestration.ts`, yalnızca `provenance_refs` alanı). Her kayıt, açıkladığı kural/risk/kontrolün tam içerik hash'ine bağlanıyor. Bu, B02/B03'ün zaten yaptığı şeyin aynısı. Commit'te onaylanmış (`DECIDED`) maddelerin provenance'ı yazılıyor. Maddelerin kendisi, onay bağları ve uyum sonuçları değişmedi; hiçbir kontrol COMPLIANT'a çevrilmiyor.

**Sonuç.** Gerçek zincirde B12 değerlendirmesi `INVALID` → `UNKNOWN` oldu. Kalan iki bulgu dürüst ve beklenen durumlardır:
- B11 kontrolleri kanıt olmadan `UNKNOWN` kalır.
- B08'de henüz gerçek analytics yoktur; ilk döngüde normaldir, öğrenme beslemesi gelince kalkar.

**Doğrulama.**
- `tests/unified/b11-provenance.test.ts`: 2 yeni test.
- B: 764/774, aynı 10 legacy hata isim bazında değişmedi.
- B manifest yeniden üretildi.
- B'nin kendi kontrolleri PASS: `verify:manifest`, `lint:policy`, `lint`, `typecheck`, `verify:critical`, `verify:integration`, `verify:remaining`, `test:repair`, `test:agent-reach`.

## Güncelleme 7 — Eksiklerin tamamlanması, tek seferde kurulum, Claude Code tanıtımı

**En büyük eksik: A-Branch'in çalıştırılabilir bir girişi yoktu.** P1, P2 ve P3 yalnızca kütüphaneydi; bir videoyu çalıştırmak için her seferinde kod yazmak gerekiyordu. Artık `integration/bridges/src/stages/` altında üç aşama katmanı ve CLI komutları var (`p1-*`, `p2-*`, `p3-*`). Hepsi A'nın gerçek fonksiyonlarını gerçek sırayla çağırır ve her insan kapısı ayrı, adlı bir komuttur.

| Değişiklik | Kanıt / test |
|---|---|
| P1 aşamaları (kapsam onayı araştırmadan önce; bulgular sonra eklenebilir) | `stage-p1.test.ts` (5) |
| P2 aşamaları (A2, karar onayları, A3; sahne → iddia bağı; UNKNOWN/INFERRED ⚠) | `stage-p2.test.ts` (11) |
| P3 aşamaları (A4–A7, imzalı durum dosyası, kaldığı yerden devam, ElevenLabs kredisi ikinci kez harcanmaz) | `stage-p3.test.ts` (12 + 1 gerçek render) |
| **Gerçek uçtan uca komut zinciri**: örnek girdilerle P1 → B → P2 → P3 plan → Flow dosyaları → P3 ingest (A4); isteğe bağlı gerçek Piper önizlemesi + A5 | `full-chain-cli.test.ts` |
| **Gerçek Remotion render** aşama katmanından: 1080×1920 H.264 + AAC anlatım, final delivery hash'i diskteki MP4 ile aynı | `verify` içinde her seferinde çalışır |
| **P3Composition düzeltmesi** (A kaynağında 2. belgelenmiş istisna): `shot · asset · Nf` hata ayıklama etiketi her karenin köşesine basılıyordu. Etiket artık yalnızca varlığı olmayan yer tutucu blokta çıkıyor; props kontratı değişmedi. | Gerçek render'ın köşe pikselleri testle kontrol ediliyor; kare gözle de incelendi |
| **İmzalı mühürler** (HMAC-SHA256, `.unified/seal.key`, kurulumda üretilir, git'e girmez): elle düzenlenip yeniden mühürlenen, imzası kopyalanan ya da başka kurulumda üretilen dosya reddedilir; `strategy.json` da imzalı; YouTube agent (CommonJS) aynı kuralı uygular | `hardening.test.ts` |
| RSS taşıyıcısı yerel/özel ağ adreslerine gitmez | `hardening.test.ts` |
| **Tek komutla kurulum** `npm run kur`: önkoşul kontrolü (işletim sistemine göre Türkçe kurulum komutları), paketler, mühür anahtarı, toolkit + yt-dlp + Agent Reach + Piper Türkçe ses + gTTS (`tools/.venv`), `.env` şablonları (anahtar yazılmaz), `UNIFIED_PIPELINE_MODE=true`, `work/` iskeleti, doktor, tam doğrulama, kurulum kaydı; tekrar çalıştırmak güvenli | temiz klasörde çalıştırıldı |
| **Claude Code tanıtımı**: `.claude/settings.json` SessionStart hook'u (`scripts/durum.mjs --hook`) oturum başında durumu Claude'a verir; Claude kendini ve hattı Türkçe tanıtır, kurulum yoksa teklif eder. Beceriler: `/tanit`, `/kurulum`, `/durum`, `/yeni-video`. İzin listesi hat komutlarını önceden onaylar; filigran araçlarını ve mühür anahtarının okunmasını yasaklar. | hook çıktısı temiz kurulumda kontrol edildi |
| `npm run durum`, `npm run yeni-dongu -- "<konu>"`; `status` artık P1/P2 taslaklarını ve P3 adımlarını da gösteriyor | `full-chain-cli.test.ts` |

Açık kalanlar (bilinçli):
- **B-3:** B'nin kampanya hedefleri şablon metin; köprü `TEMPLATE` etiketiyle taşır, sahibin hedefleri ayrı kanaldan gider.
- **ElevenLabs ve Voicebox ile gerçek anlatım** bu ortamda denenmedi (anahtar ve sunucu yok). İstekler, P3'ün kendi testlerindeki API biçimiyle birebir; ilk gerçek çalıştırmada `p3-voice` önce P3'ün bağlantı/ses/kota ön kontrolünü yapar.
- **Kaggle arşivi (P3.10)** aşama katmanında çalıştırılmaz (`NOT_ARCHIVED` olarak kaydedilir).
- **GitHub Actions** tanımı hazır, ama bir GitHub reposunda henüz çalıştırılmadı.

## Güncelleme 8 — Son bağımsız gözden geçirme

İki bağımsız inceleyici v2.0'ı (aşama komutları, imzalar, kurulum, Claude Code tanıtımı, dokümanlar) taradı. Düzeltilenler:

| Sorun | Düzeltme | Test |
|---|---|---|
| `npm run unified -- …` döngü klasöründen çalıştırılınca yollar depo kökünden çözülüyordu (belgelerdeki kullanım bozuktu; `p3-plan --dir .` köke yazabilirdi) | CLI, npm'in `INIT_CWD` değişkeniyle komutun yazıldığı klasöre geçer | `full-chain-cli.test.ts` (npm üzerinden) |
| `final_delivery.json` imzasızdı: onay kayıtları "system" yapılabiliyor ya da A4/A5 silinebiliyordu, `to-youtube` yine kabul ediyordu | Her onay kaydı isimli kişi olmalı (`GATE_ACTOR_INVALID`); `to-youtube`, `finish` ve `status`, dosyayı imzalı `p3_state.json`'daki A7 kaydına bağlar (`P3_FINAL_DELIVERY_CHANGED`); P3 kütüphanesiyle doğrudan üretilen teslimler için `--external-p3` | `stage-p3.test.ts` |
| Bir görsel değişip yeniden ingest edilince ElevenLabs anlatımı ikinci kez ücretlendiriliyordu | Anlatım, metin + ses ayarı anahtarıyla imzalı önbellekte tutulur; A5 yine yeniden istenir, A6 gerektiren kayıt yeniden kullanılmaz | `stage-p3.test.ts` |
| İnceleme dosyası isteğe bağlıydı: eski bir `*_review.md` okunup yeni taslak onaylanabiliyordu | `p1-draft`/`p2-draft` incelemeyi her zaman yazar, `p1-approve`/`p2-approve` `--review` ister ve hash'ini doğrular | CLI testleri |
| "VERIFIED = iki bağımsız kaynak" kuralı ifade edilemiyordu; tek kaynakla VERIFIED yazılabiliyordu | `verifications[].cross_checked_with` — bulgunun kendi kaynağından farklı en az bir kaynak yoksa VERIFIED reddedilir | `stage-p1.test.ts` |
| Kaynağı olmayan (UNKNOWN) iddia anlatımda kesin bilgi gibi kullanılabiliyordu | `P2_UNVERIFIED_NARRATION`; sahnede bağlam olarak ⚠ ile kalabilir | `stage-p2.test.ts` |
| Mühür anahtarı silinince imza kontrolleri sessizce kapanıyordu; TS ve CommonJS anahtar araması farklıydı | Kurulu sistemde anahtar yoksa `SEAL_KEY_MISSING`; iki taraf aynı arama kuralını kullanır | `hardening.test.ts` |
| "-", "x", "PREVIEW2" gibi adlar onay kapısından geçiyordu | En az iki harf; önizleme/sistem işaretleri ekli sayı/işaretle de reddedilir | `hardening.test.ts` |
| Gerçek render testi zorunluydu: Chrome indirilemeyen ya da kütüphanesi eksik makinede kurulum "başarısız" oluyordu | `npm run kur` bunu uyarı olarak raporlar (hattın geri kalanı doğrulanır); `npm run verify` ve CI'da zorunlu kalır | kurulum çıktısı |
| Windows: `setup-extras` kabuk üzerinden çalıştığı için boşluklu yollar ve `paket>=sürüm` bozuluyordu | git/python kabuksuz çalıştırılır; yarım kalan sanal ortam yeniden kurulur; Piper indirmesi zaman aşımlı, geçici dosyaya ve SHA-256 doğrulamalı | — |
| `word-timings.py` Linux/macOS'ta sanal ortama geçmiyordu ve anahtarı `.env`'den okumuyordu | `sys.prefix` karşılaştırması; P3 `.env`'den anahtar | elle çalıştırıldı |
| Onay kapısı komutları izin listesinde önceden onaylıydı | `.claude/settings.json` → `ask`: `--actor`, `--scope-approved-by`, `b-commit`, `*-approve`, `approve-f1` her seferinde kullanıcıya sorulur | — |
| Kurulum becerisi 10 dakikayı aşan komut için imkânsız zaman aşımı istiyordu; Ubuntu için eski Node öneriyordu; boş/örnek anahtar "var" görünüyordu | Arka planda çalıştırma, nvm, yer tutucu filtresi; P3 `.env`'ye açık `ELEVENLABS_API_KEY=` satırı | — |
| Dokümanlarda eski ifadeler (gerçek render "doğrulanmadı", tek A istisnası, anahtarsız mühür, karışık yol düzeni, `commitBranchState`, bash'e özgü sözdizimi) | Hepsi güncellendi; RUNBOOK tek yol düzenine (döngü klasörü) geçti | — |

Bilinçli kalanlar: dosya yolları mutlak kaydedilir (döngü klasörü taşınırsa komutlar güvenli biçimde durur ve yeniden çalıştırma ister); B-3; gerçek ElevenLabs/Voicebox ve GitHub Actions ilk gerçek kullanımda denenecek.
