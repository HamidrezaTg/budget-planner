# Desktop Client Operations

The Tauri desktop client is a server picker and web client. It does not contain
the server or local budget data.

## Install Paths

- Debian/Ubuntu: install `budget-planner-client_<version>_amd64.deb` with
  `sudo apt install ./budget-planner-client_<version>_amd64.deb`.
- Arch Linux: install the AUR package `budget-planner-client`, or use the
  matching AppImage from GitHub Releases.
- macOS: open the unsigned DMG and drag **Budget Planner** to Applications.
- Windows: install the generated NSIS or MSI bundle and launch the client.

On first launch, enter the server URL. The client checks
`/.well-known/budget-planner` before saving the address.

## Signing

Linux packages are currently unsigned. macOS releases are intentionally
unsigned until a Developer ID certificate and notarization credentials are
available; use **Open Anyway** as described in `INSTALL_MAC.md`.

Windows NSIS and MSI release bundles are Authenticode-signed in GitHub Actions.
The release workflow requires the repository secrets
`BP_WINDOWS_CERT_BASE64` (base64-encoded PFX) and
`BP_WINDOWS_CERT_PASSWORD`; it fails closed when either is missing.

The Tauri updater is present in the client but must not be enabled for public
releases until an updater signing key and public key are stored as repository
secrets/configuration. Never commit the private signing key.

## AUR Publishing

`scripts/build-aur.sh` generates and validates `PKGBUILD` and `.SRCINFO` in a
clean Arch container. A maintainer with an AUR account must then clone the
`budget-planner-client` AUR repository, copy the generated files, review the
source checksum and version, commit, and push them. The repository's CI only
validates the package; it does not publish to AUR automatically.
