# Eklenen üç repo — inceleme ve entegrasyon kararları (2026-09-22)

| Repo | İncelenen commit | Lisans | Pipeline'daki yeri |
|---|---|---|---|
| [jamiepine/voicebox](https://github.com/jamiepine/voicebox) | `51f49de` | MIT | **P3.05** alternatif TTS (A-Branch'te zaten vardı — gerçek API'ye göre **düzeltildi**) |
| [Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach) | `a19a171` (v1.5.0) | MIT | **B08** dış veri: YouTube araması (yt-dlp) + RSS (feedparser) taşıyıcıları |
| [digitalsamba/claude-code-video-toolkit](https://github.com/digitalsamba/claude-code-video-toolkit) | `225c80a` | MIT | **P3.F** (yeni bitirme aşaması) için müzik / SFX / kelime zamanlaması girdileri |

Hiçbiri repoya gömülmedi. `npm run kur` (ya da `npm run setup:extras`, tek tek `setup:toolkit`, `setup:reach`, `setup:voice`) sabitlenmiş commit'leri `tools/` altına, Python paketlerini repo içi `tools/.venv` sanal ortamına kurar (sistem Python'una dokunmaz; Ubuntu 23+/Homebrew'daki PEP 668 kısıtından etkilenmez). Köprüler, `scripts/word-timings.py` ve `doctor` bu ortamı kendiliğinden bulur. `dewatermark.py` / `locate_watermark.py` kurulumda yerel kopyadan silinir. Önizleme sesi: Piper + Türkçe `tr_TR-dfki-medium` modeli (SHA-256 ile sabitlenmiş) ve gTTS.

## 1. Voicebox → P3.05 (düzeltme)

A-Branch P3'te `voiceboxClient.ts` zaten vardı, fakat kendi yorumunda bir uç noktayı "tahmin" olarak işaretlemişti. Voicebox kaynak koduyla karşılaştırınca iki kesin hata çıktı:

| | A-Branch'in varsaydığı | Gerçek sunucu (`backend/routes/*`) | Etki |
|---|---|---|---|
| Durum | `GET /generate/{id}/status` → tek JSON | Aynı yol ama **SSE akışı** (`data: {...}` satırları, tamamlanınca kapanır) | `JSON.parse` her gerçek çağrıda patlıyordu |
| Ses | `GET /generate/{id}/audio` | `GET /audio/{id}` | Ses hiç alınamıyordu |
| Türkçe | varsayılan motor `qwen` | Türkçe'yi yalnızca `chatterbox` destekliyor | Türkçe metin yanlış motora gidiyordu |

Düzeltme (A kaynağında ilk ve tek değişiklik, küçük ve izole): son SSE olayını okuyan `parseVoiceboxStatusBody`, `/audio/{id}`, dile göre varsayılan motor (`tr` → `chatterbox`) ve dili desteklemeyen açık motor seçiminin reddi. Yeni test `tests/r08.voiceboxRealApi.test.ts` gerçek sunucunun davranışını birebir taklit eden yerel bir HTTP sunucusuna karşı çalışır (SSE, `/audio`, Türkçe). Voicebox'ın `RESPONSIBLE_USE.md`'si gereği ses klonlama yalnızca kendi sesiniz ya da açık izinli seslerle yapılmalı.

Kullanım: Voicebox uygulamasını çalıştırın (varsayılan `http://127.0.0.1:17493`), bir ses profili oluşturun ve döngüdeki `p3_input.json` dosyasında `"provider": "voicebox"`, `voicebox.profile_id` olarak girin (`p3-voice` bunu kullanır). A-Branch'in ses politikası değişmedi: otomatik sağlayıcı yükseltmesi yok, A5 onayı şart.

## 2. Agent-Reach → B08 (YouTube araması + RSS)

Agent Reach bir kurulum/sağlık katmanı; asıl veriyi seçtiği araçlar getiriyor (YouTube → yt-dlp, RSS → feedparser, web → Jina). B-Branch B08 yalnızca web okumayı uygulamış, arama/RSS/YouTube'u "DEFERRED" bırakmıştı.

`integration/bridges/src/reachTransports.ts` bu boşluğu **B'yi değiştirmeden** kapatır: iki taşıyıcı B'nin kendi `AgentReachTransport` arayüzünü uygular, dolayısıyla her sonuç B08'in normalize → SHA-256 → evidence `UNKNOWN` / `production_eligible=false` → provenance → yeniden doğrulama hattından geçer. B02 bunları `CompetitiveObservation` / `TrendObservation` olarak tüketir.

- Sabit argv, kabuk yok, çıktı sınırı, zaman aşımı; sonuç alanları beyaz listeyle süzülür (test: `cookies` alanı sızmıyor).
- Yapamadığını reddeder: coğrafya/tarih filtresi → `UNSUPPORTED_CAPABILITY`; `http://` RSS → reddedilir.
- **Bilinçli olarak dahil edilmedi:** çerez / tarayıcı oturumu isteyen kanallar (Twitter, XiaoHongShu, Facebook, Instagram, çerezli Reddit, LinkedIn, Xueqiu) ve `agent-reach configure --from-browser` çerez çıkarma. B08 politikası kimlik bilgisini B'nin içine sokmayı yasaklar; bu kanallar sizin oturumunuzla hareket eder.
- Canlı doğrulama: bu ortamda gerçek `yt-dlp` araması B08'den geçti (`UNIFIED_LIVE_REACH=1`). İlk sonuç konuyla doğrudan ilgiliydi ("Hanların Annesi, Devletin Aklı: Taydula Hatun", 314 sn) — tam da B02'nin rakip analizi için gereken veri.

```bash
npm run unified -- reach --plan work/reach_plan.json --out work/reach_intel.json   # şablon: docs/examples/reach_plan.example.json
npm run unified -- merge-intel --in work/reach_intel.json --in2 work/external_intelligence.json --out work/intel.json
npm run unified -- b-propose ... --intel work/intel.json
```

## 3. claude-code-video-toolkit → P3.F bitirme aşaması (yeni)

P3'ün render kontratı ve `P3Composition.tsx` dondurulmuş; müzik, SFX ve altyazı katmanı yok. 9:16 Shorts için gömülü altyazı ve konuşmanın altında kısılan müzik standarttır. Bu yüzden A7 ile Köprü 3 arasına **P3.F** eklendi (`integration/bridges/src/finishing.ts`):

- Girdi: A7 onaylı master MP4. Diskteki dosyanın SHA-256'sı P3'ün kaydettiği değerle aynı olmalı.
- Altyazı: P2 `voice_lines` metninden SRT. Zamanlama `WORD_ALIGNED` (kelime zamanları verildiyse) ya da `ESTIMATED_CHARACTER_SHARE` olarak **etiketlenir**. ffmpeg/libass ile gömülür, Shorts arayüz bandının üstünde; Türkçe karakterler görsel olarak kontrol edildi.
- Müzik: sahibin **lisans beyanı** (`source`, `license`, `attested_by`) olmadan kabul edilmez. Döngüye alınır, `sidechaincompress` ile anlatımın altında kısılır.
- Çıktı yeni bir dosya olduğu için A7 onayı onu kapsamaz → **Gate F1**: bir kişi bitmiş videoyu izleyip onaylar. Köprü 3, F1'e bağlı olmayan bitirme kaydını reddeder; onaylıysa YouTube'a **bitmiş** dosya + SRT gider (agent `assets.captions`).

Toolkit'in rolü **girdi üretmek**tir:

| İhtiyaç | Toolkit aracı | Not |
|---|---|---|
| Müzik yatağı | `tools/music_gen.py` (ACE-Step) veya `tools/addmusic.py` (ElevenLabs) | Lisans koşullarını sağlayıcıdan kontrol edin |
| SFX | `tools/sfx.py` (ElevenLabs) | |
| Kelime zamanları | `transcribe_words` (ElevenLabs Scribe) → `python3 scripts/word-timings.py narration.wav words.json` (Windows: `python`) | Altyazıyı `WORD_ALIGNED` yapar |

**Kullanılmayanlar ve nedenleri:**

| Toolkit parçası | Neden kullanılmıyor |
|---|---|
| `dewatermark.py`, `locate_watermark.py` | Stok görüntü / TikTok / NotebookLM filigranlarını silmek için hazır ayarlar içeriyor. Filigran kaldırmak lisans ve kaynak gösterme sorunudur; bu hatta **yasak** (`CLAUDE.md`). |
| `qwen3_tts.py` | Qwen3-TTS Türkçe desteklemiyor; P3'te ElevenLabs / Voicebox-chatterbox var. |
| `youtube_upload.py`, `/publish` | Yayın YouTube agent'ın işi (onay kapılarıyla). |
| Şablonlar, Remotion sahneleri | P3 render'ı ve kompozisyonu dondurulmuş; yaratıcı yön P2'de. |

```bash
npm run setup:toolkit      # npm run kur zaten kurar
# döngü klasöründen (work/cycle-NNN):
npm run unified -- finish --final final_delivery.json --production production_package.json --outdir finish \
  --captions --language tr [--word-timings words.json] \
  [--music bed.mp3 --music-source "ACE-Step (toolkit)" --music-license "<lisans>" --music-attested-by "<adınız>"] \
  --out finishing.json
# finish/finished.mp4'ü izleyin, sonra:
npm run unified -- approve-f1 --finishing finishing.json --actor "<adınız>" --out f1.json
npm run unified -- to-youtube ... --finishing finishing.json --f1 f1.json --out youtube_import.json
```
