import { Component } from '@angular/core';

@Component({
  selector: 'ps-launch',
  standalone: true,
  template: `
    <section class="launch">
      <h1>ProjectSites</h1>
      <p>Connecting to your admin dashboard…</p>
    </section>
  `,
  styles: [
    `
      .launch {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        flex: 1;
        padding: 2rem;
        text-align: center;
      }
      h1 {
        font-size: 1.75rem;
        margin: 0;
        color: var(--ps-accent);
      }
      p {
        margin: 0;
        opacity: 0.7;
      }
    `,
  ],
})
export class LaunchPage {}
