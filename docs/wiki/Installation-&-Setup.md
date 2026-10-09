# 🚀 Installation & Setup

## Prerequisites

- **macOS** 12.0 or later (Apple Silicon or Intel).
- **Hermes Desktop App** installed and running.
- **Python 3.10+** (uses standard library only, no extra `pip` packages required).

---

## 📥 Quick Installation

Run the automated installer script from your terminal:

```bash
git clone https://github.com/ronnhd/hermes-token-usage.git
cd hermes-token-usage
python3 install.py
```

### What the installer does:
1. Validates your local `$HERMES_HOME` (defaults to `~/.hermes`).
2. Copies the Desktop UI plugin to `~/.hermes/desktop-plugins/token-usage/`.
3. Creates a dedicated, isolated storage directory at `~/.hermes/token-usage-state/`.
4. Installs a background `LaunchAgent` (`com.ronnhd.hermes.token-usage`) configured to poll every 30 seconds.
5. Injects the required path configurations into `plugin.js`.

---

## ⚙️ Timezone Configuration

By default, token usage is aggregated in **UTC**. If you want calendar days, weeks (starting Monday), and months aligned with your local timezone (e.g., `Asia/Bangkok` for GMT+7), specify the `--timezone` flag during installation:

```bash
python3 install.py --timezone Asia/Bangkok
```

You can pass any valid IANA Timezone identifier (e.g., `America/New_York`, `Europe/London`, `Asia/Tokyo`).

---

## 🔄 Activating the Plugin in Hermes Desktop

After running `install.py`:

1. Open **Hermes Desktop**.
2. Press `Cmd + K` (or `Ctrl + K`) to open the Command Palette.
3. Select **Reload desktop plugins**.

The token chip (`D* ... · W* ... · M* ...`) will immediately appear on the bottom-right status bar of Hermes Desktop.

---

## 🗑️ Uninstallation

To completely remove the plugin and background collector while **preserving your accumulated token history**:

```bash
python3 uninstall.py
```

If you also want to delete all recorded token history:

```bash
python3 uninstall.py --purge-ledger
```
