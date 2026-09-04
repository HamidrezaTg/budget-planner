# Install Gulden on macOS

The macOS client is a native Tauri shell. It contains no server or budget
database; it connects to a Gulden server on your LAN, Tailscale, or
another reachable HTTPS network.

## Install

1. Download the matching `gulden-client_<version>_<arch>.dmg` from the
   [GitHub release](https://github.com/HamidrezaTg/gulden/releases).
2. Open the DMG and drag **Gulden** to **Applications**.
3. Open **Applications**, right-click **Gulden**, choose **Open**, and
   confirm **Open** on the first launch.

The release is intentionally unsigned until a Developer ID certificate is
available. macOS may show an unidentified-developer warning. If double-clicking
does not offer **Open**, go to **System Settings → Privacy & Security**, find
the blocked application message, and choose **Open Anyway**. Confirm the prompt
once more.

## Connect

On first launch enter the server address. A trusted LAN can use
`http://192.168.1.10:2026`; use an HTTPS Tailscale or reverse-proxy address on
untrusted networks. The client verifies the `/.well-known/budget-planner` discovery endpoint, remembers up to ten
servers, and lets you switch between them from the connection screen.

The macOS app uses the native **File**, **Edit**, **View**, and **Help** menus.
`Cmd+Q` quits the application.

## Troubleshooting

- A trusted-LAN HTTP server must be reachable from the Mac. For an untrusted
  network, use HTTPS and check the certificate, LAN/Tailscale connection, and
  firewall port.
- If the server address is rejected, use a complete URL beginning with
  `http://` or `https://`.
- To remove saved server addresses, use the **Forget** action on the connection
  screen.
