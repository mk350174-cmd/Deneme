---
name: durum
description: Kurulumun ve tüm video döngülerinin durumunu, zincir denetimini ve sıradaki adımı Türkçe gösterir. "durum", "nerede kaldık", "sıradaki adım ne" gibi isteklerde kullan.
---

# Durum

1. `node scripts/durum.mjs` çalıştır.
2. Belirli bir döngü sorulduysa ya da tek açık döngü varsa: `npm run unified -- status --dir work/cycle-NNN`. P3 aşamasındaysa `npm run unified -- p3-status --dir work/cycle-NNN`.
3. Türkçe ve kısa anlat: hangi video, hangi aşamada, zincir sağlam mı, sıradaki komut ve o adımda kullanıcının vermesi gereken karar (onay kapısı varsa açıkça söyle).
4. `Zincir: KIRIK` ise: hangi halka, neden, ve dosyanın kaynağından nasıl yeniden üretileceği. Dosyayı elle "düzeltmeyi" önerme; mühürler ve imzalar elle düzenlemeyi zaten reddeder.
