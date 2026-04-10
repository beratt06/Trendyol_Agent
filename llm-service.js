/**
 * Trendyol AI Shopping Assistant — LLM Service Module
 *
 * Ollama (yerel) ve OpenAI-uyumlu API ile ürün analizi,
 * beden önerisi ve satın alma önerisi yapan servis.
 * Background (Service Worker) içinde çalışır.
 */

const LOG_PREFIX = '[AI Shopping Assistant][LLM]';

// ── Varsayılan Yapılandırma (Ollama Yerel Sunucu) ────────
const DEFAULT_CONFIG = {
  apiUrl: 'http://localhost:11434/api/chat',
  model: 'llama3',
  maxTokens: 2048,
  temperature: 0.4,
};

const NETWORK_TIMEOUT_MS = 120000;
const MAX_NETWORK_RETRIES = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryRequest(error, statusCode) {
  if (statusCode === 408 || statusCode === 429) return true;
  if (statusCode >= 500) return true;
  if (!error) return false;
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('timeout') || msg.includes('fetch') || msg.includes('network');
}

async function fetchWithTimeout(url, options, timeoutMs = NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * URL'den API sağlayıcısını tespit eder.
 * @param {string} url
 * @returns {'ollama' | 'openai'}
 */
function detectProvider(url) {
  if (url.includes('localhost:11434') || url.includes('127.0.0.1:11434')) {
    return 'ollama';
  }
  return 'openai';
}

// ══════════════════════════════════════════════════════════
//  ANA ANALİZ
// ══════════════════════════════════════════════════════════

function buildSystemPrompt() {
  return `Sen, bir e-ticaret alışveriş asistanısın. Görevin, Trendyol'daki ürünler hakkında kullanıcıya detaylı ve güvenilir analizler sunmaktır. Sana verilen ürün verilerini (isim, açıklama, fiyat, yorumlar, satıcı bilgisi) analiz edecek ve aşağıdaki yapıda bir JSON yanıt üreteceksin.

MUTLAKA aşağıdaki JSON şemasına uygun yanıt ver. Yanıtının tamamı geçerli bir JSON olmalı, başka bir metin veya açıklama ekleme.

{
  "productSummary": {
    "overview": "Ürünün genel bir özeti (2-3 cümle)",
    "pros": ["Ürünün artıları/güçlü yönleri (en az 2, en fazla 5 madde)"],
    "cons": ["Ürünün eksileri/zayıf yönleri (en az 1, en fazla 4 madde)"],
    "recommendation": "Satın alma önerisi: Bu ürünü kimler almalı, kimler almamalı? (1-2 cümle)"
  },
  "reviewAnalysis": {
    "summary": "Yorumların genel özeti (2-3 cümle)",
    "mostPraised": "Yorumlarda en çok övülen özellik (1 cümle)",
    "mostComplained": "Yorumlarda en çok şikayet edilen özellik (1 cümle)",
    "sentiment": {
      "positive": 75,
      "neutral": 15,
      "negative": 10
    }
  },
  "aiScore": {
    "score": 8.0,
    "reasoning": "Skorun kısa gerekçesi (1-2 cümle)"
  }
}

ÖNEMLİ KURALLAR:
1. Tüm metinler Türkçe olmalıdır.
2. aiScore.score 0 ile 10 arasında bir ondalıklı sayı olmalı (örn: 7.5).
3. reviewAnalysis.sentiment değerleri toplamı 100 olmalıdır.
4. Yorum yoksa veya çok azsa, bunu belirt ve skoru buna göre ayarla.
5. Yanıt sadece JSON olmalı, başında veya sonunda \`\`\`json gibi işaretler KOYMA.
6. Artılar ve eksiler somut ve spesifik olsun, genel ifadelerden kaçın.
7. Girdi verisinde fiyat varsa "fiyat bilgisi yok/eksik/belirtilmemiş" gibi ifadeler KULLANMA.
8. Girdi verisinde açıklama veya özellik varsa "açıklama yok/eksik" gibi ifadeler KULLANMA.`;
}

function hasPriceData(productData) {
  return Number.isFinite(Number(productData?.price?.current)) || Number.isFinite(Number(productData?.price?.original));
}

function hasDescriptionData(productData) {
  const desc = productData?.description?.description;
  const attrs = productData?.description?.attributes || [];
  return (typeof desc === 'string' && desc.trim().length >= 10) || attrs.length > 0;
}

function sanitizeFactContradictions(text, productData) {
  if (!text || typeof text !== 'string') return text;

  let output = text;
  const priceExists = hasPriceData(productData);
  const descriptionExists = hasDescriptionData(productData);

  if (priceExists) {
    output = output.replace(/fiyat\s+bilgisi\s*(yok|eksik|belirtilmemi[sş])/gi, 'fiyat bilgisi mevcut');
    output = output.replace(/fiyat\s*(yok|eksik|belirtilmemi[sş])/gi, 'fiyat mevcut');
  }

  if (descriptionExists) {
    output = output.replace(/(urun|ürün)\s+aciklamasi\s*(yok|eksik|belirtilmemi[sş])/gi, 'ürün açıklaması mevcut');
    output = output.replace(/aciklama\s*(yok|eksik|belirtilmemi[sş])/gi, 'açıklama mevcut');
    output = output.replace(/aciklamasi\s*(yok|eksik|belirtilmemi[sş])/gi, 'açıklaması mevcut');
  }

  return output;
}

function applyFactConsistency(analysis, productData) {
  if (!analysis) return analysis;

  const mapText = (value) => sanitizeFactContradictions(value, productData);

  return {
    ...analysis,
    productSummary: {
      ...analysis.productSummary,
      overview: mapText(analysis.productSummary?.overview),
      recommendation: mapText(analysis.productSummary?.recommendation),
      pros: Array.isArray(analysis.productSummary?.pros)
        ? analysis.productSummary.pros.map(mapText)
        : [],
      cons: Array.isArray(analysis.productSummary?.cons)
        ? analysis.productSummary.cons.map(mapText)
        : [],
    },
    reviewAnalysis: {
      ...analysis.reviewAnalysis,
      summary: mapText(analysis.reviewAnalysis?.summary),
      mostPraised: mapText(analysis.reviewAnalysis?.mostPraised),
      mostComplained: mapText(analysis.reviewAnalysis?.mostComplained),
    },
    aiScore: {
      ...analysis.aiScore,
      reasoning: mapText(analysis.aiScore?.reasoning),
    },
  };
}

function normalizePromptText(text, maxLength = 260) {
  if (!text || typeof text !== 'string') return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function sanitizeProductDataForPrompt(productData) {
  const allReviews = (productData?.reviews?.reviews || [])
    .filter((r) => typeof r?.text === 'string' && r.text.trim().length >= 2)
    .map((r) => ({
      ...r,
      text: normalizePromptText(r.text, 500),
    }));

  // Prompt taşmasını önlemek için yorumları dinamik bütçeyle sınırla.
  let reviews = [];
  let charBudget = 0;
  const maxPromptReviewChars = 24000;
  for (const review of allReviews) {
    const nextLen = (review.text || '').length + 40;
    if (charBudget + nextLen > maxPromptReviewChars) break;
    reviews.push(review);
    charBudget += nextLen;
  }

  return {
    ...productData,
    description: productData?.description
      ? {
          description: normalizePromptText(productData.description.description || '', 900),
          attributes: (productData.description.attributes || []).slice(0, 20),
        }
      : null,
    sellers: productData?.sellers
      ? {
          mainSeller: productData.sellers.mainSeller || null,
          otherSellers: (productData.sellers.otherSellers || []).slice(0, 8),
        }
      : null,
    reviews: {
      ...(productData?.reviews || {}),
      reviews,
    },
  };
}

function buildUserPrompt(productData) {
  const parts = [];

  parts.push(`## ÜRÜN ADI\n${productData.productName || 'Bilinmiyor'}`);

  if (productData.price) {
    let priceText = `Güncel Fiyat: ${productData.price.current ?? 'Bilinmiyor'} TL`;
    if (productData.price.original) priceText += `\nOrijinal Fiyat: ${productData.price.original} TL`;
    if (productData.price.discount) priceText += `\nİndirim: ${productData.price.discount}`;
    parts.push(`## FİYAT\n${priceText}`);
  }

  if (productData.description) {
    let descText = productData.description.description || 'Açıklama bulunamadı';
    if (productData.description.attributes?.length > 0) {
      descText += '\n\nÜrün Özellikleri:\n';
      descText += productData.description.attributes.map((a) => `- ${a.key}: ${a.value}`).join('\n');
    }
    parts.push(`## ÜRÜN AÇIKLAMASI\n${descText}`);
  }

  if (productData.sellers) {
    let sellerText = '';
    if (productData.sellers.mainSeller) {
      sellerText += `Ana Satıcı: ${productData.sellers.mainSeller.name}`;
      if (productData.sellers.mainSeller.rating) sellerText += ` (Puan: ${productData.sellers.mainSeller.rating})`;
    }
    if (productData.sellers.otherSellers?.length > 0) {
      sellerText += `\nDiğer Satıcı Sayısı: ${productData.sellers.otherSellers.length}`;
      sellerText += '\n' + productData.sellers.otherSellers
        .map((s) => `- ${s.name}: ${s.price ?? '?'} TL ${s.rating ? `(Puan: ${s.rating})` : ''}`)
        .join('\n');
    }
    if (sellerText) parts.push(`## SATICI BİLGİSİ\n${sellerText}`);
  }

  if (productData.reviews) {
    let reviewText = '';
    if (productData.reviews.averageRating) reviewText += `Ortalama Puan: ${productData.reviews.averageRating}/5\n`;
    if (productData.reviews.totalCount) reviewText += `Toplam Yorum Sayısı: ${productData.reviews.totalCount}\n`;
    const reviews = productData.reviews.reviews || [];
    if (reviews.length > 0) {
      reviewText += `\nGörünür Yorumlar (Benzersiz: ${reviews.length} adet):\n`;
      reviewText += reviews.map((r, i) => {
        let line = `${i + 1}. `;
        if (r.rating) line += `[${r.rating}★] `;
        line += r.text || '(Yorum metni yok)';
        return line;
      }).join('\n');
    } else {
      reviewText += '\nGörünür yorum bulunamadı.';
    }
    parts.push(`## KULLANICI YORUMLARI\n${reviewText}`);
  }

  return parts.join('\n\n');
}

async function analyzeProduct(productData, config = {}) {
  const { apiKey, apiUrl, model, maxTokens, temperature } = { ...DEFAULT_CONFIG, ...config };

  if (!apiKey) throw new Error('API anahtarı ayarlanmamış. Lütfen eklenti ayarlarından API anahtarınızı girin.');

  const normalizedData = sanitizeProductDataForPrompt(productData);
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(normalizedData);

  console.log(`${LOG_PREFIX} Ana analiz API çağrısı yapılıyor...`, { model, promptLength: userPrompt.length });

  const result = await callLLMApi(apiUrl, apiKey, model, systemPrompt, userPrompt, maxTokens, temperature, true);
  let analysis;

  try {
    analysis = parseAnalysisResponse(result.content, normalizedData);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Parse hatası, fallback analiz üretilecek:`, error.message);
    analysis = buildFallbackAnalysis(normalizedData);
  }

  return { success: true, analysis, usage: result.usage };
}

// ══════════════════════════════════════════════════════════
//  BEDEN ÖNERİSİ
// ══════════════════════════════════════════════════════════

function buildSizeRecommendationPrompt() {
  return `Sen, bir kıyafet beden uzmanısın. Görevin, kullanıcının boy ve kilo bilgilerine göre ürün yorumlarını analiz ederek en uygun bedeni önermektir.

Aşağıdaki JSON şemasına uygun yanıt ver. Yanıtının tamamı geçerli bir JSON olmalı.

{
  "recommendedSize": "Önerilen beden (örn: S, M, L, XL, 38, 40, 42 vb.)",
  "confidence": "high | medium | low",
  "reasoning": "Neden bu bedeni önerdiğinin kısa açıklaması. Yorumlardaki boy-kilo-beden verilerini referans göster. (2-3 cümle)",
  "tips": ["Beden seçimiyle ilgili 1-3 pratik ipucu (yorumlara dayanarak)"],
  "sizeNotes": "Ürünün kalıbı hakkında not (dar kalıp, bol kalıp, normal kalıp gibi). Yorumlarda bu konuda bilgi yoksa 'Yeterli veri bulunamadı' yaz."
}

ÖNEMLİ KURALLAR:
1. Tüm metinler Türkçe olmalıdır.
2. Yorumlarda boy-kilo-beden bilgileri varsa bunları analiz et.
3. Eğer yeterli yorum verisi yoksa, confidence'ı "low" yap ve genel beden tablosuna göre öneri yap.
4. Yanıt sadece JSON olmalı, başında veya sonunda \`\`\`json gibi işaretler KOYMA.`;
}

function buildSizeUserPrompt(productData, height, weight) {
  let prompt = buildUserPrompt(productData);
  prompt += `\n\n## KULLANICI BİLGİLERİ\nBoy: ${height} cm\nKilo: ${weight} kg\n\nBu kullanıcı için en uygun bedeni öner. Yorumlardaki diğer kullanıcıların boy, kilo ve beden bilgilerini karşılaştırarak, en uygun bedeni belirle.`;
  return prompt;
}

async function getSizeRecommendation(productData, height, weight, config = {}) {
  const { apiKey, apiUrl, model } = { ...DEFAULT_CONFIG, ...config };

  if (!apiKey) throw new Error('API anahtarı ayarlanmamış.');

  const systemPrompt = buildSizeRecommendationPrompt();
  const userPrompt = buildSizeUserPrompt(productData, height, weight);

  console.log(`${LOG_PREFIX} Beden önerisi API çağrısı yapılıyor...`);

  const result = await callLLMApi(apiUrl, apiKey, model, systemPrompt, userPrompt, 1024, 0.3, true);
  return parseSizeResponse(result.content);
}

function parseSizeResponse(content) {
  let parsed;
  try {
    const cleaned = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Beden önerisi yanıtı geçerli JSON formatında değil.');
  }

  return {
    recommendedSize: parsed.recommendedSize || 'Belirlenemedi',
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
    reasoning: parsed.reasoning || 'Gerekçe oluşturulamadı.',
    tips: Array.isArray(parsed.tips) ? parsed.tips : [],
    sizeNotes: parsed.sizeNotes || 'Bilgi yok.',
  };
}

// ══════════════════════════════════════════════════════════
//  "BU ÜRÜNÜ ALMALI MIYIM?" ÖNERİSİ
// ══════════════════════════════════════════════════════════

function buildBuyRecommendationPrompt() {
  return `Sen, bir alışveriş danışmanısın. Kullanıcı sana bir ürün hakkında "Bu ürünü almalı mıyım?" diye soruyor.

Aşağıdaki JSON şemasına uygun yanıt ver:

{
  "verdict": "EVET" | "HAYIR" | "KOŞULLU",
  "shortAnswer": "Çok kısa ve net bir cevap (EN FAZLA 2 cümle). Doğrudan al/alma tavsiyesi ver.",
  "keyReason": "En önemli tek neden (1 cümle)"
}

KURALLAR:
1. Türkçe cevapla.
2. verdict yalnızca "EVET", "HAYIR" veya "KOŞULLU" olabilir.
3. shortAnswer EN FAZLA 2 CÜMLE olsun. Çok kısa ve vurucu yaz.
4. Fiyat, kalite, yorumlar ve satıcı güvenilirliğini bütünsel değerlendir.
5. Yanıt sadece JSON olmalı.`;
}

async function getBuyRecommendation(productData, config = {}) {
  const { apiKey, apiUrl, model } = { ...DEFAULT_CONFIG, ...config };

  if (!apiKey) throw new Error('API anahtarı ayarlanmamış.');

  const systemPrompt = buildBuyRecommendationPrompt();
  const userPrompt = buildUserPrompt(productData);

  console.log(`${LOG_PREFIX} Satın alma önerisi API çağrısı yapılıyor...`);

  const result = await callLLMApi(apiUrl, apiKey, model, systemPrompt, userPrompt, 512, 0.3, true);
  return parseBuyResponse(result.content);
}

function parseBuyResponse(content) {
  let parsed;
  try {
    const cleaned = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Satın alma önerisi yanıtı geçerli JSON formatında değil.');
  }

  return {
    verdict: ['EVET', 'HAYIR', 'KOŞULLU'].includes(parsed.verdict) ? parsed.verdict : 'KOŞULLU',
    shortAnswer: parsed.shortAnswer || 'Öneri oluşturulamadı.',
    keyReason: parsed.keyReason || '',
  };
}

// ══════════════════════════════════════════════════════════
//  ORTAK API ÇAĞRI FONKSİYONU (Ollama + OpenAI Uyumlu)
// ══════════════════════════════════════════════════════════

async function callLLMApi(apiUrl, apiKey, model, systemPrompt, userPrompt, maxTokens, temperature, jsonMode = false) {
  const provider = detectProvider(apiUrl);
  let requestBody, headers;

  if (provider === 'ollama') {
    // ── Ollama /api/chat formatı ──
    requestBody = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      options: {
        temperature,
        num_predict: maxTokens,
      },
    };
    // Ollama JSON modu: format parametresi
    if (jsonMode) {
      requestBody.format = 'json';
    }
    headers = { 'Content-Type': 'application/json' };
  } else {
    // ── OpenAI formatı ──
    requestBody = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature,
    };
    if (jsonMode) {
      requestBody.response_format = { type: 'json_object' };
    }
    headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
  }

  console.log(`${LOG_PREFIX} [${provider.toUpperCase()}] API çağrısı: model=${model}`);

  for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt += 1) {
    let response = null;

    try {
      response = await fetchWithTimeout(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || errorData.error || response.statusText;

        if (response.status === 401) throw new Error('Geçersiz API anahtarı.');
        if (response.status === 404 && provider === 'ollama') {
          throw new Error(`Model "${model}" Ollama'da bulunamadı. Terminalde \"ollama pull ${model}\" komutunu çalıştırın.`);
        }

        if (shouldRetryRequest(null, response.status) && attempt < MAX_NETWORK_RETRIES) {
          await sleep(600 * (attempt + 1));
          continue;
        }

        if (response.status === 429) throw new Error('API istek limiti aşıldı.');
        if (response.status >= 500) throw new Error('API servisi şu anda kullanılamıyor.');
        throw new Error(`API hatası (${response.status}): ${errorMessage}`);
      }

      const data = await response.json();

      // Ollama ve OpenAI farklı yanıt formatları kullanır
      let content;
      if (provider === 'ollama') {
        content = data.message?.content;
      } else {
        content = data.choices?.[0]?.message?.content;
      }

      if (!content) throw new Error('API yanıtında içerik bulunamadı.');

      const usage = provider === 'ollama'
        ? { prompt_tokens: data.prompt_eval_count, completion_tokens: data.eval_count }
        : data.usage;

      console.log(`${LOG_PREFIX} API yanıtı alındı.`, usage);
      return { content, usage };

    } catch (error) {
      if (error.name === 'AbortError') {
        if (attempt < MAX_NETWORK_RETRIES) {
          await sleep(700 * (attempt + 1));
          continue;
        }
        throw new Error('AI servisinden zamanında yanıt alınamadı.');
      }

      if (shouldRetryRequest(error, response?.status) && attempt < MAX_NETWORK_RETRIES) {
        await sleep(700 * (attempt + 1));
        continue;
      }

      // Ollama bağlantı hatası — özel mesaj
      if (error.name === 'TypeError' && (error.message.includes('fetch') || error.message.includes('Failed'))) {
        const currentProvider = detectProvider(apiUrl);
        if (currentProvider === 'ollama') {
          throw new Error('Yerel Ollama sunucusuna bağlanılamadı. Lütfen terminalden Ollama\'nın çalıştığından emin olun.');
        }
        throw new Error('Ağ bağlantı hatası. İnternet bağlantınızı kontrol edin.');
      }

      throw error;
    }
  }

  throw new Error('AI analiz isteği başarısız oldu.');
}

