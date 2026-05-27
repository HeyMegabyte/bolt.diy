/**
 * `MarketplaceService` — section-library marketplace (backlog #34).
 *
 * @remarks
 *  RxJS-first per `[[rxjs-first-angular]]`. List/search streams are
 *  `shareReplay`'d so multiple subscribers (grid + filter sidebar) share a
 *  single HTTP cycle. Install is a one-shot mutation that emits the install
 *  receipt + nudges the list to refresh.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  BehaviorSubject,
  type Observable,
  Subject,
  map,
  merge,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs';

export interface MarketplaceSection {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly category: string | null;
  readonly preview_image_url: string | null;
  readonly props_schema_json: string;
  readonly props_schema: Record<string, unknown>;
  readonly downloads: number;
  readonly rating: number | null;
  readonly status: string;
  readonly author_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MarketplaceFilters {
  readonly q?: string;
  readonly category?: string;
  readonly sort?: 'downloads' | 'rating' | 'recent';
  readonly limit?: number;
}

export interface SectionInstallReceipt {
  readonly install_id: string;
  readonly section_id: string;
  readonly site_id: string;
  readonly dest_key: string;
}

@Injectable({ providedIn: 'root' })
export class MarketplaceService {
  private readonly http = inject(HttpClient);
  private readonly filters$$ = new BehaviorSubject<MarketplaceFilters>({
    sort: 'downloads',
    limit: 40,
  });
  private readonly refresh$$ = new Subject<void>();

  /** Live, filterable list. Re-fires on filters change OR explicit refresh. */
  readonly sections$: Observable<ReadonlyArray<MarketplaceSection>> = merge(
    this.filters$$,
    this.refresh$$.pipe(map(() => this.filters$$.getValue())),
  ).pipe(
    switchMap((filters) => {
      const params: Record<string, string> = {};
      if (filters.q) params['q'] = filters.q;
      if (filters.category) params['category'] = filters.category;
      params['sort'] = filters.sort ?? 'downloads';
      params['limit'] = String(filters.limit ?? 40);
      return this.http
        .get<{ sections: ReadonlyArray<MarketplaceSection> }>(
          '/api/marketplace/sections',
          { params },
        )
        .pipe(map((r) => r.sections));
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** Fetch the detail for a single section. */
  section$(id: string): Observable<MarketplaceSection> {
    return this.http.get<MarketplaceSection>(
      `/api/marketplace/sections/${encodeURIComponent(id)}`,
    );
  }

  setFilters(patch: Partial<MarketplaceFilters>): void {
    const next = { ...this.filters$$.getValue(), ...patch };
    this.filters$$.next(next);
  }

  refresh(): void {
    this.refresh$$.next();
  }

  /** Copy a section blob into the target site. */
  install$(sectionId: string, siteId: string): Observable<SectionInstallReceipt> {
    return this.http
      .post<SectionInstallReceipt>(
        `/api/marketplace/sections/${encodeURIComponent(sectionId)}/install`,
        { site_id: siteId },
      )
      .pipe(tap(() => this.refresh$$.next()));
  }
}
