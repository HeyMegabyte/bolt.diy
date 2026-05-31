/**
 * @module pages/admin-v2/sections/apps
 *
 * V2 Apps section (SYS-ADMIN, org-wide) — the org's installed app instances
 * (container apps on `*.app.projectsites.dev`) via `getAppInstances()`. Org-
 * scoped, so it reads the stream directly (no Project-dropdown dependency,
 * unlike the per-site SITE sections). Card grid: app slug · subdomain link ·
 * status badge · last-started · surfaced last_error. 4-state on helm
 * primitives per [[spartan-ui-design-system]] + [[angular-large-app-supervisor]].
 *
 * @example Routed as the `apps` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import { ApiService, type AppInstance } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';
import { RelativeDatePipe } from './relative-date.pipe';

type AppsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: AppInstance[] };

@Component({
  selector: 'app-v2-apps',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    HlmBadgeDirective,
    RelativeDatePipe,
  ],
  template: `
    <div class="mb-3">
      <h2 class="text-lg font-semibold text-foreground">Apps</h2>
      <p class="text-sm text-muted-foreground">Installed app instances across your org</p>
    </div>

    @switch (state().status) {
      @case ('loading') {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="v2-apps-loading">
          @for (s of [0,1,2]; track s) { <div hlmCard class="h-24 animate-pulse opacity-60"></div> }
        </div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-apps-error">
          <h3 hlmCardTitle>Couldn't load apps</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        @if (rows().length === 0) {
          <div hlmCard class="text-center py-8" data-testid="v2-apps-empty">
            <p hlmCardDescription>No apps installed yet — provision one to run a container app on a subdomain.</p>
          </div>
        } @else {
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="v2-apps-grid">
            @for (app of rows(); track app.id) {
              <div hlmCard data-testid="v2-apps-card">
                <div class="flex items-center justify-between gap-2">
                  <h4 class="text-sm font-medium text-foreground truncate">{{ app.app_slug }}</h4>
                  <span hlmBadge [variant]="statusVariant(app.status)" class="shrink-0">{{ app.status }}</span>
                </div>
                <a [href]="appUrl(app)" target="_blank" rel="noopener noreferrer"
                   class="mt-1 block font-mono text-xs text-primary/80 hover:text-primary truncate transition-colors"
                   [attr.data-testid]="'v2-apps-link-' + app.id"
                   [attr.aria-label]="'Open ' + app.subdomain + '.app.projectsites.dev'">{{ app.subdomain }}.app.projectsites.dev ↗</a>
                @if (app.last_error) {
                  <p class="mt-2 text-xs text-[#ff7d96] truncate" [title]="app.last_error">{{ app.last_error }}</p>
                }
                <div class="mt-2 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{{ app.last_started_at ? 'Started' : 'Created' }}</span>
                  <span [title]="app.last_started_at || app.created_at">{{ (app.last_started_at || app.created_at) | relativeDate }}</span>
                </div>
              </div>
            }
          </div>
        }
      }
    }
  `,
})
export class V2AppsComponent {
  private readonly api = inject(ApiService);

  protected readonly state = toSignal(
    this.api.getAppInstances().pipe(
      map((r) => ({ status: 'ready', rows: r.instances ?? [] }) as AppsState),
      startWith({ status: 'loading' } as AppsState),
      catchError((e: unknown) =>
        of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as AppsState),
      ),
    ),
    { initialValue: { status: 'loading' } as AppsState },
  );

  protected readonly rows = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.rows : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected appUrl(app: AppInstance): string {
    return `https://${app.subdomain}.app.projectsites.dev`;
  }

  protected statusVariant(status: string): BadgeVariant {
    const s = (status || '').toLowerCase();
    if (s.includes('running') || s.includes('active') || s.includes('healthy')) return 'success';
    if (s.includes('error') || s.includes('failed') || s.includes('crash')) return 'danger';
    if (s.includes('booting') || s.includes('provision') || s.includes('pending') || s.includes('starting')) return 'warning';
    if (s.includes('hibern') || s.includes('idle') || s.includes('stopped')) return 'info';
    return 'neutral';
  }

  protected reload(): void {
    location.reload();
  }
}
