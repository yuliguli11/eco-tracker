# 🌿 Eco Tracker for Claude

A Chrome extension that shows a floating real-time widget on **claude.ai** tracking the environmental and financial cost of your AI usage.

## What it tracks

| Metric | Method |
|--------|--------|
| 💰 **Cost** | Token-based estimate (Claude claude-sonnet-4-6 pricing) |
| ⚡ **Energy** | ~0.002 kWh per 1K tokens (LLM inference benchmark) |
| 💧 **Water** | ~10 mL per 1K tokens (data-centre cooling) |
| ☁️ **CO₂** | ~0.47 g per 1K tokens (US grid average) |

Token counts are estimated from message text (≈ 4 characters per token).

## Features

- **Floating widget** — stays on screen while you chat, draggable, collapsible
- **Live updates** — refreshes as the assistant streams its response
- **Popup panel** — detailed session stats, all-time totals, token breakdown, and real-world equivalents (LED bulb hours, phone charge %, tree absorption time)
- **Session reset** — clear the current session without losing cumulative history
- **Persistent storage** — totals survive browser restarts

## Install (developer mode)

1. Clone or download this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select this folder
5. Visit [claude.ai](https://claude.ai) — the widget appears bottom-right

## Project structure

```
eco-tracker/
├── manifest.json          Chrome MV3 manifest
├── src/
│   ├── content.js         DOM observer + floating widget
│   ├── widget.css         Widget styles
│   ├── background.js      Service worker — data persistence
│   ├── popup.html         Extension popup UI
│   ├── popup.js           Popup data/rendering logic
│   └── icons/             PNG icons (16, 48, 128 px)
└── scripts/
    └── gen-icons.js       Icon generator (no external deps)
```

## Environmental estimates

Estimates are derived from:
- Li et al. (2023) — *Making AI Less Thirsty* (water usage)
- Patterson et al. (2022) — *The Carbon Footprint of Machine Learning Training*
- IEA grid CO₂ intensity, US average 2023 (0.233 kg CO₂/kWh)

> **Disclaimer:** These are approximations. Actual values vary by data centre location, model size, hardware generation, and grid energy mix.
