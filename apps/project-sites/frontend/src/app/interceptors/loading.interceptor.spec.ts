import { TestBed } from '@angular/core/testing';
import { HttpRequest, type HttpEvent, HttpResponse } from '@angular/common/http';
import { of, throwError, type Observable } from 'rxjs';
import { loadingInterceptor } from './loading.interceptor';
import { LoadingService } from '../services/loading.service';

/**
 * Coverage for loadingInterceptor — auto-tracks per-request + global loading state.
 * Contract: starts a `{METHOD}:{path}` key + the global `http` key on request; the key uses
 * the PATH ONLY (never query params — they may carry tokens/PII); `finalize` stops both keys
 * on completion AND on error (so a failed request never leaves a stuck spinner).
 */
function run(req: HttpRequest<unknown>, nextObs: Observable<HttpEvent<unknown>>): { start: jasmine.Spy; stop: jasmine.Spy } {
  const start = jasmine.createSpy('startLoading');
  const stop = jasmine.createSpy('stopLoading');
  TestBed.configureTestingModule({
    providers: [{ provide: LoadingService, useValue: { startLoading: start, stopLoading: stop } }],
  });
  TestBed.runInInjectionContext(() => loadingInterceptor(req, (() => nextObs) as never).subscribe({ error: () => undefined }));
  return { start, stop };
}

describe('loadingInterceptor (per-request + global loading)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts a {METHOD}:{path} key + the global http key', () => {
    const { start } = run(new HttpRequest('GET', '/api/sites'), of(new HttpResponse({ status: 200 })));
    expect(start).toHaveBeenCalledWith('GET:/api/sites');
    expect(start).toHaveBeenCalledWith('http');
  });

  it('uses the PATH ONLY in the key — never query params (PII/token safety)', () => {
    const { start } = run(new HttpRequest('GET', '/api/sites?token=secret123&q=foo'), of(new HttpResponse({ status: 200 })));
    const keys = start.calls.allArgs().map((a) => a[0] as string);
    expect(keys).toContain('GET:/api/sites');
    expect(keys.some((k) => k.includes('token') || k.includes('secret123'))).toBe(false);
  });

  it('stops both keys on successful completion (finalize)', () => {
    const { stop } = run(new HttpRequest('GET', '/api/sites'), of(new HttpResponse({ status: 200 })));
    expect(stop).toHaveBeenCalledWith('GET:/api/sites');
    expect(stop).toHaveBeenCalledWith('http');
  });

  it('stops both keys on ERROR too — no stuck spinner on a failed request', () => {
    const { stop } = run(new HttpRequest('GET', '/api/sites'), throwError(() => new Error('boom')));
    expect(stop).toHaveBeenCalledWith('GET:/api/sites');
    expect(stop).toHaveBeenCalledWith('http');
  });
});
