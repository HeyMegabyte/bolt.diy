/**
 * API & Webhooks tab — link out to `/dashboard/integrations` (no duplicate UI).
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'lib-api-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <h2 class="ps-h2">API &amp; Webhooks</h2>
    <p>
      API keys and webhook subscriptions live in
      <a href="/dashboard/integrations" class="ps-link" data-testid="api-link"
        >Integrations</a
      >.
    </p>
  `,
  styles: [
    `
      .ps-h2 { font-size: 1.25rem; font-weight: 700; margin: 0 0 16px; }
      .ps-link { color: var(--ps-accent, #00e5ff); text-decoration: none; }
      .ps-link:hover { text-decoration: underline; }
    `,
  ],
})
export class ApiTabComponent {}
