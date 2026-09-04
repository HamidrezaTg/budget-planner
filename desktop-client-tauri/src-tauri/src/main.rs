// Tauri v2 entry point. The shell loads the React bundle built by Vite
// (`frontendDist` in tauri.conf.json) and exposes a tiny IPC surface so
// the bundle can read and write the saved server address through
// `plannerClient.getConfig` / `plannerClient.saveUrl`, matching the old
// Electron preload contract.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    gulden_client_lib::run();
}
