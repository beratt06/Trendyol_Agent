/**
 * Trendyol AI Shopping Assistant — Popup Settings Script
 *
 * API sağlayıcı (Ollama/OpenAI), model ve bağlantı ayarlarını yönetir.
 */

document.addEventListener('DOMContentLoaded', () => {
  const providerSelect = document.getElementById('provider-select');
  const apiKeySection = document.getElementById('api-key-section');
  const apiKeyInput = document.getElementById('api-key-input');
  const apiUrlInput = document.getElementById('api-url-input');
  const modelInput = document.getElementById('model-input');
  const saveBtn = document.getElementById('save-btn');
  const statusMsg = document.getElementById('status-message');
  const toggleBtn = document.getElementById('toggle-key-visibility');
  const urlHint = document.getElementById('url-hint');
  const modelHint = document.getElementById('model-hint');
  const ollamaStatus = document.getElementById('ollama-status');

  const DEFAULTS = {
    ollama: { url: 'http://localhost:11434/api/chat', model: 'llama3' },
    openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  };

  // ── Kayıtlı ayarları yükle ────────────────────────────
  chrome.storage.local.get(['apiKey', 'apiUrl', 'model', 'provider'], (result) => {
    const provider = result.provider || 'ollama';
    providerSelect.value = provider;
    apiKeyInput.value = result.apiKey || '';
    apiUrlInput.value = result.apiUrl || DEFAULTS[provider].url;
    modelInput.value = result.model || DEFAULTS[provider].model;
    updateUI(provider);

    if (provider === 'ollama') checkOllamaConnection();
  });

  // ── Provider değiştiğinde UI güncelle ──────────────────
  providerSelect.addEventListener('change', () => {
    const provider = providerSelect.value;
    apiUrlInput.value = DEFAULTS[provider].url;
    modelInput.value = DEFAULTS[provider].model;
    updateUI(provider);

    if (provider === 'ollama') checkOllamaConnection();
    else ollamaStatus.style.display = 'none';
  });

  function updateUI(provider) {
    const isOllama = provider === 'ollama';
    apiKeySection.style.display = isOllama ? 'none' : 'block';
    urlHint.textContent = isOllama ? 'Ollama yerel sunucu adresi' : 'Özel endpoint (varsayılan: OpenAI)';
    modelHint.textContent = isOllama ? 'Ollama\'da yüklü model adı (örn: llama3, mistral)' : 'OpenAI model adı (örn: gpt-4o-mini)';
    apiUrlInput.placeholder = DEFAULTS[provider].url;
    modelInput.placeholder = DEFAULTS[provider].model;
  }

  // ── Ollama Bağlantı Kontrolü ───────────────────────────
  async function checkOllamaConnection() {
    ollamaStatus.style.display = 'block';
    ollamaStatus.textContent = '🔄 Ollama bağlantısı kontrol ediliyor...';
    ollamaStatus.className = 'popup-status popup-status-info';

    try {
      const baseUrl = apiUrlInput.value.replace('/api/chat', '').replace('/api/generate', '');
      const response = await fetch(`${baseUrl}/api/tags`, { method: 'GET' });

      if (response.ok) {
        const data = await response.json();
        const models = data.models?.map(m => m.name) || [];
        if (models.length > 0) {
          ollamaStatus.innerHTML = `✅ Ollama çalışıyor! Yüklü modeller: <strong>${models.slice(0, 5).join(', ')}</strong>`;
          ollamaStatus.className = 'popup-status popup-status-success';
        } else {
          ollamaStatus.textContent = '⚠️ Ollama çalışıyor ama yüklü model yok. Terminalde "ollama pull llama3" çalıştırın.';
          ollamaStatus.className = 'popup-status popup-status-warning';
        }
      } else {
        ollamaStatus.textContent = '❌ Ollama yanıt vermiyor.';
        ollamaStatus.className = 'popup-status popup-status-error';
      }
    } catch {
      ollamaStatus.textContent = '❌ Yerel Ollama sunucusuna bağlanılamadı. Terminalden Ollama\'nın çalıştığından emin olun.';
      ollamaStatus.className = 'popup-status popup-status-error';
    }
  }

  // ── API Key Toggle ─────────────────────────────────────
  toggleBtn.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleBtn.textContent = isPassword ? '🙈' : '👁️';
  });

  // ── Kaydet ─────────────────────────────────────────────
  saveBtn.addEventListener('click', () => {
    const provider = providerSelect.value;
    const apiKey = apiKeyInput.value.trim();
    const apiUrl = apiUrlInput.value.trim() || DEFAULTS[provider].url;
    const model = modelInput.value.trim() || DEFAULTS[provider].model;

    if (provider === 'openai' && !apiKey) {
      showStatus('⚠️ OpenAI kullanmak için API anahtarı gereklidir.', 'warning');
      return;
    }

    // Ollama için API key gerekmez ama boş kaydetmiyoruz — 'ollama' placeholder koyuyoruz
    const saveKey = provider === 'ollama' ? (apiKey || 'ollama-local') : apiKey;

    chrome.storage.local.set({ apiKey: saveKey, apiUrl, model, provider }, () => {
      showStatus('✅ Ayarlar kaydedildi!', 'success');
      setTimeout(() => window.close(), 1500);
    });
  });

  // ── Enter ile kaydet ───────────────────────────────────
  modelInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });
  apiKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });

  // ── Durum Mesajı ───────────────────────────────────────
  function showStatus(text, type) {
    statusMsg.textContent = text;
    statusMsg.className = `popup-status popup-status-${type}`;
    statusMsg.style.display = 'block';
    setTimeout(() => { statusMsg.style.display = 'none'; }, 3000);
  }
});
