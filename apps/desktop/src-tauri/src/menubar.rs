//! Native menu bar — File / Sites / Editor / Help sections.
//!
//! The platform handles cmd+Q, cmd+W, cmd+M, edit menu, window menu via
//! `PredefinedMenuItem`. Our custom items dispatch events to the webview
//! via `emit` so the Angular SPA can route to the right admin section.

use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, Manager, Wry,
};

pub fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let file = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("new-site", "New Site…")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("import-url", "Import from URL…")
                .accelerator("CmdOrCtrl+Shift+I")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::close_window(app, Some("Close Window"))?)
        .item(&PredefinedMenuItem::quit(app, Some("Quit ProjectSites"))?)
        .build()?;

    let sites = SubmenuBuilder::new(app, "Sites")
        .item(
            &MenuItemBuilder::with_id("nav-dashboard", "Dashboard")
                .accelerator("CmdOrCtrl+1")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("nav-sites", "All Sites")
                .accelerator("CmdOrCtrl+2")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("nav-forms", "Forms")
                .accelerator("CmdOrCtrl+3")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("nav-billing", "Billing")
                .accelerator("CmdOrCtrl+4")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("nav-audit", "Audit Log")
                .accelerator("CmdOrCtrl+5")
                .build(app)?,
        )
        .build()?;

    let editor = SubmenuBuilder::new(app, "Editor")
        .item(
            &MenuItemBuilder::with_id("open-editor", "Open Editor in New Window")
                .accelerator("CmdOrCtrl+E")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("nav-editor", "Open Inline Editor")
                .accelerator("CmdOrCtrl+Shift+E")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("nav-media", "Media Library")
                .accelerator("CmdOrCtrl+M")
                .build(app)?,
        )
        .build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("help-docs", "Documentation").build(app)?)
        .item(&MenuItemBuilder::with_id("help-changelog", "Changelog").build(app)?)
        .item(&MenuItemBuilder::with_id("help-status", "Status Page").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("help-feedback", "Send Feedback…").build(app)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&file, &sites, &editor, &help])
        .build()?;

    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if id == "open-editor" {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = crate::open_editor_window(app).await {
                    eprintln!("open-editor failed: {e}");
                }
            });
            return;
        }
        // Forward every other menu event to the webview; the Angular SPA
        // listens via `@tauri-apps/api/event` and routes accordingly.
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("menu:click", id.to_string());
        }
    });

    Ok(menu)
}
