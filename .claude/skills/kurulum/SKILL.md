---
name: kurulum
description: Birleşik Video Hattı'nı tek seferde kurar (npm run kur) ve eksikleri Türkçe açıklar. "kur", "kurulum", "install", "setup", ilk açılışta kurulum yoksa kullan.
---

# Kurulum

1. Önkoşulları kontrol et: `node --version` (≥ 20), `ffmpeg -version`, `git --version`, `python3 --version` (Windows'ta `python --version`).
   - Node < 20 ya da ffmpeg yoksa kurulum ilerleyemez. İşletim sistemine göre komutu göster ve **kullanıcı onay vermeden sistem paketi kurma**:
     - Windows: `winget install OpenJS.NodeJS.LTS`, `winget install Gyan.FFmpeg`, `winget install Git.Git`, `winget install Python.Python.3.12`
     - macOS: `brew install node ffmpeg git python`
     - Ubuntu/Debian: `sudo apt install ffmpeg git python3 python3-venv` + Node 20+ için nvm (`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install --lts`) — `apt install nodejs` eski sürüm kurar.
   - Windows'ta winget ile kurduktan sonra Claude Code'u kapatıp yeniden açın (yeni PATH ancak böyle görünür).
   - git veya Python yoksa kurulum yine çalışır; yalnızca isteğe bağlı araçlar (müzik/SFX/kelime zamanları, önizleme sesi, rakip taraması) atlanır.
2. `npm run kur` 10 dakikadan uzun sürebilir: komutu **arka planda** çalıştır (Bash aracında `run_in_background`), çıktıyı ara ara oku ve kullanıcıya kısa ilerleme ver. Alternatif: `npm run kur -- --hizli` (testsiz, birkaç dakika), ardından ayrıca `npm run verify`.
3. Çıktıyı Türkçe özetle:
   - `KURULUM TAMAM` → hazır. `!` satırları isteğe bağlı eksiklerdir; hattı engellemez.
   - `✘` satırı varsa nedenini ve çözümünü söyle, düzeltildikten sonra `npm run kur`'u tekrar çalıştır (tekrar çalıştırmak güvenli; var olan dosyalara dokunmaz).
   - `OVERALL: PASS (with documented B legacy KNOWN_RED)` normaldir: B'deki 10 eski test hatası belgelidir. Bunları "düzeltmek" için test silme/atlama yapma.
   - `gerçek Remotion render` uyarısı: Chrome indirilemedi ya da Linux'ta kütüphane eksik (`sudo apt install libnss3 libgbm1 libasound2`). Hattın geri kalanı çalışır; düzeltip `npm run verify`.
   - `.unified/seal.key` bu kurulumun imza anahtarıdır: kullanıcıya bir yedeğini almasını söyle (kaybolursa önceki döngü dosyaları doğrulanamaz). İçeriğini asla okuma/yazdırma.
4. Gerçek üretim için kullanıcının yapacakları (sen yapma, anahtarı kullanıcı girer):
   - ElevenLabs: `branches/a/pipeline3_production/.env` dosyasının sonundaki `ELEVENLABS_API_KEY=` satırına anahtarı kullanıcı kendisi yazar. Kullanıcı anahtarı sohbete yapıştırırsa: dosyaya sen yazabilirsin, ama anahtarı tekrar ekrana yazma ve ElevenLabs panelinden yenilemesini öner.
   - YouTube yayın/analytics: `cd apps/youtube-agent && npm run walkthrough` (OAuth tarayıcıda)
5. Sonunda `/yeni-video` ile ilk videoya başlamayı öner.
