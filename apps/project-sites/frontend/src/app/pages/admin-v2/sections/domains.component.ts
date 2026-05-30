/**
 * @module pages/admin-v2/sections/domains
 *
 * Spartan UI Domains section (Wave D) for the v2 admin cockpit. Lists every
 * custom hostname / domain provisioned through CF for SaaS, in a compact,
 * developer-console table built from the helm primitives
 * ([[spartan-ui-design-system]]).
 *
 * Mirrors {@link AdminV2ShellComponent} exactly: a `toSignal`-backed
 * discriminated-union state (`loading | error | ready`), the 4-state template
 * (`@switch` on `state().status` → skeletons / empty / error+Retry / ready),
 * OnPush, and RxJS→signal data (NO promises). The row shape is intentionally
 * loose — the `/admin/domains` payload shape is treated as untrusted, so each
 * field is optional and the 4-state guards an unexpected shape into a graceful
 * empty/error rather than a crash.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import {
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmButtonDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';

/**
 * Loose, defensive view of an admin domain row. Every field optional so an
 * unexpected backend shape still renders gracefully instead of throwing.
 */
interface DomainRow {
  id?: string;
  hostname?: string;
  domain?: string;
  name?: string;
  type?: string;
  status?: string;
  ssl_status?: string;
  sslStatus?: string;
  [key: string]: unknown;
}

type DomainsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; domains: DomainRow[] };

@Component({
  selector: 'app-v2-domains',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterModule,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    HlmButtonDirective,
    HlmBadgeDirective,
  ],
  host: { 'data-cockpit': 'v2', class: 'block' },
  template: `
    <section class="p-5" data-testid="v2-domains">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-sm font-semibold tracking-tight text-foreground">Domains</h2>
          <p class="text-xs text-muted-foreground mt-0.5">Custom hostnames + SSL provisioning</p>
        </div>
        <button hlmBtn variant="primary" size="sm" data-testid="v2-domains-add">+ Add domain</button>
      </div>

      @switch (state().status) {
        @case ('loading') {
          <div class="flex flex-col gap-2" data-testid="v2-domains-loading">
            @for (s of skeletons; track s) {
              <div hlmCard class="h-12 animate-pulse opacity-60"></div>
            }
          </div>
        }
        @case ('error') {
          <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-domains-error">
            <h3 hlmCardTitle>Couldn't load domains</h3>
            <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
            <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
          </div>
        }
        @case ('ready') {
          @if (domains().length === 0) {
            <div hlmCard class="max-w-md mx-auto mt-16 text-center" data-testid="v2-domains-empty">
              <h3 hlmCardTitle>No domains yet</h3>
              <p hlmCardDescription class="mt-1">Connect a custom domain to one of your sites to get started.</p>
              <button hlmBtn variant="primary" size="sm" class="mt-3" data-testid="v2-domains-empty-add">+ Add domain</button>
            </div>
          } @else {
            <div hlmCard class="overflow-hidden p-0" data-testid="v2-domains-table">
              <!-- Header row -->
              <div
                class="grid grid-cols-[2fr_0.8fr_0.8fr_0.8fr] gap-3 px-4 py-2 border-b border-border text-[0.62rem] uppercase tracking-wider text-muted-foreground"
                role="row"
              >
                <span role="columnheader">Hostname</span>
                <span role="columnheader">Type</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">SSL</span>
              </div>
              <!-- Data rows -->
              @for (row of domains(); track rowKey(row, $index)) {
                <div
                  class="grid grid-cols-[2fr_0.8fr_0.8fr_0.8fr] gap-3 px-4 py-2.5 border-b border-border last:border-b-0 items-center text-sm hover:bg-accent/40 focus-within:bg-accent/40"
                  role="row"
                  tabindex="0"
                  data-testid="v2-domains-row"
                >
                  <span class="font-mono text-xs text-foreground truncate" role="cell">{{ hostnameOf(row) }}</span>
                  <span class="text-xs text-muted-foreground" role="cell">{{ row.type || '—' }}</span>
                  <span role="cell">
                    <span hlmBadge [variant]="statusVariant(row.status)">{{ row.status || 'unknown' }}</span>
                  </span>
                  <span role="cell">
                    <span hlmBadge [variant]="sslVariant(sslOf(row))">{{ sslOf(row) || '—' }}</span>
                  </span>
                </div>
              }
            </div>
          }
        }
      }
    </section>
  `,
})
export class V2DomainsComponent {
  private readonly api = inject(ApiService);
  protected readonly skeletons = [0, 1, 2, 3, 4];

  protected readonly state = toSignal(
    this.api.get<{ data: unknown[] }>('/admin/domains').pipe(
      map((res) => {
        const rows = Array.isArray(res?.data) ? (res.data as DomainRow[]) : [];
        return { status: 'ready', domains: rows } as DomainsState;
      }),
      startWith({ status: 'loading' } as DomainsState),
      catchError((e: unknown) =>
        of({
          status: 'error',
          message: (e as { message?: string })?.message ?? 'Network error',
        } as DomainsState),
      ),
    ),
    { initialValue: { status: 'loading' } as DomainsState },
  );

  protected readonly domains = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.domains : [];
  });

  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected reload(): void {
    location.reload();
  }

  /** Best-effort hostname extraction across possible payload shapes. */
  protected hostnameOf(row: DomainRow): string {
    return row.hostname || row.domain || row.name || '—';
  }

  /** Best-effort SSL status extraction (snake_case or camelCase). */
  protected sslOf(row: DomainRow): string {
    return row.ssl_status || row.sslStatus || '';
  }

  /** Stable track key with a graceful fallback when no id is present. */
  protected rowKey(row: DomainRow, index: number): string {
    return row.id ?? this.hostnameOf(row) ?? String(index);
  }

  protected statusVariant(status: string | undefined): BadgeVariant {
    switch ((status ?? '').toLowerCase()) {
      case 'active':
      case 'verified':
      case 'live':
        return 'success';
      case 'pending':
      case 'provisioning':
      case 'verifying':
        return 'warning';
      case 'error':
      case 'failed':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  protected sslVariant(ssl: string | undefined): BadgeVariant {
    switch ((ssl ?? '').toLowerCase()) {
      case 'active':
      case 'issued':
      case 'valid':
        return 'success';
      case 'pending':
      case 'provisioning':
        return 'warning';
      case 'error':
      case 'failed':
        return 'danger';
      default:
        return 'neutral';
    }
  }
}
