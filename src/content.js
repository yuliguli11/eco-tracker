/**
 * Eco Tracker — content script injected into claude.ai
 *
 * Environmental estimates are derived from published LLM inference research:
 *   Energy:  ~0.002 kWh per 1K tokens (inference, server-side)
 *   Water:   ~10 mL per 1K tokens  (data-centre cooling, US avg)
 *   CO₂:     ~0.47 g per 1K tokens  (0.233 kg CO₂/kWh × 0.002 kWh × 1000 g/kg)
 *
 * Pricing (Claude claude-sonnet-4-6 as default approximation):
 *   Input:  $3.00 / 1M tokens
 *   Output: $15.00 / 1M tokens
 *
 * Token estimation: 1 token ≈ 4 characters (GPT/Claude tokeniser average)
 */

const ENV = {
  energyPerKToken: 0.002,   // kWh
  waterPerKToken:  10,       // mL
  co2PerKToken:    0.47,     // g
  inputCostPerMToken:  3.00, // USD
  outputCostPerMToken: 15.00,
};

const session = {
  inputTokens:  0,
  outputTokens: 0,
  messageCount: 0,
};

let widgetEl = null;
let collapsed = false;

// ── Token estimation ─────────────────────────────────────────────────────────

function charsToTokens(text) {
  return Math.ceil((text || '').length / 4);
}

// ── Impact calculations ───────────────────────────────────────────────────────

function calcImpact(inputTok, outputTok) {
  const totalKTok = (inputTok + outputTok) / 1000;
  return {
    energy: totalKTok * ENV.energyPerKToken,
    water:  totalKTok * ENV.waterPerKToken,
    co2:    totalKTok * ENV.co2PerKToken,
    cost:   (inputTok / 1e6) * ENV.inputCostPerMToken +
            (outputTok / 1e6) * ENV.outputCostPerMToken,
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtEnergy(kWh) {
  if (kWh < 0.001) return `${(kWh * 1e6).toFixed(1)} μWh`;
  if (kWh < 1)     return `${(kWh * 1000).toFixed(2)} Wh`;
  return `${kWh.toFixed(3)} kWh`;
}

function fmtWater(mL) {
  if (mL < 1)    return `${(mL * 1000).toFixed(1)} μL`;
  if (mL < 1000) return `${mL.toFixed(1)} mL`;
  return `${(mL / 1000).toFixed(2)} L`;
}

function fmtCO2(g) {
  if (g < 1)    return `${(g * 1000).toFixed(1)} μg`;
  if (g < 1000) return `${g.toFixed(2)} g`;
  return `${(g / 1000).toFixed(3)} kg`;
}

function fmtCost(usd) {
  if (usd < 0.0001) return `< $0.0001`;
  if (usd < 0.01)   return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(4)}`;
}

// ── Widget DOM ────────────────────────────────────────────────────────────────

function buildWidget() {
  const el = document.createElement('div');
  el.id = 'eco-tracker-widget';
  el.innerHTML = `
    <div id="eco-tracker-header">
      <span id="eco-tracker-title">
        <span class="eco-leaf">🌿</span> Eco Tracker
      </span>
      <div id="eco-tracker-controls">
        <button id="eco-tracker-reset" title="Reset session">↺</button>
        <button id="eco-tracker-toggle" title="Collapse">−</button>
      </div>
    </div>
    <div id="eco-tracker-body">
      <div class="eco-row" id="eco-row-cost">
        <span class="eco-icon">💰</span>
        <span class="eco-label">Cost</span>
        <span class="eco-value" id="eco-val-cost">$0.0000</span>
      </div>
      <div class="eco-row" id="eco-row-energy">
        <span class="eco-icon">⚡</span>
        <span class="eco-label">Energy</span>
        <span class="eco-value" id="eco-val-energy">0 Wh</span>
      </div>
      <div class="eco-row" id="eco-row-water">
        <span class="eco-icon">💧</span>
        <span class="eco-label">Water</span>
        <span class="eco-value" id="eco-val-water">0 mL</span>
      </div>
      <div class="eco-row" id="eco-row-co2">
        <span class="eco-icon">☁️</span>
        <span class="eco-label">CO₂</span>
        <span class="eco-value" id="eco-val-co2">0 g</span>
      </div>
      <div id="eco-tracker-footer">
        <span id="eco-msg-count">0 messages · 0 tokens</span>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  el.querySelector('#eco-tracker-toggle').addEventListener('click', toggleCollapse);
  el.querySelector('#eco-tracker-reset').addEventListener('click', resetSession);

  makeDraggable(el);
  return el;
}

function toggleCollapse() {
  collapsed = !collapsed;
  const body   = widgetEl.querySelector('#eco-tracker-body');
  const btn    = widgetEl.querySelector('#eco-tracker-toggle');
  body.style.display = collapsed ? 'none' : 'block';
  btn.textContent    = collapsed ? '+' : '−';
}

function resetSession() {
  session.inputTokens  = 0;
  session.outputTokens = 0;
  session.messageCount = 0;
  updateWidget();
  chrome.runtime.sendMessage({ type: 'RESET_SESSION' });
}

function updateWidget() {
  if (!widgetEl) return;
  const imp = calcImpact(session.inputTokens, session.outputTokens);

  widgetEl.querySelector('#eco-val-cost').textContent   = fmtCost(imp.cost);
  widgetEl.querySelector('#eco-val-energy').textContent = fmtEnergy(imp.energy);
  widgetEl.querySelector('#eco-val-water').textContent  = fmtWater(imp.water);
  widgetEl.querySelector('#eco-val-co2').textContent    = fmtCO2(imp.co2);

  const totalTok = session.inputTokens + session.outputTokens;
  widgetEl.querySelector('#eco-msg-count').textContent =
    `${session.messageCount} msg · ${totalTok.toLocaleString()} tok`;

  chrome.runtime.sendMessage({
    type:    'UPDATE_STATS',
    session: { ...session },
    impact:  imp,
  });
}

// ── Drag support ──────────────────────────────────────────────────────────────

function makeDraggable(el) {
  const header = el.querySelector('#eco-tracker-header');
  let dragging = false;
  let ox = 0, oy = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    dragging = true;
    ox = e.clientX - el.getBoundingClientRect().left;
    oy = e.clientY - el.getBoundingClientRect().top;
    el.style.transition = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  e.clientX - ox));
    const y = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, e.clientY - oy));
    el.style.right  = 'auto';
    el.style.bottom = 'auto';
    el.style.left   = x + 'px';
    el.style.top    = y + 'px';
  });

  document.addEventListener('mouseup', () => {
    dragging = false;
    el.style.transition = '';
  });
}

