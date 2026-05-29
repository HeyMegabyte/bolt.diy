import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Root mobile shell. The Capacitor `server.url` config (capacitor.config.ts)
 * actually redirects the webview to the deployed admin SPA, so this Angular
 * shell only renders when the app starts in OFFLINE mode or before the redirect
 * resolves.
 *
 * Keep it minimal: a brand splash + router outlet so the app has a real
 * Angular tree under the hood (lets us swap to an in-app shell later without
 * a native rebuild).
 */
@Component({
  selector: 'ps-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <main class="shell">
      <router-outlet />
    </main>
  `,
  styles: [
    `
      .shell {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
      }
    `,
  ],
})
export class AppComponent {}
