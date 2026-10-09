# Hermes Token Usage

Experimental **v0.1** local token ledger for the native [Hermes Desktop](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk). Free to use, modify and share under MIT. Not an official Nous Research plugin.

A compact D/W/M status-bar chip and detail page show observed day / Monday week / calendar month increments. **Providers** (default) aggregates all models/tasks/modes per exact provider/endpoint identity in collapsible profile sections; **Top models** ranks the top five exact model identifiers across the selected profiles/providers, with a Show all toggle and expandable distribution. Both share period and profile filters. Cache buckets, reasoning, raw IDs, route evidence and attribution candidates appear only on expansion. This reads **this Mac**, not the currently selected remote gateway.

Shares use **all confirmed selected tokens** as the denominator, including Unattributed and legacy/missing-model usage. Legacy/missing-model tokens are excluded from model ranking and disclosed separately with their amount and share; model shares may sum to less than 100%. Zero-token rows are hidden without deleting evidence. Coverage/history/boundary warnings stay in a one-line expandable summary. The chip abbreviates K/M; its tooltip retains full counts.

## Requirements and scope

- macOS, a logged-in GUI session, Hermes Desktop with `@hermes/plugin-sdk`, React Query, and `window.hermesDesktop.readFileText`.
- Python 3.9+ with SQLite and IANA timezone data (`zoneinfo`). Invalid or unavailable zones fail explicitly; default is UTC.
- Local `state.db` databases with `session_model_usage` containing the columns in `backend.py` (`KEYS`, `COUNTERS`, `first_seen`). Unsupported/missing databases are marked unavailable, not migrated.
- No runtime npm install, server, API key or gateway restart. Node 24+ and npm are only needed for UI checks.

Automatic installation/scheduling targets macOS only. The collector and file-only installer can run on POSIX platforms with Python `fcntl` and timezone data; **Linux desktop integration and automatic Linux scheduling are not supported or verified**. Windows is not supported.

## Install

Review the code first. From this repository:

```sh
python3 install.py --dry-run
python3 install.py --timezone America/New_York
```

Use your preferred IANA timezone, or omit the flag for UTC. `HERMES_TOKEN_USAGE_TIMEZONE` supplies a default; the argument takes precedence. The installer writes a literal local `{summaryPath, timezone}` configuration into a copy of `plugin.js`; the repository placeholder `__HERMES_TOKEN_USAGE_CONFIG__` is a documented template, not a usable installed configuration. Do not copy the template directly into Desktop.

