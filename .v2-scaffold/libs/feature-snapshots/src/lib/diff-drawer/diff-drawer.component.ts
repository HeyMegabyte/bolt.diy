/**
 * `DiffDrawerComponent` — side-drawer showing the file-tree diff between
 * two snapshots. Streams from `SnapshotsService.diffSnapshots$` and
 * groups entries by status (added | modified | removed).
 */
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { BehaviorSubject } from 'rxjs';
import {
  SnapshotDiff,
  SnapshotDiffEntry,
  SnapshotsService,
} from '@org/data-access';

interface DiffInput {
  readonly siteId: string;
  readonly a: string;
  readonly b: string;
}

@Component({
  selector: 'lib-diff-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './diff-drawer.component.html',
  styleUrl: './diff-drawer.component.css',
})
export class DiffDrawerComponent {
  @Input({ required: true }) set input(value: DiffInput | null) {
    this.input$.next(value);
  }
  @Output() readonly close = new EventEmitter<void>();

  private readonly snapshots = inject(SnapshotsService);
  private readonly input$ = new BehaviorSubject<DiffInput | null>(null);

  readonly diff = toSignal(
    this.input$.pipe(
      switchMap((i) =>
        i ? this.snapshots.diffSnapshots$(i.siteId, i.a, i.b) : of<SnapshotDiff | null>(null),
      ),
    ),
    { initialValue: null as SnapshotDiff | null },
  );

  readonly added = computed(
    () => this.diff()?.entries.filter((e) => e.status === 'added') ?? [],
  );
  readonly modified = computed(
    () => this.diff()?.entries.filter((e) => e.status === 'modified') ?? [],
  );
  readonly removed = computed(
    () => this.diff()?.entries.filter((e) => e.status === 'removed') ?? [],
  );

  bytesHuman(bytes: number | null): string {
    if (bytes === null) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  trackByPath = (_: number, entry: SnapshotDiffEntry): string => entry.path;
}
