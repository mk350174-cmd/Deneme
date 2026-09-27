# Runbook — bir video döngüsünü uçtan uca çalıştırmak

Önkoşul: Node ≥ 20 ve ffmpeg. Kök dizinde bir kez:

```bash
npm run kur       # tek seferde: önkoşullar, paketler, harici araçlar, .env şablonları, work/, testler
npm run durum     # kurulum + döngülerin durumu
```

Aşağıdaki her adım bir dosya üretir. Mühürlü zarflar (bundle, proposal, directive, youtube_import, finishing, f1) `npm run unified -- verify --file <dosya>` ile; diğerleri (strategy, p2-inputs, reach/dış veri, learning feed) aşağıdaki `status` komutuyla denetlenir.

**Her video için ayrı klasör.** `npm run yeni-dongu` döngü başına `work/cycle-001/`, `work/cycle-002/` … açar; aşağıdaki komutların hepsi **o klasörün içinden** çalıştırılır (`npm run unified -- …` göreli yolları bulunduğunuz klasöre göre çözer). Kanal düzeyindeki dosyalar bir üstte, `work/` içinde durur: `../b-store/` (strateji sürüm geçmişi), `../external_intelligence.json`, `../kpi_bindings.json`, `../reach_plan.json`. İstediğiniz an:

```bash
npm run unified -- status --dir .
```

Klasördeki dosyaları içeriğinden tanır, her halkayı (mühür, ebeveyn kimliği, araştırma ↔ strateji ↔ directive ↔ üretim ↔ YouTube bağı) doğrular, döngünün hangi aşamada olduğunu ve sıradaki komutu söyler. Kırık bir halka varsa hangisi olduğunu yazar ve çıkış kodu 2 ile sonlanır. `--json` makine okunur çıktı verir.

## 0. Kanal bağlamı (bir kez)

Kanal brief'i `work/brief.json` (şablon `docs/examples/brief.example.json`; `npm run yeni-dongu` ilk seferde oluşturur ve her döngüye kopyalar). İsteğe bağlı `work/context.json` — markayı ve kanalları **kanal sahibi** yazar, araştırmadan türetilmez:

```json
{
  "brand": { "brand_name": "Kanal Adı", "positioning": "Bozkır tarihinin kadın figürleri", "values": ["kaynak odaklı"] },
  "channels": [{ "channel_id": "ch_yt_main", "name": "Kanal Adı", "platform": "YouTube", "url": "https://www.youtube.com/@..." }],
  "default_platform": "YouTube"
}
```

## 1. Araştırma — A · P1 (Gate A1)

Yeni döngü: `npm run yeni-dongu -- "Taydula Hatun"` → `work/cycle-NNN/` (içinde `p1_input.json`, `brief.json`, şablonlar). Aşağıdaki komutları o klasörde çalıştırın.

P1 bir kütüphanedir; araştırmayı siz (ya da Claude ile birlikte) yaparsınız, P1 onu yapılandırır ve mühürler. `p1_input.json` biçimi: `docs/examples/p1_input.example.json`.

```bash
# 1a. Kapsam — konu, ana soru, amaç, kısıtlar, dil (henüz bulgu gerekmez)
npm run unified -- p1-scope --input p1_input.json --out scope.json --review p1_scope.md
# 1b. Araştırmayı yapın: her bulgu = ifade + kaynak (URL/künye) + alıntı/sayfa; doğrulama durumu:
#     iki bağımsız kaynak = VERIFIED, tek kaynak = INFERRED, kaynak yok = UNKNOWN. Sonra kapsamı onaylayarak taslak:
npm run unified -- p1-draft --input p1_input.json --scope scope.json --scope-approved-by "Adınız" --out research_draft.json --review p1_review.md
# 1c. p1_review.md'yi okuyun; onaylıyorsanız (Gate A1):
npm run unified -- p1-approve --draft research_draft.json --actor "Adınız" --review p1_review.md --out research.json
```

Kapsam onayından sonra bulgu ekleyebilirsiniz; konu/soru/amaç/kısıt/dil değişirse kapsam yeniden onaylanmalıdır (`P1_INPUT_CHANGED`).

## 2. Köprü 1 — araştırma → strateji girdisi

