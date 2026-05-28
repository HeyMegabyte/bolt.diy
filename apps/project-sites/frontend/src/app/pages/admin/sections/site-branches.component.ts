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
  template: `<section class="p-5" data-testid="site-branches"><header><h1 class="text-lg text-white">Branches</h1><p class="text-text-secondary text-xs">Branch-style site previews — admin UI under reconstruction. Use the API at <code>/api/sites/:id/branches</code> directly for now.</p></header></section>`,
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
