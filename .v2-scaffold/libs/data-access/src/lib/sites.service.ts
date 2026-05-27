/**
 * SitesService — RxJS-first data-access for tenant-owned sites.
 *
 * @remarks
 * The "Create from search" flow is async: POST returns a workflow ID, the
 * caller subscribes to `workflowStatus$(id)` which polls until status hits
 * a terminal state, then navigates to `/dashboard/sites/:siteId`.
 *
 * RxJS-first per `[[rxjs-first-angular]]`.
 *
 * @example
 * ```ts
 * this.sites.createFromSearch$('Plumber in Newark NJ').pipe(
 *   switchMap(({ workflow_id }) => this.sites.workflowStatus$(workflow_id)),
 *   filter((s) => s.status === 'published'),
 *   take(1),
 * ).subscribe(({ site_id }) => this.router.navigate(['/dashboard/sites', site_id]));
 * ```
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  type Observable,
  Subject,
  catchError,
  map,
  merge,
  of,
  repeat,
  shareReplay,
  startWith,
  switchMap,
  take,
  takeWhile,
  tap,
} from 'rxjs';
import type { Site } from '@org/domain';

const POLL_MS = 30_000;
const WORKFLOW_POLL_MS = 1_000;

export interface CreateSitePayload {
  brief: string;
  slug?: string;
  /** Optional locale preference. */
  locale?: string;
}

export interface CreateSiteResponse {
  workflow_id: string;
  site_id: string;
}

export type WorkflowStatus =
  | 'queued'
  | 'researching'
  | 'planning'
  | 'generating'
  | 'building'
  | 'deploying'
  | 'verifying'
  | 'published'
  | 'failed';

export interface WorkflowProgress {
  workflow_id: string;
  site_id: string;
  status: WorkflowStatus;
  step: string;
  step_index: number;
  step_count: number;
  message: string | null;
  error: string | null;
  updated_at: string;
}

export interface Hostname {
  id: string;
  site_id: string;
  hostname: string;
  status: 'pending' | 'verifying' | 'verified' | 'failed';
  is_primary: boolean;
  verification_record: {
    type: 'TXT';
    name: string;
    value: string;
  };
  created_at: string;
  verified_at: string | null;
}

const TERMINAL: ReadonlySet<WorkflowStatus> = new Set<WorkflowStatus>([
  'published',
  'failed',
]);

@Injectable({ providedIn: 'root' })
export class SitesService {
  private readonly http = inject(HttpClient);

  private readonly listRefresh$$ = new Subject<void>();
  private readonly siteRefresh$$ = new Subject<string>();

  readonly listSites$: Observable<readonly Site[]> = merge(
    of<void>(undefined),
    this.listRefresh$$,
  ).pipe(
    switchMap(() =>
      this.http.get<{ sites: Site[] }>('/api/sites').pipe(
        map((r) => r.sites),
        catchError(() => of<Site[]>([])),
        repeat({ delay: POLL_MS }),
      ),
    ),
    startWith<Site[]>([]),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  refreshList$(): Observable<void> {
    this.listRefresh$$.next();
    return this.listSites$.pipe(
      take(1),
      map(() => undefined),
    );
  }

  /**
   * Per-site detail stream. Polled every 30s.
   */
  getSite$(id: string): Observable<Site | null> {
    return merge(
      of<string>(id),
      this.siteRefresh$$.pipe(map((target) => (target === id ? id : id))),
    ).pipe(
      switchMap(() =>
        this.http.get<Site>(`/api/sites/${id}`).pipe(
          catchError(() => of<Site | null>(null)),
          repeat({ delay: POLL_MS }),
        ),
      ),
      startWith<Site | null>(null),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  refreshSite$(id: string): Observable<void> {
    this.siteRefresh$$.next(id);
    return of(undefined);
  }

  /**
   * Kick off the AI-driven create-from-search workflow.
   */
  createSite$(payload: CreateSitePayload): Observable<CreateSiteResponse> {
    return this.http
      .post<CreateSiteResponse>('/api/sites/create-from-search', payload)
      .pipe(tap(() => this.listRefresh$$.next()));
  }

  /**
   * Poll workflow status every 1s until terminal (published | failed).
   * Caller composes with `filter(s => s.status === 'published') + take(1)`
   * to drive a router redirect.
   */
  workflowStatus$(workflowId: string): Observable<WorkflowProgress> {
    return this.http
      .get<WorkflowProgress>(`/api/workflows/${workflowId}`)
      .pipe(
        repeat({ delay: WORKFLOW_POLL_MS }),
        takeWhile((s) => !TERMINAL.has(s.status), /* inclusive */ true),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
  }

  deleteSite$(id: string): Observable<void> {
    return this.http
      .delete<void>(`/api/sites/${id}`)
      .pipe(tap(() => this.listRefresh$$.next()));
  }

  listHostnames$(siteId: string): Observable<readonly Hostname[]> {
    return this.http
      .get<{ hostnames: Hostname[] }>(`/api/sites/${siteId}/hostnames`)
      .pipe(
        map((r) => r.hostnames),
        catchError(() => of<Hostname[]>([])),
        repeat({ delay: POLL_MS }),
        startWith<Hostname[]>([]),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
  }

  addHostname$(siteId: string, hostname: string): Observable<Hostname> {
    return this.http.post<Hostname>(`/api/sites/${siteId}/hostnames`, {
      hostname,
    });
  }

  verifyHostname$(siteId: string, hostnameId: string): Observable<Hostname> {
    return this.http.post<Hostname>(
      `/api/sites/${siteId}/hostnames/${hostnameId}/verify`,
      {},
    );
  }

  setPrimaryHostname$(siteId: string, hostnameId: string): Observable<Hostname> {
    return this.http.post<Hostname>(
      `/api/sites/${siteId}/hostnames/${hostnameId}/primary`,
      {},
    );
  }

  removeHostname$(siteId: string, hostnameId: string): Observable<void> {
    return this.http.delete<void>(
      `/api/sites/${siteId}/hostnames/${hostnameId}`,
    );
  }
}
