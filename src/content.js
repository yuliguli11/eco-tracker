/**
 * Eco Tracker — content script injected into claude.ai
 *
 * Environmental estimates (LLM inference research):
 *   Energy:  ~0.002 kWh / 1K tokens
 *   Water:   ~10 mL / 1K tokens  (data-centre cooling)
 *   CO₂:     ~0.47 g / 1K tokens  (US grid avg, 0.233 kg CO₂/kWh)
 *
 * Pricing approximation (Claude claude-sonnet-4-6):
 *   Input $3.00 / 1M tokens · Output $15.00 / 1M tokens
 *
 * Token estimation: ~4 characters per token
 */

const ENV = {
  energyPerKToken: 0.002,
  waterPerKToken:  10,
  co2PerKToken:    0.47,
};

// Pricing varies by platform and model. These are per-1M-token approximations
// for the most commonly served model on each site.
const PLATFORM_PRICING = {
  'claude.ai':        { input: 3.00,  output: 15.00 }, // Claude claude-sonnet-4-6
  'chatgpt.com':      { input: 2.50,  output: 10.00 }, // GPT-4o
  'chat.openai.com':  { input: 2.50,  output: 10.00 }, // GPT-4o (legacy domain)
};

function getPricing() {
  return PLATFORM_PRICING[location.hostname] ?? { input: 3.00, output: 15.00 };
}

const session = {
  inputTokens:  0,
  outputTokens: 0,
  messageCount: 0,
};

let widgetEl  = null;
let collapsed = false;
let funMode   = false;

// ── Token estimation ──────────────────────────────────────────────────────────

function charsToTokens(text) {
  return Math.ceil((text || '').length / 4);
}

// ── Impact calculations ───────────────────────────────────────────────────────

function calcImpact(inputTok, outputTok) {
  const totalKTok = (inputTok + outputTok) / 1000;
  const pricing   = getPricing();
  return {
    energy: totalKTok * ENV.energyPerKToken,
    water:  totalKTok * ENV.waterPerKToken,
    co2:    totalKTok * ENV.co2PerKToken,
    cost:   (inputTok / 1e6) * pricing.input +
            (outputTok / 1e6) * pricing.output,
  };
}

// ── Raw formatters ────────────────────────────────────────────────────────────

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
  return `$${usd.toFixed(4)}`;
}

// ── Fun formatters ────────────────────────────────────────────────────────────
// Cost    → ☕ coffees at $5 each
// Energy  → 💡 minutes a 10W LED was on (0.01 kWh/hr)
// Water   → 🍶 500 mL bottles
// CO₂     → 🚗 miles driven (avg US car: ~404 g CO₂/mile)

function fmtFunCost(usd) {
  const n = usd / 5;
  if (n < 0.001) return '< 0.001 coffees';
  return `${n.toFixed(3)} coffees`;
}

function fmtFunEnergy(kWh) {
  const minutes = kWh / 0.01 * 60; // 10 W LED → 0.01 kWh/hr
  if (minutes < 1)    return `${(minutes * 60).toFixed(0)}s of light`;
  if (minutes < 60)   return `${minutes.toFixed(1)} min lit`;
  return `${(minutes / 60).toFixed(2)} hrs lit`;
}

function fmtFunWater(mL) {
  const bottles = mL / 500;
  if (bottles < 0.001) return '< 0.001 bottles';
  return `${bottles.toFixed(3)} bottles`;
}

function fmtFunCO2(g) {
  const miles = g / 404;
  if (miles < 0.01) {
    const feet = miles * 5280;
    return `${feet.toFixed(1)} ft driven`;
  }
  return `${miles.toFixed(3)} mi driven`;
}

// ── Widget DOM ────────────────────────────────────────────────────────────────

