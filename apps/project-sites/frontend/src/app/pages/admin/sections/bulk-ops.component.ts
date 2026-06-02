/**
 * @component AdminBulkOpsComponent
 * @description `/admin/bulk-ops` — Bulk Site Ops (#17) preview surface.
 *
 * Cyan/black compact cockpit per [[cyan-black-compact-progression]]. Lets an
 * operator preview a bulk operation (archive / set_flag / republish) across ALL
 * their sites before applying — the safety-preview half of the feature. Calls
 * `POST /api/sites/bulk` with `dryRun: true` and renders the validated plan:
 * an eligible count (rolling counter) + a table of skipped sites with reasons.
 *
 * Apply (dryRun:false) is intentionally NOT wired from the UI yet — the backend
 * supports archive + set_flag, but a destructive bulk apply gets its own slice
 * with a confirm dialog. This surface is read-only preview.
 *
 * The numeric stat uses `<app-rolling-counter>` per the standing cinematic-ui
 * rule (every numeric stat rolls).
 */

import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { RevealDirective } from '../../../directives/reveal.directive';
import { HlmButtonDirective, HlmInputDirective } from '../../../ui';

type BulkOperation = 'archive' | 'set_flag' | 'republish';

interface BulkSkip {
  id: string;
  reason: string;
}
interface BulkPlan {
  operation: string;
  eligible: string[];
  skipped: BulkSkip[];
  cappedAt: number | null;
}
interface BulkPreviewResponse {
  ok: boolean;
  dryRun: boolean;
  plan: BulkPlan;
}

@Component({
  selector: 'app-admin-bulk-ops',
  standalone: true,
  imports: [CommonModule, FormsModule, RollingCounterComponent, RevealDirective, HlmButtonDirective, HlmInputDirective],
  template: `
    <section class="max-w-3xl mx-auto px-5 py-7" appReveal>
      <header class="mb-6">
        <p class="font-mono uppercase tracking-wider text-[0.7rem] text-primary mb-1">Agency leverage</p>
        <h2 class="text-2xl font-semibold text-light">Bulk Site Ops</h2>
        <p class="text-text-secondary text-sm mt-1 max-w-prose">
          Preview a change across <strong>all your sites</strong> before applying. Shows exactly which sites
          are eligible and which are skipped — and why.
        </p>
      </header>

      <div class="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 flex flex-col gap-4">
        <label class="flex flex-col gap-1.5">
          <span class="text-[0.72rem] uppercase tracking-wide text-text-secondary">Operation</span>
          <select
            data-testid="bulk-ops-operation"
            class="bg-dark border border-white/[0.12] rounded-lg px-3 py-2 text-text text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            [(ngModel)]="operationModel"
            (ngModelChange)="onOperationChange($event)"
          >
            <option value="archive">Archive sites</option>
            <option value="set_flag">Set a feature flag</option>
            <option value="republish">Republish sites</option>
          </select>
        </label>

        @if (isSetFlag()) {
          <div class="flex flex-col gap-3 sm:flex-row sm:items-end" data-testid="bulk-ops-setflag-fields">
            <label class="flex flex-col gap-1.5 flex-1">
              <span class="text-[0.72rem] uppercase tracking-wide text-text-secondary">Flag key</span>
              <input
                hlmInput
                data-testid="bulk-ops-flagkey"
                placeholder="e.g. review_synthesis"
                [(ngModel)]="flagKeyModel"
              />
            </label>
            <label class="inline-flex items-center gap-2 pb-2 cursor-pointer">
              <input type="checkbox" data-testid="bulk-ops-enabled" class="accent-primary w-4 h-4" [(ngModel)]="enabledModel" />
              <span class="text-sm text-light">Enabled</span>
            </label>
          </div>
        }

        <div class="flex items-center gap-3">
          <button
            hlmBtn
            data-testid="bulk-ops-preview-btn"
            [disabled]="loading()"
            (click)="preview()"
          >
            {{ loading() ? 'Previewing…' : 'Preview impact' }}
          </button>
          <span class="text-[0.72rem] text-text-secondary">Read-only — nothing is changed.</span>
        </div>
      </div>

      @if (error()) {
        <div data-testid="bulk-ops-error" role="alert" class="mt-5 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-300">
          {{ error() }}
        </div>
      }

      @if (plan(); as p) {
        <div data-testid="bulk-ops-result" class="mt-6 rounded-xl border border-white/[0.08] bg-white/[0.02] p-5" appReveal>
          <div class="flex items-baseline gap-2">
            <app-rolling-counter [value]="p.eligible.length" />
            <span class="text-text-secondary text-sm">site(s) eligible for <strong class="text-light">{{ p.operation }}</strong></span>
            @if (p.cappedAt !== null) {
              <span class="ml-2 text-[0.7rem] text-amber-300/90">capped at {{ p.cappedAt }}</span>
            }
          </div>

          @if (p.skipped.length > 0) {
            <div class="mt-4">
              <p class="text-[0.72rem] uppercase tracking-wide text-text-secondary mb-2">Skipped ({{ p.skipped.length }})</p>
              <ul class="flex flex-col gap-1.5">
                @for (s of p.skipped; track s.id) {
                  <li data-testid="bulk-ops-skip-row" class="flex items-center justify-between gap-3 text-[0.8rem] rounded-lg bg-white/[0.03] px-3 py-2">
                    <code class="text-text-secondary truncate">{{ s.id }}</code>
                    <span class="text-amber-300/90 shrink-0">{{ s.reason }}</span>
                  </li>
                }
              </ul>
            </div>
          } @else {
            <p class="mt-3 text-sm text-text-secondary">No sites skipped — the operation applies cleanly to every site.</p>
          }
        </div>
      }
    </section>
  `,
})
export class AdminBulkOpsComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly operationModel = signal<BulkOperation>('archive');
  readonly flagKeyModel = signal('');
  readonly enabledModel = signal(true);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly plan = signal<BulkPlan | null>(null);

  readonly isSetFlag = computed(() => this.operationModel() === 'set_flag');

  onOperationChange(_op: BulkOperation): void {
    // Switching operation invalidates a prior preview to avoid a stale plan.
    this.plan.set(null);
    this.error.set(null);
  }

  preview(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);

    const body: Record<string, unknown> = { operation: this.operationModel(), allSites: true, dryRun: true };
    if (this.operationModel() === 'set_flag') {
      body['flagKey'] = this.flagKeyModel().trim();
      body['enabled'] = this.enabledModel();
    }

    this.api.post<BulkPreviewResponse>('/sites/bulk', body).subscribe({
      next: (res) => {
        this.plan.set(res.plan);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const msg =
          (err as { error?: { error?: { message?: string } } })?.error?.error?.message ??
          'Could not preview the bulk operation.';
        this.error.set(msg);
        this.toast.error(msg);
        this.loading.set(false);
      },
    });
  }
}
