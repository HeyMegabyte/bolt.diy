import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { FormAnalyticsComponent } from './form-analytics.component';
import { ApiService } from '../../../services/api.service';
import { AdminStateService } from '../admin-state.service';

const SAMPLE = {
  siteId: 'site_1',
  windowDays: 30,
  forms: [
    { form: 'contact', starts: 10, submits: 4, completionRate: 40, abandoned: 6 },
    { form: 'newsletter', starts: 5, submits: 5, completionRate: 100, abandoned: 0 },
  ],
  generatedAt: '2026-06-28T00:00:00.000Z',
};

function make(opts: { get?: jasmine.Spy; selectedSite?: unknown } = {}) {
  const get = opts.get ?? jasmine.createSpy('get').and.returnValue(of(SAMPLE));
  // NB: distinguish "not passed" from an explicit `null`.
  const initialSite = 'selectedSite' in opts ? opts.selectedSite : { id: 'site_1' };
  const selectedSite = signal<unknown>(initialSite);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [FormAnalyticsComponent],
    providers: [
      { provide: ApiService, useValue: { get } },
      { provide: AdminStateService, useValue: { selectedSite } },
    ],
  });
  const f = TestBed.createComponent(FormAnalyticsComponent);
  f.detectChanges();
  return { f, get };
}

describe('FormAnalyticsComponent (AN17)', () => {
  it('fetches the selected site’s form analytics and renders completion rows', () => {
    const { f, get } = make();
    expect(get).toHaveBeenCalledWith('/sites/site_1/analytics/forms');
    const rows = f.nativeElement.querySelectorAll('[data-testid="form-analytics-rows"] li');
    expect(rows.length).toBe(2);
    expect(f.nativeElement.textContent).toContain('contact');
    expect(f.nativeElement.textContent).toContain('40% completed');
    expect(f.nativeElement.textContent).toContain('4 / 10 finished');
    expect(f.nativeElement.textContent).toContain('⚠ 6 abandoned');
  });

  it('shows the empty state when there is no form activity', () => {
    const { f } = make({
      get: jasmine.createSpy('get').and.returnValue(of({ ...SAMPLE, forms: [] })),
    });
    expect(f.nativeElement.querySelector('[data-testid="form-analytics-empty"]')).toBeTruthy();
  });

  it('shows a retry-able error card when the request fails', () => {
    const { f } = make({
      get: jasmine.createSpy('get').and.returnValue(throwError(() => new Error('boom'))),
    });
    expect(f.componentInstance.error()).toBe(true);
    expect(f.nativeElement.textContent).toContain('Couldn’t load form analytics');
  });

  it('does not fetch when no site is selected', () => {
    const { get } = make({ selectedSite: null });
    expect(get).not.toHaveBeenCalled();
  });
});
