/**
 * `SnapshotsListComponent` — merged Snapshots + Deploy History surface.
 *
 * Two views via PrimeNG `p-selectButton`:
 *   1. Grid (ag-grid Community) — dense table for power users
 *   2. Timeline (vertical card stack) — visual narrative with screenshot
 *      + AI commit description + Lighthouse score chips with delta vs
 *      previous snapshot + ops metrics row
 *
 * Per-row actions: Rollback (typed-confirm), Diff (side-drawer), Promote
 * staging → production.
 *
 * RxJS-first per [[rxjs-first-angular]]: snapshots stream comes from
 * `SnapshotsService.listSnapshots$`, bridged via `toSignal` at template
 * boundary.
 */
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, of, switchMap } from 'rxjs';
import { AgGridAngular } from 'ag-grid-angular';
import type { ColDef } from 'ag-grid-community';
import { SnapshotsService } from '@org/data-access';
import type { LighthouseScores, Snapshot } from '@org/domain';
import { RollbackConfirmComponent } from '../rollback-confirm/rollback-confirm.component';

type View = 'grid' | 'timeline';

@Component({
  selector: 'lib-snapshots-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, AgGridAngular, RollbackConfirmComponent],
  templateUrl: './snapshots-list.component.html',
  styleUrl: './snapshots-list.component.css',
})
export class SnapshotsListComponent {
  @Input({ required: true }) set siteId(value: string) {
    this.siteId$.next(value);
  }
  @Input({ required: true }) siteSlug = '';

  private readonly snapshots = inject(SnapshotsService);
  private readonly siteId$ = new BehaviorSubject<string>('');

  readonly view = signal<View>('timeline');

  readonly rows = toSignal(
    this.siteId$.pipe(
      switchMap((id) =>
        id ? this.snapshots.listSnapshots$(id) : of<ReadonlyArray<Snapshot>>([]),
      ),
    ),
    { initialValue: [] as ReadonlyArray<Snapshot> },
  );

  /** Sorted by iteration descending for timeline + grid default. */
  readonly sortedRows = computed(() =>
    [...this.rows()].sort((a, b) => b.iteration - a.iteration),
  );

  readonly hasRows = computed(() => this.sortedRows().length > 0);

  /** Snapshot pending rollback confirmation (drives the modal). */
  readonly rollbackTarget = signal<Snapshot | null>(null);

  readonly lighthouseKeys: ReadonlyArray<keyof LighthouseScores> = [
    'performance',
    'accessibility',
    'best_practices',
    'seo',
    'pwa',
  ];

  scoreFor(snap: Snapshot, key: keyof LighthouseScores): number | null {
    return snap.lighthouse_scores?.[key] ?? null;
  }

  readonly colDefs: ColDef<Snapshot>[] = [
    { field: 'iteration', headerName: '#', width: 80, sortable: true },
    { field: 'captured_at', headerName: 'Captured', width: 200 },
    {
      headerName: 'Perf',
      width: 90,
      valueGetter: (p) => p.data?.lighthouse_scores?.performance ?? '—',
    },
    {
      headerName: 'A11y',
      width: 90,
      valueGetter: (p) => p.data?.lighthouse_scores?.accessibility ?? '—',
    },
    {
      headerName: 'SEO',
      width: 90,
      valueGetter: (p) => p.data?.lighthouse_scores?.seo ?? '—',
    },
    { field: 'ai_description', headerName: 'Description', flex: 1 },
    {
      headerName: 'Actions',
      width: 240,
      cellRenderer: () => '<button data-action="rollback">Rollback</button>',
    },
  ];

  setView(v: View): void {
    this.view.set(v);
  }

  openRollback(snap: Snapshot): void {
    this.rollbackTarget.set(snap);
  }

  closeRollback(): void {
    this.rollbackTarget.set(null);
  }

  promote(snap: Snapshot): void {
    this.snapshots.promoteToProduction$(snap.site_id, snap.id).subscribe();
  }

  /**
   * Lighthouse delta vs previous snapshot in `sortedRows()` (sortedRows
   * is descending, so previous = next index).
   */
  delta(snap: Snapshot, key: keyof LighthouseScores): number | null {
    const list = this.sortedRows();
    const idx = list.findIndex((s) => s.id === snap.id);
    const prev = list[idx + 1];
    const a = snap.lighthouse_scores?.[key];
    const b = prev?.lighthouse_scores?.[key];
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    return a - b;
  }

  deltaClass(delta: number | null): string {
    if (delta === null) return 'd-na';
    if (delta > 0) return 'd-up';
    if (delta < 0) return 'd-down';
    return 'd-flat';
  }

  scoreClass(score: number | null | undefined): string {
    if (typeof score !== 'number') return 'sc-na';
    if (score >= 90) return 'sc-good';
    if (score >= 50) return 'sc-mid';
    return 'sc-bad';
  }

  bytesHuman(bytes: number | null | undefined): string {
    if (typeof bytes !== 'number') return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }

  trackById = (_: number, row: Snapshot): string => row.id;
}
