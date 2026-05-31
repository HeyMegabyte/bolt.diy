/**
 * @module pages/admin-v2/sections/site-voice
 *
 * Per-site Voice — a SITE-group section driven by the topbar Project dropdown
 * ({@link V2SiteContextService.selectedSite}): the selected site's provisioned
 * phone numbers + recent conversations (calls + SMS) via
 * `forkJoin([getVoiceNumbers, getVoiceConversations])`. Numbers strip (number ·
 * vanity · status · monthly cost) + a conversation feed (kind/direction badge ·
 * from→to · duration · sentiment · relative time). Same dropdown-reactive
 * `switchMap` pattern as Forms/Files/Snapshots/AI-Logs. 4-state + no-site state
 * on helm primitives per [[spartan-ui-design-system]].
 *
 * @example Routed as `site/voice` under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, map, of, startWith, switchMap } from 'rxjs';
import { ApiService, type VoiceNumber, type VoiceConversation } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';
import { RelativeDatePipe } from './relative-date.pipe';
import { V2SiteContextService } from '../v2-site-context.service';

type VoiceState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; numbers: VoiceNumber[]; convos: VoiceConversation[] };

@Component({
  selector: 'app-v2-site-voice',
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
    @if (!ctx.selectedSite()) {
      <div hlmCard class="max-w-md mx-auto mt-16 text-center" data-testid="v2-site-voice-nosite">
        <h3 hlmCardTitle>No site selected</h3>
        <p hlmCardDescription class="mt-1">Pick a project from the dropdown above to see its voice activity.</p>
      </div>
    } @else {
      <div class="mb-3">
        <h2 class="text-lg font-semibold text-foreground">Voice</h2>
        <p class="text-sm text-muted-foreground">Phone numbers &amp; conversations for {{ ctx.selectedSite()!.business_name }}</p>
      </div>

      @switch (state().status) {
        @case ('loading') {
          <div class="flex flex-col gap-3" data-testid="v2-site-voice-loading">
            <div hlmCard class="h-16 animate-pulse opacity-60"></div>
            @for (s of [0,1,2]; track s) { <div hlmCard class="h-12 animate-pulse opacity-60"></div> }
          </div>
        }
        @case ('error') {
          <div hlmCard class="max-w-md mx-auto mt-12 text-center" role="alert" data-testid="v2-site-voice-error">
            <h3 hlmCardTitle>Couldn't load voice</h3>
            <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
            <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
          </div>
        }
        @case ('ready') {
          <!-- Provisioned numbers -->
          <div hlmCard class="mb-3" data-testid="v2-site-voice-numbers">
            <h3 hlmCardTitle>Numbers</h3>
            @if (numbers().length === 0) {
              <p hlmCardDescription class="mt-1">No phone numbers provisioned for this site yet.</p>
            } @else {
              <ul class="mt-3 flex flex-col gap-2">
                @for (n of numbers(); track n.id) {
                  <li class="flex items-center gap-3 text-sm" data-testid="v2-site-voice-number">
                    <span class="h-1.5 w-1.5 rounded-full shrink-0" [class]="numberDot(n.status)" aria-hidden="true"></span>
                    <span class="font-mono text-foreground">{{ n.vanity_display || n.phone_number }}</span>
                    @if (n.friendly_name) { <span class="text-muted-foreground truncate">{{ n.friendly_name }}</span> }
                    <span class="flex-1"></span>
                    @if (n.monthly_cost_cents != null) { <span class="text-xs text-muted-foreground tabular-nums shrink-0">{{ cost(n.monthly_cost_cents) }}/mo</span> }
                    <span hlmBadge [variant]="numberVariant(n.status)" class="shrink-0">{{ n.status || 'active' }}</span>
                  </li>
                }
              </ul>
            }
          </div>

          <!-- Conversation feed -->
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-foreground">Conversations</h3>
            <span class="text-xs text-muted-foreground tabular-nums">{{ convos().length }}</span>
          </div>
          @if (convos().length === 0) {
            <div hlmCard class="text-center py-8" data-testid="v2-site-voice-convos-empty">
              <p hlmCardDescription>No calls or messages recorded yet.</p>
            </div>
          } @else {
            <ul hlmCard class="p-0 divide-y divide-border/50" data-testid="v2-site-voice-convos">
              @for (cv of convos(); track cv.id) {
                <li class="flex items-start gap-3 px-3 py-2.5 text-sm" data-testid="v2-site-voice-convo-row">
                  <span hlmBadge [variant]="kindVariant(cv)" class="shrink-0 mt-0.5">{{ kindLabel(cv) }}</span>
                  <div class="flex-1 min-w-0">
                    <p class="font-mono text-xs text-foreground truncate">{{ cv.from_number || '?' }} → {{ cv.to_number || '?' }}</p>
                    @if (cv.summary) { <p class="text-xs text-muted-foreground line-clamp-2">{{ cv.summary }}</p> }
                  </div>
                  @if (cv.sentiment) { <span hlmBadge [variant]="sentimentVariant(cv.sentiment)" class="shrink-0">{{ cv.sentiment }}</span> }
                  @if (cv.duration_seconds != null && cv.duration_seconds > 0) { <span class="text-xs text-muted-foreground tabular-nums shrink-0">{{ dur(cv.duration_seconds) }}</span> }
                  <span class="text-xs text-muted-foreground shrink-0 tabular-nums" [title]="cv.event_at || ''">{{ (cv.event_at || '') | relativeDate }}</span>
                </li>
              }
            </ul>
          }
        }
      }
    }
  `,
})
export class V2SiteVoiceComponent {
  private readonly api = inject(ApiService);
  protected readonly ctx = inject(V2SiteContextService);

  protected readonly state = toSignal(
    toObservable(this.ctx.selectedSite).pipe(
      switchMap((site) =>
        site
          ? forkJoin({
              numbers: this.api.getVoiceNumbers(site.id),
              convos: this.api.getVoiceConversations(site.id),
            }).pipe(
              map((r) => ({ status: 'ready', numbers: r.numbers.numbers ?? [], convos: r.convos.items ?? [] }) as VoiceState),
              startWith({ status: 'loading' } as VoiceState),
              catchError((e: unknown) =>
                of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as VoiceState),
              ),
            )
          : of({ status: 'ready', numbers: [], convos: [] } as VoiceState),
      ),
    ),
    { initialValue: { status: 'loading' } as VoiceState },
  );

  protected readonly numbers = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.numbers : [];
  });
  protected readonly convos = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.convos : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected cost(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }
  protected dur(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  protected kindLabel(cv: VoiceConversation): string {
    const arrow = (cv.direction || '').toLowerCase().includes('out') ? '↑' : '↓';
    return `${cv.kind === 'sms' ? 'SMS' : 'Call'} ${arrow}`;
  }
  protected kindVariant(cv: VoiceConversation): BadgeVariant {
    return cv.kind === 'sms' ? 'info' : 'neutral';
  }

  protected numberDot(status: string | null | undefined): string {
    const s = (status || '').toLowerCase();
    if (s.includes('released') || s.includes('error') || s.includes('suspend')) return 'bg-[#ff4d6d]';
    if (s.includes('pending') || s.includes('provision')) return 'bg-[#ffd166]';
    return 'bg-[#4dffb5]'; // active / blank default
  }
  protected numberVariant(status: string | null | undefined): BadgeVariant {
    const s = (status || 'active').toLowerCase();
    if (s.includes('active')) return 'success';
    if (s.includes('released') || s.includes('error') || s.includes('suspend')) return 'danger';
    if (s.includes('pending') || s.includes('provision')) return 'warning';
    return 'neutral';
  }
  protected sentimentVariant(sentiment: string): BadgeVariant {
    const s = (sentiment || '').toLowerCase();
    if (s.includes('pos') || s.includes('happy')) return 'success';
    if (s.includes('neg') || s.includes('angry') || s.includes('frustrat')) return 'danger';
    return 'neutral';
  }

  protected reload(): void {
    location.reload();
  }
}
