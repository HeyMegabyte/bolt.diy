import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminAnalyticsLiveComponent } from './analytics-live.component';
import { ApiService } from '../../../services/api.service';
import { AdminStateService } from '../admin-state.service';

describe('AdminAnalyticsLiveComponent', () => {
  const selectedSite = signal<{ slug: string } | null>(null);
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
    get.and.callFake((path: string) =>
      path === '/analytics-data'
        ? of({ events: [{ id: '1', eventId: 'a', eventType: 'pageview', timestamp: 1, status: 'ingested' }] })
        : of({ circuits: { sentry: 'closed' } }),
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
});