function buildWidget() {
  const el = document.createElement('div');
  el.id = 'eco-tracker-widget';
  el.innerHTML = `
    <div id="eco-tracker-header">
      <span id="eco-tracker-title">🌿 eco</span>
      <div id="eco-tracker-controls">
        <button id="eco-mode-btn" title="Switch view">✦ fun</button>
        <button id="eco-tracker-reset" title="Reset session">↺</button>
        <button id="eco-tracker-collapse" title="Collapse">−</button>
      </div>
    </div>
    <div id="eco-tracker-body">
      <div class="eco-row">
        <span class="eco-row-icon" id="eco-icon-cost">💰</span>
        <span class="eco-row-val" id="eco-val-cost">$0.0000</span>
      </div>
      <div class="eco-row">
        <span class="eco-row-icon" id="eco-icon-energy">⚡</span>
        <span class="eco-row-val" id="eco-val-energy">0 Wh</span>
      </div>
      <div class="eco-row">
        <span class="eco-row-icon" id="eco-icon-water">💧</span>
        <span class="eco-row-val" id="eco-val-water">0 mL</span>
      </div>
      <div class="eco-row">
        <span class="eco-row-icon" id="eco-icon-co2">☁️</span>
        <span class="eco-row-val" id="eco-val-co2">0 g</span>
      </div>
      <div id="eco-tracker-footer">
        <span id="eco-msg-count">0 msg · 0 tok</span>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  el.querySelector('#eco-mode-btn').addEventListener('click', toggleMode);
  el.querySelector('#eco-tracker-reset').addEventListener('click', resetSession);
  el.querySelector('#eco-tracker-collapse').addEventListener('click', toggleCollapse);

  makeDraggable(el);
  return el;
}

function toggleMode() {
  funMode = !funMode;
  const btn = widgetEl.querySelector('#eco-mode-btn');
  btn.textContent = funMode ? '# raw' : '✦ fun';
  btn.classList.toggle('fun-active', funMode);
  widgetEl.classList.toggle('fun-mode', funMode);
  updateWidget();
}

function toggleCollapse() {
  collapsed = !collapsed;
  const body = widgetEl.querySelector('#eco-tracker-body');
  const btn  = widgetEl.querySelector('#eco-tracker-collapse');
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

  if (funMode) {
    widgetEl.querySelector('#eco-icon-cost').textContent   = '☕';
    widgetEl.querySelector('#eco-val-cost').textContent    = fmtFunCost(imp.cost);
    widgetEl.querySelector('#eco-icon-energy').textContent = '💡';
    widgetEl.querySelector('#eco-val-energy').textContent  = fmtFunEnergy(imp.energy);
    widgetEl.querySelector('#eco-icon-water').textContent  = '🍶';
    widgetEl.querySelector('#eco-val-water').textContent   = fmtFunWater(imp.water);
    widgetEl.querySelector('#eco-icon-co2').textContent    = '🚗';
    widgetEl.querySelector('#eco-val-co2').textContent     = fmtFunCO2(imp.co2);
  } else {
    widgetEl.querySelector('#eco-icon-cost').textContent   = '💰';
    widgetEl.querySelector('#eco-val-cost').textContent    = fmtCost(imp.cost);
    widgetEl.querySelector('#eco-icon-energy').textContent = '⚡';
    widgetEl.querySelector('#eco-val-energy').textContent  = fmtEnergy(imp.energy);
    widgetEl.querySelector('#eco-icon-water').textContent  = '💧';
    widgetEl.querySelector('#eco-val-water').textContent   = fmtWater(imp.water);
    widgetEl.querySelector('#eco-icon-co2').textContent    = '☁️';
    widgetEl.querySelector('#eco-val-co2').textContent     = fmtCO2(imp.co2);
  }

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

const INPUT_SELECTORS = [
  // Claude
  '[data-testid="human-turn"]',
  '[data-testid="user-message"]',
  '[class*="human-turn"]',
  '[class*="HumanTurn"]',
  // ChatGPT
  '[data-message-author-role="user"]',
];

const OUTPUT_SELECTORS = [
  // Claude
  '[data-testid="assistant-turn"]',
  '[data-testid="ai-message"]',
  '[class*="assistant-turn"]',
  '[class*="AssistantTurn"]',
  // ChatGPT
  '[data-message-author-role="assistant"]',
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
      if (prev === -1) session.messageCount++;
      const delta = current - Math.max(prev, 0);
      if (delta > 0) {
        if (role === 'input') session.inputTokens  += delta;
        else                  session.outputTokens += delta;
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
  scanTimer = setTimeout(scan, 200);
}

const observer = new MutationObserver(scheduleScan);

function startObserving() {
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

setInterval(scan, 2000);

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  if (document.getElementById('eco-tracker-widget')) return;
  widgetEl = buildWidget();
  startObserving();
  scan();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ── SPA navigation handler ────────────────────────────────────────────────────

let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  nodeTokens.clear();
  session.inputTokens  = 0;
  session.outputTokens = 0;
  session.messageCount = 0;
  setTimeout(scan, 500);
}).observe(document, { subtree: true, childList: true });
