# Welcome to the Hermes Token Usage Ledger Wiki

**Hermes Token Usage Ledger** is an open-source, local-first Desktop plugin and background collector for [Hermes Agent](https://github.com/NousResearch/hermes-agent). It provides real-time token tracking across multiple bot profiles and LLM providers—with zero API keys, zero network overhead, and strict read-only database isolation.

---

## 📚 Table of Contents

- [🚀 Installation & Setup](./Installation-&-Setup) — How to install, configure timezones, and uninstall.
- [📊 User Guide](./User-Guide) — How to use the Status Bar Chip, Providers Tab, and Top Models Tab.
- [🔒 Architecture & Data Privacy](./Architecture-&-Data-Privacy) — Technical details on SQLite read-only collection, delta accounting, and privacy guarantees.
- [❓ FAQ & Troubleshooting](./FAQ-&-Troubleshooting) — Answers to common questions and troubleshooting steps.

---

## Key Features

- **Multi-Profile Aggregation**: Dynamically discovers all active Hermes profiles (e.g., `default`, `delta`, `zalo`, `lotus`, etc.) and aggregates token usage.
- **Provider & Endpoint Disambiguation**: Resolves profile-local provider aliases (e.g., OpenRouter, OpenAI, Custom endpoints) while preserving raw route integrity.
- **Top Models Breakdown**: Global ranking of your most-used models across all providers with interactive profile distribution.
- **Accurate Token Metrics**: Tracks Input, Output, Cache Read, Cache Write, and Reasoning tokens accurately without double-counting.
- **100% Local & Secure**: Operates entirely on your Mac via SQLite `mode=ro`. Never transmits telemetry, credentials, or prompts anywhere.
