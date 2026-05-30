/**
 * @module pages/admin-v2/sections/integrations
 *
 * V2 Integrations section — Cloudflare connection status (drives custom-domain
 * provisioning). Reads `getCloudflareCredentialStatus()` → connection badge,
 * credential source, email, last-validated (via the dayjs `relativeDate` pipe),
 * + a "Validate now" action (`validateCloudflareCredentials`). 4-state on helm
 * primitives per [[spartan-ui-design-system]] + [[angular-large-app-supervisor]].
 *
 * @example Routed as the `integrations` child under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import { ApiService, type CloudflareCredentialStatus } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
} from '../../../ui';
import { RelativeDatePipe } from './relative-date.pipe';

type IntegrationsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; cf: CloudflareCredentialStatus };

@Component({
  selector: 'app-v2-integrations',
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
    @switch (state().status) {
      @case ('loading') {
        <div hlmCard class="h-32 max-w-lg animate-pulse opacity-60" data-testid="v2-integrations-loading"></div>
      }
      @case ('error') {
        <div hlmCard class="max-w-md mx-auto mt-16 text-center" role="alert" data-testid="v2-integrations-error">
          <h3 hlmCardTitle>Couldn't load integrations</h3>
          <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
          <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
        </div>
      }
      @case ('ready') {
        <div hlmCard class="max-w-lg" data-testid="v2-integrations-cf">
          <div class="flex items-center justify-between gap-2">
            <h3 hlmCardTitle>Cloudflare</h3>
            <span hlmBadge [variant]="cf()!.has_credentials ? 'success' : 'neutral'">
              {{ cf()!.has_credentials ? 'connected' : 'not connected' }}
            </span>
          </div>
          <p hlmCardDescription class="mt-1">Powers custom-domain provisioning.</p>
          <dl class="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt class="text-muted-foreground text-xs uppercase tracking-wider">Source</dt>
              <dd class="text-foreground mt-0.5">{{ sourceLabel(cf()!.source) }}</dd></div>
            <div><dt class="text-muted-foreground text-xs uppercase tracking-wider">Email</dt>
              <dd class="text-foreground mt-0.5 truncate">{{ cf()!.email || '—' }}</dd></div>
            <div><dt class="text-muted-foreground text-xs uppercase tracking-wider">Last validated</dt>
              <dd class="text-foreground mt-0.5" [title]="cf()!.last_validated_at || ''">{{ cf()!.last_validated_at | relativeDate }}</dd></div>
            <div><dt class="text-muted-foreground text-xs uppercase tracking-wider">Account</dt>
              <dd class="text-foreground mt-0.5 truncate font-mono text-xs">{{ cf()!.last_validated_account_id || '—' }}</dd></div>
          </dl>
          <div class="mt-4 flex items-center gap-3">
            <button hlmBtn variant="primary" size="sm" (click)="validate()" [disabled]="validating()"
                    data-testid="v2-integrations-validate">
              {{ validating() ? 'Validating…' : 'Validate now' }}
            </button>
            @if (validateMsg(); as m) {
              <span hlmBadge [variant]="validateOk() ? 'success' : 'danger'" data-testid="v2-integrations-result">{{ m }}</span>
            }
          </div>
        </div>
      }
    }
  `,
})
export class V2IntegrationsComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly validating = signal(false);
  protected readonly validateMsg = signal<string | null>(null);
  protected readonly validateOk = signal(false);

  protected readonly state = toSignal(
    this.api.getCloudflareCredentialStatus().pipe(
      map((r) => ({ status: 'ready', cf: r.data }) as IntegrationsState),
      startWith({ status: 'loading' } as IntegrationsState),
      catchError((e: unknown) =>
        of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as IntegrationsState),
      ),
    ),
    { initialValue: { status: 'loading' } as IntegrationsState },
  );

  protected readonly cf = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.cf : null;
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected validate(): void {
    this.validating.set(true);
    this.validateMsg.set(null);
    this.api
      .validateCloudflareCredentials()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.validating.set(false);
          this.validateOk.set(!!res?.data?.ok);
          this.validateMsg.set(res?.data?.ok ? 'Valid' : res?.data?.message || 'Invalid');
        },
        error: () => {
          this.validating.set(false);
          this.validateOk.set(false);
          this.validateMsg.set('Validation failed');
        },
      });
  }

  protected sourceLabel(source: CloudflareCredentialStatus['source']): string {
    switch (source) {
      case 'org':
        return 'Org credentials';
      case 'worker_global_key':
        return 'Worker global key';
      case 'worker_token':
        return 'Worker token';
      default:
        return 'None';
    }
  }

  protected reload(): void {
    location.reload();
  }
}
