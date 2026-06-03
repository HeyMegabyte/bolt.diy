import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { SentryService } from './sentry.service';

/**
 * Coverage for AuthService — the SPA's session container. Security-critical:
 *  - setSession persists + exposes token/email/isLoggedIn; clearSession/logout wipe them
 *  - a session older than the 7-day TTL is DROPPED on load (stale token never reaches the API)
 *  - a legacy session without createdAt is treated as fresh (no false expiry)
 *  - clearSession wipes credentials but preserves the location-declined UX preference
 * SentryService is stubbed (agent-owned — not edited).
 */
const SESSION_KEY = 'ps_session';
const DAY = 24 * 60 * 60 * 1000;

function inject_(): AuthService {
  TestBed.configureTestingModule({
    providers: [
      AuthService,
      { provide: SentryService, useValue: { setUser: () => undefined, addBreadcrumb: () => undefined } },
    ],
  });
  return TestBed.inject(AuthService);
}

describe('AuthService (session lifecycle + TTL)', () => {
  afterEach(() => { try { localStorage.clear(); } catch { /* */ } TestBed.resetTestingModule(); });

  it('setSession persists and exposes token / email / isLoggedIn', () => {
    const a = inject_();
    a.setSession('tok_abc', 'brian@megabyte.space');
    expect(a.getToken()).toBe('tok_abc');
    expect(a.email()).toBe('brian@megabyte.space');
    expect(a.isLoggedIn()).toBe(true);
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).token).toBe('tok_abc');
  });

  it('clearSession / logout wipe the session', () => {
    const a = inject_();
    a.setSession('t', 'e@x.com');
    a.logout();
    expect(a.getToken()).toBeNull();
    expect(a.isLoggedIn()).toBe(false);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('drops a session older than the 7-day TTL on load (stale token never re-used)', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'old', identifier: 'e@x.com', createdAt: Date.now() - 8 * DAY }));
    const a = inject_(); // constructor loadSession() runs the TTL check
    expect(a.getToken()).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull(); // also evicted from storage
  });

  it('keeps a session within the TTL on load', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'fresh', identifier: 'e@x.com', createdAt: Date.now() - 1 * DAY }));
    const a = inject_();
    expect(a.getToken()).toBe('fresh');
  });

  it('treats a legacy session without createdAt as fresh (no false expiry)', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'legacy', identifier: 'e@x.com' }));
    const a = inject_();
    expect(a.getToken()).toBe('legacy');
  });

  it('clearSession preserves the location-declined UX preference (not a credential)', () => {
    const a = inject_();
    a.setSession('t', 'e@x.com');
    a.setLocationDeclined();
    a.clearSession();
    expect(a.isLocationDeclined()).toBe(true);
  });

  it('getMode defaults to business and round-trips custom', () => {
    const a = inject_();
    expect(a.getMode()).toBe('business');
    a.setMode('custom');
    expect(a.getMode()).toBe('custom');
  });

  it('pending-build + auto-create flags toggle on and remove the key off', () => {
    const a = inject_();
    a.setPendingBuild(true);
    expect(a.getPendingBuild()).toBe(true);
    a.setPendingBuild(false);
    expect(a.getPendingBuild()).toBe(false);
    a.setAutoCreate(true);
    expect(a.getAutoCreate()).toBe(true);
  });
});
