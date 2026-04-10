# Trendyol AI Shopping Assistant

Trendyol urun sayfalarinda calisan Chrome eklentisi. Urun bilgisi, yorum analizi, beden onerisi ve satin alma onerisi icin LLM tabanli destek sunar.

## Ozellikler

- Urun ozet analizi (arti, eksi, genel yorum)
- Yorumlardan duygu analizi (pozitif, notr, negatif)
- AI skor uretimi (0-10)
- Beden onerisi
- Satin alma onerisi
- Iki farkli saglayici destegi:
  - Ollama (yerel)
  - OpenAI uyumlu API

## Teknoloji

- Chrome Extension (Manifest V3)
- JavaScript (background/content/popup)
- Harici LLM baglantisi:
  - Yerel: Ollama
  - Bulut: OpenAI API

## Kurulum

1. Bu klasoru bilgisayarina indir.
2. Chrome'da extensions sayfasini ac: chrome://extensions
3. Developer mode secenegini ac.
4. Load unpacked ile bu klasoru sec.
5. Eklenti popup ayarlarindan saglayiciyi sec:
   - Ollama: URL varsayilan olarak http://localhost:11434/api/chat
   - OpenAI: API key gir ve model sec

## Ollama ile hizli baslangic

1. Ollama yukle.
2. Terminalde model indir:

```bash
ollama pull llama3
```

3. Ollama calistir (gerekiyorsa):

```bash
ollama serve
```

4. Eklenti popup ayarinda provider olarak Ollama sec.

## OpenAI ile kullanim

1. Popup ayarinda provider olarak OpenAI sec.
2. API key alaniina anahtarini gir.
3. Model olarak ornek: gpt-4o-mini
4. Kaydet ve Trendyol urun sayfasinda analizi baslat.

## Dosya Yapisi

- manifest.json: Eklenti tanimi ve izinler
- background.js: Service worker ve mesaj koprusu
- llm-service.js: LLM istekleri ve analiz mantigi
- content.js, scraper.js, panel.js: Sayfadan veri cekme ve UI paneli
- popup.html, popup.js, popup.css: Ayarlar ekrani

## Sorun Giderme

- Ollama baglanamiyor:
  - URL'yi kontrol et: http://localhost:11434/api/chat
  - Ollama servisinin calistigindan emin ol
- API hatasi aliniyor:
  - API key ve model adini kontrol et
  - Internet erisimini ve kota durumunu kontrol et
- Analiz yavas:
  - Modeli daha hafif bir modelle degistir
  - Yorum sayisinin fazla oldugu urunlerde ilk analiz daha uzun surebilir

## Guvenlik Notu

API ayarlari chrome.storage.local icinde saklanir. Paylasilan bilgisayarlarda API key kullaniminda dikkatli ol.

## Lisans

Bu proje LICENSE dosyasindaki kosullara tabidir.
