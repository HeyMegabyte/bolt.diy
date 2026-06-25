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
    topPaths: [{ path: '/', count: 600 }],
    byType: [],
    byDevice: [
      { label: 'mobile', count: 700 },
      { label: 'desktop', count: 500 },
    ],
    byChannel: [
      { label: 'organic', count: 480 },
      { label: 'social', count: 360 },
    ],
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

  it('fetches /sites/:id/analytics (silent) and renders the visitor stat cards', () => {
    const { fixture, get } = setup('s1');
    expect(get).toHaveBeenCalledWith('/sites/s1/analytics', undefined, { silent: true });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="oa-pageviews"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="oa-contacts"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="oa-donations"]')).toBeTruthy(); // count > 0 → shown
    expect(el.textContent).toContain('Top pages');
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
  });

  it('stays quiet with an "not enabled" note on a 404 (flag dark)', () => {
    const { fixture } = setup('s1', { error: true });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="oa-unavailable"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="oa-pageviews"]')).toBeNull();
  });
});