// ══════════════════════════════════════════════════════════
//  ANA ANALİZ YANIT AYRIŞTIRICISI
// ══════════════════════════════════════════════════════════

function extractJsonObject(content) {
  const cleaned = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
      throw new Error('JSON nesnesi bulunamadı.');
    }
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  }
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSentiment(rawSentiment) {
  let positive = Math.max(0, Math.round(toFiniteNumber(rawSentiment?.positive, 0)));
  let neutral = Math.max(0, Math.round(toFiniteNumber(rawSentiment?.neutral, 0)));
  let negative = Math.max(0, Math.round(toFiniteNumber(rawSentiment?.negative, 0)));

  const sum = positive + neutral + negative;
  if (sum <= 0) {
    return { positive: 45, neutral: 35, negative: 20 };
  }

  positive = Math.round((positive / sum) * 100);
  neutral = Math.round((neutral / sum) * 100);
  negative = 100 - positive - neutral;

  return { positive, neutral, negative };
}

function buildFallbackAnalysis(productData) {
  const reviewCount = productData?.reviews?.reviews?.length || 0;
  const hasEnoughReviews = reviewCount >= 3;

  return {
    productSummary: {
      overview: 'Model yaniti tam ayrıştırılamadığı için güvenli fallback analizi gösteriliyor.',
      pros: ['Urun verisi alındı ve temel alanlar analiz edildi.'],
      cons: ['Detaylı AI yorumu üretilemedi; model yanıt formatı tutarsız.'],
      recommendation: 'Karar vermeden once yorumlar ve satıcı puanını manuel olarak da kontrol edin.',
    },
    reviewAnalysis: {
      summary: hasEnoughReviews
        ? `${reviewCount} yorum üzerinden özet çıkarıldı, ancak model yanıtı kısmen bozuk geldi.`
        : 'Yorum verisi yetersiz olduğu için güvenilir duygu analizi üretilemedi.',
      mostPraised: hasEnoughReviews ? 'Yorumlarda tekrar eden olumlu noktalar mevcut.' : 'Belirlenemedi.',
      mostComplained: hasEnoughReviews ? 'Yorumlarda tekrar eden şikayet noktaları mevcut.' : 'Belirlenemedi.',
      sentiment: hasEnoughReviews ? { positive: 50, neutral: 30, negative: 20 } : { positive: 0, neutral: 100, negative: 0 },
    },
    aiScore: {
      score: hasEnoughReviews ? 6.5 : 5.0,
      reasoning: hasEnoughReviews
        ? 'Model yanıtı tam parse edilemediği için skor orta seviyede tutuldu.'
        : 'Yorum verisi az olduğu için skor temkinli hesaplandı.',
    }
  };
}

