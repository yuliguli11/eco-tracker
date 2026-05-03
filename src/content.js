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
  nodeTokens.clear();
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

// ── Selector catalogue ────────────────────────────────────────────────────────
// Tried in order; first selector that returns nodes wins for that role.
// Covers multiple claude.ai DOM layouts observed across 2024–2025.

const INPUT_SELECTORS = [
  '[data-testid="human-turn"]',
  '[data-testid="user-message"]',
  '[class*="human-turn"]',
  '[class*="HumanTurn"]',
];

const OUTPUT_SELECTORS = [
  '[data-testid="assistant-turn"]',
  '[data-testid="ai-message"]',
  '[class*="assistant-turn"]',
  '[class*="AssistantTurn"]',
];

function queryAll(selectors) {
  const seen = new Set();
  const results = [];
  for (const sel of selectors) {
    try {
      document.querySelectorAll(sel).forEach((n) => {
        if (!seen.has(n)) { seen.add(n); results.push(n); }
      });
    } catch (_) { /* invalid selector — skip */ }
  }
  return results;
}

// ── Delta-based message tracker ───────────────────────────────────────────────
//
// Map<Element, number> — how many tokens we have already counted for each node.
// On every scan we compute (current − previous) and add only the new tokens.
// This handles both fully-loaded messages and live-streaming responses with a
// single, unified code path — no fingerprints, no separate streaming tracker.

const nodeTokens = new Map();

function scan() {
  const inputNodes  = queryAll(INPUT_SELECTORS);
  const outputNodes = queryAll(OUTPUT_SELECTORS);

  let changed = false;

  function processNodes(nodes, role) {
    for (const node of nodes) {
      const current = charsToTokens(node.innerText);
      const prev    = nodeTokens.get(node) ?? -1;
      if (current === prev) continue;

      if (prev === -1) {
        // Brand-new node — count all its tokens and record the message
        session.messageCount++;
      }
      const delta = current - Math.max(prev, 0);
      if (delta > 0) {
        if (role === 'input')  session.inputTokens  += delta;
        else                   session.outputTokens += delta;
        nodeTokens.set(node, current);
        changed = true;
      }
    }
  }

  processNodes(inputNodes,  'input');
  processNodes(outputNodes, 'output');

  if (changed) updateWidget();
}

// ── MutationObserver ──────────────────────────────────────────────────────────

let scanTimer = null;

function scheduleScan() {
  clearTimeout(scanTimer);
  // Short debounce so rapid character-by-character streaming batches into one scan
  scanTimer = setTimeout(scan, 200);
}

// Always watch document.body — more reliable than trying to find <main> early
const observer = new MutationObserver(scheduleScan);

function startObserving() {
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

// Periodic backstop: catches any mutations the observer might have missed
// (e.g. cross-origin iframes, delayed hydration)
setInterval(scan, 2000);

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  if (document.getElementById('eco-tracker-widget')) return;
  widgetEl = buildWidget();
  startObserving();
  scan(); // pick up any messages already in the DOM
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ── SPA navigation handler ────────────────────────────────────────────────────
// claude.ai is a Next.js SPA — URL changes without a full page reload.
// On navigation: clear the node-token map so stale element refs are released
// and any messages in the new conversation are counted fresh.

let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  nodeTokens.clear();
  session.inputTokens  = 0;
  session.outputTokens = 0;
  session.messageCount = 0;
  // Give the SPA a moment to render the new conversation before scanning
  setTimeout(scan, 500);
}).observe(document, { subtree: true, childList: true });
