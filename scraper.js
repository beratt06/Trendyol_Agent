/**
 * Trendyol AI Shopping Assistant — DOM Scraper Module
 *
 * Trendyol urun sayfasindaki DOM elemanlarindan urun verilerini
 * ceken moduler fonksiyonlar.
 */

// -- Yardimci Fonksiyonlar --------------------------------------------------
const ScraperUtils = {
  getText(selector) {
    const el = document.querySelector(selector);
    return el ? el.textContent.trim() : null;
  },

  getAll(selector) {
    return Array.from(document.querySelectorAll(selector));
  },

  parsePrice(priceText) {
    if (!priceText) return null;
    const cleaned = priceText
      .replace(/[^\d.,]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const value = parseFloat(cleaned);
    return Number.isNaN(value) ? null : value;
  },

  safeGet(fn, fallback = null) {
    try {
      return fn() ?? fallback;
    } catch {
      return fallback;
    }
  },
};

function normalizeReviewText(text) {
  if (!text || typeof text !== 'string') return null;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length < 2) return null;
  return normalized;
}

function normalizeReviewItem(review) {
  const text = normalizeReviewText(review?.text);
  if (!text) return null;

  const reviewId = review?.reviewId != null
    ? String(review.reviewId).trim()
    : null;

  const numericRating = review?.rating != null
    ? Number(String(review.rating).replace(',', '.'))
    : null;
  const rating = Number.isFinite(numericRating)
    ? Math.max(1, Math.min(5, Math.round(numericRating * 10) / 10))
    : null;

  return {
    reviewId,
    author: review?.author ? String(review.author).trim() : null,
    date: review?.date ? String(review.date).trim() : null,
    rating,
    text,
    sellerName: review?.sellerName ? String(review.sellerName).trim() : null,
  };
}

function dedupeReviews(reviews, maxCount = Infinity) {
  const seen = new Set();
  const output = [];

  for (const review of reviews || []) {
    const normalized = normalizeReviewItem(review);
    if (!normalized) continue;

    const key = normalized.reviewId
      ? `id:${normalized.reviewId}`
      : [
          normalized.text.toLowerCase(),
          (normalized.author || '').toLowerCase(),
          (normalized.date || '').toLowerCase(),
          normalized.rating != null ? String(normalized.rating) : '',
        ].join('|');
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(normalized);

    if (maxCount !== Infinity && output.length >= maxCount) break;
  }

  return output;
}

function extractReviewsFromJsonLd() {
  const collected = [];
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');

  scripts.forEach((script) => {
    const raw = script.textContent?.trim();
    if (!raw) return;

    try {
      const json = JSON.parse(raw);
      const nodes = Array.isArray(json) ? json : [json];

      nodes.forEach((node) => {
        const reviews = node?.review;
        if (!reviews) return;

        const list = Array.isArray(reviews) ? reviews : [reviews];
        list.forEach((r) => {
          collected.push({
            author: r?.author?.name || r?.author || null,
            date: r?.datePublished || null,
            rating: r?.reviewRating?.ratingValue || null,
            text: r?.reviewBody || r?.description || null,
            sellerName: null,
          });
        });
      });
    } catch {
      // Bazi ld+json bloklari parse edilemeyebilir.
    }
  });

  return dedupeReviews(collected, Infinity);
}

