import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { SectionAttributionComponent } from './section-attribution.component';
import { ApiService } from '../../../services/api.service';
import { AdminStateService } from '../admin-state.service';

const SAMPLE = {
  siteId: 'site_1',
  windowDays: 30,
  totalConversions: 10,
  sections: [
    { section: 'services', count: 6, percent: 60, calls: 4, directions: 2, emails: 0 },
    { section: 'contact', count: 4, percent: 40, calls: 2, directions: 0, emails: 2 },
  ],
  generatedAt: '2026-06-28T00:00:00.000Z',
};

function make(opts: { get?: jasmine.Spy; selectedSite?: unknown } = {}) {
  const get = opts.get ?? jasmine.createSpy('get').and.returnValue(of(SAMPLE));
  // NB: distinguish "not passed" from an explicit `null` (null is a valid value here).
  const initialSite = 'selectedSite' in opts ? opts.selectedSite : { id: 'site_1' };
  const selectedSite = signal<unknown>(initialSite);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [SectionAttributionComponent],
    providers: [
      { provide: ApiService, useValue: { get } },
      { provide: AdminStateService, useValue: { selectedSite } },
    ],
  });
  const f = TestBed.createComponent(SectionAttributionComponent);
  f.detectChanges();
  return { f, get };
}

describe('SectionAttributionComponent (AN27)', () => {
  it('fetches the selected site’s section breakdown and renders ranked rows', () => {
    const { f, get } = make();
    expect(get).toHaveBeenCalledWith('/sites/site_1/analytics/sections');
    const rows = f.nativeElement.querySelectorAll('[data-testid="section-attribution-rows"] li');
    expect(rows.length).toBe(2);
    expect(f.nativeElement.textContent).toContain('services');
    expect(f.nativeElement.textContent).toContain('60% · 6');
    expect(f.nativeElement.textContent).toContain('📞 4 calls');
  });

  it('shows the empty state when there are no conversions yet', () => {
    const { f } = make({
      get: jasmine
        .createSpy('get')
        .and.returnValue(of({ ...SAMPLE, totalConversions: 0, sections: [] })),
    });
    expect(f.nativeElement.querySelector('[data-testid="section-attribution-empty"]')).toBeTruthy();
  });

  it('shows a retry-able error card when the request fails', () => {
    const { f } = make({
      get: jasmine.createSpy('get').and.returnValue(throwError(() => new Error('boom'))),
    });
    expect(f.componentInstance.error()).toBe(true);
    expect(f.nativeElement.textContent).toContain('Couldn’t load section attribution');
  });

  it('does not fetch when no site is selected', () => {
    const { get } = make({ selectedSite: null });
    expect(get).not.toHaveBeenCalled();
  });
});
