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
import { RouterModule, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { ToastService } from '../../../services/toast.service';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { RevealDirective } from '../../../directives/reveal.directive';

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
  imports: [FormsModule, RouterModule, RollingCounterComponent, RevealDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-5 flex-1 overflow-y-auto space-y-5 animate-fade-in" data-testid="site-branches">

      <!-- Header -->
      <header class="flex items-center justify-between gap-3 flex-wrap" appReveal>
        <div>
          <div class="kicker">Site Previews</div>
          <h2 class="section-h m-0 mt-1 flex items-center gap-2">
            Branches
            @if (inReviewCount() > 0) {
              <span class="header-pill">
                <span class="header-pill-dot" aria-hidden="true"></span>
                <app-rolling-counter [value]="inReviewCount()" suffix=" in review" />
              </span>
            }
          </h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1 max-w-prose">
            Each branch gets a live preview at
            <code class="text-accent text-[0.75rem]">{'{branch}'}--{'{slug}'}.projectsites.dev</code>.
            Merge to production once approved.
          </p>
        </div>

        <button
          class="btn-primary text-xs px-3 py-1.5"
          data-testid="create-branch-btn"
          (click)="showCreate.set(true)"
        >+ New Branch</button>
      </header>

      <!-- Stats row -->
      <div class="grid grid-cols-3 gap-3" appReveal>
        @for (stat of stats(); track stat.label) {
          <div class="card p-3 text-center">
            <app-rolling-counter [value]="stat.value" class="text-xl font-bold text-accent" />
            <div class="text-[0.7rem] text-text-secondary mt-0.5">{{ stat.label }}</div>
          </div>
        }
      </div>

      <!-- Create form -->
      @if (showCreate()) {
        <div class="card p-4 space-y-3" data-testid="create-branch-form" appReveal>
          <h3 class="text-sm font-semibold m-0">Create branch</h3>
          <div class="flex gap-2 flex-wrap">
            <input
              class="input flex-1 min-w-[180px]"
              placeholder="e.g. feat-new-hero"
              [(ngModel)]="newBranchName"
              data-testid="branch-name-input"
              [disabled]="creating()"
            />
            <input
              class="input w-20"
              type="number"
              min="1"
              max="10"
              [(ngModel)]="newApprovalsRequired"
              title="Approvals required"
              aria-label="Approvals required"
            />
            <button
              class="btn-primary text-xs px-3"
              data-testid="create-branch-submit"
              (click)="createBranch()"
              [disabled]="creating() || !newBranchName.trim()"
            >{{ creating() ? 'Creating…' : 'Create' }}</button>
            <button class="btn-ghost text-xs px-3" (click)="showCreate.set(false)">Cancel</button>
          </div>
        </div>
      }

      <!-- Branches table -->
      @if (loading() && branches().length === 0) {
        <div class="space-y-1.5" aria-busy="true">
          @for (i of [0,1,2]; track i) {
            <div class="skel h-9 rounded-lg w-full"></div>
          }
        </div>
      } @else if (branches().length === 0) {
        <div class="card p-6 text-center text-text-secondary text-sm">
          No branches yet. Create one to start a preview workflow.
        </div>
      } @else {
        <div class="card overflow-hidden" appReveal>
          <table class="w-full text-xs" data-testid="branches-table">
            <thead>
              <tr class="border-b border-white/5 text-text-secondary uppercase tracking-wider text-[0.65rem]">
                <th class="px-3 py-2 text-left font-medium">Branch</th>
                <th class="px-3 py-2 text-left font-medium">Status</th>
                <th class="px-3 py-2 text-left font-medium">Approvals</th>
                <th class="px-3 py-2 text-left font-medium">Preview</th>
                <th class="px-3 py-2 text-left font-medium">Created</th>
                <th class="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (b of branches(); track b.id) {
                <tr
                  class="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                  [attr.data-testid]="'branch-row-' + b.id"
                >
                  <td class="px-3 py-2 font-mono font-semibold text-accent">{{ b.branch_name }}</td>
                  <td class="px-3 py-2">
                    <span [class]="statusClass(b.status)">{{ b.status }}</span>
                  </td>
                  <td class="px-3 py-2 text-text-secondary">
                    {{ b.approvals_received }}/{{ b.approvals_required }}
                  </td>
                  <td class="px-3 py-2">
                    @if (b.preview_url) {
                      <a
                        [href]="b.preview_url"
                        target="_blank"
                        rel="noopener"
                        class="text-accent hover:underline truncate max-w-[180px] inline-block"
                      >{{ b.preview_url }}</a>
                    } @else {
                      <span class="text-text-secondary">—</span>
                    }
                  </td>
                  <td class="px-3 py-2 text-text-secondary">{{ formatDate(b.created_at) }}</td>
                  <td class="px-3 py-2">
                    <div class="flex items-center justify-end gap-1.5 flex-wrap">
                      @if (b.status === 'draft') {
                        <button
                          class="btn-ghost text-[0.68rem] px-2 py-0.5"
                          data-testid="request-review-btn"
                          (click)="requestReview(b.id)"
                          [disabled]="actioning() === b.id"
                        >Request Review</button>
                      }
                      @if (b.status === 'review') {
                        <button
                          class="btn-ghost text-[0.68rem] px-2 py-0.5 text-green-400"
                          data-testid="approve-btn"
                          (click)="approve(b.id)"
                          [disabled]="actioning() === b.id"
                        >Approve</button>
                        @if (b.approvals_received >= b.approvals_required) {
                          <button
                            class="btn-primary text-[0.68rem] px-2 py-0.5"
                            data-testid="merge-btn"
                            (click)="mergeBranch(b)"
                            [disabled]="actioning() === b.id"
                          >Merge</button>
                        }
                      }
                      @if (b.status !== 'merged' && b.status !== 'closed') {
                        <button
                          class="btn-ghost text-[0.68rem] px-2 py-0.5 text-red-400"
                          data-testid="close-btn"
                          (click)="closeBranch(b.id)"
                          [disabled]="actioning() === b.id"
                        >Close</button>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

    </div>
  `,
})
export class SiteBranchesComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  readonly branches = signal<Branch[]>([]);
  readonly loading = signal(true);
  readonly showCreate = signal(false);
  readonly creating = signal(false);
  readonly actioning = signal<string | null>(null);

  newBranchName = '';
  newApprovalsRequired = 1;

  private siteId = '';

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

  private loadBranches(): void {
    if (!this.siteId) return;
    this.loading.set(true);
    this.http
      .get<{ branches: Branch[] }>(`/api/sites/${this.siteId}/branches`)
      .pipe(catchError(() => of({ branches: [] as Branch[] })))
      .subscribe((res) => {
        this.branches.set(res.branches);
        this.loading.set(false);
      });
  }

  createBranch(): void {
    if (!this.newBranchName.trim()) return;
    this.creating.set(true);
    this.http
      .post<{ branch: Branch }>(`/api/sites/${this.siteId}/branches`, {
        branch_name: this.newBranchName.trim(),
        approvals_required: this.newApprovalsRequired,
      })
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
    this.http
      .post<{ branch: Branch }>(`/api/sites/${this.siteId}/branches/${branchId}/review`, {})
      .pipe(catchError((err) => { this.toast.error(err?.error?.error ?? 'Failed'); return of(null); }))
      .subscribe((res) => {
        if (res?.branch) this.updateBranch(res.branch);
        this.actioning.set(null);
      });
  }

  approve(branchId: string): void {
    this.actioning.set(branchId);
    this.http
      .post<{ branch: Branch; readyToMerge: boolean }>(`/api/sites/${this.siteId}/branches/${branchId}/approve`, {})
      .pipe(catchError((err) => { this.toast.error(err?.error?.error ?? 'Failed'); return of(null); }))
      .subscribe((res) => {
        if (res?.branch) {
          this.updateBranch(res.branch);
          if (res.readyToMerge) this.toast.success('All approvals received — ready to merge!');
        }
        this.actioning.set(null);
      });
  }

  mergeBranch(branch: Branch): void {
    // The build_version for a merged branch is auto-generated here as a timestamp.
    const buildVersion = `branch-merge-${Date.now()}`;
    this.actioning.set(branch.id);
    this.http
      .post<{ branch: Branch }>(`/api/sites/${this.siteId}/branches/${branch.id}/merge`, { build_version: buildVersion })
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
    this.http
      .post<{ branch: Branch }>(`/api/sites/${this.siteId}/branches/${branchId}/close`, {})
      .pipe(catchError((err) => { this.toast.error(err?.error?.error ?? 'Failed'); return of(null); }))
      .subscribe((res) => {
        if (res?.branch) this.updateBranch(res.branch);
        this.actioning.set(null);
      });
  }

  private updateBranch(updated: Branch): void {
    this.branches.update((bs) => bs.map((b) => (b.id === updated.id ? updated : b)));
  }

  statusClass(status: string): string {
    const base = 'inline-block px-1.5 py-0.5 rounded text-[0.65rem] font-semibold uppercase tracking-wide';
    return {
      draft: `${base} bg-white/5 text-text-secondary`,
      review: `${base} bg-amber-500/15 text-amber-400`,
      merged: `${base} bg-green-500/15 text-green-400`,
      closed: `${base} bg-red-500/10 text-red-400`,
    }[status] ?? base;
  }

  formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  }
}
