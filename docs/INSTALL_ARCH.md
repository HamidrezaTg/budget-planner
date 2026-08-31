# Install Budget Planner on Arch Linux

The desktop client is a Tauri application. It contains no server or budget data;
run the Budget Planner server separately and connect to its LAN, Tailscale, or
HTTPS address on first launch.

## AUR with yay

After the package has been published to the AUR, install or update it with:

```bash
yay -S budget-planner-client
```

The AUR package installs the native desktop entry and icons. Upgrade it with
the usual `yay -Syu` command.

## AppImage fallback

Use this option when the AUR package is not yet available or when you prefer a
portable download:

1. Download `budget-planner-client_<version>_amd64.AppImage` from the
   [GitHub Releases](https://github.com/HamidrezaTg/budget-planner/releases).
2. Make it executable:

   ```bash
   chmod +x budget-planner-client_<version>_amd64.AppImage
   ```

3. Launch it:

   ```bash
   ./budget-planner-client_<version>_amd64.AppImage
   ```

The AppImage does not install the server or automatically create a menu entry.
Keep it in a stable location if you create your own desktop shortcut.

## First Launch

Enter the server address when prompted, for example
`http://192.168.1.20:2026`. The client verifies the
`/.well-known/budget-planner` discovery endpoint and remembers the server.

If the address cannot be reached, check the server bind address and firewall,
then see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
