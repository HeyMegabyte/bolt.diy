/**
 * @module pages/admin-v2/sections/settings
 *
 * V2 Settings section — account identity (via `getMe()`) + cockpit info +
 * quick links into the legacy admin surfaces that haven't been ported to
 * Spartan yet. Honest about scope: it links out rather than faking controls
 * that don't exist. 3-state (loading / error / ready) on helm primitives per
 * [[spartan-ui-design-system]].
 *
 * @example Routed as the `settings` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
} from '../../../ui';

type Status = 'loading' | 'error' | 'ready';

@Component({
  selector: 'app-v2-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule, HlmButtonDirective, HlmCardDirective, HlmCardTitleDirective, HlmCardDescriptionDirective],
  template: `
    <div class="mb-3">
      <h2 class="text-lg font-semibold text-foreground">Settings</h2>
      <p class="text-sm text-muted-foreground">Account, organization &amp; cockpit info</p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 max-w-3xl">
      <div hlmCard data-testid="v2-settings-account">
        <h3 hlmCardTitle>Account</h3>
        @switch (status()) {
          @case ('loading') {
            <div class="mt-3 h-12 animate-pulse opacity-60 rounded bg-card"></div>
          }
          @case ('error') {
            <p hlmCardDescription class="mt-1" role="alert">{{ errMsg() }}</p>
            <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
          }
          @case ('ready') {
            <dl class="mt-3 text-sm flex flex-col gap-2">
              <div class="flex justify-between gap-4">
                <dt class="text-muted-foreground">Email</dt>
                <dd class="text-foreground truncate">{{ email() || '—' }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-muted-foreground">Organization</dt>
                <dd class="text-foreground truncate">{{ org() || '—' }}</dd>
              </div>
            </dl>
          }
        }
      </div>

      <div hlmCard data-testid="v2-settings-links">
        <h3 hlmCardTitle>More controls</h3>
        <p hlmCardDescription class="mt-1">Surfaces not yet ported to the Spartan cockpit.</p>
        <nav class="mt-3 flex flex-col gap-1.5">
          @for (link of links; track link.path) {
            <a [routerLink]="link.path" hlmBtn variant="ghost" size="sm" class="justify-start w-full">{{ link.label }}</a>
          }
        </nav>
      </div>
    </div>
  `,
})
export class V2SettingsComponent {
  private readonly api = inject(ApiService);

  protected readonly links = [
    { label: 'Feature flags', path: '/admin/feature-flags' },
    { label: 'Billing', path: '/admin/billing' },
    { label: 'Audit log', path: '/admin/audit' },
    { label: 'MCP connections', path: '/admin/mcp' },
    { label: 'User settings', path: '/admin/user-settings' },
  ];

  private readonly me = toSignal(
    this.api.getMe().pipe(
      map((res) => ({ status: 'ready' as const, user: res.data })),
      startWith({ status: 'loading' as const, user: null }),
      catchError((e: unknown) =>
        of({
          status: 'error' as const,
          user: null,
          message: (e as { message?: string })?.message ?? 'Network error',
        }),
      ),
    ),
    { initialValue: { status: 'loading' as const, user: null } },
  );

  protected readonly status = computed<Status>(() => this.me().status);
  protected readonly email = computed(() => {
    const u = this.me().user as { email?: string } | null;
    return u?.email ?? '';
  });
  protected readonly org = computed(() => {
    const u = this.me().user as { org_name?: string; orgName?: string } | null;
    return u?.org_name ?? u?.orgName ?? '';
  });
  protected readonly errMsg = computed(() => {
    const s = this.me();
    return 'message' in s ? (s as { message?: string }).message ?? '' : '';
  });

  protected reload(): void {
    location.reload();
  }
}
