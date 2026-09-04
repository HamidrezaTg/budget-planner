# Troubleshooting

Quick fixes for the most common problems, grouped by where they appear.

## Server installation

### Service crash-loops (`status=1/FAILURE`)

Almost always **Node.js < 22** — the server uses the built-in `node:sqlite`,
which older distro packages (Ubuntu 24.04 ships Node 18) don't have. Check:

```bash
node -v
journalctl -u gulden -n 30 --no-pager
```

Fix: installer v3.8.1+ enforces Node 22 and can install it via NodeSource.
Manual fix: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install nodejs`,
then `sudo systemctl restart gulden`.

Another classic: the service was installed before v3.8.2 — those units didn't set
`DATA_DIR` and died with `ENOENT … /opt/gulden/data`. Upgrade to ≥ 3.8.2.

### Port already in use

`EADDRINUSE` in the journal → something else owns the port. Change it:
`sudo nano /etc/default/gulden` → add `PORT=3000`, then
`sudo systemctl restart gulden`.

## Connecting from other devices

### Use an IP address, not the computer's name

Phones rarely resolve hostnames like `lenovo`. Use:

- `http://192.168.0.174:2026` — the server's LAN IP for a trusted browser or desktop client
- `http://lenovo.local:2026` — mDNS name, when supported by the local network
- an HTTPS Tailscale hostname or HTTPS reverse-proxy URL — recommended outside trusted networks

The Android and iOS clients accept HTTP on a trusted LAN or VPN and warn before saving
the address. iOS still blocks arbitrary public HTTP through App Transport Security. Use
HTTPS Tailscale or a certificate-backed reverse proxy on public or untrusted networks.

Beware the reverse trap on desktop machines: some routers/DNS setups resolve the
_server's own hostname_ to `127.0.0.1`, which silently opens a **different app on the
local machine**. If two different account lists appear, this is why — always compare
using the numeric IP.

### Phone can't reach the server, browser can't either

- Phone and server on the same Wi-Fi? Some routers enable _client/AP isolation_ —
  disable it, or use Tailscale on both.
- Server firewall: `sudo ufw allow 2026/tcp` (or your port).

### Android app says "Can't reach your server"

Checklist, in order:

1. Does the same HTTP or HTTPS address open in the phone's browser? Then the network
   path and server are reachable. For HTTPS, also check the certificate on the device.
2. Use the server's numeric LAN IP or HTTPS Tailscale hostname instead of a bare computer name.
3. To change the server later, use **Change server address** on the recovery
   screen. The address is remembered after a successful connection.

### Linux desktop client shows the wrong welcome page

Upgrade to the current Tauri desktop client from GitHub Releases. The server address lives in
`~/.config/com.hamidreza.budgetplanner.client/config.json`; delete that file to get the
first-launch setup screen back.

## Import & transactions

### PDF or image import says OCR tools are unavailable

Local PDF and image import needs optional Poppler/Tesseract tools. On Debian/Ubuntu install:

```bash
sudo apt install poppler-utils tesseract-ocr
```

The service must be able to find `pdfinfo`, `pdftotext`, `pdftoppm`, and `tesseract` on its `PATH`.
Selectable PDFs use local text extraction. Scanned PDFs and JPG/PNG images are OCR'd locally; set
`TESSERACT_LANG` to a language installed on the server when `eng` is not sufficient. Alternatively,
the Import page's explicit online OCR mode uses the active vision profile and sends bounded pages
to that provider. The import preview still requires explicit confirmation.

### Importing the same/overlapping statement again

Safe by design: rows are fingerprinted (date + amount + description, plus an
occurrence index for genuine same-day twins) and the database rejects duplicates.
The preview shows what counts as a duplicate before you confirm. If a bank changes
merchant _wording_ between statements, those rows can slip through — delete them
manually in that case.

### A transaction has no category

It's in **needs review** (Transactions page). Assign once — a keyword rule is learned
and applied retroactively to matching rows.

### "Something went wrong" — getting support with a request id

Every response carries an `X-Request-Id` header. If a server error mentions one
(or your browser devtools Network tab shows it), find the matching server line with:

```bash
journalctl -u gulden | grep <request-id>
```

That line contains the full error detail without exposing stack traces to clients.

## Multi-currency

### Foreign-currency totals look wrong (1:1)

No exchange rate exists for that month/currency yet — the app counts 1:1 and shows an
"Exchange rates missing" card. Add rates in Settings (manual, or "Fetch missing from
ECB"). Changing the display currency clears all stored rates — refetch afterwards.

## Data

### Migrating to a new server

Stop the service, copy the whole data directory (default `/var/lib/gulden`,
or `data/` for source installs) to the same path on the new machine, fix ownership
(`chown -R budget:budget`), start. Alternatively: Settings → **Download full backup**
on the old machine → create an account on the new one → **Restore backup**.

### "I made an account but it doesn't exist on another device"

Accounts live in the **server's** database — one server, one account list. If two
different account lists appear, you are talking to two different servers (see the
hostname trap above).
