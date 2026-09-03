# Security

Budget Planner is a self-hosted, single-machine-first budget app. This document
summarizes the security model and how to report issues.

## Reporting a vulnerability

Please report security issues privately instead of in a public issue:

- Open a private advisory via the GitHub repo, or
- Email the maintainers (see the repository profile).

Please include:

- The affected version(s).
- A step-by-step description of the issue.
- Proof-of-concept or reproducer if possible.

## Security model

- **Isolation**: every user gets a private SQLite database (`data/users/<user>.db`);
  API handlers run inside that user's database context (AsyncLocalStorage). Session
  cookies are `HttpOnly` + `SameSite=Lax`, expire server-side after 30 days, and all
  sessions are invalidated on a password change.
- **Authentication**: salted scrypt password hashing (async), minimum 8 characters,
  per-IP+username login rate limiting, and localhost-only first-run setup unless an
  explicit `SETUP_TOKEN` is configured.
- **SQL**: all application queries are parameterized. The AI assistant's SQL tool is
  read-only, single-statement, allowlisted to budget tables, and row-limited.
- **Files**: uploads are size-limited, stored under a private directory with
  server-generated names, and cleaned up after import. Attachment paths are
  traversal-guarded.
- **Headers**: CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`;
  no `X-Powered-By`; production error responses never expose stack traces.
- **Binding**: the server binds to loopback by default; exposing it to a LAN or
  VPN is an explicit `BIND_IP` decision, and HTTPS deployments via reverse proxy
  or Tailscale Serve get the session-cookie `Secure` flag automatically
  (`TRUST_PROXY=1`).
- **Egress**: AI provider endpoints (chat and online OCR) and ntfy servers are
  the only user-configured outbound URLs. An administrator can restrict all of
  them to an allowlist (Settings → Outbound requests); custom endpoints are
  validated against the policy at save time and again before every request.

## Transport

The server binds to loopback by default. LAN or Tailscale use over plain HTTP is
an explicit opt-in (`BIND_IP`). The Android client supports that mode after an
explicit warning; use it only on a trusted private network. Over untrusted
networks (public Wi-Fi, the open internet) HTTP exposes credentials
and permits application tampering. Use an HTTPS reverse proxy
(`TRUST_PROXY=1` — the cookie `Secure` flag is then applied automatically) or
Tailscale HTTPS. A raw encrypted Tailscale tunnel does not make the HTTP URL
itself safe from all endpoint/network risks.

## Spreadsheet dependency

- Spreadsheet import/export uses the API-compatible `@e965/xlsx@0.20.3` package
  through the `xlsx` npm alias. Import files remain untrusted and are bounded by
  file, row, column, sheet, and workbook-cell limits. `npm audit --omit=dev`
  currently reports no vulnerabilities.
