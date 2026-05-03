/**
 * Background service worker — persists cumulative stats across sessions
 * and across browser restarts via chrome.storage.local.
 */

const DEFAULT_CUMULATIVE = {
  inputTokens:  0,
  outputTokens: 0,
  messageCount: 0,
  energy: 0, // kWh
  water:  0, // mL
  co2:    0, // g
  cost:   0, // USD
  sessionsCount: 0,
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('cumulative', (data) => {
    if (!data.cumulative) {
      chrome.storage.local.set({ cumulative: { ...DEFAULT_CUMULATIVE } });
    }
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'UPDATE_STATS') {
    persistStats(msg.session, msg.impact);
  }

  if (msg.type === 'RESET_SESSION') {
    // Session reset: bump session counter but keep cumulative totals intact
    chrome.storage.local.get('cumulative', (data) => {
      const c = data.cumulative || { ...DEFAULT_CUMULATIVE };
      c.sessionsCount = (c.sessionsCount || 0) + 1;
      chrome.storage.local.set({ cumulative: c });
    });
  }

  if (msg.type === 'GET_STATS') {
    chrome.storage.local.get(['cumulative', 'currentSession'], (data) => {
      sendResponse({
        cumulative:     data.cumulative     || { ...DEFAULT_CUMULATIVE },
        currentSession: data.currentSession || null,
      });
    });
    return true; // async response
  }
});

function persistStats(session, impact) {
  chrome.storage.local.get('cumulative', (data) => {
    const c = data.cumulative || { ...DEFAULT_CUMULATIVE };

    // Store the latest session snapshot (not additive — replace last snapshot)
    chrome.storage.local.set({ currentSession: { session, impact } });

    // Cumulative totals are the session values + whatever was there before
    // the session started. We track a "session baseline" to avoid double-counting.
    chrome.storage.local.get('sessionBaseline', (bData) => {
      const base = bData.sessionBaseline || {
        inputTokens: 0, outputTokens: 0, messageCount: 0,
        energy: 0, water: 0, co2: 0, cost: 0,
      };

      // Reset baseline when session tokens go backwards (i.e. user reset)
      const resetDetected =
        session.inputTokens  < (base.lastInput  || 0) ||
        session.outputTokens < (base.lastOutput || 0);

      if (resetDetected) {
        chrome.storage.local.set({
          sessionBaseline: {
            inputTokens:  c.inputTokens,
            outputTokens: c.outputTokens,
            messageCount: c.messageCount,
            energy: c.energy,
            water:  c.water,
            co2:    c.co2,
            cost:   c.cost,
            lastInput:  session.inputTokens,
            lastOutput: session.outputTokens,
          },
        });
        return;
      }

      c.inputTokens  = base.inputTokens  + session.inputTokens;
      c.outputTokens = base.outputTokens + session.outputTokens;
      c.messageCount = base.messageCount + session.messageCount;
      c.energy = base.energy + impact.energy;
      c.water  = base.water  + impact.water;
      c.co2    = base.co2    + impact.co2;
      c.cost   = base.cost   + impact.cost;

      chrome.storage.local.set({ cumulative: c });
    });
  });
}
