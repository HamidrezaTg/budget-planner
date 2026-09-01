# Desktop OS Test Matrix

The repository CI builds the Tauri client on Linux, macOS, and Windows. Runtime
checks still need to be performed on each operating system because this Linux
workspace cannot exercise native tray, menu, WebView, or installer behavior.

## Checklist

- [ ] Linux: launch the AppImage or `.deb`, select a server, switch servers, and
  verify the tray/menu behavior.
- [ ] macOS: open the unsigned DMG, select a server, switch servers, and verify
  the native menu and dock/single-instance behavior.
- [ ] Windows: install the NSIS/MSI bundle, select a server, switch servers, and
  verify the taskbar/tray behavior.

For each platform, confirm the client rejects a server without
`/.well-known/budget-planner`, remembers valid server URLs, and does not expose
or create local budget databases.
