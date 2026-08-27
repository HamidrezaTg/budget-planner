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

## Transport

The server runs plain HTTP for home LAN / Tailscale use. Over untrusted networks
(public Wi-Fi, the open internet) this exposes credentials — use an HTTPS reverse
proxy (`SECURE_COOKIE=1`, `TRUST_PROXY=1`), Tailscale, or bind to `127.0.0.1`.

## Known dependency advisories

- `xlsx` (used for spreadsheet import/export) has an unfixed HIGH advisory
  (prototype pollution / ReDoS). It is scheduled for replacement; until then imports
  are size-limited and treated as untrusted. See `docs/IMPROVEMENT_PLAN.md`.