function extractReviewsFromAppData() {
  const script = document.querySelector('script#__NEXT_DATA__');
  if (!script || !script.textContent) return [];

  let payload;
  try {
    payload = JSON.parse(script.textContent);
  } catch {
    return [];
  }

  const candidates = [];
  const queue = [payload];
  let safety = 0;

  while (queue.length > 0 && safety < 4000) {
    safety += 1;
    const node = queue.shift();
    if (!node) continue;

    if (Array.isArray(node)) {
      const looksLikeReviewArray =
        node.length > 0 &&
        node.some((item) => {
          if (!item || typeof item !== 'object') return false;
          return Boolean(
            item.commentText || item.reviewText || item.comment || item.text || item.content ||
            item.rate || item.rating || item.star || item.reviewRating
          );
        });

      if (looksLikeReviewArray) {
        candidates.push(...node);
      } else {
        for (const item of node) {
          if (item && typeof item === 'object') queue.push(item);
        }
      }
      continue;
    }

    if (typeof node === 'object') {
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') queue.push(value);
      }
    }
  }

  const mapped = candidates.map((r) => ({
    reviewId: r?.id ?? r?.reviewId ?? r?.commentId ?? r?.uuid ?? null,
    author: r?.userFullName || r?.nickname || r?.userName || r?.author?.name || r?.author || null,
    date: r?.lastModifiedDate || r?.createdDate || r?.commentDate || r?.date || null,
    rating: r?.rate ?? r?.star ?? r?.rating ?? r?.reviewRating?.ratingValue ?? null,
    text: r?.commentText || r?.reviewText || r?.comment || r?.text || r?.content || r?.reviewBody || r?.description || null,
    sellerName: r?.sellerName || r?.seller?.name || null,
  }));

  return dedupeReviews(mapped, Infinity);
}

// -- Urun Adi ----------------------------------------------------------------
function scrapeProductName() {
  const selectors = [
    'h1.pr-new-br span',
    'h1.pr-new-br',
    '.pr-in-w h1 span',
    '.product-name',
    'h1[class*="product"]',
    '.detail-name h1',
  ];

  for (const selector of selectors) {
    const text = ScraperUtils.getText(selector);
    if (text) return text;
  }

  const h1 = document.querySelector('h1');
  return h1 ? h1.textContent.trim() : null;
}

// -- Urun Fiyati --------------------------------------------------------------
function scrapeProductPrice() {
  const result = {
    current: null,
    original: null,
    discount: null,
    currency: 'TL',
  };

  const currentPriceSelectors = [
    '.prc-dsc',
    '.product-price-container .prc-dsc',
    'span.prc-dsc',
    '.prc-slg .prc-dsc',
  ];

  for (const selector of currentPriceSelectors) {
    const text = ScraperUtils.getText(selector);
    if (text) {
      result.current = ScraperUtils.parsePrice(text);
      break;
    }
  }

  const originalPriceSelectors = [
    '.prc-org',
    '.product-price-container .prc-org',
    'span.prc-org',
  ];

  for (const selector of originalPriceSelectors) {
    const text = ScraperUtils.getText(selector);
    if (text) {
      result.original = ScraperUtils.parsePrice(text);
      break;
    }
  }

  const discountSelectors = [
    '.pr-bx-w .pr-bx-nm',
    '.discount-badge',
    '.pr-bx-pr-dsc',
  ];

  for (const selector of discountSelectors) {
    const text = ScraperUtils.getText(selector);
    if (text) {
      result.discount = text;
      break;
    }
  }

  return result;
}

// -- Urun Aciklamasi ----------------------------------------------------------
function scrapeProductDescription() {
  const result = {
    description: null,
    attributes: [],
  };

  const descriptionSelectors = [
    '.detail-attr-container p',
    '.info-wrapper .info-text',
    '.product-description',
    '.detail-desc-content',
    '.product-detail-description',
  ];

  for (const selector of descriptionSelectors) {
    const text = ScraperUtils.getText(selector);
    if (text && text.length > 10) {
      result.description = text;
      break;
    }
  }

  const attrRows = ScraperUtils.getAll('.detail-attr-container li, .detail-attr-item');
  attrRows.forEach((row) => {
    const key = ScraperUtils.safeGet(() =>
      row.querySelector('.attr-name, .detail-attr-key, span:first-child')?.textContent.trim()
    );
    const value = ScraperUtils.safeGet(() =>
      row.querySelector('.attr-value, .detail-attr-value, span:last-child')?.textContent.trim()
    );

    if (key && value && key !== value) {
      result.attributes.push({ key, value });
    }
  });

  if (result.attributes.length === 0) {
    const tableRows = ScraperUtils.getAll('.detail-border-bottom .detail-attr-container table tr');
    tableRows.forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 2) {
        result.attributes.push({
          key: cells[0].textContent.trim(),
          value: cells[1].textContent.trim(),
        });
      }
    });
  }

  return result;
}