// ── Message observer ──────────────────────────────────────────────────────────

const seenMessages = new Set();

function scanMessages() {
  // Claude.ai renders human turns as [data-testid="human-turn"] and
  // assistant turns as [data-testid="assistant-turn"] (observed as of 2025).
  // Fallback: look for role attributes used in older layouts.
  const humanTurns     = document.querySelectorAll('[data-testid="human-turn"]');
  const assistantTurns = document.querySelectorAll('[data-testid="assistant-turn"]');

  let newInput  = 0;
  let newOutput = 0;
  let newMsgs   = 0;

  humanTurns.forEach((node) => {
    const key = 'h:' + (node.dataset.index || nodeFingerprint(node));
    if (seenMessages.has(key)) return;
    seenMessages.add(key);
    newInput += charsToTokens(node.innerText);
    newMsgs++;
  });

  assistantTurns.forEach((node) => {
    const key = 'a:' + (node.dataset.index || nodeFingerprint(node));
    if (seenMessages.has(key)) return;
    seenMessages.add(key);
    newOutput += charsToTokens(node.innerText);
    newMsgs++;
  });

  if (newInput > 0 || newOutput > 0) {
    session.inputTokens  += newInput;
    session.outputTokens += newOutput;
    session.messageCount += newMsgs;
    updateWidget();
  }
}

function nodeFingerprint(node) {
  // Stable enough key: truncated text + child count
  return (node.innerText || '').slice(0, 80) + '|' + node.children.length;
}

// ── Streaming output tracker ──────────────────────────────────────────────────
// For streaming responses we watch the active assistant turn and update live.

let streamingNode = null;
let streamingKey  = null;
let streamingPrev = 0;

function watchStreaming() {
  // The last assistant-turn element is the one currently streaming.
  const turns = document.querySelectorAll('[data-testid="assistant-turn"]');
  if (!turns.length) return;
  const last = turns[turns.length - 1];
  const key  = 'stream:' + nodeFingerprint(last);

  if (key !== streamingKey) {
    streamingKey  = key;
    streamingNode = last;
    streamingPrev = 0;
  }

  const currentTokens = charsToTokens(last.innerText);
  const delta = currentTokens - streamingPrev;
  if (delta > 0) {
    streamingPrev = currentTokens;
    session.outputTokens += delta;
    updateWidget();
  }
}

// ── MutationObserver ──────────────────────────────────────────────────────────

let scanTimer = null;

function scheduleScans() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanMessages();
    watchStreaming();
  }, 300);
}

const observer = new MutationObserver(scheduleScans);

function startObserving() {
  const root = document.querySelector('main') || document.body;
  observer.observe(root, { childList: true, subtree: true, characterData: true });
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  if (document.getElementById('eco-tracker-widget')) return;
  widgetEl = buildWidget();
  startObserving();
  scanMessages();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Re-init on SPA navigation (claude.ai is a Next.js SPA)
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    // Keep the widget but clear seen-message cache for the new conversation
    seenMessages.clear();
    streamingKey  = null;
    streamingPrev = 0;
  }
}).observe(document, { subtree: true, childList: true });
