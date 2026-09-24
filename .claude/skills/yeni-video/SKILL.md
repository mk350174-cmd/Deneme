---
name: yeni-video
description: Yeni bir video döngüsünü baştan sona birlikte yürütür (araştırma → strateji → kreatif → Google Flow görselleri → anlatım → Remotion render → bitirme → YouTube). "yeni video", "video yapalım", konu vererek başlama isteklerinde kullan.
argument-hint: "<konu, ör. Taydula Hatun>"
---

# Yeni video döngüsü

Her adımda: komutu çalıştır → üretilen inceleme dosyasını (…_review.md) kullanıcıya özetle → **onay kapısında dur**. Onayı kullanıcı adıyla verir ("onaylıyorum, adım …"). Adı sen uydurmazsın, "PREVIEW"/"system" yazmazsın; kullanıcı açıkça onaylamadan kapı komutunu çalıştırmazsın. Her adımdan sonra `npm run unified -- status --dir <döngü>` ile zinciri doğrula.

Klasör: `npm run yeni-dongu -- "$ARGUMENTS"` → `work/cycle-NNN/`. Aşağıdaki tüm komutlar bu klasörde (`cd work/cycle-NNN`) ve `npm run unified -- …` yerine doğrudan `node ../../integration/bridges/dist/cli.js …` ile de çalışır.

## 0. Kanal brief'i (bir kez)
`work/brief.json` kanalın kimliği: marka, kanal, kitle, sahibin hedefleri. Yoksa kullanıcıyla birlikte doldur (örnek: `docs/examples/brief.example.json`). Kitle analitiğinde `verified_at` yoksa B03 güveni 0 olur; kullanıcıya sor.

## 1. P1 araştırma (Gate A1)
1. `p1_input.json`: konu, ana soru, amaç, kısıtlar, dil. `p1-scope --input p1_input.json --out scope.json --review p1_scope.md` → kapsamı göster → kullanıcı onaylarsa adını al.
2. Araştırma: kaynak bul (web araması, kullanıcının PDF'leri, kitap künyeleri). Her bulgu = ifade + kaynak (URL/künye) + alıntı/sayfa. **Kaynağı olmayan bilgi yazma.** Doğrulama durumu: iki bağımsız kaynak = VERIFIED, tek kaynak = INFERRED, kaynak yok = UNKNOWN. Emin değilsen düşük olanı seç.
3. `p1-draft --input p1_input.json --scope scope.json --scope-approved-by "<kullanıcının adı>" --out research_draft.json --review p1_review.md` → incelemeyi özetle (özellikle UNKNOWN/INFERRED iddialar).
4. Kullanıcı onaylarsa: `p1-approve --draft research_draft.json --actor "<ad>" --review p1_review.md --out research.json`.

## 2. B strateji (G-B)
`research-to-strategy --research research.json --out bundle.json` → `b-propose --bundle bundle.json --brief brief.json --store ../b-store --out proposal.json --review review.md --decisions decisions.json` → review.md'yi özetle (TEMPLATE/HEURISTIC etiketlerini "kanıta dayalı" diye sunma) → kullanıcı onaylarsa decisions.json'da `authority`, `rationale`, `approve` alanlarını **kullanıcının söylediğiyle** doldur → `b-commit … --out strategy.json` → `directive --bundle bundle.json --strategy strategy.json --out directive.json`.

## 3. P2 kreatif (A2, A3)
`p2_input.template.json`'dan `p2_input.json` yaz: sahneler, çekimler (süre, kamera, asset_type), her çekim için Google Flow istemi, anlatım satırları. Her sahne/anlatım satırı `research.json`daki claim_id'lere bağlanır; UNKNOWN iddiayı kesin bilgi gibi anlatma. `approvals` alanlarını kullanıcı onayladıkça onun adıyla doldur. `p2-draft --input p2_input.json --research research.json --directive directive.json --out p2_draft.json --review p2_review.md` → özetle → onaylarsa `p2-approve --draft p2_draft.json --actor "<ad>" --review p2_review.md --out production_package.json`.

## 4. P3 prodüksiyon (A4–A7)
1. `p3-plan --production production_package.json --dir .` → `assets_checklist.md`: her dosya adı + Google Flow istemi. Kullanıcı görselleri Google Flow'da üretip `assets/` içine bu adlarla koyar.
2. `p3-ingest --production production_package.json --dir . --actor "<ad>"` (A4).
3. `p3-preview …` → önizlemeyi (voice/preview_*.wav|mp3) kullanıcı dinler → `p3-approve-voice … --actor "<ad>" [--confirm "Taydula,…"]` (A5; telaffuz bayrağı kalırsa `p3-resolve-ambiguity`, A6).
4. `p3-voice … --config p3_input.json` (ElevenLabs voice_id ya da Voicebox profili; anahtar .env'de). Ses klonlama yalnızca kullanıcının kendi sesi veya izinli ses.
5. `p3-render …` → render/master.mp4'ü kullanıcı izler → `p3-approve … --actor "<ad>"` (A7) → final_delivery.json.

## 5. Bitirme (F1) ve YouTube
- Altyazı/müzik: `finish --final final_delivery.json --production production_package.json --outdir finish --captions --out finishing.json` (müzik için lisans bilgisini kullanıcı verir) → kullanıcı izler → `approve-f1 --finishing finishing.json --actor "<ad>" --out f1.json`.
- `to-youtube --final final_delivery.json --production production_package.json --research research.json --directive directive.json [--finishing finishing.json --f1 f1.json] --out youtube_import.json` → `cd ../../apps/youtube-agent && npm run unified:import -- ../../work/cycle-NNN/youtube_import.json`. Yayın onayı YouTube agent'ın Review Studio'sunda kullanıcıdadır.
- Yayından ~7 gün sonra öğrenme: `cd apps/youtube-agent && npm run unified:export-feed -- --channel <kanal_id> --project <B proje id> --out ../../work/learning_feed.json` → `npm run unified -- feed-to-b --feed work/learning_feed.json --bindings work/kpi_bindings.json --out work/external_intelligence.json` (KPI eşlemesini kullanıcı yazar: `work/templates/kpi_bindings.example.json`) → bir sonraki döngüde `b-propose … --intel ../external_intelligence.json`.

Hata olursa CLI'nın "→ Ne yapmalı" satırını izle; mühürlü dosyaları elle düzenleme, kaynağından yeniden üret.