```bash
npm run unified -- research-to-strategy --research research.json --context ../context.json --out bundle.json
```

`bundle.b01_input` → B01'e, `bundle.b03_audience_sources` → B03 `audience_sources`'a verilir.

## 3. Strateji — B · B01…B11 + B12 commit (orkestratör)

Önce kanal sahibi olarak bir **strateji brief'i** yazın (`docs/examples/brief.example.json` şablonu). B'nin heuristik motoru şunlar olmadan boş strateji üretir: kanal için `audience_category` (`professional|lifestyle|creators|broad|niche`), marka `positioning`, ve kanal/platform adını geçen kitle kanıtı (ör. `audience.platform_analytics`). `owner_goals` / `owner_constraints` directive'e **USER_DEFINED** olarak girer — B'nin şablon hedeflerinden ayrı tutulur.

```bash
# 3a. Önizleme — gerçek B01→B11 zinciri "PREVIEW" yetkisiyle çalışır, hiçbir şey commit edilmez
npm run unified -- b-propose --bundle bundle.json --brief brief.json --store ../b-store \
  --out proposal.json --review review.md --decisions decisions.json
#   (sonraki döngülerde: --intel ../external_intelligence.json)
```

`review.md` dosyasını okuyun: her modülün ne ürettiği, B'nin epistemik etiketleri (TEMPLATE/HEURISTIC/DEFAULT), B'nin bildirdiği eksikler ve B12 semantik/operasyonel değerlendirmesi. "HAZIR DEĞİL" yazıyorsa engeller listelenir; brief'i düzeltip 3a'yı tekrarlayın.

```bash
# 3b. Onay — decisions.json: her modülü true yapın, authority (adınız) ve rationale yazın
npm run unified -- b-commit --bundle bundle.json --brief brief.json --proposal proposal.json \
  --decisions decisions.json --store ../b-store --out strategy.json
```

`b-commit` zinciri sizin adınızla yeniden çalıştırır ve her modülün içeriğini incelediğiniz parmak iziyle karşılaştırır. Tek bir fark, değişmiş girdi, eksik onay ya da isimsiz yetki varsa **hiçbir şey commit edilmez**. Başarılı olursa B01–B11 ve commit edilmiş B12 snapshot'ı `../b-store/` altına yazılır; sonraki döngü otomatik olarak bir sonraki sürümü (v1.1, v1.2 …) üretir.

### 3c. (Önerilir) Rakip ve trend verisi — Agent Reach backend'leri

`docs/examples/reach_plan.example.json` şablonuyla aynı figür/konu hakkındaki YouTube videolarını ve RSS kaynaklarını B08'den geçirin; `b-propose --intel` ile B02'ye verin:

```bash
npm run unified -- reach --plan ../reach_plan.json --out ../reach_intel.json
npm run unified -- b-propose ... --intel ../reach_intel.json
```

Not: brief'teki `audience.platform_analytics` kayıtlarına `verified_at` (YouTube Studio'da rakamları okuduğunuz tarih) ekleyin; yoksa B03 kitleye 0 güven verir ve öneri "HAZIR DEĞİL" olur.

## 4. Köprü 2 — commit edilmiş strateji → kreatif directive

```bash
npm run unified -- directive --bundle bundle.json --strategy strategy.json --out directive.json
#   --strict        HEURISTIC/TEMPLATE hedefleri etiketlemek yerine at
#   --channel <id>  B06'da birden çok kanal varsa seç
#   --aspect 9:16   varsayılan zaten 9:16
npm run unified -- p2-inputs --directive directive.json --research research.json --out p2-inputs.json
```

## 5. Kreatif — A · P2 (Gate A2, A3)

`p2_input.json` (şablon: döngüdeki `p2_input.template.json` ya da `docs/examples/p2_input.example.json`): referanslar, anlama/strateji, sanat yönü, sahneler ve çekimler (süre, kamera, `asset_type`), her çekim için **Google Flow istemi**, anlatım satırları. Her sahne/anlatım satırı `research.json`daki `claim_id`'lere bağlanır; araştırmada olmayan iddia reddedilir. `approvals` alanlarına, o adımı inceleyip onaylayan kişinin adını yazın (A2 ve karar onayları).

