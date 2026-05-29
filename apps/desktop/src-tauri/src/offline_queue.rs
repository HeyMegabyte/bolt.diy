//! Offline edit queue mirror.
//!
//! The authoritative queue lives in the webview (IndexedDB) so the
//! Angular SPA owns conflict resolution + retry. The Rust side mirrors
//! only the queue COUNT so the tray icon can show a badge ("3 pending
//! edits") and the dock badge stays accurate across app launches.
//!
//! The webview emits `queue:update` with the current pending count via
//! `@tauri-apps/api/event`. We listen and update the tray title.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Listener, Manager};

#[derive(Default)]
struct QueueState {
    pending: u32,
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    app.manage(Mutex::new(QueueState::default()));

    let handle = app.clone();
    app.listen("queue:update", move |event| {
        let payload = event.payload();
        let parsed: serde_json::Result<QueueUpdate> = serde_json::from_str(payload);
        if let Ok(update) = parsed {
            if let Some(state) = handle.try_state::<Mutex<QueueState>>() {
                if let Ok(mut lock) = state.lock() {
                    lock.pending = update.pending;
                }
            }
            // Re-emit so the menu / tray label refreshes.
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.emit("queue:mirror", update.pending);
            }
        }
    });

    Ok(())
}

#[derive(serde::Deserialize)]
struct QueueUpdate {
    pending: u32,
}
