# Mobile Clients

Budget Planner's Capacitor apps are clients only. They contain no server, account
service, analytics, advertising, or third-party data collection. Financial data stays
on the self-hosted Budget Planner server; the native shell stores only the selected
server address in WebView local storage.

## Network policy

The Android client accepts HTTP and HTTPS server connections. This supports a trusted
LAN address such as `http://192.168.1.20:2026` and a trusted Tailscale IP such as
`http://100.x.y.z:2026`. The picker shows a warning and requires confirmation before
remembering an HTTP address.

HTTP is not safe on public Wi-Fi or any untrusted network: passwords, cookies, and
application traffic can be observed or modified. Use HTTPS for those networks. A
Tailscale HTTPS DNS hostname (for example `https://server.example.ts.net:2026`) or a
certificate-backed reverse proxy provides HTTPS while keeping Budget Planner on port
2026. A raw Tailscale IP cannot have a normal DNS certificate.

The iOS shell also permits HTTP only for local/VPN networking and uses the same explicit
confirmation before saving an HTTP address. Arbitrary public HTTP remains blocked by
App Transport Security. HTTPS is still recommended outside trusted networks.

The web server can run over HTTP for localhost and private networks. Use Caddy or
another reverse proxy for an HTTPS deployment and enable `SECURE_COOKIE=1` and
`TRUST_PROXY=1` as described in [`HTTPS_CADDY.md`](HTTPS_CADDY.md).

## Android release signing

The release workflow publishes the signed APK as a GitHub Release asset. It does not
upload anything to Google Play. An optional signed AAB is produced only as a private
GitHub Actions artifact for later review; it is not published.

Configure these repository or environment secrets before tagging a release:

- `BP_ANDROID_KEYSTORE_BASE64` — base64-encoded JKS/keystore contents
- `BP_ANDROID_KEYSTORE_PASSWORD` — keystore password
- `BP_ANDROID_KEY_ALIAS` — signing key alias
- `BP_ANDROID_KEY_PASSWORD` — optional key password; defaults to the keystore password

CI materializes the base64 value only in the runner's temporary directory and removes it
with the runner. Do not commit a keystore, password, `google-services.json`, or a decoded
secret. Local debug builds use `BP_ALLOW_DEBUG_APK=1` and are never release artifacts.

## iOS archive

The macOS workflow builds an unsigned `.xcarchive` and uploads it as a GitHub Actions
artifact. This validates the Capacitor/Xcode scaffold without publishing to the App
Store. Distribution still requires an Apple Developer account, a team identifier,
signing certificate, and provisioning profile on a macOS runner.