```bash
npm run unified -- p2-draft --input p2_input.json --research research.json --directive directive.json --out p2_draft.json --review p2_review.md
# p2_review.md: sahneler, süreler, her sahnenin dayandığı iddialar (UNKNOWN/INFERRED ⚠ ile), Flow istemleri, anlatım
npm run unified -- p2-approve --draft p2_draft.json --actor "Adınız" --review p2_review.md --out production_package.json   # Gate A3
```

## 6. Prodüksiyon — A · P3 (Gate A4–A7)

```bash
npm run unified -- p3-plan --production production_package.json --dir .
#   assets_checklist.md: her çekim için dosya adı (assets/<id>.png|.mp4) + Google Flow istemi + anlatım metni
#   → görselleri Google Flow'da üretip bu adlarla assets/ klasörüne koyun
npm run unified -- p3-ingest --production production_package.json --dir . --actor "Adınız"           # Gate A4
npm run unified -- p3-preview --production production_package.json --dir .                            # Piper (çevrimdışı Türkçe) → gTTS
npm run unified -- p3-approve-voice --production production_package.json --dir . --actor "Adınız"    # Gate A5 (önizlemeyi dinlediniz)
#   telaffuz bayrağı kalırsa: --confirm "Taydula,Canibek" ya da p3-resolve-ambiguity (Gate A6)
npm run unified -- p3-voice --production production_package.json --dir . --config p3_input.json       # ElevenLabs / Voicebox
npm run unified -- p3-render --production production_package.json --dir .                             # zamanlama + Remotion 9:16 + anlatım + QA
#   render/master.mp4'ü izleyin
npm run unified -- p3-approve --production production_package.json --dir . --actor "Adınız"          # Gate A7 → final_delivery.json
npm run unified -- p3-status --dir .                                                                  # nerede kaldınız
```

`p3_input.json`: `provider` (`elevenlabs` | `voicebox`), ElevenLabs `voice_id` ya da Voicebox profili. Anahtar **yalnızca** `ELEVENLABS_API_KEY` ortam değişkeni ya da `branches/a/pipeline3_production/.env` içinde durur. Aynı anlatım ikinci kez istenirse yeniden üretilmez (kredi harcanmaz; `--force` ile zorlanır). Her adım önceki adımların dosyalarını hash ile kontrol eder; bir görsel ya da ses sonradan değişirse ilgili adımı yeniden çalıştırmanız istenir.

## 6b. (Önerilir) Bitirme — P3.F altyazı + müzik

Ayrıntı: `docs/EXTENSIONS.md` §3. Kısaca: `finish` → `finish/finished.mp4`'ü izleyin → `approve-f1` → Köprü 3'e `--finishing … --f1 …` ekleyin. Kelime-hizalı altyazı için önce (depo kökünden) `python3 scripts/word-timings.py work/cycle-NNN/voice/narration.wav work/cycle-NNN/words.json` (Windows: `python`).

## 7. Köprü 3 — YouTube agent'a aktarım

```bash
npm run unified -- to-youtube --final final_delivery.json --production production_package.json \
  --research research.json --directive directive.json --out youtube_import.json
cd ../../apps/youtube-agent          # döngü klasöründen
npm run unified:import -- ../../work/cycle-NNN/youtube_import.json
```

Opsiyonel `--options opts.json`: `{ "title": "...", "tags": [...], "language": "tr" }`.
Import **hiçbir şeyi onaylamaz**. Review Studio'da: Evidence desk'te `pending` iddiaları çözün, factual + rights onaylarını verin, sentetik medya beyanını kontrol edin, başlığı/açıklamayı düzenleyin, onaylayın, zamanlayın.

## 8. Yayın ve ölçüm — YouTube agent

Agent `.env` içinde `UNIFIED_PIPELINE_MODE=true` ile çalışır: yayın kuyruğu, 24s/7g analytics, retention, yorum senkronu, Shorts ve paket deneyleri normal şekilde işler.

## 9. Köprü 4 — öğrenme geri beslemesi

Depo kökünden:

```bash
cd apps/youtube-agent
npm run unified:export-feed -- --channel ch_yt_main --project <B-proje-id> --out ../../work/learning_feed.json
cd ../..
npm run unified -- feed-to-b --feed work/learning_feed.json --bindings work/kpi_bindings.json --out work/external_intelligence.json
```

