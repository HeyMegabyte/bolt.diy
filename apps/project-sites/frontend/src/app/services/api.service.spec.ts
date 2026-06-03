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
});
