/**
 * @component ReviewComponent
 * @description Public `/review/:id` page (#4 review_approval_links) — the
 * stakeholder-facing approval surface. The reviewer opens a shared link (no
 * login; the unguessable UUID id is the bearer), sees the current status, and
 * approves / rejects it.
 *
 * Reads `GET /api/review/:id` and posts to `POST /api/review/:id/decision`.
 * Cyan/black product styling. Self-contained (not inside the admin shell).
 */

import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { HlmButtonDirective } from '../../ui';

interface ReviewView {
  id: string;
  site_id: string;
  status: string;
  expires_at: string;
}
interface ReviewResponse {
  ok: boolean;
  review: ReviewView;
}
interface DecisionResponse {
  ok: boolean;
  status: string;
}

@Component({
  selector: 'app-review',
  standalone: true,
  imports: [CommonModule, HlmButtonDirective],
  template: `
    <main class="min-h-screen bg-dark text-light flex items-center justify-center px-5 py-10">
      <div class="w-full max-w-md rounded-2xl border border-white/[0.08] bg-white/[0.02] p-7">
        <p class="font-mono uppercase tracking-wider text-[0.7rem] text-primary mb-1">Review &amp; approve</p>
        <h1 class="text-xl font-semibold mb-4">Site review</h1>

        @if (loading()) {
          <p data-testid="review-loading" class="text-text-secondary text-sm">Loading review…</p>
        } @else if (error()) {
          <p data-testid="review-error" role="alert" class="text-sm text-red-300">{{ error() }}</p>
        } @else if (review(); as r) {
          <div class="flex items-center gap-2 mb-5">
            <span class="text-text-secondary text-sm">Status:</span>
            <span data-testid="review-status" [class]="statusClass(r.status)" class="text-sm font-semibold capitalize">{{ r.status }}</span>
          </div>

          @if (canDecide()) {
            <p class="text-text-secondary text-sm mb-4">Approve to let this site go live, or reject to send it back for changes.</p>
            <div class="flex gap-3">
              <button hlmBtn data-testid="review-approve" [disabled]="deciding()" (click)="decide('approve')">Approve</button>
              <button hlmBtn variant="outline" data-testid="review-reject" [disabled]="deciding()" (click)="decide('reject')">Request changes</button>
            </div>
          } @else {
            <p data-testid="review-decided" class="text-sm text-text-secondary">
              This review is <strong class="text-light capitalize">{{ r.status }}</strong> — no further action needed.
            </p>
          }
        }
      </div>
    </main>
  `,
})
export class ReviewComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly review = signal<ReviewView | null>(null);
  readonly deciding = signal(false);

  readonly canDecide = computed(() => this.review()?.status === 'pending');

  constructor() {
    this.load();
  }

  statusClass(status: string): string {
    if (status === 'approved') return 'text-primary';
    if (status === 'rejected' || status === 'expired') return 'text-amber-300';
    return 'text-light';
  }

  private load(): void {
    if (!this.id) {
      this.error.set('This review link is invalid.');
      this.loading.set(false);
      return;
    }
    this.api.get<ReviewResponse>(`/review/${this.id}`).subscribe({
      next: (res) => {
        this.review.set(res.review);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('This review link was not found or has expired.');
        this.loading.set(false);
      },
    });
  }

  decide(action: 'approve' | 'reject'): void {
    if (this.deciding() || !this.canDecide()) return;
    this.deciding.set(true);
    this.api.post<DecisionResponse>(`/review/${this.id}/decision`, { action }).subscribe({
      next: (res) => {
        this.review.update((r) => (r ? { ...r, status: res.status } : r));
        this.toast.success(action === 'approve' ? 'Approved — thank you!' : 'Sent back for changes.');
        this.deciding.set(false);
      },
      error: (err: unknown) => {
        const msg =
          (err as { error?: { error?: { message?: string } } })?.error?.error?.message ??
          'Could not record your decision.';
        this.toast.error(msg);
        this.deciding.set(false);
      },
    });
  }
}
