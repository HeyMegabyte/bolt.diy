import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { SiteDoctorComponent } from './site-doctor.component';
import { ApiService } from '../../../services/api.service';
import { AdminStateService } from '../admin-state.service';

const REPORT = {
  grade: 'C',
  score: 68,
  summary: 'Solid foundation — two quick wins will push you to an A.',
  issues: [
    { id: 'meta', severity: 'high', title: 'Missing meta description', fix: 'Add a 150-char description.', locked: false },
    { id: 'alt', severity: 'medium', title: 'Images lack alt text', fix: '', locked: true },
  ],
  locked_count: 1,
};

function make(opts: { get?: jasmine.Spy; site?: unknown } = {}) {
  const get = opts.get ?? jasmine.createSpy('get').and.returnValue(of(REPORT));
  const site = 'site' in opts ? opts.site : { id: 'site_1', plan: 'free' };
  const selectedSite = signal<unknown>(site);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [SiteDoctorComponent],
    providers: [
      provideRouter([]),
      { provide: ApiService, useValue: { get } },
      { provide: AdminStateService, useValue: { selectedSite } },
    ],
  });
  const f = TestBed.createComponent(SiteDoctorComponent);
  f.detectChanges();
  return { f, get };
}

describe('SiteDoctorComponent (#59)', () => {
  it('fetches the report with the site’s plan and renders grade + score + issues', () => {
    const { f, get } = make();
    expect(get).toHaveBeenCalledWith('/sites/site_1/doctor?plan=free');
    expect(f.nativeElement.querySelector('[data-testid="site-doctor-grade"]').textContent).toContain('C');
    expect(f.nativeElement.textContent).toContain('68/100');
    expect(f.nativeElement.textContent).toContain('Missing meta description');
  });

  it('maps a paid site to the pro plan (unlocks all)', () => {
    const { get } = make({ site: { id: 'site_2', plan: 'paid' } });
    expect(get).toHaveBeenCalledWith('/sites/site_2/doctor?plan=pro');
  });

  it('shows an upsell link on locked issues + the locked-count note', () => {
    const { f } = make();
    expect(f.nativeElement.querySelector('[data-testid="site-doctor-upsell"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="site-doctor-lockednote"]')).toBeTruthy();
  });

  it('shows a retry-able error card when the request fails', () => {
    const { f } = make({
      get: jasmine.createSpy('get').and.returnValue(throwError(() => new Error('boom'))),
    });
    expect(f.componentInstance.error()).toBe(true);
  });

  it('does not fetch when no site is selected', () => {
    const { get } = make({ site: null });
    expect(get).not.toHaveBeenCalled();
  });
});
