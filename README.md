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
