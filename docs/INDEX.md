# Documentation

Gulden is a self-hosted application. The server owns the data; browsers,
phones, and desktop applications connect to it as clients.

## Start Using Gulden

- [User Guide](USER_GUIDE.md) - complete end-user reference for setup, budgeting,
  imports, transactions, forecasting, reports, backups, sharing, and administration.
- [In-app Help](../client/src/pages/Help.jsx) - the same task-oriented guidance is
  available publicly at `/help`, before login and while the server is unavailable.
- [Math and definitions](MATH.md) - formulas and terminology behind dashboard,
  balance, fund, projection, and report values.
- [Troubleshooting](TROUBLESHOOTING.md) - connection, service, import, currency,
  backup, and migration fixes.

## Install and Operate the Server

- [README](../README.md) - recommended installation, source development, features,
  configuration, privacy, and security overview.
- [HTTPS with Caddy](HTTPS_CADDY.md) - put the HTTP server behind HTTPS for public
  or untrusted networks.
- [Security policy](../SECURITY.md) - security model and responsible disclosure.
- [Hosted Service Terms](TERMS_OF_SERVICE.md) - draft terms for the hosted
  subscription service; complete the marked business details before launch.
- [Privacy Policy](PRIVACY_POLICY.md) - draft hosted-service privacy policy;
  complete the marked provider and contact details before launch.
- [Hosted Service Launch Plan](HOSTED_SERVICE_LAUNCH_PLAN.md) - required
  decisions and launch checklist.

## Connect Clients

- [Mobile clients](MOBILE_CLIENTS.md) - Android/iOS network policy, release signing,
  and iOS archive limitations.
- [Desktop client](DESKTOP_CLIENT.md) - Tauri client architecture and operation.
- [Arch Linux installation](INSTALL_ARCH.md) - AUR and AppImage installation.
- [macOS installation](INSTALL_MAC.md) - DMG installation and Gatekeeper guidance.

## Develop and Integrate

- [OpenAPI contract](openapi.json) - authenticated API schema.
- [OS test matrix](OS_TEST_MATRIX.md) - platform validation notes.
- [Changelog](../CHANGELOG.md) - release history.
- [Roadmap](../ROADMAP.md) - planned work.
- [Contributing](../CONTRIBUTING.md) - development workflow and DCO policy.
- [Trademark policy](../TRADEMARKS.md) - Gulden name and branding guidance.

## Documentation Rules

- Treat the public `/help` page and `USER_GUIDE.md` as end-user documentation.
- Treat README and deployment documents as operator documentation.
- Document mobile HTTP only as a trusted-LAN/VPN option with its security warning;
  iOS keeps App Transport Security enabled for arbitrary public HTTP.
- A SQLite backup does not include transaction attachments. Copy the corresponding
  uploads directory separately for a complete migration.
- Do not put passwords, API keys, keystores, database files, or private server URLs
  in issues, screenshots, examples, or commits.
