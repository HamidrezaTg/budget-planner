// Tauri v2 application library. The shell stores the configured server
// address in the OS-appropriate `app_config_dir` and exposes it to the
// React frontend over a small IPC surface. All navigation is then driven
// from JS (the bundle decides when to call `saveUrl` and asks Rust to
// reload the window).
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_window_state::StateFlags;

#[derive(Default)]
struct AppState {
    config_path: Mutex<Option<PathBuf>>,
}

#[derive(Serialize, Deserialize, Default)]
struct ClientConfig {
    #[serde(default)]
    url: String,
}

#[cfg(desktop)]
fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    let file = SubmenuBuilder::new(app, "File")
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Budget Planner"),
            None,
        )?)
        .build()?;

    MenuBuilder::new(app)
        .item(&file)
        .item(&edit)
        .item(&view)
        .item(&help)
        .build()
}

#[tauri::command]
fn get_config(state: tauri::State<'_, AppState>) -> ClientConfig {
    let path = state.config_path.lock().ok().and_then(|p| p.clone());
    let Some(path) = path else {
        return ClientConfig::default();
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => ClientConfig::default(),
    }
}

#[tauri::command]
fn save_url(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AppState>,
    url: String,
) -> Result<(), String> {
    let cleaned = url.trim().trim_end_matches('/').to_string();
    if !cleaned.starts_with("http://") && !cleaned.starts_with("https://") {
        return Err("Address must start with http:// or https://".into());
    }
    let path = state
        .config_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "config path not initialized".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let payload = serde_json::to_string_pretty(&ClientConfig {
        url: cleaned.clone(),
    })
    .map_err(|e| e.to_string())?;
    std::fs::write(&path, payload).map_err(|e| e.to_string())?;
    // Reload the window so the user immediately lands on the new server.
    if window.label() == "main" {
        let _ = window.eval(&format!("window.location.replace({:?})", cleaned + "/"));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                app.exit(0);
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Bring the existing window to the foreground when the user tries
            // to launch a second instance.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.set_menu(build_menu(app.handle())?)?;

            let path = app
                .path()
                .app_config_dir()
                .map_err(|e| format!("config dir: {e}"))?
                .join("config.json");
            app.manage(AppState {
                config_path: Mutex::new(Some(path)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_config, save_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
