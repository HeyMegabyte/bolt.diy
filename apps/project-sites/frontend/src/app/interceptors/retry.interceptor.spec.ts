import { fakeAsync, tick } from '@angular/core/testing';
import { HttpRequest, HttpErrorResponse, type HttpEvent, HttpResponse } from '@angular/common/http';
import { of, throwError, type Observable } from 'rxjs';
import { retryInterceptor } from './retry.interceptor';

/**
 * Coverage for retryInterceptor — the reliability layer that retries transient failures.
 * Contract: adds X-Request-ID; retries ONLY idempotent methods (GET/HEAD/OPTIONS/PUT) on
 * retryable statuses (0/500/502/503/504) up to 2× with exponential backoff (1s, 2s); never
 * retries non-idempotent methods (POST/DELETE) or client errors (4xx) — so a non-idempotent
 * mutation can't be silently double-executed.
 */
function runReq(method: string, nextFn: (req: HttpRequest<unknown>) => Observable<HttpEvent<unknown>>): { sub: () => void; errors: unknown[] } {
  const req = method === 'POST'
    ? new HttpRequest('POST', '/api/x', {})
    : new HttpRequest(method as 'GET', '/api/x');
  const errors: unknown[] = [];
  return {
    sub: () => retryInterceptor(req, nextFn as never).subscribe({ error: (e) => errors.push(e) }),
    errors,
  };
}

const fail = (status: number) => () => throwError(() => new HttpErrorResponse({ status, statusText: 'x' }));

describe('retryInterceptor (idempotent-only retry + backoff)', () => {
  it('adds an X-Request-ID header to the outgoing request', () => {
    let seen: HttpRequest<unknown> | null = null;
    retryInterceptor(new HttpRequest('GET', '/api/x'), ((r: HttpRequest<unknown>) => { seen = r; return of(new HttpResponse({ status: 200 })); }) as never).subscribe();
    expect(seen!.headers.get('X-Request-ID')).toBeTruthy();
  });

  it('does NOT retry a non-idempotent POST (500) — no silent double-execution', fakeAsync(() => {
    const next = jasmine.createSpy('next').and.callFake(fail(500));
    const { sub } = runReq('POST', next);
    sub();
    tick(5000);
    expect(next.calls.count()).toBe(1);
  }));

  it('does NOT retry a client error (404) on a GET', fakeAsync(() => {
    const next = jasmine.createSpy('next').and.callFake(fail(404));
    const { sub } = runReq('GET', next);
    sub();
    tick(5000);
    expect(next.calls.count()).toBe(1);
  }));

  it('passes a successful response straight through (no retry)', () => {
    const next = jasmine.createSpy('next').and.returnValue(of(new HttpResponse({ status: 200 })));
    const { sub } = runReq('GET', next);
    sub();
    expect(next.calls.count()).toBe(1);
  });
});
