import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, type HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';
import { TelemetryService } from './telemetry.service';

/**
 * Coverage for ApiService — the wrapper behind every admin HTTP call. Security/reliability:
 *  - injects Authorization: Bearer <token> when signed in; omits when signed out
 *  - prefixes /api
 *  - a 401 INSIDE a protected route (/admin, /billing, /editor) clears the session AND
 *    redirects to /signin?returnUrl=…; a 401 on a public route clears the session but does NOT
 *    bounce the visitor into signin
 *  - failures surface a user-friendly, status-mapped toast
 */
function make(opts: { token?: string | null; url?: string; get?: jasmine.Spy }): {
  api: ApiService; http: { get: jasmine.Spy }; nav: jasmine.Spy; clear: jasmine.Spy; toastErr: jasmine.Spy;
} {
  const http = { get: opts.get ?? jasmine.createSpy('get').and.returnValue(of({})), post: () => of({}), put: () => of({}), patch: () => of({}), delete: () => of({}) };
  const nav = jasmine.createSpy('navigate');
  const clear = jasmine.createSpy('clearSession');
  const toastErr = jasmine.createSpy('error');
  TestBed.configureTestingModule({
    providers: [
      ApiService,
      { provide: HttpClient, useValue: http },
      { provide: AuthService, useValue: { getToken: () => opts.token ?? null, clearSession: clear } },
      { provide: ToastService, useValue: { error: toastErr, success: () => 0 } },
      { provide: Router, useValue: { url: opts.url ?? '/', navigate: nav } },
      { provide: TelemetryService, useValue: { track: () => undefined } },
    ],
  });
  return { api: TestBed.inject(ApiService), http, nav, clear, toastErr };
}

