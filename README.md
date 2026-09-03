# Budget Planner

Budget Planner is a self-hosted, local-first budget planner for people who want
their financial data on their own server. It stores each user's budget in a
private SQLite database and has no required cloud account, advertising, or
telemetry service.

The server is the source of truth. The browser, Android app, iOS shell, and Tauri
desktop clients are user interfaces that connect to the server.

## What It Does

- Imports CSV, XLS, XLSX, PDF, JPG, and PNG bank statements with preview-first
  confirmation, selectable saved-template reuse, and database-level duplicate protection.
- Learns merchant categorization rules and supports advanced rules, rule testing,
  AI category suggestions, splits, attachments, and transfer pairing.
- Plans monthly budgets with standing plans, one-month overrides, account
  assignments, and optional underspend rollover.
- Tracks recurring income/expenses, sinking funds with goals, dated commitments,
  actual income, and account balance observations.
- Shows a 96-month projection that re-anchors from observed bank balances and
  avoids double-counting commitments.
- Reports monthly/yearly totals, category trends, account-filtered views, charts,
  browser PDF printing, CSV/XLSX exports, and frozen month-end history.
- Supports multi-currency transactions with monthly reference rates and preserved
  original statement amounts.
- Offers optional local or hosted AI for format analysis, read-only finance chat,
  and explicit, reviewable change proposals.
- Provides per-user backups, restore validation, read-only sharing links, ntfy
  warning notifications, account-synchronized themes, privacy mode, and
  administrator user management. Native mobile clients support trusted local/VPN HTTP
  with an explicit warning; HTTPS remains recommended outside private networks.

## Install the Server

### Debian or Ubuntu: recommended installer

Requires Node.js 22 or newer. The installer downloads the latest GitHub release,
verifies the release checksum, installs the server and systemd service, and stores
data in `/var/lib/budget-planner`.

```bash
bash <(curl -fsSL https://github.com/HamidrezaTg/budget-planner/releases/latest/download/budget-planner-install.sh)
```

The interactive installer asks whether to install local OCR tools. Use
`--ocr none`, `--ocr pdf`, or `--ocr full` for unattended installs, and
`--data-dir /absolute/path` to place the server data elsewhere. Custom data paths
are added to the systemd write sandbox automatically. To migrate a complete server,
use `--restore-server-data /absolute/path` where the source contains `master.db` and
`users/`; the installer validates the SQLite files and retains the old destination
before swapping it.

When upgrading an existing installation and only changing the listen address or port,
answer `y` to reconfigure and then choose **Network only**. The current database and
all other settings are kept. If you choose the full reconfiguration path, the database
step explicitly offers **Keep the existing database** or **Restore a complete server-data
directory**. Leaving the restore choice at its default keeps the current database; it
only creates a new database when the selected data directory is empty.

The default port is `2026`. Open `http://<server-ip>:2026` in a browser, create the
first account, and follow the setup path in the [User Guide](docs/USER_GUIDE.md).
The first account becomes the administrator.

The Debian package also installs the `budget-planner` administration CLI:

```bash
sudo budget-planner status
sudo budget-planner doctor
sudo budget-planner backup create
```

Run `budget-planner --help` for user management, configuration, logs, backup listing,
and validated restore commands. Restores require an explicit confirmation and retain
the previous data directory.

### Install a release package manually