Hermes home defaults to `$HERMES_HOME` or `~/.hermes`. To collect the root and its child profiles, explicitly choose that root (an active named profile's `$HERMES_HOME` may point elsewhere):

```sh
python3 install.py --hermes-home "$HOME/.hermes" --timezone UTC
```

Files written:

- `<hermes-home>/desktop-plugins/token-usage/{plugin.js,backend.py,.token-usage-install.json}`
- `<hermes-home>/token-usage-state/` for private ledger, summary, lock and logs
- `~/Library/LaunchAgents/io.github.hermes-token-usage.collector.plist`

The LaunchAgent runs at load and every 30 seconds using the installing Python interpreter's absolute path. Keep that interpreter installed. Logs are local and not rotated automatically. A lock prevents overlapping collectors. The first successful read baselines existing rows; the first view may show zero increments.

Desktop normally hot-loads disk plugins; if needed use **Reload desktop plugins** in the command palette. It contributes a status chip, **Token Usage** sidebar page and palette command. A previously disabled plugin may need enabling in Desktop settings.

The installer refuses any existing plugin directory or scheduled plist; it does not overwrite or upgrade your current installation. Move an older unmanaged plugin yourself after backing it up; this installer does not import old ledgers. Never remove a running collector's files without first stopping its own scheduler.

## Manual collection / other POSIX platforms

```sh
python3 install.py --no-launchd --hermes-home "$HOME/.hermes" --timezone UTC
python3 "$HOME/.hermes/desktop-plugins/token-usage/backend.py" \
  --hermes-home "$HOME/.hermes" \
  --data-dir "$HOME/.hermes/token-usage-state" --timezone UTC
```

The collector performs one sample and exits. Run it repeatedly with your own scheduler if desired; no scheduler is created with `--no-launchd`. The UI expects the installer's configured summary path. The sampling interval mentioned in the UI assumes the default 30-second LaunchAgent, not arbitrary manual scheduling. Without `--data-dir`, standalone `backend.py` uses its sibling `data/` directory, which will **not** match the installer-generated UI path.

Profiles are dynamically discovered as root `default` plus non-symlink immediate directories under `<hermes-home>/profiles/`. Names are not renamed or guessed. A child literally named `default` is rejected because it conflicts with the root identity. Symlink profile directories are intentionally skipped. Missing, unreadable and removed profiles retain ledger history and show failure status.

## Uninstall and rollback

```sh
python3 uninstall.py --dry-run
python3 uninstall.py
# For a file-only installation:
python3 uninstall.py --no-launchd
```

Supply the same `--hermes-home` used at installation. Uninstall verifies a versioned ownership marker and file hashes before removing **only** the installed plugin and its owned LaunchAgent. It refuses changed files, unexpected additions and symlink paths. No recursive removal is used. If files were edited, restore them from your reviewed version or remove them manually after inspecting and stopping the scheduler.

The ledger, snapshot and logs are **preserved by default**, including on installer rollback. Reinstallation at the same home resumes that ledger. Delete private state yourself only after stopping collection and deciding to reset history. A failed LaunchAgent bootstrap rolls back newly installed plugin/plist files, leaving state intact. There is no migration of Hermes databases or configuration and no automatic production restart.

## What the numbers mean

- These are **observed positive deltas since the first successful baseline**, not complete day/week/month totals or per-call historical reports. No historical totals are inferred from cumulative rows or `last_seen`.
- Full compound keys include session, model, provider, base URL, billing mode and task. New deltas retain model, provider, endpoint, billing mode and task; display labels never change snapshot keys or add usage. Missing IDs without endpoint evidence remain `Unknown`. No model-to-provider guessing.
- Total = canonical uncached input + output + cache read + cache write. Reasoning is an **output subset**, never added twice. This assumes Hermes stores normalized canonical counters; older/different accounting schemas may not be compatible. Counts are not invoices, API cost estimates or subscription charges.
- New historical/imported rows are baselined; rows with `first_seen` after the prior successful profile observation contribute their initial counters. Any counter decrease rebaselines the entire row and increments an anomaly count. Rows deleted between polls cannot be recovered.
- Interval bounds span prior pre-read to current post-read observation. Intervals crossing the timezone's calendar boundary are reported separately as **boundary-ambiguous**, excluded from confirmed totals. Calendar boundaries use Python `ZoneInfo`, including DST offset changes; week starts Monday, month starts on day 1.
- Sleep, outages and delayed database persistence widen intervals. Observation times are not exact API execution times. System clock changes can affect attribution. Changing timezone recomputes calendar attribution from the same ledger, not new history.
- Source read failures preserve prior ledger counts. UI reports partial/error and stale snapshots (older than 95 seconds), with no remote fallback. Rotated logs, session-only legacy usage and unpersisted calls are not read.

## Provider labels and older ledgers

Labels are **local-only**, derived separately for each source profile from its sibling `config.yaml`. Modern `providers` dictionaries and legacy `custom_providers` lists/dictionaries are supported. An explicitly named stored provider ID wins and survives config removal. Generic `custom`/missing IDs match only a unique exact normalized full endpoint (scheme/host case, default port and trailing slash normalized). Shared endpoint aliases are listed as candidates, never assigned by model family. Unmatched/ambiguous endpoints display origin plus an opaque provider fingerprint; URLs containing userinfo, path, query or fragment secrets are never rendered in full. Model, mode and task remain distinct evidence route dimensions.

Provider display grouping uses a separate opaque `provider_identity` derived from the exact raw provider ID, full raw endpoint and legacy marker, excluding model/task/mode. Different full endpoints remain separate even when labels or sanitized origins coincide; alias matching normalization is not used to merge usage. Raw endpoints remain private. Route identities and ledger keys are unchanged. Pre-update snapshots without `provider_identity` fail closed to separate route rows until refreshed, never merge by label. Unresolved IDs without endpoint evidence and legacy rows display **Unattributed**, separately from known providers.

PyYAML is optional: without it, collection and history still work with raw IDs/sanitized endpoints and a config-label warning. To enable labels, run the installer with a trusted Python that already has PyYAML (the scheduled collector uses that same interpreter), or create a dedicated environment:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install PyYAML
.venv/bin/python install.py --timezone UTC
# Full optional-label regressions:
.venv/bin/python checks/provider_checks.py
```

For manual collection with a standard-library-only Python, `backend.py --config-python /absolute/path/to/trusted/python` uses that interpreter solely for safe YAML parsing. Config parse/helper failures do not discard counts or replace snapshots with zero. No heuristic YAML parser is used. Invalid config falls back to raw route identity rather than retaining potentially stale alias assignments.

Existing plugin-ledger `deltas` are upgraded transactionally by adding a nullable `route` column. Existing rows/counts are untouched and displayed as **legacy route unidentified**; their endpoint/model/mode/task attribution was never retained and cannot be recovered from current snapshots. Legacy aggregates and newly observed route-specific deltas remain separate. Label changes recompute presentation without generating cumulative usage. Back up a running ledger using SQLite's backup API while holding its `collector.lock`; never copy a live DB without accounting for WAL or infer a historical endpoint from today's config. Source Hermes databases are not migrated.

## Privacy and permissions

No telemetry, external API requests, remote collection or cost lookup. The collector opens source SQLite databases with `mode=ro` and `PRAGMA query_only=ON`; it reads usage columns, not messages, and never intentionally edits source databases, configuration or profile identity. For optional labels it safely parses local profile configuration and selects only provider names and base URLs, never publishing credential fields or YAML error text. SQLite may manage its own WAL/shared-memory metadata; normal SQLite access permissions still apply.

Its own state directory is mode `0700`; newly created state/log files use umask `077`. The private ledger stores session IDs, model/provider IDs, billing base URLs, counters and observations; error messages can contain local paths. Treat it as private, especially if a billing URL includes sensitive material. Do not publish state, logs or real screenshots. Existing preserved state files are not re-permissioned individually. The UI uses the native file-read bridge only, so no new listening port is opened.

## Development checks

All database rows, usage snapshots, profile names and test homes are **synthetic fake fixtures generated by the checks**. No personal data is bundled. Tests use named temporary directories inside this repository and remove only their own generated artifacts.

```sh
python3 checks/backend_checks.py
python3 checks/provider_checks.py
python3 checks/installer_checks.py
npm ci --ignore-scripts
npm run check
```

Python checks cover dynamic discovery, read-only SQLite, baselines, compound keys, imported/new rows, resets, invalid counters, cache/reasoning totals, missing databases/profiles and DST calendars. Installer checks use isolated fake homes; launchctl is mocked for plist/rollback testing. UI checks syntax-check the plain ESM and mount actual React in jsdom using an SDK/native-bridge shim, including compact/full chip counts, provider/model conservation, exact identities, top-five/show-all ranking, shared period/profile filters, expandable evidence/distribution/coverage, zero hiding, missing-model denominator disclosure, navigation, refresh and stale/error handling. An explicit `TOKEN_USAGE_LOCAL_SNAPSHOT=/private/path/summary.json node checks/ui_checks.mjs` opt-in mounts a local real summary without copying it into the repository; never enable it in CI or publish its output. Dependencies are pinned in the lockfile and are development-only.

**Native Hermes window loading and real launchd activation are not validated by these checks.** Verify those independently on a consenting test installation. CI runs synthetic checks only; no production Hermes instance is required. Screenshots are intentionally not included until a real, sanitized capture is available.
