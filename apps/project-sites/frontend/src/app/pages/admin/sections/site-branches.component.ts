/**
 * Admin → Sites → Branches
 *
 * Branch-style preview management for a single site (#27).
 * Accessible via `/admin/sites/:id/branches`.
 *
 * Rows are ≤36px high per [[cyan-black-compact-progression]].
 * Stats use `<app-rolling-counter>` for live branch counts.
 * Sections fade in via `appReveal`.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { ApiService } from '../../../services/api.service';
import { catchError, of } from 'rxjs';
import { ToastService } from '../../../services/toast.service';
import { ConfirmService } from '../../../services/confirm.service';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { RevealDirective } from '../../../directives/reveal.directive';
import { EmptyStateComponent, ErrorCardComponent } from '../../../components/states';
import { HlmInputDirective, HlmButtonDirective } from '../../../ui';

interface Branch {
  id: string;
  branch_name: string;
  status: 'draft' | 'review' | 'merged' | 'closed';
  preview_url: string | null;
  approvals_required: number;
  approvals_received: number;
  created_by: string;
  created_at: string;
}

@Component({
  selector: 'app-site-branches',
  standalone: true,
  imports: [FormsModule, RouterModule, RollingCounterComponent, RevealDirective, EmptyStateComponent, ErrorCardComponent, HlmInputDirective, HlmButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      /* Cyan approval-progress track — fills toward merge-ready */
      .branch-approvals-track {
        position: relative;
        display: inline-block;
        width: 64px;
        height: 5px;
        border-radius: 999px;
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent);
        overflow: hidden;
      }
      .branch-approvals-fill {
        position: absolute;
        inset: 0 auto 0 0;
        border-radius: 999px;
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 55%, transparent);
        transition: width 360ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .branch-approvals-fill.is-complete {
        background: var(--ps-accent, #00e5ff);
        box-shadow: 0 0 8px color-mix(in oklch, var(--ps-accent, #00e5ff) 60%, transparent);
      }
      /* Live "In Review" stat pulses a cyan halo to draw the eye */
      .branch-stat--live :is(app-rolling-counter) {
        color: var(--ps-accent, #00e5ff);
        animation: branchStatPulse 2.4s ease-in-out infinite;
      }
      @keyframes branchStatPulse {
        0%,
        100% {
          text-shadow: 0 0 0 transparent;
        }
        50% {
          text-shadow: 0 0 10px color-mix(in oklch, var(--ps-accent, #00e5ff) 55%, transparent);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .branch-approvals-fill {
          transition: none;
        }
        .branch-stat--live :is(app-rolling-counter) {
          animation: none;
        }
      }
    `,
  ],
  template: `
    <section class="p-5 max-w-5xl" data-testid="site-branches">
      <header class="flex items-start justify-between gap-4 flex-wrap mb-4" appReveal>
        <div>
          <h1 class="text-lg font-semibold text-white">Branches</h1>
          <p class="text-text-secondary text-xs mt-0.5">Branch-style site previews — create an isolated preview, gather approvals, then merge to production.</p>
        </div>
        <button hlmBtn variant="primary" size="sm" type="button" (click)="showCreate.set(!showCreate())" [disabled]="!siteId" data-testid="branch-new-toggle">
          {{ showCreate() ? 'Cancel' : '+ New branch' }}
        </button>
      </header>

      <!-- Stats -->
      <div class="flex gap-6 mb-4 rounded-xl border-l-2 border-accent/40 border-y border-r border-white/6 bg-white/2 px-5 py-3" appReveal role="group" aria-label="Branch statistics">
        @for (s of stats(); track s.label) {
          <div class="flex flex-col" [class.branch-stat--live]="s.label === 'In Review' && s.value > 0">
            <app-rolling-counter [value]="s.value" [duration]="900" />
            <span class="text-[0.6rem] uppercase tracking-wide text-text-secondary font-semibold">{{ s.label }}</span>
          </div>
        }
      </div>

      <!-- Create form -->
      @if (showCreate()) {
        <form class="flex items-end gap-3 flex-wrap mb-4 rounded-xl border border-accent/20 bg-accent/4 p-4" (submit)="$event.preventDefault(); createBranch()" appReveal>
          <label class="flex flex-col gap-1 text-[0.72rem] text-text-secondary flex-1 min-w-[200px]">
            Branch name
            <input hlmInput type="text" name="branchName" [(ngModel)]="newBranchName" placeholder="e.g. homepage-redesign" data-testid="branch-name-input" />
          </label>
          <label class="flex flex-col gap-1 text-[0.72rem] text-text-secondary w-32">
            Approvals required
            <input hlmInput type="number" name="approvals" min="1" max="10" [(ngModel)]="newApprovalsRequired" />
          </label>
          <button hlmBtn variant="primary" size="sm" type="submit" [disabled]="creating() || !newBranchName.trim()" data-testid="branch-create-submit">
            {{ creating() ? 'Creating…' : 'Create branch' }}
          </button>
        </form>
      }

      <!-- Loading skeleton -->
      @if (loading()) {
        <div class="flex flex-col gap-2" role="status" aria-busy="true" aria-label="Loading branches">
          @for (r of skeletonRows; track r) {
            <span class="glow-skel block w-full h-9 rounded-lg" aria-hidden="true"></span>
          }
        </div>
      } @else if (loadError(); as err) {
        <app-error-card
          data-testid="branches-error"
          title="Couldn't load branches"
          [message]="err"
          [correlationId]="loadErrorRef()"
          (retry)="loadBranches()" />
      } @else if (branches().length === 0) {
        <app-empty-state
          icon="⎇"
          title="No branches yet"
          [message]="siteId ? 'Create a branch to preview changes in isolation before merging to production.' : 'Select a site to manage its branches.'"
          [ctaLabel]="siteId ? 'Create branch' : ''"
          (ctaClick)="showCreate.set(true)" />
      } @else {
        <div class="rounded-xl border border-white/6 overflow-hidden" role="region" aria-label="Branches" appReveal>
          <table class="w-full text-[0.8rem] text-left">
            <caption class="sr-only">Site preview branches with status, approval progress, and lifecycle actions</caption>
            <thead>
              <tr class="bg-white/3 text-text-secondary text-[0.62rem] uppercase tracking-wide">
                <th scope="col" class="px-3 py-2 font-semibold">Branch</th>
                <th scope="col" class="px-3 py-2 font-semibold">Status</th>
                <th scope="col" class="px-3 py-2 font-semibold">Approvals</th>
                <th scope="col" class="px-3 py-2 font-semibold">Created</th>
                <th scope="col" class="px-3 py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (b of branches(); track b.id) {
                <tr class="border-t border-white/4 hover:bg-white/2">
                  <td class="px-3 py-2">
                    <div class="flex flex-col">
                      <span class="text-white font-medium">{{ b.branch_name }}</span>
                      @if (b.preview_url) {
                        <a [href]="b.preview_url" target="_blank" rel="noopener noreferrer" class="text-accent text-[0.68rem] hover:underline">Preview ↗</a>
                      }
                    </div>
                  </td>
                  <td class="px-3 py-2"><span [class]="'status-pill ' + statusPill(b.status)">{{ b.status }}</span></td>
                  <td class="px-3 py-2">
                    <div class="flex items-center gap-2">
                      <span class="branch-approvals-track" role="progressbar"
                            [attr.aria-valuenow]="b.approvals_received" aria-valuemin="0" [attr.aria-valuemax]="b.approvals_required"
                            [attr.aria-label]="b.approvals_received + ' of ' + b.approvals_required + ' approvals received'">
                        <span class="branch-approvals-fill" [class.is-complete]="canMerge(b)"
                              [style.width.%]="approvalPct(b)"></span>
                      </span>
                      <span class="text-text-secondary tabular-nums text-[0.7rem]">{{ b.approvals_received }} / {{ b.approvals_required }}</span>
                    </div>
                  </td>
                  <td class="px-3 py-2 text-text-secondary">{{ formatDate(b.created_at) }}</td>
                  <td class="px-3 py-2">
                    <div class="flex gap-1.5 justify-end items-center">
                      @if (actioning() === b.id) {
                        <span class="text-text-secondary text-[0.68rem]" role="status" aria-live="polite" [attr.aria-label]="'Working on ' + b.branch_name">…</span>
                      } @else {
                        @if (b.status === 'draft') {
                          <button hlmBtn variant="ghost" size="sm" type="button" (click)="requestReview(b.id)" [attr.aria-label]="'Request review for ' + b.branch_name">Request review</button>
                        }
                        @if (b.status === 'review') {
                          <button hlmBtn variant="ghost" size="sm" type="button" (click)="approve(b.id)" [attr.aria-label]="'Approve ' + b.branch_name">Approve</button>
                          @if (canMerge(b)) {
                            <button hlmBtn variant="primary" size="sm" type="button" (click)="mergeBranch(b)" [attr.aria-label]="'Merge ' + b.branch_name + ' to production'">Merge</button>
                          }
                        }
                        @if (b.status === 'draft' || b.status === 'review') {
                          <button hlmBtn variant="ghost" size="sm" type="button" (click)="closeBranch(b.id)" aria-label="Close branch">Close</button>
                        }
                        @if (b.status === 'merged' || b.status === 'closed') {
                          <span class="text-text-secondary text-[0.68rem]">—</span>
                        }
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class SiteBranchesComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  // ApiService (not raw HttpClient) so every /api/sites/:id/branches* call carries
  // the auth bearer + 401-handling — raw http.* sent no Authorization → 401 (the
  // same bug fixed in site-mcp-server). See [[admin-raw-httpclient-auth-gap]].
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirmSvc = inject(ConfirmService);

  readonly branches = signal<Branch[]>([]);
  readonly loading = signal(true);
  /** Set when the branches fetch fails so we show a distinct error card with a
   *  Retry instead of the misleading "No branches yet" empty state. */
  readonly loadError = signal<string | null>(null);
  /** Worker request_id from the failed fetch → shown as the copyable support
   *  reference on the error card (empty string when none was returned). */
  readonly loadErrorRef = signal('');
  readonly showCreate = signal(false);
  readonly creating = signal(false);
  readonly actioning = signal<string | null>(null);

  newBranchName = '';
  newApprovalsRequired = 1;

  protected siteId = '';

  readonly inReviewCount = computed(() => this.branches().filter((b) => b.status === 'review').length);
  readonly stats = computed(() => [
    { label: 'Total', value: this.branches().length },
    { label: 'In Review', value: this.inReviewCount() },
    { label: 'Merged', value: this.branches().filter((b) => b.status === 'merged').length },
  ]);

  ngOnInit(): void {
    this.siteId = this.route.parent?.snapshot.params['id'] ?? this.route.snapshot.params['id'] ?? '';
    this.loadBranches();
  }

  loadBranches(): void {
    if (!this.siteId) return;
    this.loading.set(true);
    this.loadError.set(null);
    this.loadErrorRef.set('');
    this.api
      .get<{ branches: Branch[] }>(`/sites/${this.siteId}/branches`, undefined, { silent: true })
      .pipe(catchError((err: HttpErrorResponse) => {
        this.loadError.set('Could not load branches — check your connection and retry.');
        const ref = this.refOf(err);
        if (ref) this.loadErrorRef.set(ref);
        return of({ branches: [] as Branch[] });
      }))
      .subscribe((res) => {
        this.branches.set(res.branches);
        this.loading.set(false);
      });
  }

  /** Pull the worker request_id from a failed response ({ error: { request_id } }),
   *  falling back to the X-Request-ID response header. Empty when neither exists. */
  private refOf(err: unknown): string {
    const e = err as HttpErrorResponse;
    const fromBody = (e?.error as { error?: { request_id?: string } } | undefined)?.error?.request_id;
    return fromBody || e?.headers?.get?.('X-Request-ID') || '';
  }

  createBranch(): void {
    if (!this.newBranchName.trim()) return;
    this.creating.set(true);
    this.api
      .post<{ branch: Branch }>(`/sites/${this.siteId}/branches`, {
        branch_name: this.newBranchName.trim(),
        approvals_required: this.newApprovalsRequired,
      }, { silent: true })
      .pipe(catchError((err) => { this.toast.error(err?.error?.error ?? 'Failed to create branch'); return of(null); }))
      .subscribe((res) => {
        if (res?.branch) {
          this.branches.update((bs) => [res.branch, ...bs]);
          this.newBranchName = '';
          this.showCreate.set(false);
          this.toast.success(`Branch "${res.branch.branch_name}" created`);
        }
        this.creating.set(false);
      });
  }

  requestReview(branchId: string): void {
    this.actioning.set(branchId);
    this.api
      .post<{ branch: Branch }>(`/sites/${this.siteId}/branches/${branchId}/review`, {}, { silent: true })
      .pipe(catchError((err) => { this.toast.error(err?.error?.error ?? 'Failed'); return of(null); }))
      .subscribe((res) => {
        if (res?.branch) this.updateBranch(res.branch);
        this.actioning.set(null);
      });
  }

  readonly skeletonRows = [0, 1, 2];

  canMerge(b: Branch): boolean {
    return b.approvals_received >= b.approvals_required;
  }

  approve(branchId: string): void {
    this.actioning.set(branchId);
    this.api
      .post<{ branch: Branch; readyToMerge: boolean }>(`/sites/${this.siteId}/branches/${branchId}/approve`, {}, { silent: true })
      .pipe(catchError((err) => { this.toast.error(err?.error?.error ?? 'Failed'); return of(null); }))
      .subscribe((res) => {
        if (res?.branch) {
          this.updateBranch(res.branch);
          if (res.readyToMerge) this.toast.success('All approvals received — ready to merge!');
        }
        this.actioning.set(null);
      });
  }

  async mergeBranch(branch: Branch): Promise<void> {
    // Merging publishes the branch to the LIVE production site — verify first.
    const ok = await this.confirmSvc.confirm({
      title: 'Merge to production',
      message: `Merge "${branch.branch_name}" to production? This publishes the branch's content to your live site, replacing what visitors currently see.`,
      confirmLabel: 'Merge to production',
      danger: true,
    });
    if (!ok) return;
    // The build_version for a merged branch is auto-generated here as a timestamp.
    const buildVersion = `branch-merge-${Date.now()}`;
    this.actioning.set(branch.id);
    this.api
      .post<{ branch: Branch }>(`/sites/${this.siteId}/branches/${branch.id}/merge`, { build_version: buildVersion }, { silent: true })
      .pipe(catchError((err) => { this.toast.error(err?.error?.error ?? 'Merge failed'); return of(null); }))
      .subscribe((res) => {
        if (res?.branch) {
          this.updateBranch(res.branch);
          this.toast.success(`Branch "${branch.branch_name}" merged to production`);
        }
        this.actioning.set(null);
      });
  }

  closeBranch(branchId: string): void {
    this.actioning.set(branchId);
    this.api
      .post<{ branch: Branch }>(`/sites/${this.siteId}/branches/${branchId}/close`, {}, { silent: true })
      .pipe(catchError((err) => { this.toast.error(err?.error?.error ?? 'Failed'); return of(null); }))
      .subscribe((res) => {
        if (res?.branch) this.updateBranch(res.branch);
        this.actioning.set(null);
      });
  }

  private updateBranch(updated: Branch): void {
    this.branches.update((bs) => bs.map((b) => (b.id === updated.id ? updated : b)));
  }

  /** Map branch lifecycle status → shared global `.status-pill` modifier (cyan-first). */
  statusPill(status: string): string {
    return (
      {
        draft: 'is-idle',
        review: 'is-info', // cyan — active in the review loop
        merged: 'is-healthy',
        closed: 'is-degraded',
      }[status] ?? 'is-idle'
    );
  }

  /** Approval completion as a 0-100 percentage for the cyan progress track. */
  approvalPct(b: Branch): number {
    if (b.approvals_required <= 0) return 100;
    return Math.min(100, Math.round((b.approvals_received / b.approvals_required) * 100));
  }

  formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  }
}
