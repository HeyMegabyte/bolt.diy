//! System tray menu — quick build status monitoring without bringing the
//! main window forward.

use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    AppHandle, Emitter, Manager, Wry,
};

pub fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let show = MenuItemBuilder::with_id("tray-show", "Show ProjectSites").build(app)?;
    let recent_builds =
        MenuItemBuilder::with_id("tray-recent-builds", "Recent Builds…").build(app)?;
    let new_site = MenuItemBuilder::with_id("tray-new-site", "New Site…").build(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit ProjectSites"))?;

    let menu = MenuBuilder::new(app)
        .items(&[&show, &recent_builds, &new_site])
        .separator()
        .item(&quit)
        .build()?;

    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        match id {
            "tray-show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            other => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("tray:click", other.to_string());
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }
    });

    Ok(menu)
}
