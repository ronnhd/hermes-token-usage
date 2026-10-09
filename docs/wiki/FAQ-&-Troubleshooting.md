# ❓ FAQ & Troubleshooting

## Frequently Asked Questions

### 1. Why does my token count start from zero after installation?
Hermes profile databases store cumulative totals per session/model rather than individual call timestamps. To prevent inaccurate backfilling or guessing historical execution times, the plugin baselines pre-existing rows at the moment of installation and records **observed positive deltas** going forward.

### 2. Does this plugin cost money or consume API credits?
**No.** The plugin runs 100% locally on your machine. It reads local SQLite databases and makes zero API requests to LLM providers or external servers.

### 3. How do I change the aggregation timezone?
Run the installer script with your preferred IANA timezone name:
```bash
python3 install.py --timezone America/New_York
```
Supported values include any standard IANA timezone name (e.g., `Asia/Bangkok`, `Europe/London`, `UTC`).

---

## Troubleshooting

### Issue: Status chip shows `Tokens ⚠` or `STALE`

**Cause**: The background collector process (`backend.py`) hasn't updated `summary.json` in over 95 seconds.

**Fix**:
1. Check if the LaunchAgent background job is running:
   ```bash
   launchctl list | grep com.ronnhd.hermes.token-usage
   ```
2. Check collector logs for errors:
   ```bash
   cat ~/.hermes/token-usage-state/collector-error.log
   ```
3. Manually trigger a collection run to test:
   ```bash
   python3 ~/.hermes/token-usage-state/backend.py
   ```

### Issue: Status chip isn't showing up in Hermes Desktop

**Fix**:
1. Open Hermes Desktop.
2. Press `Cmd + K` -> select **Reload desktop plugins**.
3. Ensure the plugin directory exists under `~/.hermes/desktop-plugins/token-usage/`.
