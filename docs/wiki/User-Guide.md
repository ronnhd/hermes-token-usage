# 📊 User Guide

The **Hermes Token Usage Ledger** user interface consists of two main components:
1. **Status Bar Chip** (Quick summary)
2. **Main Dashboard View** (Detailed breakdown with two tabs)

---

## 🟢 1. Status Bar Chip

Located at the bottom-right status bar of Hermes Desktop:

```text
D* 1.2M · W* 8.5M · M* 24.1M
```

- **D\***: Observed token delta for **Today** (Calendar Day).
- **W\***: Observed token delta for **This Week** (Monday to Sunday).
- **M\***: Observed token delta for **This Month** (1st to end of month).
- **Tooltip**: Hover over the chip to see exact token counts, collector status, and installation timestamp.
- **Click**: Opens the full Token Usage Dashboard.

> **Note on `*`**: The asterisk denotes that metrics represent observed increments since plugin installation, strictly avoiding artificial historical guessing.

---

## 📈 2. Main Dashboard View

Clicking the Status Bar Chip or navigating to `/token-usage` (also accessible via Command Palette `Cmd+K -> Token Usage: local ledger`) opens the main view.

### Shared Controls (Header)
- **Timeframe Selector**: Toggle between `Today`, `Week (Monday)`, and `Calendar Month`.
- **Profile Filter**: Filter metrics across `All profiles` or narrow down to a specific bot profile (e.g., `default`, `delta`, `zalo`).
- **Refresh Button**: Manually re-read the collector's latest local snapshot (`summary.json`).

---

### Tab 1: Providers (Default)

Organized into collapsible sections per bot profile. Each section aggregates all model calls made under a specific provider:

- **Provider Name / Endpoint**: Displays the resolved provider name (e.g., `OpenRouter`, `OpenAI`) or sanitized endpoint.
- **Token Count**: Total canonical tokens (Input + Output + Cache Read + Cache Write).
- **Share %**: Visual proportion bar showing the provider's share relative to total profile usage.
- **Expandable Details**: Click any provider row to reveal breakdown:
  - **Input Tokens** (Uncached)
  - **Output Tokens**
  - **Cache Read Tokens**
  - **Cache Write Tokens**
  - **Reasoning Tokens** *(Output subset, cleanly excluded from total)*
  - **API Call Count**

---

### Tab 2: Top Models

Global leaderboard ranking your most-used LLM models across all profiles and providers within the selected timeframe:

- **Top 5 Ranking**: Displays the 5 heaviest models by total canonical tokens.
- **Show All Toggle**: Expand to view all models.
- **Model Distribution**: Click on any model row to see a breakdown of which profiles and providers called that model.
- **Unattributed Tokens Disclosure**: Clear, transparent accounting of any legacy or missing-model tokens excluded from model ranking.
