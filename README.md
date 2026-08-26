# Budget Planner

A self-hosted personal budget planner for a two-person household, built to replace
a hand-maintained Excel system (a monthly spending ledger + an 8-year cash projection).
Runs entirely on your machine at **http://localhost:2026**. Multi-user: every account
gets its own private database.

## Quick start

```bash
npm install
npm run build     # builds the web client into client/dist
npm start         # serves everything at http://localhost:2026
```

Open http://localhost:2026, create your account (username + password), and you're in.
Each account gets its own private database, pre-seeded with a clean, generic starter:
two accounts (bank + card), category groups, categories with zero budgets, and two
income sources — everything renameable. The first account created is the **admin**
and manages users on the Users page.

Development mode with hot reload: `npm run dev`.

## Install as a service (Debian/Ubuntu)

```bash
./scripts/build-deb.sh                       # → dist/budget-planner_<ver>_all.deb
sudo apt install ./dist/budget-planner_<ver>_all.deb
```

Runs as the system user `budget` via systemd, data in `/var/lib/budget-planner`,
port 2026 (override in `/etc/default/budget-planner`). To reuse data from a manual
install: stop the service, `sudo cp -a <old data>/. /var/lib/budget-planner/`,
`sudo chown -R budget:budget /var/lib/budget-planner`, start the service.
`sudo apt purge budget-planner` deletes the data directory; `remove` keeps it.

## Android app (client)

The APK is a **pure client** — no backend inside. On first launch it asks for your
server's address (LAN IP or Tailscale), remembers it, and loads the planner from there.

```bash
sudo apt install openjdk-21-jdk-headless     # once — needs a JDK, not just a JRE
./scripts/build-apk.sh                       # -> dist/budget-planner-android.apk
```

Install with `adb install` or by copying the APK to the phone (allow "unknown sources").

## Desktop client (Linux)

A client-only desktop app (Electron shell, no backend) that connects to your server:

```bash
./scripts/build-deb-client.sh                # -> dist/budget-planner-client_<ver>_amd64.deb
sudo apt install ./dist/budget-planner-client_<ver>_amd64.deb
```

Find "Budget Planner" in your application menu; enter the server address on first
launch. Stored per user in `~/.config/budget-planner-client/config.json`.

The server itself is the `budget-planner` package above — install it on exactly one
machine (home server, mini PC, ...); phones, tablets and desktops all connect as clients.

## The one-minute workflow

1. **Import** your bank statement (Revolut exports work out of the box; anything else,
   use "Analyze format with AI")
2. **Transactions → needs-review**: assign a category to each unknown merchant once —
   the app learns the rule and never asks again
3. **Dashboard** tells you the *transfer to Revolut* number and how the month compares
   to plan
4. Occasionally: enter real bank balances on **Balances**, actual income on **Income**,
   and check the **Projection**

## Documentation

- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — every page, button and section explained
- [`docs/MATH.md`](docs/MATH.md) — the exact formulas behind every number, so you can trust them

## Feature overview

- **Import** — CSV/XLSX (including Revolut's ".csv that is really Excel"). Only COMPLETED
  rows import; pendings from previous months count as completed; current-month pendings
  and REVERTED rows are skipped; duplicates blocked by date+amount+description.
- **AI file doctor** — any bank export: the AI detects columns/date/decimal format and
  converts it. Full preview before saving.
- **Learning categorization** — assigning a category once creates a keyword rule that
  also retro-fixes existing rows. Optional AI suggestions with per-item or bulk apply.
- **Budgets** — standing monthly plan per category + per-month overrides.
- **Sinking funds** — monthly accrual per fund, withdrawals when bills land, negative
  balance = warning.
- **Commitments** — dated obligations with end months; the projection stops charging
  them automatically.
- **Projection** — 96 months forward, free vs committed savings, re-anchored to real
  bank balances you enter.
- **AI chat** — read-only questions about your data (strictly SELECT-only queries).
- **AI dev mode** — proposes whitelisted changes as reviewable diffs; applies only on
  your explicit confirmation; fully audit-logged.
- **Multi-user** — username + password, separate SQLite database per user.

## Stack

Node.js (built-in `node:sqlite`), Express, React + Vite + Recharts.
No external database, no cloud, no telemetry.

## Roadmap

Release history lives in [`CHANGELOG.md`](CHANGELOG.md). Up next:

1. **Bank synchronization** — pull transactions directly from banks (GoCardless Bank
   Account Data, PSD2) or scheduled CSV watching; design depends on privacy preference
2. **Native packaging** — installable builds for Android (APK), Linux
   (Ubuntu/Debian `.deb`), macOS (.app/.dmg) and Windows (installer), wrapping the
   existing PWA so each platform gets a real app without app-store review
3. Ongoing: security hardening, performance, polish

## Data & backups

Everything lives in `data/`:
- `data/master.db` — user accounts and sessions
- `data/users/<username>.db` — that user's complete budget
- `data/users/<username>.db` files are plain SQLite; copy them to back up.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `2026` | HTTP port |
| `DATA_DIR` | `./data` | Where databases and uploads live |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | – | AI fallback if not set in Settings |

AI providers are configured per-user in Settings: OpenAI, Anthropic, OpenRouter, Groq,
DeepSeek, Mistral, Together, Ollama (local), LM Studio (local), or a custom
OpenAI-compatible endpoint.