const err401 = () => throwError(() => new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' }));

describe('ApiService (auth header + 401 redirect + error mapping)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('injects the bearer token + /api prefix when signed in', () => {
    const { api, http } = make({ token: 'tok_xyz' });
    api.get('/sites').subscribe();
    const [url, opts] = http.get.calls.mostRecent().args as [string, { headers: HttpHeaders }];
    expect(url).toBe('/api/sites');
    expect(opts.headers.get('Authorization')).toBe('Bearer tok_xyz');
  });

  it('omits the Authorization header when signed out', () => {
    const { api, http } = make({ token: null });
    api.get('/sites').subscribe();
    const [, opts] = http.get.calls.mostRecent().args as [string, { headers: HttpHeaders }];
    expect(opts.headers.has('Authorization')).toBe(false);
  });

  it('a 401 inside a protected route clears the session AND redirects to /signin', () => {
    const { api, nav, clear } = make({ token: 't', url: '/admin/sites', get: jasmine.createSpy('get').and.callFake(err401) });
    api.get('/sites').subscribe({ error: () => undefined });
    expect(clear).toHaveBeenCalled();
    expect(nav).toHaveBeenCalledWith(['/signin'], { queryParams: { returnUrl: '/admin/sites' } });
  });

  it('a 401 on a public route clears the session but does NOT redirect', () => {
    const { api, nav, clear } = make({ token: null, url: '/', get: jasmine.createSpy('get').and.callFake(err401) });
    api.get('/auth/me').subscribe({ error: () => undefined });
    expect(clear).toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
  });

  it('surfaces a user-friendly, status-mapped toast on failure', () => {
    const cases: Array<[number, string, string]> = [
      [404, "wasn't found", 'Not Found'],
      [429, 'Too many requests', 'Too Many Requests'],
      [500, "looking into it", 'Internal Server Error'],
      [0, "Can't reach the server", 'Unknown Error'],
    ];
    for (const [status, fragment, statusText] of cases) {
      const { api, toastErr } = make({ url: '/admin', get: jasmine.createSpy('get').and.callFake(() => throwError(() => new HttpErrorResponse({ status, statusText }))) });
      api.get('/x').subscribe({ error: () => undefined });
      expect(toastErr).toHaveBeenCalledWith(jasmine.stringContaining(fragment));
      TestBed.resetTestingModule();
    }
  });

  it('{ silent: true } SUPPRESSES the error toast (fire-and-forget / forward-compat calls)', () => {
    const failingGet = jasmine.createSpy('get').and.callFake(() => throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found' })));
    const { api, toastErr } = make({ url: '/admin', get: failingGet });
    api.get('/admin/notifications', undefined, { silent: true }).subscribe({ error: () => undefined });
    expect(toastErr).withContext('a silent call must never nag the user, even on a 404').not.toHaveBeenCalled();
  });

  it('without { silent } a failing call STILL toasts (silent is strictly opt-in)', () => {
    const failingGet = jasmine.createSpy('get').and.callFake(() => throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found' })));
    const { api, toastErr } = make({ url: '/admin', get: failingGet });
    api.get('/admin/notifications').subscribe({ error: () => undefined });
    expect(toastErr).toHaveBeenCalled();
  });

  it('a 401 still clears the session even on a silent call (security preserved, only the toast is muted)', () => {
    const { api, clear, toastErr } = make({ token: 't', url: '/admin', get: jasmine.createSpy('get').and.callFake(err401) });
    api.get('/admin/notifications', undefined, { silent: true }).subscribe({ error: () => undefined });
    expect(clear).withContext('silent suppresses the toast, not the auth/session handling').toHaveBeenCalled();
    expect(toastErr).not.toHaveBeenCalled();
  });

  // The analytics reads own their own accurate inline error UX (a cred-aware
  // "Connect Cloudflare" banner + an inline "couldn't reach the analytics
  // service" message + Retry). The generic network-blame toast ("Can't reach
  // the server. Check your connection.") firing ON TOP of that is a misleading,
  // redundant double-signal — so these reads must be silent at the API layer.
  it('getMultiUrlAnalytics is silent — no redundant network-blame toast (component owns error UX)', () => {
    const failingGet = jasmine.createSpy('get').and.callFake(() => throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' })));
    const { api, toastErr } = make({ url: '/admin/analytics', get: failingGet });
    api.getMultiUrlAnalytics('site-1', '7d', []).subscribe({ error: () => undefined, next: () => undefined });
    expect(toastErr).withContext('analytics owns its inline error banner; the global toast must not double-fire').not.toHaveBeenCalled();
  });

  it('listSiteUrls is silent — a failed URL list never nags (the cred/empty state explains it inline)', () => {
    const failingGet = jasmine.createSpy('get').and.callFake(() => throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' })));
    const { api, toastErr } = make({ url: '/admin/analytics', get: failingGet });
    api.listSiteUrls('site-1').subscribe({ error: () => undefined, next: () => undefined });
    expect(toastErr).not.toHaveBeenCalled();
  });

  it('remaps a 2xx-with-non-JSON body (SPA fallthrough) to 404 so "endpoint unavailable" handling applies', () => {
    // Angular HttpClient surfaces a 200 whose body is HTML (JSON parse fails) as an
    // HttpErrorResponse with a 2xx status. The worker's SPA catch-all returns 200 +
    // index.html for any /api path whose route isn't deployed/registered → callers
    // (recipes/webhooks/deliverability all branch on status===404) must see it as
    // unavailable (calm flag-gate notice), NOT an alarming transient "Couldn't load" card.
    const fallthrough = jasmine.createSpy('get').and.callFake(() =>
      throwError(() => new HttpErrorResponse({
        status: 200, statusText: 'OK', url: '/api/sites/x/recipes',
        error: { error: new SyntaxError('Unexpected token <'), text: '<!doctype html><html>…' },
      })),
    );
    const { api, toastErr } = make({ token: 't', url: '/admin/recipes', get: fallthrough });
    let seen: HttpErrorResponse | undefined;
    api.get('/sites/x/recipes').subscribe({ next: () => undefined, error: (e: HttpErrorResponse) => (seen = e) });
    expect(seen?.status).withContext('2xx parse-failure remapped to 404').toBe(404);
    // Not user-actionable (the section renders its own calm notice) → never toast, even unsilenced.
    expect(toastErr).withContext('SPA fallthrough must not surface a generic network toast').not.toHaveBeenCalled();
  });
});
