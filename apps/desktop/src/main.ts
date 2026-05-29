/**
 * Desktop frontend bootstrap.
 *
 * The webview loads `https://projectsites.dev/admin` directly (per
 * `tauri.conf.json > app.windows[0].url`). This file only runs when
 * served via `tauri dev` for local development of the wrapper itself.
 *
 * In production the deployed Angular admin SPA does ALL the UI work;
 * this module exists so we can:
 *   1. Subscribe to native menu + tray events from the SPA
 *   2. Surface offline queue mirror updates
 */
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

async function init() {
  // Forward Rust → JS events to the SPA's existing event bus.
  await listen<string>('menu:click', (event) => {
    window.dispatchEvent(
      new CustomEvent('ps-desktop:menu', { detail: event.payload }),
    );
  });

  await listen<string>('tray:click', (event) => {
    window.dispatchEvent(
      new CustomEvent('ps-desktop:tray', { detail: event.payload }),
    );
  });

  await listen<number>('queue:mirror', (event) => {
    window.dispatchEvent(
      new CustomEvent('ps-desktop:queue', { detail: event.payload }),
    );
  });

  // Wire a global keyboard shortcut to open the editor in a separate window.
  window.addEventListener('keydown', (e) => {
    const isMac = navigator.userAgent.toLowerCase().includes('mac');
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.shiftKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      void invoke('open_editor_window');
    }
  });
}

void init();
