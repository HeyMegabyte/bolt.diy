import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError, NEVER } from 'rxjs';
import { AdminAnalyticsLiveComponent } from './analytics-live.component';
import { ApiService } from '../../../services/api.service';
import { AdminStateService } from '../admin-state.service';

describe('AdminAnalyticsLiveComponent', () => {
  const selectedSite = signal<{ slug: string; id?: string } | null>(null);
  const get = jasmine.createSpy('get');
  const post = jasmine.createSpy('post');

  function make() {
    TestBed.configureTestingModule({
      imports: [AdminAnalyticsLiveComponent],
      providers: [
        { provide: ApiService, useValue: { get, post } },
        { provide: AdminStateService, useValue: { selectedSite } },
      ],
    });
    const f = TestBed.createComponent(AdminAnalyticsLiveComponent);
    f.detectChanges();
    return f;
  }

  /** Route /analytics-data → data, /analytics-debug → debug, anything else → empty. */
  function route(data: unknown, debug: unknown) {
    return (path: string) => (path === '/analytics-data' ? of(data) : path === '/analytics-debug' ? of(debug) : of({}));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    selectedSite.set(null);
    get.calls.reset();
    post.calls.reset();
    get.and.returnValue(of({ events: [] }));
    post.and.returnValue(of({ ok: true }));
  });

  it('renders the header + no-site empty state when no site is selected', () => {
    const f = make();
    expect(f.nativeElement.querySelector('[data-testid="analytics-live"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="al-nosite"]')).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it('loads the feed + circuit state for the selected site and renders the table', () => {
    get.and.callFake(
      route({ events: [{ id: '1', eventId: 'a', eventType: 'pageview', timestamp: 1, status: 'ingested' }] }, { circuits: { sentry: 'closed' } }),
    );
    selectedSite.set({ slug: 's1' });
    const f = make();
    expect(get).toHaveBeenCalledWith('/analytics-data', { siteId: 's1', limit: '100' }, { silent: true });
    expect(get).toHaveBeenCalledWith('/analytics-debug', { siteId: 's1' }, { silent: true });
    expect(f.nativeElement.querySelector('[data-testid="al-table"]')).toBeTruthy();
    expect(f.nativeElement.textContent).toContain('pageview');
  });

  it('shows the empty state (not the table) when the site has no events', () => {
    selectedSite.set({ slug: 's1' });
    const f = make();
    expect(f.nativeElement.querySelector('[data-testid="al-empty"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="al-table"]')).toBeFalsy();
  });

  it('POSTs a test event then reloads', () => {
    selectedSite.set({ slug: 's1' });
    const f = make();
    get.calls.reset();
    f.componentInstance.sendTest();
    expect(post).toHaveBeenCalledWith('/test-event?siteId=s1', undefined, { silent: true });
    expect(get).toHaveBeenCalled(); // reload fired after the test event
  });

  it('renders a circuit pill per provider with its delivery state', () => {
    get.and.callFake(route({ events: [] }, { circuits: { sentry: 'closed', posthog: 'half_open', ga4: 'open' } }));
    selectedSite.set({ slug: 's1' });
    const f = make();
    const txt = f.nativeElement.textContent;
    expect(txt).toContain('sentry: closed');
    expect(txt).toContain('posthog: half_open');
    expect(txt).toContain('ga4: open');
    expect(f.nativeElement.querySelector('.text-emerald-300')).withContext('closed → emerald').toBeTruthy();
    expect(f.nativeElement.querySelector('.text-amber-300')).withContext('half_open → amber').toBeTruthy();
    expect(f.nativeElement.querySelector('.text-rose-300')).withContext('open → rose').toBeTruthy();
  });

  it('shows the loading state while the feed request is in flight', () => {
    get.and.callFake((path: string) => (path === '/analytics-data' ? NEVER : of({})));
    selectedSite.set({ slug: 's1' });
    const f = make();
    expect(f.nativeElement.querySelector('[data-testid="al-loading"]')).toBeTruthy();
    expect(f.componentInstance.loading()).toBeTrue();
  });

  it('shows the error state with the message when the feed request fails', () => {
    get.and.callFake((path: string) =>
      path === '/analytics-data' ? throwError(() => ({ message: 'boom' })) : of({ circuits: {} }),
    );
    selectedSite.set({ slug: 's1' });
    const f = make();
    const err = f.nativeElement.querySelector('[data-testid="al-error"]');
    expect(err).toBeTruthy();
    expect(err.textContent).toContain('boom');
    expect(f.componentInstance.loading()).toBeFalse();
  });

  it('falls back to a generic message when the feed error has no message', () => {
    get.and.callFake((path: string) => (path === '/analytics-data' ? throwError(() => ({})) : of({ circuits: {} })));
    selectedSite.set({ slug: 's1' });
    const f = make();
    expect(f.componentInstance.error()).toBe('request failed');
  });

  it('clears circuits when the debug request fails, leaving the table intact', () => {
    get.and.callFake((path: string) =>
      path === '/analytics-data'
        ? of({ events: [{ id: '1', eventId: 'a', eventType: 'click', timestamp: 1 }] })
        : throwError(() => new Error('debug down')),
    );
    selectedSite.set({ slug: 's1' });
    const f = make();
    expect(f.componentInstance.circuits()).toEqual({});
    expect(f.nativeElement.querySelector('[data-testid="al-table"]')).toBeTruthy();
  });

  it('renders the user/status fallbacks (— and ingested) for sparse rows', () => {
    get.and.callFake(route({ events: [{ id: '1', eventId: 'a', eventType: 'pageview', timestamp: 1 }] }, { circuits: {} }));
    selectedSite.set({ slug: 's1' });
    const f = make();
    const row = f.nativeElement.querySelector('[data-testid="al-table"] tbody tr');
    expect(row.textContent).toContain('—'); // userId falsy → em dash
    expect(row.textContent).toContain('ingested'); // status falsy → default
  });

  it('pluralizes the event-count pill (singular vs plural)', () => {
    get.and.callFake(route({ events: [{ id: '1', eventId: 'a', eventType: 'x', timestamp: 1 }] }, { circuits: {} }));
    selectedSite.set({ slug: 's1' });
    let f = make();
    expect(f.nativeElement.textContent).toContain('1 event');
    expect(f.nativeElement.textContent).not.toContain('1 events');

    TestBed.resetTestingModule();
    get.and.callFake(
      route({ events: [{ id: '1', eventId: 'a', eventType: 'x', timestamp: 1 }, { id: '2', eventId: 'b', eventType: 'y', timestamp: 2 }] }, { circuits: {} }),
    );
    selectedSite.set({ slug: 's2' });
    f = make();
    expect(f.nativeElement.textContent).toContain('2 events');
  });

  it('passes the site RECORD id (not the slug) to the readiness badge', () => {
    selectedSite.set({ slug: 's1', id: 'rec-1' });
    const f = make();
    expect(f.componentInstance.siteRecordId()).toBe('rec-1');
    expect(f.nativeElement.querySelector('app-readiness-badge')).toBeTruthy();
  });

  it('reload() is a no-op when no site is selected', () => {
    const f = make();
    get.calls.reset();
    f.componentInstance.reload();
    expect(get).not.toHaveBeenCalled();
  });

  it('reload() re-fetches when a site is selected (Refresh button)', () => {
    selectedSite.set({ slug: 's1' });
    const f = make();
    get.calls.reset();
    f.nativeElement.querySelector('[data-testid="al-refresh"]').click();
    expect(get).toHaveBeenCalledWith('/analytics-data', { siteId: 's1', limit: '100' }, { silent: true });
  });

  it('sendTest() no-ops when no site is selected', () => {
    const f = make();
    f.componentInstance.sendTest();
    expect(post).not.toHaveBeenCalled();
    expect(f.componentInstance.testing()).toBeFalse();
  });

  it('sendTest() ignores re-entry while a test is already in flight', () => {
    post.and.returnValue(NEVER); // first call hangs → testing stays true
    selectedSite.set({ slug: 's1' });
    const f = make();
    f.componentInstance.sendTest();
    f.componentInstance.sendTest(); // re-entry guard
    expect(post).toHaveBeenCalledTimes(1);
    expect(f.componentInstance.testing()).toBeTrue();
  });

  it('sendTest() resets the busy flag when the POST fails', () => {
    post.and.returnValue(throwError(() => new Error('nope')));
    selectedSite.set({ slug: 's1' });
    const f = make();
    f.componentInstance.sendTest();
    expect(f.componentInstance.testing()).toBeFalse();
  });

  it('sendTest() click via the button posts then reloads', () => {
    selectedSite.set({ slug: 's1' });
    const f = make();
    get.calls.reset();
    f.nativeElement.querySelector('[data-testid="al-test"]').click();
    expect(post).toHaveBeenCalledWith('/test-event?siteId=s1', undefined, { silent: true });
    expect(get).toHaveBeenCalled();
  });

  it('fmt() returns a localized string for a valid timestamp', () => {
    const f = make();
    expect(typeof f.componentInstance.fmt(1_700_000_000_000)).toBe('string');
    expect(f.componentInstance.fmt(1_700_000_000_000).length).toBeGreaterThan(0);
  });

  it('fmt() falls back to String(ts) when toLocaleString throws', () => {
    const f = make();
    spyOn(Date.prototype, 'toLocaleString').and.throwError('locale unavailable');
    expect(f.componentInstance.fmt(42)).toBe('42');
  });
});
