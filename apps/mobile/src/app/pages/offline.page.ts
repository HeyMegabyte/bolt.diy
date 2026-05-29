import { Component } from '@angular/core';

@Component({
  selector: 'ps-offline',
  standalone: true,
  template: `
    <section class="offline">
      <h1>You're offline</h1>
      <p>ProjectSites needs an internet connection to load the admin SPA.</p>
      <p>Reconnect and pull-to-refresh.</p>
    </section>
  `,
  styles: [
    `
      .offline {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        flex: 1;
        padding: 2rem;
        text-align: center;
      }
    `,
  ],
})
export class OfflinePage {}