Download `budget-planner-server_<version>_all.deb` from
[GitHub Releases](https://github.com/HamidrezaTg/budget-planner/releases), then run:

```bash
sudo apt install ./budget-planner-server_<version>_all.deb
```

The package keeps OCR tools optional. Install `poppler-utils` for PDF extraction and
`tesseract-ocr` as well for scanned PDFs and JPG/PNG statement images. CSV/XLSX imports
work without either package.

Removing the package keeps data. Purging the package deletes packaged application
data; make a backup first.

### Run from source

Node.js 22 or newer is required because the server uses built-in `node:sqlite`.

```bash
npm install
npm run build
npm start                 # http://localhost:2026
npm run dev               # server plus Vite hot reload
```

Useful checks:

```bash
npm test
npm run test:e2e
npm run lint
npm run format:check
```

## Connect Other Devices

Clients contain no backend and do not copy the database. They connect to the
server address entered on first launch.

- **Browser/PWA:** use the server URL in a trusted LAN, localhost, VPN, or HTTPS
  reverse proxy. A PWA caches the application shell, not financial API data.
- **Android:** download `budget-planner-android.apk` from
  [Releases](https://github.com/HamidrezaTg/budget-planner/releases) and sideload it.
  Enter `http://192.168.x.x:2026` for a trusted LAN, `http://100.x.y.z:2026` for a
  trusted Tailscale network, or an `https://` endpoint. The app warns before saving
  HTTP because it is unsafe on untrusted networks. It remembers up to ten server
  addresses.
- **Linux desktop:** download the matching `.deb` or `.AppImage`, or install the
  AUR package. The Tauri client remembers up to ten servers and contains no backend.
- **macOS desktop:** download the matching unsigned arm64 DMG, drag the app to
  Applications, and use [macOS installation](docs/INSTALL_MAC.md) if Gatekeeper
  blocks the first launch.
- **iOS:** the Capacitor shell is scaffolded and validated in CI; App Store
  distribution still requires Apple signing and provisioning.

See [Mobile Clients](docs/MOBILE_CLIENTS.md), [Desktop Client](docs/DESKTOP_CLIENT.md),
and [Troubleshooting](docs/TROUBLESHOOTING.md) for client-specific details.

## Recommended First Setup

1. Create the first user and sign in.
2. Add real accounts, currencies, and opening balances in **Accounts**.
3. Create groups and categories, assign paying accounts, and set standing plans.
4. Add income sources, usual amounts, scheduled items, funds, and commitments.
5. Import a statement and inspect the full preview before confirming it.
6. Review unknown transactions, transfers, duplicates, and attachments.
7. Enter actual income and observed balances as the month progresses.
8. Use Dashboard for the monthly check-in, then Projection and Reports for planning.

On the Import page, choose **Reuse matching saved templates** for known CSV exports,
or **Start fresh and ignore saved templates** when you want the file checked without
applying an earlier mapping. AI-approved mappings remain available for later imports.

The complete, searchable guide is available publicly at `/help`, including before
login, and in [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md).

## Data, Privacy, and Backups

The default source-install data directory is `data/`; the packaged service uses
`/var/lib/budget-planner`:

- `master.db` stores server-level users and sessions.
- `users/<username>.db` stores that user's budget, settings, and planning data.
- `uploads/<username>/` stores transaction attachments outside SQLite.

Use **Settings → Download full backup** before upgrades. That download contains the
user database only. For a complete migration, copy the matching uploads directory
too. Restore validates the SQLite file, creates a pre-restore copy, and rolls back a
failed restore.

Budget Planner does not require outbound services. Optional outbound requests are
limited to AI providers you configure, ECB/Frankfurter exchange-rate data, ntfy if
you configure it, and the GitHub release check shown in Settings. Statement files
are processed and removed after import.

## Configuration

Packaged installs read `/etc/default/budget-planner`. Source installs can use shell
environment variables.

| Variable          | Default       | Purpose                                                                                 |
| ----------------- | ------------- | --------------------------------------------------------------------------------------- |
| `PORT`            | `2026`        | HTTP listening port                                                                     |
| `DATA_DIR`        | `./data`      | Database and upload directory                                                           |
| `BIND_IP`         | `127.0.0.1`   | Loopback only; set `0.0.0.0` or an interface IP to expose the server                    |
| `SECURE_COOKIE`   | auto          | Set to `1` to force the Secure cookie flag; automatic behind HTTPS with `TRUST_PROXY=1` |
| `TRUST_PROXY`     | off           | Set to `1` behind a trusted reverse proxy                                               |
| `METRICS_ENABLED` | off           | Expose unauthenticated `/metrics` counters                                              |
| `SETUP_TOKEN`     | unset         | `X-Setup-Token` required for remote first-run setup                                     |
| `AI_BASE_URL`     | unset         | Optional server-level AI fallback URL                                                   |
| `AI_API_KEY`      | unset         | Optional server-level AI fallback key                                                   |
| `AI_MODEL`        | `gpt-4o-mini` | Optional server-level AI fallback model                                                 |

The server binds to loopback by default so financial data is never exposed
accidentally. To reach it from other devices, either set `BIND_IP` explicitly or
(Recommended) keep it local and put Tailscale Serve or an HTTPS reverse proxy in
front — see [HTTPS With Caddy](docs/HTTPS_CADDY.md) and set `TRUST_PROXY=1` so
session cookies gain the `Secure` flag automatically. Do not expose plain port
`2026` directly to the internet. Administrators can also restrict the server's
outbound requests (AI and ntfy endpoints) to an allowlist in Settings.

## Security Model

- Passwords require at least eight characters and are hashed with salted scrypt.
- Login and setup attempts are rate-limited. Sessions are HttpOnly, SameSite=Lax,
  and expire server-side after 30 days.
- Security headers include a strict Content-Security-Policy, frame and MIME
  protection, Referrer-Policy, and Permissions-Policy.
- The server binds to loopback by default; LAN or remote exposure is explicit
  (`BIND_IP`) and is expected to run behind Tailscale Serve or an HTTPS proxy.
- Outbound requests (AI providers, online OCR, ntfy) can be restricted by an
  administrator-managed egress allowlist (Settings → Outbound requests).
- Imports have size limits, real calendar-date validation, invalid-row reporting,
  and database duplicate protection.
- The AI read-only query path cannot access settings, API keys, authentication, or
  audit internals. Dev-mode writes come from a fixed proposal whitelist and require
  explicit Apply confirmation.
- Health checks use `/healthz`. If metrics are enabled, restrict `/metrics` at the
  firewall or reverse proxy because it is not protected by a session cookie.

## Documentation

- [`docs/INDEX.md`](docs/INDEX.md) - documentation map and documentation rules
- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) - complete end-user manual
- [`docs/MATH.md`](docs/MATH.md) - financial formulas and definitions
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) - operational fixes
- [`docs/HTTPS_CADDY.md`](docs/HTTPS_CADDY.md) - HTTPS deployment
- [`docs/MOBILE_CLIENTS.md`](docs/MOBILE_CLIENTS.md) - Android/iOS clients and network policy
- [`docs/DESKTOP_CLIENT.md`](docs/DESKTOP_CLIENT.md) - desktop client
- [`docs/openapi.json`](docs/openapi.json) - API schema
- [`CHANGELOG.md`](CHANGELOG.md) - release history

## Roadmap

- Optional bank synchronization alongside the hardened manual import.
- Further signed desktop auto-update support.
- Apple distribution signing and store publication.
- Ongoing security, performance, accessibility, and platform polish.

## Contributing and License

Issues and pull requests are welcome. Budget Planner is licensed under [MIT](LICENSE).