// -- Urun Yorumlari -----------------------------------------------------------
function scrapeProductReviews() {
  const result = {
    averageRating: null,
    totalCount: null,
    reviews: [],
  };

  const productId = extractProductId();
  if (productId) {
    result._productId = productId;
    result._needsApiFetch = true;
  }

  const ratingSelectors = [
    '.pr-in-rnr .pr-rnr-sm-p',
    '.tltp-avg',
    '.rating-score',
    '.pr-rnr-cn .pr-rnr-sm-p',
    '.rnr-cn .avg',
    '.pr-in-rnr span:first-child',
    '[class*="ratingScore"]',
    '[class*="rating-score"]',
    '[data-testid="rating"]',
  ];

  for (const selector of ratingSelectors) {
    const text = ScraperUtils.getText(selector);
    if (text) {
      const parsed = parseFloat(text.replace(',', '.'));
      if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 5) {
        result.averageRating = parsed;
        break;
      }
    }
  }

  const countSelectors = [
    '.pr-in-rnr .pr-rnr-sm-c',
    '.rnr-com-tp span',
    '.total-review-count',
    '.pr-rnr-cn span',
    '[class*="totalReview"]',
    '[class*="review-count"]',
  ];

  for (const selector of countSelectors) {
    const text = ScraperUtils.getText(selector);
    if (text) {
      result.totalCount = text;
      break;
    }
  }

  if (!result.totalCount) {
    const rnrContainer = document.querySelector('.pr-in-rnr, [class*="rnr"], [class*="rating"]');
    if (rnrContainer) {
      const spans = rnrContainer.querySelectorAll('span, a, div');
      for (const s of spans) {
        const txt = s.textContent.trim();
        if (txt.match(/\d+\s*(yorum|degerlendirme|değerlendirme|review)/i)) {
          result.totalCount = txt;
          break;
        }
      }
    }
  }

  const reviewContainerSelectors = [
    '.rnr-com-w .rnr-com-c',
    '.rnr-com-w > div[class]',
    '.pr-rnr-cmp .comment',
    '[class*="commentItem"]',
    '[class*="comment-item"]',
    '[class*="review-item"]',
    '[class*="reviewItem"]',
    '[class*="rnr-com-c"]',
    '[data-testid*="comment"]',
    '[data-testid*="review"]',
    '.rnr-com-w > div',
    '.pr-rvw-w > div',
    '.rvw-cnt > div',
  ];

  for (const selector of reviewContainerSelectors) {
    const cards = document.querySelectorAll(selector);
    if (cards.length === 0) continue;

    cards.forEach((card, index) => {
      // index limiti kaldırıldı. DOM'da var olan hepsi alınıyor.

      const textSelectors = [
        '.rnr-com-tx p',
        '.rnr-com-tx',
        '.comment-text',
        '[class*="commentText"]',
        '[class*="comment-text"]',
        '[class*="reviewText"]',
        'p',
      ];

      let reviewText = null;
      for (const ts of textSelectors) {
        const el = card.querySelector(ts);
        if (el && el.textContent.trim().length > 5) {
          reviewText = el.textContent.trim();
          break;
        }
      }

      const authorSelectors = [
        '.rnr-com-u',
        '.rnr-com-nm',
        '.comment-author',
        '[class*="commentAuthor"]',
        '[class*="userName"]',
        '[class*="author"]',
      ];

      let author = null;
      for (const as of authorSelectors) {
        const el = card.querySelector(as);
        if (el) {
          author = el.textContent.trim();
          break;
        }
      }

      const dateSelectors = ['.rnr-com-d', '.comment-date', '[class*="commentDate"]', '[class*="date"]'];
      let date = null;
      for (const ds of dateSelectors) {
        const el = card.querySelector(ds);
        if (el) {
          date = el.textContent.trim();
          break;
        }
      }

      let rating = null;
      const starEl = card.querySelector('.rnr-com-s, .star-w, [class*="star"], [class*="rating"]');
      if (starEl) {
        const width = starEl.style.width;
        if (width) {
          rating = Math.round((parseFloat(width) / 100) * 5 * 10) / 10;
        } else {
          const fullStars = starEl.querySelectorAll('.full, [class*="full"]');
          if (fullStars.length > 0) rating = fullStars.length;
        }
      }

      const sellerName = ScraperUtils.safeGet(() =>
        card.querySelector('.seller-name-w, .rnr-com-sell, [class*="seller"]')?.textContent.trim()
      );

      result.reviews.push({ author, date, rating, text: reviewText, sellerName });
    });

    // İlk seçicide durma: farklı container yapılarındaki tüm yorumları topla.
  }

  result.reviews = dedupeReviews(result.reviews, Infinity);

  if (result.reviews.length === 0) {
    result.reviews = extractReviewsFromJsonLd();
  }

  if (result.reviews.length <= 1) {
    const appReviews = extractReviewsFromAppData();
    if (appReviews.length > 0) {
      result.reviews = dedupeReviews(result.reviews.concat(appReviews), Infinity);
    }
  }

  // Her zaman API'den çekmeyi denemesi için
  if (result._productId) {
    result._needsApiFetch = true;
  }

  if (result.reviews.length === 0 && !result._needsApiFetch) {
    const allDivs = document.querySelectorAll('div, p, span');
    const seen = new Set();

    allDivs.forEach((el) => {
      const text = el.textContent.trim();
      if (text.length >= 30 && text.length <= 500 && !seen.has(text)) {
        const parent = el.closest('[class*="com"], [class*="review"], [class*="comment"]');
        if (parent) {
          seen.add(text);
          result.reviews.push({
            author: null,
            date: null,
            rating: null,
            text,
            sellerName: null,
          });
        }
      }
    });

    result.reviews = dedupeReviews(result.reviews, Infinity);
  }

  return result;
}