function parseAnalysisResponse(content, productData = null) {
  let parsed;
  try {
    parsed = extractJsonObject(content);
  } catch (error) {
    console.error(`${LOG_PREFIX} JSON parse hatası:`, error, '\nİçerik:', content);
    throw new Error('AI yanıtı geçerli bir JSON formatında değil.');
  }

  const reviewCount = productData?.reviews?.reviews?.length || 0;
  const fallbackSummary = reviewCount > 0
    ? `${reviewCount} yorum üzerinden analiz oluşturuldu.`
    : 'Yeterli yorum verisi bulunamadı.';

  const sentiment = normalizeSentiment(parsed.reviewAnalysis?.sentiment);

  const parsedResult = {
    productSummary: {
      overview: parsed.productSummary?.overview || 'Özet oluşturulamadı.',
      pros: Array.isArray(parsed.productSummary?.pros) ? parsed.productSummary.pros : [],
      cons: Array.isArray(parsed.productSummary?.cons) ? parsed.productSummary.cons : [],
      recommendation: parsed.productSummary?.recommendation || 'Öneri oluşturulamadı.',
    },
    reviewAnalysis: {
      summary: parsed.reviewAnalysis?.summary || fallbackSummary,
      mostPraised: parsed.reviewAnalysis?.mostPraised || 'Belirlenemedi.',
      mostComplained: parsed.reviewAnalysis?.mostComplained || 'Belirlenemedi.',
      sentiment,
    },
    aiScore: {
      score: Math.min(10, Math.max(0, toFiniteNumber(parsed.aiScore?.score, 0))),
      reasoning: parsed.aiScore?.reasoning || 'Skor gerekçesi oluşturulamadı.',
    }
  };

  return applyFactConsistency(parsedResult, productData);
}
