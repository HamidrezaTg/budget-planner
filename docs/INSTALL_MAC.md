# Install Budget Planner on macOS

The macOS client is a native Tauri shell. It contains no server or budget
database; it connects to a Budget Planner server on your LAN, Tailscale, or
another reachable HTTPS network.

## Install

1. Download the matching `budget-planner-client_<version>_<arch>.dmg` from the
   [GitHub release](https://github.com/HamidrezaTg/budget-planner/releases).
2. Open the DMG and drag **Budget Planner** to **Applications**.
3. Open **Applications**, right-click **Budget Planner**, choose **Open**, and
   confirm **Open** on the first launch.

The release is intentionally unsigned until a Developer ID certificate is
available. macOS may show an unidentified-developer warning. If double-clicking
does not offer **Open**, go to **System Settings → Privacy & Security**, find
the blocked application message, and choose **Open Anyway**. Confirm the prompt
once more.

## Connect

On first launch enter the server address, for example
`http://192.168.1.10:2026` or its Tailscale HTTPS address. The client verifies
the `/.well-known/budget-planner` discovery endpoint, remembers up to ten
servers, and lets you switch between them from the connection screen.

The macOS app uses the native **File**, **Edit**, **View**, and **Help** menus.
`Cmd+Q` quits the application.

## Troubleshooting

- A server on plain HTTP must be reachable from the Mac. Check the Mac's LAN or
  Tailscale connection and confirm the server's firewall allows port `2026`.
- If the server address is rejected, use a complete URL beginning with
  `http://` or `https://`.
- To remove saved server addresses, use the **Forget** action on the connection
  screen.