function extractProductId() {
  // 1. Durum: URL'de -p-12345 formatı var mı?
  let match = window.location.href.match(/-p-(\d+)/);
  if (match) return match[1];

  // Alternatif regex kalıpları (URL sonundaki parametreler için)
  match = window.location.href.match(/[?&]pi=(\d+)/) || window.location.href.match(/[?&]boutiqueId=\d+&merchantId=\d+.*?-p-(\d+)/);
  if (match && match[1]) return match[1];
  
  // 2. Durum: URL query parametrelerinde prc, v vb ürün id içeren şeyler
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('pi')) return urlParams.get('pi');

  // 3. Durum: document içi id etiketleri vb. genelde datalayer objesinde olur.
  // global window.ty alanina vs cok girmeyecegiz, basit dom takibi:
  const meta = document.querySelector('meta[name="product-id"]');
  if (meta) return meta.content;

  const appData = document.querySelector('script#__NEXT_DATA__');
  if (appData) {
    try {
      const data = JSON.parse(appData.textContent);
      // Ürün ID'sini arama (next.js veri yapılarında genelde bulunur)
      if (data?.props?.pageProps?.product?.id) {
         return data.props.pageProps.product.id;
      }
    } catch {}
  }

  return null;
}

async function fetchReviewsFromApi(productId, expectedTotalCount = 0) {
  const pickFirstString = (...values) => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim().length > 0) return value;
    }
    return null;
  };

  const extractTextDeep = (obj, depth = 0) => {
    if (depth > 3 || obj == null) return null;
    if (typeof obj === 'string' && obj.trim().length > 0) return obj;
    if (typeof obj !== 'object') return null;

    const preferredKeys = [
      'commentText',
      'reviewText',
      'text',
      'comment',
      'content',
      'description',
      'reviewBody',
      'message',
      'body',
      'title',
    ];

    for (const key of preferredKeys) {
      if (key in obj) {
        const found = extractTextDeep(obj[key], depth + 1);
        if (found) return found;
      }
    }

    for (const value of Object.values(obj)) {
      const found = extractTextDeep(value, depth + 1);
      if (found) return found;
    }

    return null;
  };

  const extractReviewArray = (payload) => {
    const candidates = [
      payload?.result?.productReviews?.content,
      payload?.result?.productReviews?.reviews,
      payload?.result?.productReviews?.items,
      payload?.result?.content,
      payload?.result?.contentList,
      payload?.result?.reviews,
      payload?.reviews,
      payload?.data?.reviews,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
      if (candidate && Array.isArray(candidate.items)) return candidate.items;
    }

    // Son çare: payload içinde review benzeri kayıtları recursive bul.
    const queue = [payload];
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;

      if (Array.isArray(node)) {
        if (
          node.length > 0 &&
          node.some((x) => {
            if (!x || typeof x !== 'object') return false;
            return Boolean(
              x.commentText || x.reviewText || x.comment || x.text || x.content || x.description || x.reviewBody
            );
          })
        ) {
          return node;
        }
        for (const item of node) queue.push(item);
      } else {
        for (const value of Object.values(node)) queue.push(value);
      }
    }

    return [];
  };

  const hosts = [
    'https://public-mdc.trendyol.com',
    'https://public.trendyol.com',
    'https://api.trendyol.com'
  ];

  for (const host of hosts) {
    let allReviews = [];
    let noGrowthPages = 0;

    for (let page = 0; page < 200; page += 1) {
      const urls = [
        `${host}/discovery-web-socialgw-service/api/review/${productId}?page=${page}&order=most-recent&pageSize=100`,
        `${host}/discovery-web-socialgw-service/api/review/${productId}?page=${page}&order=most-recent&pageSize=20`,
        `${host}/discovery-web-socialgw-service/api/review/${productId}?page=${page + 1}&order=most-recent&pageSize=20`,
        `${host}/discovery-web-socialgw-service/api/review/${productId}?page=${page + 1}&order=most-recent&pageSize=100`,
        `${host}/discovery-web-socialgw-service/api/review/${productId}?page=${page}&order=DESC&size=100`,
        `${host}/discovery-web-socialgw-service/api/review/${productId}?page=${page}&order=DESC&size=20`,
        `${host}/discovery-web-socialgw-service/api/review/${productId}?pageIndex=${page}&order=most-recent&pageSize=100`,
        `${host}/discovery-web-socialgw-service/api/review/${productId}?pageIndex=${page + 1}&order=most-recent&pageSize=100`,
        `${host}/discovery-web-socialgw-service/api/review/${productId}?p=${page}&order=most-recent&pageSize=100`,
      ];

      let pageData = null;
      let bestReviewData = [];
      let bestNormalized = [];

      for (const url of urls) {
        try {
          const response = await fetch(url, {
            headers: {
              Accept: 'application/json',
              'x-app-name': 'web',
            },
          });

          if (!response.ok) continue;

          const candidateData = await response.json();
          const candidateReviewData = extractReviewArray(candidateData);
          const candidateNormalized = dedupeReviews(
            candidateReviewData.map((r) => ({
              reviewId: r?.id ?? r?.reviewId ?? r?.commentId ?? r?.uuid ?? null,
              author: pickFirstString(r?.userFullName, r?.nickname, r?.userName, r?.author, r?.user?.name),
              date: pickFirstString(r?.lastModifiedDate, r?.createdDate, r?.commentDate, r?.date),
              rating: r?.rate ?? r?.star ?? r?.rating ?? r?.reviewRating?.ratingValue ?? null,
              text: pickFirstString(
                r?.commentText,
                r?.reviewText,
                r?.text,
                r?.content,
                r?.reviewBody,
                r?.description,
                extractTextDeep(r?.comment),
                extractTextDeep(r)
              ),
              sellerName: pickFirstString(r?.sellerName, r?.seller?.name),
            })),
            Infinity
          );

          if (candidateNormalized.length > bestNormalized.length) {
            pageData = candidateData;
            bestReviewData = candidateReviewData;
            bestNormalized = candidateNormalized;
          }
        } catch {
          // Bir sonraki URL varyasyonunu dene.
        }
      }

      if (!pageData) break;

      const reviewData = bestReviewData;
      console.log('[AI Shopping Assistant] API sayfa', page, 'ham yorum adedi:', Array.isArray(reviewData) ? reviewData.length : 0);
      if (!reviewData || reviewData.length === 0) break;

      const normalized = bestNormalized;

      if (normalized.length === 0) break;
      console.log('[AI Shopping Assistant] API sayfa', page, 'normalize yorum adedi:', normalized.length);

      const beforeCount = allReviews.length;
      allReviews = dedupeReviews(allReviews.concat(normalized), Infinity);
      const afterCount = allReviews.length;

      if (afterCount === beforeCount) {
        noGrowthPages += 1;
      } else {
        noGrowthPages = 0;
      }

      // Arka arkaya birkaç sayfada yeni yorum gelmiyorsa sayfalama tıkanmıştır.
      if (noGrowthPages >= 3) break;

      const totalPages =
        pageData?.result?.productReviews?.totalPages ??
        pageData?.result?.totalPages ??
        pageData?.totalPages;

      const apiTotalCount =
        pageData?.result?.productReviews?.totalCount ??
        pageData?.result?.totalCount ??
        pageData?.totalCount ??
        0;

      const targetCount = Math.max(expectedTotalCount || 0, apiTotalCount || 0);

      if (targetCount > 0 && allReviews.length >= targetCount) break;

      if (Number.isFinite(totalPages) && page >= totalPages - 1) break;
    }

    if (allReviews.length > 0) {
      return dedupeReviews(allReviews, Infinity);
    }
  }

  return [];
}

