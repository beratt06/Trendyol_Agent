/**
 * Trendyol AI Shopping Assistant — Content Script (Final Build v3)
 *
 * Orchestrator: scraping → AI analysis → interactive modules
 */

const LOG_PREFIX = '[AI Shopping Assistant]';
const SCRAPE_DELAY_MS = 5000; // Sayfa tam yüklenip dinamik içerik gelmesi için bekleme süresi
const RETRY_DELAY_MS = 4000;
const MAX_RETRIES = 3;

let _currentProductData = null;

// ── Ana Giriş Noktası ────────────────────────────────────
(function init() {
  console.log(`${LOG_PREFIX} 🚀 v3 Başlatıldı — ${window.location.href}`);

  if (document.readyState === 'complete') {
    onPageReady();
  } else {
    window.addEventListener('load', onPageReady, { once: true });
  }
})();

function onPageReady() {
  const panel = injectPanel();
  if (!panel) { console.error(`${LOG_PREFIX} ❌ Panel enjekte edilemedi!`); return; }
  setTimeout(() => runScraper(0), SCRAPE_DELAY_MS);
  setupMutationObserver();
}

// ── Scraper ──────────────────────────────────────────────
async function runScraper(attempt) {
  console.log(`${LOG_PREFIX} 🔍 Veri çekme (${attempt + 1}/${MAX_RETRIES})`);

  try {
    const data = scrapeAllData();
    if (!data || typeof data !== 'object') {
      throw new Error('scrapeAllData geçersiz veri döndürdü.');
    }

    if (!data.reviews) data.reviews = { reviews: [], totalCount: null };
    if (!Array.isArray(data.reviews.reviews)) data.reviews.reviews = [];
    if (!data.sellers) data.sellers = { mainSeller: null, otherSellers: [] };
    if (!Array.isArray(data.sellers.otherSellers)) data.sellers.otherSellers = [];
    if (!data.description) data.description = { description: null, attributes: [] };

    let usedReviewApi = false;
    const expectedReviewCount = Number(String(data?.reviews?.totalCount || '').replace(/[^\d]/g, '')) || 0;

    // Katman 2: API çekimi - mevcut DOM analizini zenginleştirmek veya baştan yorum çekmek
    // Her koşulda API'yi denemesi ve bulabildiği TÜM DİĞER yorumları çekmesi için `veya` mantığı eklendi
    const productId = data.reviews._productId || data._productId || extractProductId();
    if (productId) {
      console.log(`${LOG_PREFIX} 📡 API üzerinden ekstra yorumlar çekiliyor... (${productId})`);
      updatePanelStatus('Tüm yorumlar sorgulanıyor...');
      try {
        const apiReviews = await fetchReviewsFromApi(productId, expectedReviewCount);
        if (apiReviews && apiReviews.length > 0) {
          // Mevcut DOM'da olanlarla API'den gelenleri birleştir ve tekrar edenleri temizle
          const combined = data.reviews.reviews.concat(apiReviews);
          // dedupe işlemi (metne göre)
          const seen = new Set();
          const deduped = [];
          for (const rv of combined) {
            const key = [
              rv.reviewId != null ? String(rv.reviewId).toLowerCase().trim() : '',
              (rv.text || '').toLowerCase().trim(),
              (rv.author || '').toLowerCase().trim(),
              (rv.date || '').toLowerCase().trim(),
            ].join('|');
            if (key && !seen.has(key)) {
              seen.add(key);
              deduped.push(rv);
            }
          }

          data.reviews.reviews = deduped;
          usedReviewApi = true;
          data.reviews.totalCount = `${deduped.length} yorum`;
          console.log(`${LOG_PREFIX} ✅ API dahil taranan toplam yorum sayısı: ${deduped.length}`);
          console.log(`${LOG_PREFIX} ✅ Analize gönderilecek benzersiz yorum sayısı: ${data.reviews.reviews.length}`);
        }
      } catch (err) {
        console.warn(`${LOG_PREFIX} API yorum çekme başarısız:`, err.message);
      }
      delete data.reviews._needsApiFetch;
      delete data.reviews._productId;
    }

    logScrapedData(data);

    const quality = assessDataQuality(data);
    quality.reviewSource = usedReviewApi
      ? 'api'
      : (quality.reviewCount > 0 ? 'dom' : 'none');
    data.meta = {
      ...(data.meta || {}),
      quality,
    };
    if (quality.score < 25 && attempt < MAX_RETRIES - 1) { // kalite eşiği biraz düşürüldü
      updatePanelStatus('Sayfa yükleniyor...');
      setTimeout(() => runScraper(attempt + 1), RETRY_DELAY_MS);
      return;
    }

    _currentProductData = data;
    updatePanelContent(data);
    sendToBackground(data);
    triggerAIAnalysis(data);

  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Scraping hatası:`, error);
    if (attempt < MAX_RETRIES - 1) {
      setTimeout(() => runScraper(attempt + 1), RETRY_DELAY_MS);
    } else {
      updatePanelError('Ürün verileri çekilemedi. Sayfayı yenileyin.');
    }
  }
}

// ── AI Analiz ────────────────────────────────────────────
function triggerAIAnalysis(productData) {
  showAnalyzingState();

  chrome.runtime.sendMessage(
    { type: 'ANALYZE_REQUEST', payload: productData },
    (response) => {
      if (chrome.runtime.lastError) {
        updatePanelError('Eklenti ile iletişim kurulamadı.');
        return;
      }

      if (response.success) {
        updatePanelWithAnalysis(response.analysis, productData);
      } else if (response.error === 'API_KEY_MISSING') {
        showApiKeyMissing();
      } else {
        updatePanelError(response.message || 'AI analiz hatası.');
      }
    }
  );
}

// ── Beden Önerisi İsteği ─────────────────────────────────
function requestSizeRecommendation(height, weight) {
  if (!_currentProductData) {
    showSizeResult({ error: true, message: 'Ürün verisi henüz hazır değil.' });
    return;
  }

  showSizeLoading();

  chrome.runtime.sendMessage(
    {
      type: 'SIZE_RECOMMENDATION',
      payload: { productData: _currentProductData, height, weight },
    },
    (response) => {
      if (chrome.runtime.lastError) {
        showSizeResult({ error: true, message: 'İletişim hatası.' });
        return;
      }
      if (response.success) {
        showSizeResult({ error: false, recommendation: response.recommendation });
      } else {
        showSizeResult({ error: true, message: response.message || 'Beden önerisi alınamadı.' });
      }
    }
  );
}

// ── "Bu Ürünü Almalı mıyım?" İsteği ─────────────────────
function requestBuyRecommendation() {
  if (!_currentProductData) return;

  showBuyLoading();

  chrome.runtime.sendMessage(
    { type: 'BUY_RECOMMENDATION', payload: _currentProductData },
    (response) => {
      if (chrome.runtime.lastError) {
        showBuyResult({ error: true, message: 'İletişim hatası.' });
        return;
      }
      if (response.success) {
        showBuyResult({ error: false, recommendation: response.recommendation });
      } else {
        showBuyResult({ error: true, message: response.message || 'Öneri alınamadı.' });
      }
    }
  );
}

// ── Konsol Test ──────────────────────────────────────────
function logScrapedData(data) {
  console.group(`${LOG_PREFIX} 📊 Ürün Verileri`);
  console.log('%c📦 Ürün:', 'font-weight:bold;color:#818cf8;', data.productName || '—');
  console.log('%c💰 Fiyat:', 'font-weight:bold;color:#34d399;', data.price.current ?? '—', 'TL');
  console.log('%c💬 Yorumlar:', 'font-weight:bold;color:#f87171;', data.reviews.reviews.length, 'adet');
  console.log('%c🏪 Satıcılar:', 'font-weight:bold;color:#a78bfa;',
    data.sellers.mainSeller?.name || '—',
    `+ ${data.sellers.otherSellers.length} diğer`
  );
  console.groupEnd();
}

function assessDataQuality(data) {
  const checks = [
    { field: 'Ürün Adı', value: data.productName, weight: 30 },
    { field: 'Fiyat', value: data.price.current, weight: 25 },
    { field: 'Açıklama', value: data.description.description, weight: 15 },
    { field: 'Yorumlar', value: data.reviews.reviews.length > 0, weight: 15 },
    { field: 'Satıcı', value: data.sellers.mainSeller, weight: 15 },
  ];
  let score = 0;
  const missingFields = [];
  for (const c of checks) { if (c.value) score += c.weight; else missingFields.push(c.field); }

  const reviewCount = data?.reviews?.reviews?.length || 0;

  return {
    score,
    missingFields,
    reviewCount,
    reviewSource: 'none',
  };
}

function sendToBackground(data) {
  try {
    chrome.runtime.sendMessage({ type: 'PRODUCT_DATA', payload: data }, () => {
      if (chrome.runtime.lastError) return;
    });
  } catch {}
}

// ── MutationObserver ─────────────────────────────────────
function setupMutationObserver() {
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      _currentProductData = null;
      const p = document.getElementById(PANEL_ID);
      if (p) p.remove();
      setTimeout(() => { injectPanel(); runScraper(0); }, SCRAPE_DELAY_MS);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
