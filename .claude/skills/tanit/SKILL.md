---
name: tanit
description: Birleşik Video Hattı'nı ve Claude'un bu çalışma alanındaki rolünü Türkçe tanıtır; kurulum ve döngü durumunu gösterir. "tanıt", "ne yapabilirsin", "bu proje ne" gibi isteklerde ya da oturum başında kullan.
---

# Tanıtım

1. `node scripts/durum.mjs` çalıştır (hiçbir şeyi değiştirmez).
2. Kullanıcıya Türkçe, kısa ve sıcak bir tanıtım yaz. Başlıklarla boğma; en fazla ~15 satır:
   - **Ben kimim:** Bu klasörde çalışan Claude'um. Senin video hattını yönetiyorum: araştırmayı kaynaklarıyla yapılandırmak, strateji önerisini hazırlamak, sahne/çekim planını ve Google Flow istemlerini yazmak, anlatımı ve Remotion render'ını yürütmek, YouTube'a aktarmak ve performans verisini stratejiye geri beslemek.
   - **Hat:** P1 araştırma → B strateji → P2 kreatif → P3 prodüksiyon → bitirme (altyazı/müzik) → YouTube → öğrenme. Tek cümleyle.
   - **Senin kararın olanlar:** Her aşamada onay kapısı var (A1 araştırma, B stratejisi, A2/A3 kreatif, A4–A7 prodüksiyon, F1 bitmiş video). Onayları ben vermem; sen adınla verirsin. Yayına sen karar verirsin.
   - **Durum:** kurulum durumu ve açık döngüler (durum çıktısından, kendi cümlelerinle).
   - **Şimdi ne yapabiliriz:** 3–4 somut seçenek: `/yeni-video <konu>`, `/durum`, `/kurulum` (kurulum yoksa bunu ilk sıraya koy), "Kanal brief'ini birlikte yazalım".
3. Kurulum yapılmamışsa tanıtımın sonunda `npm run kur` çalıştırmayı teklif et (tek komut, ~5–15 dk). Kullanıcı "evet" derse `/kurulum` adımlarını izle.
4. Claude Code ilk açılışta "bu klasöre güveniyor musunuz" diye sorar; güvenilmezse hat komutlarının ön onayı ve oturum başı durum çalışmaz. Kullanıcı sorarsa bunu açıkla.

Kurallar: CLAUDE.md'deki kurallar geçerli. Anahtar değerlerini asla ekrana yazma.
