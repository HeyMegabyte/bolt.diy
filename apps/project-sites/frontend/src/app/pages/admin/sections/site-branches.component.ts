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
import { EmptyStateComponent } from '../../../components/states';
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
  imports: [FormsModule, RouterModule, RollingCounterComponent, RevealDirective, EmptyStateComponent, HlmInputDirective, HlmButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
      <div class="flex gap-6 mb-4 rounded-xl border border-white/6 bg-white/2 px-5 py-3" appReveal>
        @for (s of stats(); track s.label) {
          <div class="flex flex-col">
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
      } @else if (branches().length === 0) {
        <app-empty-state
          icon="⎇"
          title="No branches yet"
          [message]="siteId ? 'Create a branch to preview changes in isolation before merging to production.' : 'Select a site to manage its branches.'"
          [ctaLabel]="siteId ? 'Create branch' : ''"
          (ctaClick)="showCreate.set(true)" />
      } @else {
        <div class="rounded-xl border border-white/6 overflow-hidden" role="region" aria-label="Branches">
          <table class="w-full text-[0.8rem] text-left">
            <thead>
              <tr class="bg-white/3 text-text-secondary text-[0.62rem] uppercase tracking-wide">
                <th class="px-3 py-2 font-semibold">Branch</th>
                <th class="px-3 py-2 font-semibold">Status</th>
                <th class="px-3 py-2 font-semibold">Approvals</th>
                <th class="px-3 py-2 font-semibold">Created</th>
                <th class="px-3 py-2 font-semibold text-right">Actions</th>
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
                  <td class="px-3 py-2"><span [class]="statusClass(b.status)">{{ b.status }}</span></td>
                  <td class="px-3 py-2 text-text-secondary tabular-nums">{{ b.approvals_received }} / {{ b.approvals_required }}</td>
                  <td class="px-3 py-2 text-text-secondary">{{ formatDate(b.created_at) }}</td>
                  <td class="px-3 py-2">
                    <div class="flex gap-1.5 justify-end items-center">
                      @if (actioning() === b.id) {
                        <span class="text-text-secondary text-[0.68rem]">…</span>
                      } @else {
                        @if (b.status === 'draft') {
                          <button hlmBtn variant="ghost" size="sm" type="button" (click)="requestReview(b.id)">Request review</button>
                        }
                        @if (b.status === 'review') {
                          <button hlmBtn variant="ghost" size="sm" type="button" (click)="approve(b.id)">Approve</button>
                          @if (canMerge(b)) {
                            <button hlmBtn variant="primary" size="sm" type="button" (click)="mergeBranch(b)">Merge</button>
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
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  readonly branches = signal<Branch[]>([]);
  readonly loading = signal(true);
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

  readonly skeletonRows = [0, 1, 2];

  canMerge(b: Branch): boolean {
    return b.approvals_received >= b.approvals_required;
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
