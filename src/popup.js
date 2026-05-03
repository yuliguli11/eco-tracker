/* Popup script — loads stats from background and renders them */

// ── Formatting (mirrors content.js) ──────────────────────────────────────────

function fmtEnergy(kWh) {
  if (kWh < 0.001) return [`${(kWh * 1e6).toFixed(1)}`, 'μWh'];
  if (kWh < 1)     return [`${(kWh * 1000).toFixed(2)}`, 'Wh'];
  return [`${kWh.toFixed(3)}`, 'kWh'];
}

function fmtWater(mL) {
  if (mL < 1)    return [`${(mL * 1000).toFixed(1)}`, 'μL'];
  if (mL < 1000) return [`${mL.toFixed(1)}`, 'mL'];
  return [`${(mL / 1000).toFixed(2)}`, 'L'];
}

function fmtCO2(g) {
  if (g < 1)    return [`${(g * 1000).toFixed(1)}`, 'μg'];
  if (g < 1000) return [`${g.toFixed(2)}`, 'g'];
  return [`${(g / 1000).toFixed(3)}`, 'kg'];
}

function fmtCost(usd) {
  if (usd < 0.0001) return '< $0.0001';
  return `$${usd.toFixed(4)}`;
}

function fmtTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ── Equivalents ───────────────────────────────────────────────────────────────

function buildEquivs(impact) {
  const items = [];

  // Energy: avg LED bulb = 0.01 kWh/hour
  const ledHours = impact.energy / 0.01;
  if (ledHours >= 0.01) {
    items.push({ icon: '💡', text: `Powers an LED bulb for ${fmtDuration(ledHours * 3600)}` });
  }

  // Water: avg sip = 15 mL
  const sips = impact.water / 15;
  if (sips >= 0.1) {
    items.push({ icon: '🥤', text: `≈ ${sips.toFixed(1)} sip${sips >= 2 ? 's' : ''} of water` });
  }

  // CO₂: avg tree absorbs ~21 kg/year = 0.0575 g/s
  const treeSeconds = impact.co2 / 0.0575;
  if (treeSeconds >= 1) {
    items.push({ icon: '🌳', text: `A tree absorbs this CO₂ in ${fmtDuration(treeSeconds)}` });
  }

  // Smartphone charge = ~0.012 kWh
  const phoneCharges = impact.energy / 0.012;
  if (phoneCharges >= 0.01) {
    items.push({ icon: '📱', text: `${(phoneCharges * 100).toFixed(1)}% of a phone charge` });
  }

  if (items.length === 0) {
    items.push({ icon: '🌱', text: 'Impact is very small — keep chatting!' });
  }

  return items;
}

function fmtDuration(seconds) {
  if (seconds < 60)   return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(2)} hr`;
}

function renderEquivs(listEl, impact) {
  const items = buildEquivs(impact);
  listEl.innerHTML = items.map(({ icon, text }) =>
    `<li><span class="equiv-icon">${icon}</span>${text}</li>`
  ).join('');
}

// ── Render functions ──────────────────────────────────────────────────────────

function renderSession(session, impact) {
  if (!session || !impact) {
    ['s-cost','s-energy','s-water','s-co2'].forEach(id => {
      document.getElementById(id).textContent = '$0 / 0';
    });
    return;
  }

  document.getElementById('s-cost').textContent = fmtCost(impact.cost);

  const [ev, eu] = fmtEnergy(impact.energy);
  document.getElementById('s-energy').textContent = ev;
  document.getElementById('s-energy-sub').textContent = eu;

  const [wv, wu] = fmtWater(impact.water);
  document.getElementById('s-water').textContent = wv;
  document.getElementById('s-water-sub').textContent = wu;

  const [cv, cu] = fmtCO2(impact.co2);
  document.getElementById('s-co2').textContent = cv;
  document.getElementById('s-co2-sub').textContent = cu;

  // Token bars
  const total = (session.inputTokens || 0) + (session.outputTokens || 0);
  const inputPct  = total > 0 ? (session.inputTokens  / total) * 100 : 0;
  const outputPct = total > 0 ? (session.outputTokens / total) * 100 : 0;

  document.getElementById('s-bar-input').style.width  = inputPct  + '%';
  document.getElementById('s-bar-output').style.width = outputPct + '%';
  document.getElementById('s-tok-input').textContent  = fmtTokens(session.inputTokens  || 0);
  document.getElementById('s-tok-output').textContent = fmtTokens(session.outputTokens || 0);

  renderEquivs(document.getElementById('s-equivs'), impact);
}

function renderCumulative(cumulative) {
  if (!cumulative) return;

  document.getElementById('c-cost').textContent = fmtCost(cumulative.cost || 0);

  const [ev, eu] = fmtEnergy(cumulative.energy || 0);
  document.getElementById('c-energy').textContent = ev;
  document.getElementById('c-energy-sub').textContent = eu;

  const [wv, wu] = fmtWater(cumulative.water || 0);
  document.getElementById('c-water').textContent = wv;
  document.getElementById('c-water-sub').textContent = wu;

  const [cv, cu] = fmtCO2(cumulative.co2 || 0);
  document.getElementById('c-co2').textContent = cv;
  document.getElementById('c-co2-sub').textContent = cu;

  renderEquivs(document.getElementById('c-equivs'), {
    energy: cumulative.energy || 0,
    water:  cumulative.water  || 0,
    co2:    cumulative.co2    || 0,
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.panel).classList.add('active');
  });
});

// ── Load data ─────────────────────────────────────────────────────────────────

chrome.runtime.sendMessage({ type: 'GET_STATS' }, (response) => {
  if (!response) return;
  const { cumulative, currentSession } = response;
  renderSession(currentSession?.session, currentSession?.impact);
  renderCumulative(cumulative);
});
