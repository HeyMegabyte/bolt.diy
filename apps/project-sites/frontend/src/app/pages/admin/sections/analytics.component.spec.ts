import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AdminAnalyticsComponent } from './analytics.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { PromptService } from '../../../services/prompt.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Guards the P0 site-reactive-load class-bug fix for the Analytics section:
 * on a deep-link the selected site resolves AFTER mount, so the constructor
 * effect (not ngOnInit-once) must fire the analytics + URL fetch the instant
 * selectedSite() resolves — never leaving the panel empty until the 60s poll.
 */
describe('AdminAnalyticsComponent (site-reactive load)', () => {
  let fixture: ComponentFixture<AdminAnalyticsComponent>;
  let selectedSite: WritableSignal<{ id: string } | null>;
  let getAnalytics: jasmine.Spy;
  let listUrls: jasmine.Spy;
  let credStatus: jasmine.Spy;

  function build(initial: { id: string } | null): void {
    selectedSite = signal<{ id: string } | null>(initial);
    getAnalytics = jasmine.createSpy('getMultiUrlAnalytics').and.returnValue(of({ data: null }));
    listUrls = jasmine.createSpy('listSiteUrls').and.returnValue(of({ data: [] }));
    credStatus = jasmine.createSpy('getCloudflareCredentialStatus').and.returnValue(of({ data: null }));
    TestBed.configureTestingModule({
      imports: [AdminAnalyticsComponent],
      providers: [
        {
          provide: ApiService,
          useValue: {
            getMultiUrlAnalytics: getAnalytics,
            listSiteUrls: listUrls,
            getCloudflareCredentialStatus: credStatus,
            addSiteUrl: jasmine.createSpy('addSiteUrl').and.returnValue(of({})),
          },
        },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
        { provide: PromptService, useValue: { prompt: jasmine.createSpy('prompt').and.resolveTo(null) } },
        { provide: Router, useValue: { navigateByUrl: jasmine.createSpy('navigateByUrl') } },
        { provide: AdminStateService, useValue: { selectedSite } },
      ],
    });
    fixture = TestBed.createComponent(AdminAnalyticsComponent);
    fixture.detectChanges(); // ngOnInit + first effect flush
  }

  afterEach(() => TestBed.resetTestingModule());

  it('does NOT fetch analytics on mount when no site is selected (deep-link)', () => {
    build(null);
    expect(getAnalytics).not.toHaveBeenCalled();
    expect(credStatus).toHaveBeenCalled(); // org-level cred status still loads
  });

  it('fetches analytics the instant the site resolves after mount (no poll tick)', () => {
    build(null);
    expect(getAnalytics).not.toHaveBeenCalled();

    selectedSite.set({ id: 'site-deep-link' });
    fixture.detectChanges(); // flush the constructor effect — NOT the 60s timer

    expect(getAnalytics).toHaveBeenCalled();
    expect(getAnalytics.calls.mostRecent().args[0]).toBe('site-deep-link');
    expect(listUrls).toHaveBeenCalledWith('site-deep-link');
  });

  it('re-fetches when the operator switches sites', () => {
    build({ id: 'site-a' });
    expect(getAnalytics.calls.mostRecent().args[0]).toBe('site-a');

    selectedSite.set({ id: 'site-b' });
    fixture.detectChanges();

    expect(getAnalytics.calls.mostRecent().args[0]).toBe('site-b');
  });

  describe('pvTrend (period-over-period delta chip)', () => {
    function series(views: number[]): { series: { date: string; page_views: number; unique_visitors: number }[] } {
      return { series: views.map((v, i) => ({ date: `2026-06-0${i + 1}`, page_views: v, unique_visitors: v })) };
    }

    it('returns null until ≥4 days of data exist', () => {
      build({ id: 's' });
      const c = fixture.componentInstance;
      c.envelope.set(series([10, 20, 30]) as never);
      expect(c.pvTrend()).toBeNull();
    });

    it('reports an up trend when the recent half outweighs the older half', () => {
      build({ id: 's' });
      const c = fixture.componentInstance;
      c.envelope.set(series([10, 10, 30, 30]) as never); // older 20 → recent 60 = +200%
      const t = c.pvTrend();
      expect(t?.dir).toBe('up');
      expect(t?.label).toBe('200%');
    });

    it('reports a down trend (muted, never red) when traffic falls', () => {
      build({ id: 's' });
      const c = fixture.componentInstance;
      c.envelope.set(series([40, 40, 10, 10]) as never); // older 80 → recent 20 = -75%
      const t = c.pvTrend();
      expect(t?.dir).toBe('down');
      expect(t?.label).toBe('75%');
    });

    it('reports flat when the halves are within ±1%', () => {
      build({ id: 's' });
      const c = fixture.componentInstance;
      c.envelope.set(series([50, 50, 50, 50]) as never);
      expect(c.pvTrend()?.dir).toBe('flat');
    });

    it('reads as "new" when the earlier half had zero views', () => {
      build({ id: 's' });
      const c = fixture.componentInstance;
      c.envelope.set(series([0, 0, 12, 18]) as never);
      const t = c.pvTrend();
      expect(t?.dir).toBe('up');
      expect(t?.label).toBe('new');
    });
  });

  it('surfaces an actionable, non-redundant error message on failure (not an echo of the banner header)', () => {
    build(null);
    getAnalytics.and.returnValue(throwError(() => ({ status: 500 })));
    selectedSite.set({ id: 'site-x' });
    fixture.detectChanges();
    const msg = (fixture.componentInstance.error() ?? '').toLowerCase();
    expect(msg).withContext('an error was surfaced').not.toBe('');
    // Must NOT merely echo the banner header "Analytics returned an error."
    expect(msg).not.toContain('returned an error');
    // Must guide the operator on what to do next.
    expect(msg).toMatch(/retry|temporar|unavailable|try again|moment|shortly/);
  });

  // A FAILED load must not also paint "0 views / no traffic yet" — that reads as
  // a definitive empty-data claim over an error (lying-UI). On error the body
  // (KPI tiles + chart + lists) is gated; only the error banner + Retry show.
  it('on error, the KPI tiles + chart body are NOT rendered (no lying "0"/"no traffic" over a failed load)', () => {
    build({ id: 'site-x' });
    fixture.componentInstance.error.set('Analytics service is unavailable.');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="kpi-pageviews"]')).withContext('KPI tiles hidden on error').toBeNull();
    expect(el.textContent).withContext('error banner still shows').toContain('Analytics returned an error');
  });

  it('with a site + no error, the KPI tiles render', () => {
    build({ id: 'site-x' });
    fixture.componentInstance.error.set(null);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="kpi-pageviews"]'))
      .withContext('body renders on the happy path').not.toBeNull();
  });
});
