# Budget Planner

A self-hosted, local-first budget planner. Your financial data lives in plain SQLite
files on **your** machine — no cloud, no accounts with third parties, no telemetry.
Multi-user: every account gets its own private database. The web UI works on any
device, and native Android/Linux clients are available.

**Highlights:** bank-statement import with bulletproof duplicate protection · learning
categorization · budgets with rollover · sinking funds · a 96-month projection that
re-anchors to reality · multi-currency reporting · automatic month-end snapshots ·
optional AI assistant (works with local models too).

## Install

**Recommended — one line on any Debian/Ubuntu machine:**

```bash
curl -fsSL https://raw.githubusercontent.com/HamidrezaTg/budget-planner/main/scripts/install.sh -o /tmp/bp-install.sh && bash /tmp/bp-install.sh
```

The installer downloads the latest release, checks Node.js ≥ 22 (and offers to set it
up if missing), and installs a systemd service running as the unprivileged system user
`budget` with data in `/var/lib/budget-planner` (port 2026, configurable via
`/etc/default/budget-planner`).

**Prefer not to pipe scripts?** Download `budget-planner_<version>_all.deb` from
[Releases](https://github.com/HamidrezaTg/budget-planner/releases) and run:

```bash
sudo apt install ./budget-planner_<version>_all.deb
```

Then open `http://<server-ip>:2026`, create your account (the first account becomes
the admin), and you're in. `sudo apt remove budget-planner` keeps your data;
`purge` deletes it.

### Clients (optional)

The server is the only component with a backend. Phones, tablets and desktops connect
to it as clients — over your LAN or a VPN such as Tailscale:

- **Android** — download `budget-planner-android.apk` from
  [Releases](https://github.com/HamidrezaTg/budget-planner/releases) and sideload it.
  On first launch it asks for the server's address — use the **IP form**
  (`http://192.168.x.x:2026`; computer names rarely resolve on phones), it verifies
  reachability, remembers it, and auto-connects from then on. If the server is
  unreachable, the app offers **Try again** and **Change server address**.
  (A PWA install via "Add to Home Screen" works too.)
- **Linux desktop (Tauri v2)** — download `budget-planner-client_<version>_amd64.deb`
  or the matching `.AppImage` from Releases. On first launch it asks for the server
  address, verifies the `/.well-known/budget-planner` discovery endpoint, and
  remembers it (up to ten servers, switchable from the picker). The package
  contains no backend.
- **Build the clients yourself** with `scripts/build-apk.sh` (Android, needs a JDK),
  `scripts/build-tauri-client.sh` (Linux), or `npm run tauri:build` inside
  `desktop-client-tauri/` (macOS/Windows; needs Rust + Node.js ≥ 22).

Connection problems (phone can't reach the server, wrong account list, hostname
traps): see [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

## Running from source

Requires Node.js ≥ 22 (for the built-in `node:sqlite`).

```bash
npm install
npm run build     # builds the web client into client/dist
npm start         # serves everything at http://localhost:2026
npm run dev       # development mode with hot reload
```

## The one-minute workflow

1. **Import** a bank statement (Revolut exports work out of the box; any other format
   via "Analyze format with AI"). Re-importing or overlapping files never creates
   duplicates.
2. **Transactions → needs review**: assign a category to each unknown merchant once —
   the app learns the rule, retro-fixes old rows, and never asks again.
3. The **Dashboard** tells you the amount to move to your spending account and how the
   month compares to plan.
4. Occasionally: enter real bank balances on **Balances**, actual income on **Income**,
   and glance at the **Projection**.

## Features

- **Import engine** — CSV/XLSX (including Revolut's ".csv that is really Excel");
  only COMPLETED rows import; pendings and REVERTED rows handled; duplicates blocked
  by fingerprint at the database level
- **Learning categorization** — keyword rules learned from assignments, plus advanced
  rules (amount range, account, type, priority) and a read-only rule tester
- **Budgets** — standing monthly plan per category, per-month overrides, optional
  rollover of underspend
- **Sinking funds** — monthly accrual, goal targets with on-track/overdue tracking,
  movement ledger
- **Commitments** — dated obligations (loans, instalments) that drop out of the
  projection at their end month
- **Projection** — 96 months forward, free vs committed savings, re-anchored to real
  bank balances you enter so drift never compounds silently
- **Multi-currency** — transactions keep their statement currency; monthly reference
  rates convert reporting to your display currency (manual rates or one-click ECB data)
- **Scheduled month-end reports** — closed months are snapshotted automatically and
  frozen forever, plus CSV and Excel exports with raw statement values
- **Attachments** — receipts and documents per transaction, stored locally
- **AI assistant (optional)** — category suggestions, a file-format doctor for
  arbitrary bank exports, read-only chat over your data, and dev-mode change
  proposals that apply only on your explicit confirmation — fully audit-logged;
  works with local models (Ollama, LM Studio)
- **Accounts & people** — manage bank accounts, cards, cash, spending pots, opening
  balances, and the people attached to income sources
- **Multi-user** — username + password, one private SQLite database per user,
  admin user management, and safe username changes

## Privacy & data ownership

- Everything lives in `data/` on your machine: `data/master.db` (accounts, sessions)
  and `data/users/<username>.db` (that user's entire budget). Plain SQLite — copy the
  files to back up, or use **Settings → Download full backup**.
- The app phones home to nobody. The only optional outbound requests are AI providers
  *you* configure, the ECB exchange-rate service (dates and currency codes only), and
  your own banks' statement files.
- Backups restore cleanly onto a fresh install — that's the migration path to a new
  server.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `2026` | HTTP port |
| `DATA_DIR` | `./data` | Where databases and uploads live |
| `BIND_IP` | all interfaces | Listen address (`127.0.0.1` for localhost-only) |
| `SECURE_COOKIE` | off | Set to `1` when serving behind HTTPS so session cookies are marked `Secure` |
| `TRUST_PROXY` | off | Set to `1` when behind a reverse proxy (for correct client IPs/rate limiting) |
| `SETUP_TOKEN` | – | Optional token in `X-Setup-Token` for first-run setup from a non-localhost address |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | – | AI fallback if not set in Settings (`AI_MODEL` defaults to `gpt-4o-mini`) |

AI providers are configured per user in Settings: OpenAI, Anthropic, OpenRouter,
Groq, DeepSeek, Mistral, Together, Ollama (local), LM Studio (local), or any custom
OpenAI-compatible endpoint. Everything is optional — the planner is fully usable
without any AI.

## Security

- **Passwords**: at least **8 characters**; hashed with salted scrypt (async, so it
  never blocks the server). All sessions are invalidated when you change your password.
- **Login protection**: attempts are rate-limited per IP and username; setup is
  rate-limited too and limited to localhost unless `SETUP_TOKEN` is supplied.
  Session cookies are `HttpOnly` + `SameSite=Lax` and expire server-side after 30 days.
- **Headers**: strict Content-Security-Policy (allows the app's inline theme
  preloader via its hash), `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy` and `Permissions-Policy`; `X-Powered-By` is disabled.
  Production responses never leak stack traces; every response carries an
  `X-Request-Id` for matching server log lines (see Troubleshooting).
- **Liveness**: `GET /healthz` answers without authentication for systemd and
  uptime monitors.
- **Downloads**: the installer verifies artifacts against the release's
  `SHA256SUMS.txt` before installing.
- **AI safety**: the assistant's read-only SQL can only touch budget tables —
  `settings` (your AI API key) and audit internals are unreachable.
- **Import safety**: uploads are size-limited, dates are validated as real calendar
  dates, and statement files are deleted after import.

**Transport.** The server speaks plain HTTP by design (home LAN/Tailscale). On a
hostile network (public Wi-Fi, the open internet) that exposes passwords and session
cookies, so prefer one of:

1. localhost-only (`BIND_IP=127.0.0.1`) for single-machine use;
2. a private VPN such as Tailscale for devices anywhere;
3. an HTTPS reverse proxy (e.g. Caddy) in front of the server — set
   `SECURE_COOKIE=1` and `TRUST_PROXY=1` in `/etc/default/budget-planner`.

**Tailscale phone setup.** Install Tailscale on both the server machine and the
phone, then enter the server's Tailscale IP (`100.x.y.z`) or MagicDNS hostname in
the Android app. Keep the planner port in the address, for example
`http://100.x.y.z:2026`. The Android shell remembers up to ten server addresses,
so LAN and Tailscale endpoints can coexist.

## Documentation

- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — every page, button and section explained
- [`docs/MATH.md`](docs/MATH.md) — the exact formulas behind every number, so you can trust them
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — service won't start, devices can't connect, odd totals
- [`CHANGELOG.md`](CHANGELOG.md) — release history

## Roadmap

- Bank synchronization via GoCardless Bank Account Data (PSD2) — optional alongside
  the hardened manual import
- macOS and Windows desktop clients
- Ongoing: security hardening, performance, polish

## Contributing & license

Issues and pull requests are welcome. Licensed under [MIT](LICENSE).
