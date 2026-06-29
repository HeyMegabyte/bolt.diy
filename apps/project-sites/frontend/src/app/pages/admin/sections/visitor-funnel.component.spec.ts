import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { VisitorFunnelComponent } from './visitor-funnel.component';
import { ApiService } from '../../../services/api.service';
import { AdminStateService } from '../admin-state.service';

const SAMPLE = {
  siteId: 'site_1',
  windowDays: 30,
  stages: [
    { key: 'landing', label: 'Landed', sessions: 100, percentOfLanding: 100 },
    { key: 'engaged', label: 'Engaged (2+ pages)', sessions: 40, percentOfLanding: 40 },
    { key: 'converted', label: 'Converted', sessions: 12, percentOfLanding: 12 },
  ],
  generatedAt: '2026-06-29T00:00:00.000Z',
};

function make(opts: { get?: jasmine.Spy; selectedSite?: unknown } = {}) {
  const get = opts.get ?? jasmine.createSpy('get').and.returnValue(of(SAMPLE));
  const initialSite = 'selectedSite' in opts ? opts.selectedSite : { id: 'site_1' };
  const selectedSite = signal<unknown>(initialSite);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [VisitorFunnelComponent],
    providers: [
      { provide: ApiService, useValue: { get } },
      { provide: AdminStateService, useValue: { selectedSite } },
    ],
  });
  const f = TestBed.createComponent(VisitorFunnelComponent);
  f.detectChanges();
  return { f, get };
}

describe('VisitorFunnelComponent (AN19)', () => {
  it('fetches the selected site’s funnel and renders the three stages with drop-off', () => {
    const { f, get } = make();
    expect(get).toHaveBeenCalledWith('/sites/site_1/analytics/funnel');
    const stages = f.nativeElement.querySelectorAll('[data-testid="visitor-funnel-stages"] li');
    expect(stages.length).toBe(3);
    expect(f.nativeElement.textContent).toContain('Landed');
    expect(f.nativeElement.textContent).toContain('40 · 40%');
    expect(f.nativeElement.textContent).toContain('Converted');
  });

  it('shows the empty state when there are no sessions', () => {
    const empty = { ...SAMPLE, stages: [{ key: 'landing', label: 'Landed', sessions: 0, percentOfLanding: 0 }] };
    const { f } = make({ get: jasmine.createSpy('get').and.returnValue(of(empty)) });
    expect(f.nativeElement.querySelector('[data-testid="visitor-funnel-empty"]')).toBeTruthy();
  });

  it('shows a retry-able error card when the request fails', () => {
    const { f } = make({
      get: jasmine.createSpy('get').and.returnValue(throwError(() => new Error('boom'))),
    });
    expect(f.componentInstance.error()).toBe(true);
  });

  it('does not fetch when no site is selected', () => {
    const { get } = make({ selectedSite: null });
    expect(get).not.toHaveBeenCalled();
  });
});
