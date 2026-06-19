import { Injectable, signal, inject, DestroyRef, type Signal, type WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from './api.service';

export interface ReadinessData {
  grade: string;
  score: number | null;
  passing: boolean | null;
  summary: string | null;
  checkedAt?: string;
}

/** Debounce window (ms) over which per-badge requests coalesce into one batch. */
const FLUSH_MS = 50;
/** The batch endpoint caps at 100 ids per request. */
const CHUNK = 100;

/**
 * DataLoader-style cache for Production-Readiness grades (#9 follow-on).
 *
 * @remarks
 * Each readiness badge calls {@link request} when it scrolls into view and reads
 * {@link read} for its grade. Requests made within a {@link FLUSH_MS}ms window
 * coalesce into a single `GET /api/readiness?ids=…` call, so a sites list of N
 * rows costs ~1-2 requests instead of N. Results are memoised per id for the
 * session (readiness is static per build), and ids are de-duped — a second badge
 * for the same site never triggers a second fetch.
 *
 * @example
 * // in a badge: register + read
 * effect(() => { const id = this.siteId(); if (id && this.visible()) this.cache.request(id); });
 * readonly data = computed(() => { const id = this.siteId(); return id ? this.cache.read(id)() : null; });
 */
@Injectable({ providedIn: 'root' })
export class ReadinessCacheService {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly cache = new Map<string, WritableSignal<ReadinessData | null>>();
  private readonly requested = new Set<string>();
  private pending = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** The per-id grade signal (null until a batch resolves it, or if unscored). */
  read(id: string): Signal<ReadinessData | null> {
    return this.ensure(id);
  }

  /** Register an id for the next batch. Deduped — already-fetched ids are skipped. */
  request(id: string): void {
    if (!id || this.requested.has(id)) return;
    this.requested.add(id);
    this.ensure(id);
    this.pending.add(id);
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
    }
  }

  private ensure(id: string): WritableSignal<ReadinessData | null> {
    let sig = this.cache.get(id);
    if (!sig) {
      sig = signal<ReadinessData | null>(null);
      this.cache.set(id, sig);
    }
    return sig;
  }

  private flush(): void {
    this.flushTimer = null;
    const ids = [...this.pending];
    this.pending.clear();
    if (ids.length === 0) return;

    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      this.api
        .get<{ data: Record<string, ReadinessData | null> }>(
          '/readiness',
          { ids: chunk.join(',') },
          { silent: true },
        )
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            const map = res?.data ?? {};
            for (const id of chunk) this.ensure(id).set(map[id] ?? null);
          },
          // On failure, leave the signals null (badge renders nothing) — never throw.
          error: () => {
            for (const id of chunk) this.ensure(id).set(null);
          },
        });
    }
  }
}
