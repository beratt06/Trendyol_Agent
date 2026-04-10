/**
 * Trendyol AI Shopping Assistant — Panel Injection Module
 *
 * Sayfaya AI Analiz Paneli enjekte eder, scrape verileri gösterir
 * ve AI analiz sonuçlarını zengin UI ile render eder.
 */

const PANEL_ID = 'ai-shopping-assistant-panel';

// ── Panel Enjeksiyonu ────────────────────────────────────
function injectPanel() {
  if (document.getElementById(PANEL_ID)) {
    console.log('[AI Shopping Assistant] Panel zaten mevcut.');
    return document.getElementById(PANEL_ID);
  }

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div class="ai-panel-header">
      <div class="ai-panel-logo">
        <span class="ai-panel-icon">🤖</span>
        <span class="ai-panel-title">AI Alışveriş Asistanı</span>
      </div>
      <button class="ai-panel-toggle" aria-label="Paneli Küçült" title="Küçült / Genişlet">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 5L7 9L11 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
    <div class="ai-panel-body">
      <div class="ai-panel-status">
        <div class="ai-panel-spinner"></div>
        <span class="ai-panel-status-text">Analiz Ediliyor...</span>
      </div>
      <div class="ai-panel-content" style="display: none;"></div>
    </div>
    <div class="ai-panel-footer">
      <span class="ai-panel-badge">v2.0 • AI Powered</span>
    </div>
  `;

  const anchorPoint = findAnchorPoint();
  if (anchorPoint) {
    anchorPoint.parentNode.insertBefore(panel, anchorPoint.nextSibling);
  } else {
    panel.classList.add('ai-panel-floating');
    document.body.appendChild(panel);
  }

  setupPanelToggle(panel);

  requestAnimationFrame(() => {
    panel.classList.add('ai-panel-visible');
  });

  return panel;
}

// ── Anchor Noktası Bulma ─────────────────────────────────
function findAnchorPoint() {
  const selectors = [
    '.pr-in-w .pr-in-cn',
    '.product-detail-container',
    '.pr-cn-w',
    '.product-price-container',
    '.pr-in-w',
    '.detail-name',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

// ── Panel Toggle ─────────────────────────────────────────
function setupPanelToggle(panel) {
  const toggleBtn = panel.querySelector('.ai-panel-toggle');
  const body = panel.querySelector('.ai-panel-body');
  const footer = panel.querySelector('.ai-panel-footer');
  if (!toggleBtn) return;

  toggleBtn.addEventListener('click', () => {
    const isCollapsed = panel.classList.toggle('ai-panel-collapsed');
    body.style.display = isCollapsed ? 'none' : 'block';
    footer.style.display = isCollapsed ? 'none' : 'flex';
    toggleBtn.style.transform = isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
  });
}

// ── Durum Güncelleme ─────────────────────────────────────

/** Panel status metnini güncele (spinner gösterilirken) */
function updatePanelStatus(text) {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;
  const statusText = panel.querySelector('.ai-panel-status-text');
  if (statusText) statusText.textContent = text;
}

/** Spinner'ı göster, "AI Analiz Ediliyor" durumu */
function showAnalyzingState() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;

  const statusEl = panel.querySelector('.ai-panel-status');
  const contentEl = panel.querySelector('.ai-panel-content');
  if (statusEl) {
    statusEl.style.display = 'flex';
    const statusText = statusEl.querySelector('.ai-panel-status-text');
    if (statusText) statusText.textContent = '🧠 AI Analiz Ediliyor...';
  }
  if (contentEl) contentEl.style.display = 'none';
}

/** Hata durumunu panelde göster */
function updatePanelError(message) {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;

  const statusEl = panel.querySelector('.ai-panel-status');
  const contentEl = panel.querySelector('.ai-panel-content');
  if (statusEl) statusEl.style.display = 'none';
  if (contentEl) {
    contentEl.style.display = 'block';
    contentEl.innerHTML = `
      <div class="ai-error-state">
        <div class="ai-error-icon">⚠️</div>
        <div class="ai-error-title">Hata Oluştu</div>
        <div class="ai-error-message">${escapeHTML(message)}</div>
        <button class="ai-retry-btn" onclick="location.reload()">🔄 Sayfayı Yenile</button>
      </div>
    `;
  }
}

/** API key eksik durumu */
function showApiKeyMissing() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;

  const statusEl = panel.querySelector('.ai-panel-status');
  const contentEl = panel.querySelector('.ai-panel-content');
  if (statusEl) statusEl.style.display = 'none';
  if (contentEl) {
    contentEl.style.display = 'block';
    contentEl.innerHTML = `
      <div class="ai-error-state">
        <div class="ai-error-icon">🔑</div>
        <div class="ai-error-title">API Anahtarı Gerekli</div>
        <div class="ai-error-message">AI analiz özelliğini kullanmak için bir API anahtarı gereklidir. Tarayıcı araç çubuğundaki eklenti ikonuna tıklayarak ayarlardan API anahtarınızı girin.</div>
      </div>
    `;
  }
}

// ── Scrape Verilerini Panelde Göster ─────────────────────
function updatePanelContent(data) {
  // Bu fonksiyon artık sadece scrape verilerini geçici olarak gösterir
  // AI analizi geldiğinde updatePanelWithAnalysis() ile değiştirilir
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;

  const statusText = panel.querySelector('.ai-panel-status-text');
  if (statusText) {
    statusText.textContent = `📊 ${data.productName ? '"' + data.productName.substring(0, 40) + '..." verisi çekildi, AI analiz başlıyor...' : 'Veri çekildi, AI analiz başlıyor...'}`;
  }
}

// ── AI Analiz Sonuçlarını Panelde Göster ──────────────────
/**
 * LLM'den dönen yapılandırılmış analiz sonuçlarını zengin UI ile render eder
 * @param {object} analysis - parseAnalysisResponse() çıktısı
 */
function updatePanelWithAnalysis(analysis, productData = null) {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;

  const statusEl = panel.querySelector('.ai-panel-status');
  const contentEl = panel.querySelector('.ai-panel-content');

  if (statusEl) statusEl.style.display = 'none';
  if (!contentEl) return;

  contentEl.style.display = 'block';
  contentEl.innerHTML = buildAnalysisHTML(analysis, productData);

  // Tab işlevselliğini aktifleştir
  setupTabs(contentEl);
}

// ── Analiz HTML Oluşturucu ───────────────────────────────
function buildAnalysisHTML(analysis, productData) {
  const { productSummary, reviewAnalysis, aiScore } = analysis;
  const reviewCount = productData?.reviews?.reviews?.length || 0;

  return `
    <div style="text-align: center; margin-bottom: 8px; font-size: 12px; color: var(--ai-text-muted);">
      <span style="background: rgba(99, 102, 241, 0.1); padding: 4px 8px; border-radius: 12px; border: 1px solid rgba(99, 102, 241, 0.3);">
        💬 <strong>${reviewCount}</strong> adet yorum incelendi
      </span>
    </div>

    <!-- AI Skor Göstergesi -->
    ${buildScoreGauge(aiScore)}

    <!-- Tab Navigasyonu -->
    <div class="ai-tabs">
      <button class="ai-tab ai-tab-active" data-tab="summary">📋 Özet</button>
      <button class="ai-tab" data-tab="reviews">💬 Yorumlar</button>
    </div>

    <!-- Tab İçerikleri -->
    <div class="ai-tab-content ai-tab-content-active" data-tab-content="summary">
      ${buildSummaryTab(productSummary)}
    </div>

    <div class="ai-tab-content" data-tab-content="reviews">
      ${buildReviewsTab(reviewAnalysis)}
    </div>
  `;
}

// ── Skor Göstergesi ──────────────────────────────────────
function buildScoreGauge(aiScore) {
  const score = aiScore.score;
  const percentage = (score / 10) * 100;
  const circumference = 2 * Math.PI * 42;
  const dashOffset = circumference - (percentage / 100) * circumference;

  // Skor rengini belirle
  let scoreColor, scoreLabel;
  if (score >= 8) {
    scoreColor = '#34d399'; scoreLabel = 'Mükemmel';
  } else if (score >= 6) {
    scoreColor = '#818cf8'; scoreLabel = 'İyi';
  } else if (score >= 4) {
    scoreColor = '#fbbf24'; scoreLabel = 'Orta';
  } else {
    scoreColor = '#f87171'; scoreLabel = 'Düşük';
  }

  return `
    <div class="ai-score-gauge">
      <div class="ai-score-circle">
        <svg width="100" height="100" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" stroke="rgba(255,255,255,0.06)" stroke-width="6" fill="none"/>
          <circle cx="50" cy="50" r="42"
            stroke="${scoreColor}"
            stroke-width="6"
            fill="none"
            stroke-linecap="round"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${dashOffset}"
            transform="rotate(-90 50 50)"
            class="ai-score-ring"
          />
        </svg>
        <div class="ai-score-value">
          <span class="ai-score-number" style="color: ${scoreColor}">${score.toFixed(1)}</span>
          <span class="ai-score-max">/10</span>
        </div>
      </div>
      <div class="ai-score-info">
        <div class="ai-score-label" style="color: ${scoreColor}">${scoreLabel}</div>
        <div class="ai-score-reasoning">${escapeHTML(aiScore.reasoning)}</div>
      </div>
    </div>
  `;
}

// ── Özet Tab ─────────────────────────────────────────────
function buildSummaryTab(summary) {
  const prosHTML = summary.pros
    .map((p) => `<li class="ai-pro-item">✅ ${escapeHTML(p)}</li>`)
    .join('');

  const consHTML = summary.cons
    .map((c) => `<li class="ai-con-item">❌ ${escapeHTML(c)}</li>`)
    .join('');

  return `
    <div class="ai-summary-overview">
      <div class="ai-mini-title">📝 Genel Özet</div>
      <p class="ai-summary-text">${escapeHTML(summary.overview)}</p>
    </div>

    <div class="ai-pros-cons">
      <div class="ai-pros">
        <div class="ai-mini-title ai-title-pro">👍 Artıları</div>
        <ul class="ai-list">${prosHTML || '<li class="ai-muted">Belirlenemedi</li>'}</ul>
      </div>
      <div class="ai-cons">
        <div class="ai-mini-title ai-title-con">👎 Eksileri</div>
        <ul class="ai-list">${consHTML || '<li class="ai-muted">Belirlenemedi</li>'}</ul>
      </div>
    </div>

    <div class="ai-recommendation">
      <div class="ai-mini-title">💡 Satın Alma Önerisi</div>
      <p class="ai-recommendation-text">${escapeHTML(summary.recommendation)}</p>
    </div>
  `;
}

// ── Yorum Analizi Tab ────────────────────────────────────
function buildReviewsTab(reviewAnalysis) {
  const { sentiment } = reviewAnalysis;

  return `
    <div class="ai-review-overview">
      <div class="ai-mini-title">📊 Yorum Özeti</div>
      <p class="ai-summary-text">${escapeHTML(reviewAnalysis.summary)}</p>
    </div>

    <div class="ai-sentiment-bar-container">
      <div class="ai-mini-title">📈 Duygu Analizi</div>
      <div class="ai-sentiment-bar">
        <div class="ai-sentiment-segment ai-sentiment-positive" style="width: ${sentiment.positive}%">
          ${sentiment.positive > 10 ? `${sentiment.positive}%` : ''}
        </div>
        <div class="ai-sentiment-segment ai-sentiment-neutral" style="width: ${sentiment.neutral}%">
          ${sentiment.neutral > 10 ? `${sentiment.neutral}%` : ''}
        </div>
        <div class="ai-sentiment-segment ai-sentiment-negative" style="width: ${sentiment.negative}%">
          ${sentiment.negative > 10 ? `${sentiment.negative}%` : ''}
        </div>
      </div>
      <div class="ai-sentiment-legend">
        <span class="ai-legend-item"><span class="ai-legend-dot ai-dot-positive"></span> Pozitif</span>
        <span class="ai-legend-item"><span class="ai-legend-dot ai-dot-neutral"></span> Nötr</span>
        <span class="ai-legend-item"><span class="ai-legend-dot ai-dot-negative"></span> Negatif</span>
      </div>
    </div>

    <div class="ai-review-highlights">
      <div class="ai-highlight-card ai-highlight-positive">
        <div class="ai-highlight-label">⭐ En Çok Övülen</div>
        <p class="ai-highlight-text">${escapeHTML(reviewAnalysis.mostPraised)}</p>
      </div>
      <div class="ai-highlight-card ai-highlight-negative">
        <div class="ai-highlight-label">⚡ En Çok Şikâyet</div>
        <p class="ai-highlight-text">${escapeHTML(reviewAnalysis.mostComplained)}</p>
      </div>
    </div>
  `;
}

// ── Tab Yönetimi ─────────────────────────────────────────
function setupTabs(container) {
  const tabs = container.querySelectorAll('.ai-tab');
  const contents = container.querySelectorAll('.ai-tab-content');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetTab = tab.getAttribute('data-tab');

      // Tab butonlarını güncelle
      tabs.forEach((t) => t.classList.remove('ai-tab-active'));
      tab.classList.add('ai-tab-active');

      // Tab içeriklerini güncelle
      contents.forEach((c) => {
        c.classList.toggle('ai-tab-content-active', c.getAttribute('data-tab-content') === targetTab);
      });
    });
  });
}

// ── XSS Koruması ─────────────────────────────────────────
function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
