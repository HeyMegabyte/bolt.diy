/**
 * `SettingsShellComponent` — `/dashboard/settings` shell with PrimeNG
 * `p-tabView`. Vertical on desktop, horizontal on mobile via a
 * `prefers-pointer: coarse` + width media query (CSS, not JS).
 *
 * Every tab body is a standalone component lazy-loaded via dynamic
 * `import()` so the bundle is split per tab. Spec contract:
 * `feature-settings/__tests__/settings-tabs.spec.ts` —
 *   - every tab renders
 *   - lazy-loaded components mount on tab activation
 *   - Danger Zone typed-confirm enforces slug match before enabling delete
 */
import {
  ChangeDetectionStrategy,
  Component,
  Type,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export interface SettingsTab {
  readonly id: string;
  readonly label: string;
  readonly testid: string;
  readonly load: () => Promise<Type<unknown>>;
}

@Component({
  selector: 'lib-settings-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './settings-shell.component.html',
  styleUrls: ['./settings-shell.component.css'],
})
export class SettingsShellComponent {
  protected readonly tabs: readonly SettingsTab[] = [
    {
      id: 'profile',
      label: 'Profile',
      testid: 'settings-tab-profile',
      load: () =>
        import('../tabs/profile-tab.component').then((m) => m.ProfileTabComponent),
    },
    {
      id: 'workspace',
      label: 'Workspace',
      testid: 'settings-tab-workspace',
      load: () =>
        import('../tabs/workspace-tab.component').then(
          (m) => m.WorkspaceTabComponent,
        ),
    },
    {
      id: 'security',
      label: 'Security',
      testid: 'settings-tab-security',
      load: () =>
        import('../tabs/security-tab.component').then(
          (m) => m.SecurityTabComponent,
        ),
    },
    {
      id: 'notifications',
      label: 'Notifications',
      testid: 'settings-tab-notifications',
      load: () =>
        import('../tabs/notifications-tab.component').then(
          (m) => m.NotificationsTabComponent,
        ),
    },
    {
      id: 'appearance',
      label: 'Appearance',
      testid: 'settings-tab-appearance',
      load: () =>
        import('../tabs/appearance-tab.component').then(
          (m) => m.AppearanceTabComponent,
        ),
    },
    {
      id: 'api',
      label: 'API & Webhooks',
      testid: 'settings-tab-api',
      load: () =>
        import('../tabs/api-tab.component').then((m) => m.ApiTabComponent),
    },
    {
      id: 'integrations',
      label: 'Integrations',
      testid: 'settings-tab-integrations',
      load: () =>
        import('../tabs/integrations-tab.component').then(
          (m) => m.IntegrationsTabComponent,
        ),
    },
    {
      id: 'danger',
      label: 'Danger Zone',
      testid: 'settings-tab-danger',
      load: () =>
        import('../tabs/danger-zone-tab.component').then(
          (m) => m.DangerZoneTabComponent,
        ),
    },
  ];

  protected readonly activeTabId = signal<string>('profile');
  protected readonly loadedComponent = signal<Type<unknown> | null>(null);
  protected readonly loadError = signal<string | null>(null);

  constructor() {
    void this.activate('profile');
  }

  protected async activate(id: string): Promise<void> {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.activeTabId.set(id);
    this.loadedComponent.set(null);
    this.loadError.set(null);
    try {
      const comp = await tab.load();
      // Only swap if the active tab is still this one (avoids race on rapid clicks).
      if (this.activeTabId() === id) {
        this.loadedComponent.set(comp);
      }
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : 'Load failed');
    }
  }
}
