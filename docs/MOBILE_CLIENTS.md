# Mobile Clients

Budget Planner's Capacitor apps are clients only. They contain no server, account
service, analytics, advertising, or third-party data collection. Financial data stays
on the self-hosted Budget Planner server; the native shell stores only the selected
server address in WebView local storage.

## Network policy

The native Android and iOS clients require HTTPS for the server connection. For private
access, use an HTTPS endpoint on the Tailscale tailnet, such as a Tailscale HTTPS
hostname or a certificate-backed reverse proxy reachable only through Tailscale. Plain
HTTP LAN URLs are not accepted by the native clients because they would expose session
credentials and cookies.

The web server can still be run over HTTP for localhost-only development. Use Caddy or
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