// -- Satici Listesi -----------------------------------------------------------
function scrapeSellerList() {
  const result = {
    mainSeller: null,
    otherSellers: [],
  };

  const mainSellerSelectors = [
    '.merchant-box-wrapper .seller-name-text',
    '.merchant-info a',
    '.pr-mc-w .sl-name',
    '.seller-container .seller-name',
  ];

  for (const selector of mainSellerSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      result.mainSeller = {
        name: el.textContent.trim(),
        url: el.href || null,
        rating: ScraperUtils.safeGet(() => {
          const ratingEl = el
            .closest('.merchant-box-wrapper, .merchant-info, .seller-container')
            ?.querySelector('.sl-pn, .merchant-rating, .seller-score');
          return ratingEl ? ratingEl.textContent.trim() : null;
        }),
      };
      break;
    }
  }

  const otherSellerCards = ScraperUtils.getAll(
    '.other-sellers-w .os-item, .merchant-list-w .merchant-item, .other-merchant-w li'
  );

  otherSellerCards.forEach((card) => {
    const seller = {
      name: ScraperUtils.safeGet(() => card.querySelector('.os-seller-name, .merchant-name, .sl-name')?.textContent.trim()),
      price: ScraperUtils.safeGet(() => {
        const priceText = card.querySelector('.os-price, .merchant-price, .prc-dsc')?.textContent;
        return priceText ? ScraperUtils.parsePrice(priceText) : null;
      }),
      rating: ScraperUtils.safeGet(() => card.querySelector('.os-seller-rating, .merchant-rating, .sl-pn')?.textContent.trim()),
      shippingInfo: ScraperUtils.safeGet(() => card.querySelector('.os-shipping, .shipping-info, .merchant-shipping')?.textContent.trim()),
    };

    if (seller.name) {
      result.otherSellers.push(seller);
    }
  });

  return result;
}

// -- Tum Verileri Cek ---------------------------------------------------------
function scrapeAllData() {
  const data = {
    productName: scrapeProductName(),
    price: scrapeProductPrice(),
    description: scrapeProductDescription(),
    reviews: scrapeProductReviews(),
    sellers: scrapeSellerList(),
    meta: {
      url: window.location.href,
      scrapedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
    },
  };

  return data;
}
