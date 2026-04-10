/**
 * Trendyol AI Shopping Assistant — Background Service Worker
 *
 * LLM API çağrılarını yöneten ve content script ile
 * mesaj köprüsü sağlayan service worker. (Final Build v3)
 */

importScripts('llm-service.js');

const BG_LOG = '[AI Shopping Assistant][BG]';
const ANALYSIS_TIMEOUT_MS = 120000;
const ANALYSIS_CACHE_TTL_MS = 15 * 60 * 1000;
const inflightAnalysis = new Map();

function withTimeout(promise, ms, timeoutMessage) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function createAnalysisKey(productData, settings) {
  const fingerprint = {
    productName: productData?.productName || null,
    url: productData?.meta?.url || null,
    model: settings?.model || null,
    apiUrl: settings?.apiUrl || null,
    price: productData?.price?.current || null,
    reviewCount: productData?.reviews?.reviews?.length || 0,
    firstReview: productData?.reviews?.reviews?.[0]?.text || null,
    lastReview: productData?.reviews?.reviews?.[Math.max(0, (productData?.reviews?.reviews?.length || 1) - 1)]?.text || null,
    totalCount: productData?.reviews?.totalCount || null,
  };

  return JSON.stringify(fingerprint);
}

function isFreshCache(entry) {
  if (!entry || !entry.timestamp) return false;
  return Date.now() - entry.timestamp <= ANALYSIS_CACHE_TTL_MS;
}

// ── Kurulum ──────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`${BG_LOG} Eklenti kuruldu.`, {
    reason: details.reason,
    version: chrome.runtime.getManifest().version,
  });

  if (details.reason === 'install') {
    console.log(`${BG_LOG} İlk kurulum tamamlandı! 🎉`);
    chrome.storage.local.set({
      provider: 'ollama',
      apiUrl: 'http://localhost:11434/api/chat',
      model: 'llama3',
      apiKey: 'ollama-local',
    });
  }
});

// ── Mesaj Köprüsü ────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;
  console.log(`${BG_LOG} Mesaj alındı:`, type);

  switch (type) {
    case 'PRODUCT_DATA':
      handleProductData(payload, sendResponse);
      return true;

    case 'ANALYZE_REQUEST':
      handleAnalyzeRequest(payload, sendResponse);
      return true;

    case 'SIZE_RECOMMENDATION':
      handleSizeRecommendation(payload, sendResponse);
      return true;

    case 'BUY_RECOMMENDATION':
      handleBuyRecommendation(payload, sendResponse);
      return true;

    case 'CHECK_API_KEY':
      handleCheckApiKey(sendResponse);
      return true;

    case 'PING':
      sendResponse({ status: 'alive', timestamp: Date.now() });
      return false;

    default:
      sendResponse({ error: 'Unknown message type' });
      return false;
  }
});

// ── Ürün Verisi ──────────────────────────────────────────
async function handleProductData(data, sendResponse) {
  try {
    await chrome.storage.local.set({
      lastProductData: { ...data, timestamp: Date.now() },
    });
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// ── Ana AI Analiz ────────────────────────────────────────
async function handleAnalyzeRequest(productData, sendResponse) {
  let analysisKey = null;
  try {
    const settings = await chrome.storage.local.get(['apiKey', 'apiUrl', 'model']);

    if (!settings.apiKey) {
      sendResponse({ success: false, error: 'API_KEY_MISSING', message: 'API anahtarı ayarlanmamış.' });
      return;
    }

    analysisKey = createAnalysisKey(productData, settings);

    const { lastAnalysis } = await chrome.storage.local.get(['lastAnalysis']);
    if (
      lastAnalysis &&
      lastAnalysis.cacheKey === analysisKey &&
      isFreshCache(lastAnalysis)
    ) {
      sendResponse({ ...lastAnalysis, cached: true });
      return;
    }

    if (inflightAnalysis.has(analysisKey)) {
      const shared = await inflightAnalysis.get(analysisKey);
      sendResponse({ ...shared, shared: true });
      return;
    }

    const pending = withTimeout(
      analyzeProduct(productData, {
        apiKey: settings.apiKey,
        apiUrl: settings.apiUrl || undefined,
        model: settings.model || undefined,
      }),
      ANALYSIS_TIMEOUT_MS,
      'AI analiz isteği zaman aşımına uğradı. Lütfen tekrar deneyin.'
    );

    inflightAnalysis.set(analysisKey, pending);
    const result = await pending;

    const toStore = {
      ...result,
      timestamp: Date.now(),
      cacheKey: analysisKey,
    };
    await chrome.storage.local.set({ lastAnalysis: toStore });
    sendResponse(result);
  } catch (error) {
    console.error(`${BG_LOG} Analiz hatası:`, error);
    sendResponse({ success: false, error: 'ANALYSIS_FAILED', message: error.message });
  } finally {
    if (analysisKey) {
      inflightAnalysis.delete(analysisKey);
    }
  }
}

// ── Beden Önerisi ────────────────────────────────────────
async function handleSizeRecommendation(payload, sendResponse) {
  try {
    const { productData, height, weight } = payload;
    const settings = await chrome.storage.local.get(['apiKey', 'apiUrl', 'model']);

    if (!settings.apiKey) {
      sendResponse({ success: false, error: 'API_KEY_MISSING' });
      return;
    }

    const recommendation = await getSizeRecommendation(productData, height, weight, {
      apiKey: settings.apiKey,
      apiUrl: settings.apiUrl || undefined,
      model: settings.model || undefined,
    });

    sendResponse({ success: true, recommendation });
  } catch (error) {
    console.error(`${BG_LOG} Beden önerisi hatası:`, error);
    sendResponse({ success: false, error: 'SIZE_FAILED', message: error.message });
  }
}

// ── Satın Alma Önerisi ───────────────────────────────────
async function handleBuyRecommendation(productData, sendResponse) {
  try {
    const settings = await chrome.storage.local.get(['apiKey', 'apiUrl', 'model']);

    if (!settings.apiKey) {
      sendResponse({ success: false, error: 'API_KEY_MISSING' });
      return;
    }

    const recommendation = await getBuyRecommendation(productData, {
      apiKey: settings.apiKey,
      apiUrl: settings.apiUrl || undefined,
      model: settings.model || undefined,
    });

    sendResponse({ success: true, recommendation });
  } catch (error) {
    console.error(`${BG_LOG} Satın alma önerisi hatası:`, error);
    sendResponse({ success: false, error: 'BUY_FAILED', message: error.message });
  }
}

// ── API Key Kontrol ──────────────────────────────────────
async function handleCheckApiKey(sendResponse) {
  try {
    const { apiKey } = await chrome.storage.local.get(['apiKey']);
    sendResponse({ hasKey: !!apiKey });
  } catch (error) {
    sendResponse({ hasKey: false });
  }
}
