/**
 * `SnapshotsService` — RxJS-first wrapper around `/api/sites/:siteId/snapshots/*`.
 *
 * Returns a typed `Snapshot[]` list, supports rollback (typed-confirmation
 * happens in the feature lib, not here), promote-to-prod, and diff.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  Observable,
  map,
  shareReplay,
  switchMap,
  timer,
} from 'rxjs';
import { retry } from 'rxjs/operators';
import type { Snapshot } from '@org/domain';

export interface SnapshotDiffEntry {
  readonly path: string;
  readonly status: 'added' | 'modified' | 'removed';
  readonly bytes_before: number | null;
  readonly bytes_after: number | null;
}

export interface SnapshotDiff {
  readonly a_id: string;
  readonly b_id: string;
  readonly entries: ReadonlyArray<SnapshotDiffEntry>;
}

interface ListResponse {
  readonly snapshots: ReadonlyArray<Snapshot>;
}

interface RollbackResponse {
  readonly site_id: string;
  readonly rolled_back_to: string;
  readonly correlation_id: string;
}

interface PromoteResponse {
  readonly site_id: string;
  readonly promoted_snapshot_id: string;
  readonly correlation_id: string;
}

// TODO: lock in once util-rxjs lands — replace with retryWithBackoff from @org/util-rxjs.
function retryWithBackoff<T>(maxAttempts = 4, initialMs = 300) {
  return retry<T>({
    count: maxAttempts,
    delay: (_err, attempt) => timer(Math.min(initialMs * 2 ** attempt, 8_000)),
  });
}

@Injectable({ providedIn: 'root' })
export class SnapshotsService {
  private readonly http = inject(HttpClient);

  listSnapshots$(siteId: string): Observable<ReadonlyArray<Snapshot>> {
    return this.http
      .get<ListResponse>(`/api/sites/${siteId}/snapshots`)
      .pipe(
        map((r) => r.snapshots),
        retryWithBackoff<ReadonlyArray<Snapshot>>(),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
  }

  /**
   * Caller MUST have already collected typed-slug confirmation in the UI.
   * The control-plane re-checks the typed slug on the server before
   * applying the rollback (defense-in-depth).
   */
  rollback$(
    siteId: string,
    snapshotId: string,
    typedSlug: string,
  ): Observable<RollbackResponse> {
    return this.http.post<RollbackResponse>(
      `/api/sites/${siteId}/snapshots/${snapshotId}/rollback`,
      { typed_slug: typedSlug },
    );
  }

  diffSnapshots$(siteId: string, a: string, b: string): Observable<SnapshotDiff> {
    return this.http
      .get<SnapshotDiff>(`/api/sites/${siteId}/snapshots/diff`, {
        params: { a, b },
      })
      .pipe(retryWithBackoff<SnapshotDiff>(3, 250));
  }

  promoteToProduction$(
    siteId: string,
    snapshotId: string,
  ): Observable<PromoteResponse> {
    return this.http.post<PromoteResponse>(
      `/api/sites/${siteId}/snapshots/${snapshotId}/promote`,
      {},
    );
  }

  /**
   * Helper for delta-vs-previous Lighthouse colour-coding. Returns the
   * snapshot immediately preceding `snapshotId` in iteration order, or
   * `null` if it is the first.
   */
  previousSnapshot$(
    siteId: string,
    snapshotId: string,
  ): Observable<Snapshot | null> {
    return this.listSnapshots$(siteId).pipe(
      switchMap((list) => {
        const sorted = [...list].sort((a, b) => a.iteration - b.iteration);
        const idx = sorted.findIndex((s) => s.id === snapshotId);
        const prev = idx > 0 ? sorted[idx - 1] : null;
        return [prev] as Snapshot[] | [null];
      }),
    );
  }
}
