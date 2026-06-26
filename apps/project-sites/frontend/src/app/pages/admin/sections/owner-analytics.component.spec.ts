import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { OwnerAnalyticsComponent } from './owner-analytics.component';
import { ApiService } from '../../../services/api.service';
import { AdminStateService } from '../admin-state.service';

const SUMMARY = {
  siteId: 's1',
  windowDays: 30,
  contacts: {
    total: 12,
    newInWindow: 3,
    bySource: [
      { source: 'instagram', count: 7 },
      { source: '', count: 5 },
    ],
  },
  formSubmissions: { total: 8, newInWindow: 2 },
  newsletter: { confirmed: 5, total: 7 },
  donations: { raisedCents: 25000, count: 4 },
  traffic: {
    pageviews: 1200,
    uniqueSessions: 800,
    conversions: 14,
    topPaths: [{ path: '/', count: 600, uniques: 420 }],
    byType: [],
    byDevice: [
      { label: 'mobile', count: 700 },
      { label: 'desktop', count: 500 },
    ],
    byChannel: [
      { label: 'organic', count: 480 },
      { label: 'social', count: 360 },
    ],
    byCountry: [
      { label: 'US', count: 900 },
      { label: 'CA', count: 200 },
    ],
    previous: { pageviews: 1000, uniqueSessions: 700, conversions: 10 }, // pv +20%
    windowDays: 30,
  },
  generatedAt: '2026-06-25T00:00:00Z',
};

function setup(siteId: string | null, opts: { error?: boolean } = {}) {
  const get = jasmine
    .createSpy('get')
    .and.returnValue(opts.error ? throwError(() => new Error('404')) : of({ data: SUMMARY }));
  const selectedSiteId = signal<string | null>(siteId);
  TestBed.configureTestingModule({
    imports: [OwnerAnalyticsComponent],
    providers: [
      { provide: ApiService, useValue: { get } },
      { provide: AdminStateService, useValue: { selectedSiteId } },
    ],
  });
  const fixture = TestBed.createComponent(OwnerAnalyticsComponent);
  fixture.detectChanges();
  return { fixture, get, selectedSiteId };
}

describe('OwnerAnalyticsComponent (AN7 — Your Visitors)', () => {
  it('prompts to select a site when none is selected, and does not call the API', () => {
    const { fixture, get } = setup(null);
    expect(get).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Select a site');
  });

  it('renders a 7/30/90-day window selector and re-fetches with the chosen window', () => {
    const { fixture, get } = setup('s1');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="oa-window-7"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="oa-window-90"]')).toBeTruthy();
    get.calls.reset();
    fixture.componentInstance.setWindow(90);
    fixture.detectChanges();
    expect(get).toHaveBeenCalledWith('/sites/s1/analytics', { windowDays: '90' }, { silent: true });
  });

  it('fetches /sites/:id/analytics (silent) and renders the visitor stat cards', () => {
    const { fixture, get } = setup('s1');
    expect(get).toHaveBeenCalledWith('/sites/s1/analytics', { windowDays: '30' }, { silent: true });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="oa-pageviews"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="oa-contacts"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="oa-donations"]')).toBeTruthy(); // count > 0 → shown
    expect(el.textContent).toContain('Top pages');
    // AN9 — engagement signal: unique visitors per page (not raw hits), views secondary.
    const engagement = el.querySelector('[data-testid="oa-page-engagement"]');
    expect(engagement?.textContent).toContain('420 visitors');
    expect(engagement?.textContent).toContain('600 views');
    // Conversion rate = 14 / 1200 = 1.2% of visits.
    expect(el.querySelector('[data-testid="oa-conv-rate"]')?.textContent).toContain('1.2%');
    // Contacts-by-source breakdown, with the empty source labelled.
    const sources = el.querySelector('[data-testid="oa-contact-sources"]');
    expect(sources).toBeTruthy();
    expect(sources?.textContent).toContain('instagram');
    expect(sources?.textContent).toContain('Direct / unknown');
    // AN10 channel + AN13 device breakdowns (from the AN1 metadata enrichment).
    const channels = el.querySelector('[data-testid="oa-channels"]');
    expect(channels?.textContent).toContain('organic');
    expect(channels?.textContent).toContain('480');
    const devices = el.querySelector('[data-testid="oa-devices"]');
    expect(devices?.textContent).toContain('mobile');
    expect(devices?.textContent).toContain('700');
    const countries = el.querySelector('[data-testid="oa-countries"]');
    expect(countries?.textContent).toContain('US');
    expect(countries?.textContent).toContain('900');
    // AN15 period-over-period: pageviews 1200 vs prev 1000 = +20% up.
    const deltaPv = el.querySelector('[data-testid="oa-delta-pv"]');
    expect(deltaPv?.textContent).toContain('20%');
    expect(deltaPv?.getAttribute('data-dir')).toBe('up');
    // AN8 outcome-language headline — people + actions, never "sessions".
    const headline = el.querySelector('[data-testid="oa-headline"]');
    expect(headline?.textContent).toContain('800 people visited your site');
    expect(headline?.textContent).toContain('reached out');
    expect(headline?.textContent).not.toContain('session');
  });

  it('outcomeSummary(): no-visits + outcome-only phrasings', () => {
    const c = setup('s1').fixture.componentInstance;
    const base = {
      siteId: 's1',
      windowDays: 30,
      contacts: { total: 0, newInWindow: 0, bySource: [] },
      formSubmissions: { total: 0, newInWindow: 0 },
      newsletter: { confirmed: 0, total: 0 },
      donations: { raisedCents: 0, count: 0 },
      traffic: {
        pageviews: 0,
        uniqueSessions: 0,
        conversions: 0,
        topPaths: [],
        byType: [],
        byDevice: [],
        byChannel: [],
        byCountry: [],
        previous: { pageviews: 0, uniqueSessions: 0, conversions: 0 },
        windowDays: 30,
      },
      generatedAt: '',
    };
    expect(c.outcomeSummary(base)).toBe('No visits yet.');
    const oneEach = {
      ...base,
      contacts: { total: 1, newInWindow: 1, bySource: [] },
      traffic: { ...base.traffic, uniqueSessions: 1 },
    };
    expect(c.outcomeSummary(oneEach)).toBe('1 person visited your site — and 1 reached out.');
  });

  it('delta(): null when no baseline; up/down with arrows otherwise', () => {
    const c = setup('s1').fixture.componentInstance;
    expect(c.delta(50, 0)).toBeNull();
    expect(c.delta(50, 40)).toEqual({ label: '↑ 25%', dir: 'up' });
    expect(c.delta(30, 40)).toEqual({ label: '↓ 25%', dir: 'down' });
  });

  it('stays quiet with an "not enabled" note on a 404 (flag dark)', () => {
    const { fixture } = setup('s1', { error: true });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="oa-unavailable"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="oa-pageviews"]')).toBeNull();
  });
});
