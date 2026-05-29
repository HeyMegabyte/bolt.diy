use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

mod menubar;
mod offline_queue;
mod tray;

/// Frontend invokable: returns the deployed admin URL the webview should load.
#[tauri::command]
fn admin_url() -> &'static str {
    "https://projectsites.dev/admin"
}

/// Frontend invokable: open the bolt.diy editor in a separate native window so
/// the user can have the editor side-by-side with the dashboard.
#[tauri::command]
async fn open_editor_window(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("editor") {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let url = WebviewUrl::External(
        "https://editor.projectsites.dev/"
            .parse()
            .map_err(|e: url::ParseError| e.to_string())?,
    );
    WebviewWindowBuilder::new(&app, "editor", url)
        .title("ProjectSites — Editor")
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![admin_url, open_editor_window])
        .setup(|app| {
            // Build native menu bar.
            let menu = menubar::build_menu(app.handle())?;
            app.set_menu(menu)?;

            // Build system tray.
            let tray_menu = tray::build_tray_menu(app.handle())?;
            let _tray = TrayIconBuilder::with_id("main-tray")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Initialize the offline edit queue (IndexedDB lives in the webview;
            // the Rust side just owns a tiny mirror for "n queued edits" badge).
            offline_queue::init(app.handle())?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // On macOS, hide-to-tray instead of fully quitting.
                #[cfg(target_os = "macos")]
                {
                    let _ = window.hide();
                    api.prevent_close();
                }
                #[cfg(not(target_os = "macos"))]
                {
                    let _ = api;
                    let _ = window;
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
