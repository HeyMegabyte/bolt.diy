/**
 * @component AdminReviewLinksComponent
 * @description `/admin/review-links` — Review/Approval Links (#4) management for
 * the selected site. Create a shareable preview+approve link a stakeholder uses
 * to approve/reject before publish (the public `/review/:id` page), and list
 * existing links with their derived status.
 *
 * Cyan/black cockpit. Backend (`/api/sites/:siteId/review-links`) is flag-gated
 * (`approval_workflow`) — 404 when off → friendly "not available" message.
 */

import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';
import { RevealDirective } from '../../../directives/reveal.directive';
import { SkeletonComponent, EmptyStateComponent, ErrorCardComponent, FlagGateNoticeComponent } from '../../../components/states';
import { HlmButtonDirective } from '../../../ui';

interface ReviewLink {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired';
  url: string;
  expiresAt: string;
  usedAt: string | null;
}

@Component({
  selector: 'app-admin-review-links',
  standalone: true,
  imports: [CommonModule, FormsModule, RevealDirective, HlmButtonDirective, SkeletonComponent, EmptyStateComponent, ErrorCardComponent, FlagGateNoticeComponent],
  template: `
    <section class="max-w-3xl mx-auto px-5 py-7" appReveal>
      <header class="mb-6">
        <p class="font-mono uppercase tracking-wider text-[0.7rem] text-primary mb-1">Collaboration</p>
        <h2 class="text-2xl font-semibold text-light">Review &amp; Approval Links</h2>
        <p class="text-text-secondary text-sm mt-1 max-w-prose">
          Share a private link so a client can preview and approve the site before it goes live.
        </p>
      </header>

      @if (!site()) {
        <div data-testid="review-links-empty" class="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 text-center">
          <p class="text-text-secondary text-sm">Select a site from <strong class="text-light">Sites</strong> to manage its review links.</p>
        </div>
      } @else {
        @if (createdUrl(); as u) {
          <div data-testid="review-links-created" role="status" class="mb-5 rounded-xl border border-primary/30 bg-primary/[0.06] p-4 flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm text-light font-semibold mb-1">Review link created</p>
              <code class="block text-[0.8rem] text-primary break-all">{{ u }}</code>
            </div>
            <button hlmBtn variant="ghost" size="sm" data-testid="review-links-copy" (click)="copy(u)">Copy</button>
          </div>
        }

        <div class="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 flex items-center gap-3 mb-6">
          <button hlmBtn data-testid="review-links-create-btn" [disabled]="creating() || flagDisabled()" [attr.aria-busy]="creating()" (click)="create()">
            {{ creating() ? 'Creating…' : 'Create review link' }}
          </button>
          <span class="text-[0.72rem] text-text-secondary">Valid for 7 days · stakeholder can approve or request changes</span>
        </div>

        @if (flagDisabled()) {
          <!-- Flag OFF (404) → calm cohesive cyan notice (NOT alarming red). Shared primitive. -->
          <app-flag-gate-notice feature="Review links" flag="approval_workflow" [plural]="true" testid="review-links-flag-gate" margin="mb-5" />
        } @else if (error()) {
          <app-error-card data-testid="review-links-error" class="block mb-5"
            title="Couldn't load review links"
            message="Check your connection and retry."
            [correlationId]="loadErrorRef()"
            (retry)="load()" />
        }

        @if (loading()) {
          <app-skeleton variant="table" [rows]="3" data-testid="review-links-loading" />
        } @else if (!error() && !flagDisabled() && links().length === 0) {
          <app-empty-state data-testid="review-links-none" icon="🔗" title="No review links yet"
            body="Create a shareable approval link above so a stakeholder can preview and sign off before publish." />
        } @else if (links().length > 0) {
          <ul class="flex flex-col gap-2">
            @for (l of links(); track l.id) {
              <li data-testid="review-links-row" class="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2.5">
                <div class="min-w-0">
                  <code class="text-[0.82rem] text-light truncate block" [attr.title]="l.url">{{ l.url }}</code>
                  <span class="text-[0.7rem] text-text-secondary tabular-nums">expires {{ l.expiresAt | date: 'MMM d, y' }}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <span [class]="statusClass(l.status)" class="text-[0.7rem] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full" data-testid="review-links-status">{{ l.status }}</span>
                  <button hlmBtn variant="ghost" size="sm" data-testid="review-links-copy-row" (click)="copy(absolute(l.url))">Copy</button>
                </div>
              </li>
            }
          </ul>
        }
      }
    </section>
  `,
})
export class AdminReviewLinksComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly state = inject(AdminStateService);

  readonly site = computed(() => this.state.selectedSite());
  readonly links = signal<ReviewLink[]>([]);
  readonly loading = signal(false);
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);
  /** Flag OFF (load 404 = approval_workflow disabled) → calm cyan Feature-Flags notice, NOT a red error. */
  readonly flagDisabled = signal(false);
  /** True when the load error is transient (not a 404 feature-gate) → show a Retry. */
  readonly errorRetryable = signal(false);
  /** Worker request_id from a failed load → the copyable support reference on the error card. */
  readonly loadErrorRef = signal('');
  readonly createdUrl = signal<string | null>(null);

  private loadedSiteId: string | null = null;

  constructor() {
    // Site-reactive load: the selected site may resolve AFTER mount on a deep-link.
    effect(() => {
      const id = this.site()?.id ?? null;
      if (id && id !== this.loadedSiteId) {
        this.loadedSiteId = id;
        this.load();
      }
    });
  }

  private siteId(): string | null {
    return this.site()?.id ?? null;
  }

  /** Absolute reviewer URL for copy/share (the API returns a relative `/review/:id`). */
  absolute(url: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://projectsites.dev';
    return url.startsWith('http') ? url : `${origin}${url}`;
  }

  statusClass(status: ReviewLink['status']): string {
    switch (status) {
      case 'approved':
        return 'bg-primary/15 text-primary';
      case 'pending':
        return 'bg-white/10 text-light';
      case 'rejected':
        return 'bg-red-500/15 text-red-300';
      default: // revoked | expired
        return 'bg-white/5 text-text-secondary';
    }
  }

  load(): void {
    const id = this.siteId();
    if (!id) return;
    this.loading.set(true);
    this.error.set(null);
    this.errorRetryable.set(false);
    this.flagDisabled.set(false);
    this.loadErrorRef.set('');
    this.api.get<{ ok: boolean; links: ReviewLink[] }>(`/sites/${id}/review-links`, undefined, { silent: true }).subscribe({
      next: (res) => {
        // Shape guard: ApiService only remaps a 2xx→404 when the body FAILS to
        // parse. A stale worker route returning a parseable-but-shapeless 200
        // ({} or an SPA/marketing-HTML fallthrough that's valid JSON) flows
        // straight through here. `res.links ?? []` would mask it as a fake-empty
        // "No review links yet" (or crash the @for on a non-array). Treat a
        // shapeless 200 as an honest, retryable error — never a silent empty.
        if (!res || !Array.isArray(res.links)) {
          this.error.set("Couldn't load review links — the response was unexpected. Retry.");
          this.errorRetryable.set(true);
          this.links.set([]);
          this.loading.set(false);
          return;
        }
        this.links.set(res.links);
        this.loading.set(false);
      },
      // 404 = approval_workflow flag OFF (permanent → calm cyan Feature-Flags notice,
      // NOT alarming red; a worker SPA-fallthrough 200+HTML is remapped to 404 by
      // ApiService so it lands here as the calm gate too). Anything else = transient
      // (→ app-error-card with Retry + request_id).
      error: (err: { status?: number; error?: unknown }) => {
        if (err?.status === 404) {
          this.flagDisabled.set(true);
        } else {
          this.error.set("Couldn't load review links — check your connection and retry.");
          this.errorRetryable.set(true);
          this.loadErrorRef.set(this.requestIdFrom(err));
        }
        this.loading.set(false);
      },
    });
  }

  /** Pull the worker request_id from a failed response ({ error: { request_id } }) for the support reference. */
  private requestIdFrom(e: { error?: unknown } | undefined): string {
    return (e?.error as { error?: { request_id?: string } } | undefined)?.error?.request_id ?? '';
  }

  create(): void {
    const id = this.siteId();
    if (!id || this.creating()) return;
    this.creating.set(true);
    this.createdUrl.set(null);
    this.api.post<{ ok: boolean; id: string; url: string; expiresAt: string }>(`/sites/${id}/review-links`, {}, { silent: true }).subscribe({
      next: (res) => {
        this.createdUrl.set(this.absolute(res.url));
        this.toast.success('Review link created.');
        this.creating.set(false);
        this.load();
      },
      error: (err: unknown) => {
        const msg = (err as { error?: { error?: { message?: string } } })?.error?.error?.message ?? 'Could not create the review link.';
        this.toast.error(msg);
        this.creating.set(false);
      },
    });
  }

  async copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.toast.success('Link copied to clipboard.');
    } catch {
      this.toast.error(`Copy failed — copy manually: ${url}`);
    }
  }
}