`work/kpi_bindings.json` (örnek: `work/templates/kpi_bindings.example.json`) — hangi YouTube metriğinin hangi B07 KPI'ını cevapladığını **siz** yazarsınız:

```json
[{ "kpi_id": "<B07 kpi_id>", "youtube_metric": "views", "unit": "count", "measurement_window": "7d" }]
```

Kullanılabilir metrikler: `views, impressions, ctr, retention, averageViewDuration, watchMinutes, watchHours, engagementRate, netSubscribers, …` (yalnızca sonlu sayısal değerler).

`reach_plan.json` içindeki `project_id` ile `--project` aynı değer olmalıdır (aksi hâlde `merge-intel` `CROSS_PROJECT_MERGE` ile reddeder). Tam örnek: `docs/examples/kpi_bindings.example.json`.

`external_intelligence.json` bir sonraki döngüde `b-propose ... --intel ../external_intelligence.json` ile verilir (reach verisi de varsa önce `merge-intel` ile birleştirin); orkestratör B03/B07/B08'e kendisi aktarır. B07'nin gerçek değeri yazabilmesi için her ölçümün **bağımsız kanıtla** (ör. YouTube Studio dışa aktarımı) incelenmesi gerekir: `prepareObservationReview(observation, { authority, reviewed_at, confirmation_evidence })` → `reviews` alanı (bu adım şimdilik yalnızca kütüphane fonksiyonu; CLI komutu yok ve inceleme kişinin kendisi tarafından yapılır). B10 önerileri onaylanıp canonical olduğunda bir sonraki directive'e `CAMPAIGN_MEMORY` olarak girer.

## Sorun giderme

| Hata kodu | Anlamı | Ne yapılır |
|---|---|---|
| `STRATEGY_NOT_READY` | B04–B07 boş kaldı | `review.md` → Engeller; brief'e eksik girdiyi ekleyip yeniden `b-propose` |
| `FINGERPRINT_MISMATCH` / `INPUT_CHANGED` / `STORE_CHANGED` | İncelediğiniz öneri ile commit anı farklı | Yeniden `b-propose`, yeniden onay |
| `MODULES_NOT_APPROVED` / `AUTHORITY_REQUIRED` | decisions.json eksik | Her modülü `true` yapın, adınızı yazın |
| `RESEARCH_PACKAGE_REJECTED` | P1 paketi A1'siz veya mühür sonrası değişmiş | P1'den yeniden onaylı paket alın |
| `BRANCH_NOT_COMMITTED` / `NO_HUMAN_COMMIT` | B12 snapshot commit edilmemiş | `b-commit` ile isimli onay verin |
| `MODULE_BRANCH_MISMATCH` / `MODULE_STATE_TAMPERED` | Verilen B05/B06/… commit edilen sürüm değil | Snapshot'taki sürümleri kullanın veya yeniden commit edin |
| `COMPLIANCE_BLOCKED` | B11 NON_COMPLIANT | Uyum sorununu B'de çözün |
| `DIRECTIVE_RESEARCH_MISMATCH` / `LINEAGE_BROKEN` | Directive/üretim paketi başka araştırmadan | Aynı araştırma paketinden yeniden üretin |
| `GATE_A7_MISSING` / `FINAL_DELIVERY_TAMPERED` | P3 final QA onayı yok veya paket değişmiş | P3'te A7'yi tamamlayın |
| `VIDEO_HASH_MISMATCH` | Diskteki MP4, P3'ün render ettiği değil | Doğru dosyayı kullanın |
| B08 sonuç `UNAVAILABLE` | Feed'de o video/pencere için gerçek (simüle olmayan) ölçüm yok | 7g penceresinin dolmasını bekleyin |
| `refusing to write: looks like a …` | Yazılacak zarfta API anahtarı/token benzeri değer var | Değeri brief/context'ten çıkarın; anahtarlar yalnızca `.env` içinde |
| `status` → `Zincir: KIRIK` | Klasörde başka döngüden ya da elle düzenlenmiş dosya | Satırda adı geçen dosyayı kaynağından yeniden üretin |

CLI her hata için "→ Ne yapmalı: …" satırı basar; tablo ile aynı bilgidir.
