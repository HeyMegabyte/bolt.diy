import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { signal } from '@angular/core';
import { AdminAnalyticsDashboardComponent } from './analytics-dashboard.component';
import { ApiService } from '../../../services/api.service';
import { AdminStateService } from '../admin-state.service';
import { ToastService } from '../../../services/toast.service';

// Lightweight stubs so the wrapper test never instantiates the heavy real
// Analytics / Live Events children (which fan out API calls on construction).
// They share the real selectors so the wrapper template resolves to them.
@Component({ selector: 'app-admin-analytics', standalone: true, template: '<div data-testid="stub-overview"></div>' })
class StubOverviewComponent {}
@Component({ selector: 'app-admin-analytics-live', standalone: true, template: '<div data-testid="stub-live"></div>' })
class StubLiveComponent {}
@Component({ selector: 'app-admin-activation-funnel', standalone: true, template: '<div data-testid="stub-funnel"></div>' })
class StubFunnelComponent {}
@Component({ selector: 'app-social-analytics', standalone: true, template: '<div data-testid="stub-social"></div>' })
class StubVisitorsComponent {}
@Component({ selector: 'app-section-attribution', standalone: true, template: '<div data-testid="stub-sections"></div>' })
class StubSectionsComponent {}
@Component({ selector: 'app-form-analytics', standalone: true, template: '<div data-testid="stub-forms"></div>' })
class StubFormsComponent {}
@Component({ selector: 'app-visitor-funnel', standalone: true, template: '<div data-testid="stub-visitor"></div>' })
class StubVisitorFunnelComponent {}
@Component({ selector: 'app-site-doctor', standalone: true, template: '<div data-testid="stub-health"></div>' })
class StubSiteDoctorComponent {}

describe('AdminAnalyticsDashboardComponent', () => {
  const qpm = new BehaviorSubject<ParamMap>(convertToParamMap({}));
  const navigate = jasmine.createSpy('navigate');
  let apiPost: jasmine.Spy;
  let apiGet: jasmine.Spy;
  let toastSuccess: jasmine.Spy;

  function make() {
    apiPost = jasmine
      .createSpy('post')
      .and.returnValue(of({ url: 'https://projectsites.dev/shared/analytics/tok', expiresAt: 1 }));
    apiGet = jasmine
      .createSpy('get')
      .and.returnValue(of({ filename: 'analytics-site_1.csv', csv: 'metric,value\r\nx,1' }));
    toastSuccess = jasmine.createSpy('success');
    TestBed.configureTestingModule({
      imports: [AdminAnalyticsDashboardComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: qpm.asObservable() } },
        { provide: Router, useValue: { navigate } },
        { provide: ApiService, useValue: { post: apiPost, get: apiGet } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 'site_1' }) } },
        { provide: ToastService, useValue: { success: toastSuccess, error: jasmine.createSpy('error') } },
      ],
    });
    TestBed.overrideComponent(AdminAnalyticsDashboardComponent, {
      set: {
        imports: [StubOverviewComponent, StubLiveComponent, StubFunnelComponent, StubVisitorsComponent, StubSectionsComponent, StubFormsComponent, StubVisitorFunnelComponent, StubSiteDoctorComponent],
      },
    });
    const f = TestBed.createComponent(AdminAnalyticsDashboardComponent);
    f.detectChanges();
    return f;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    qpm.next(convertToParamMap({}));
    navigate.calls.reset();
  });

  it('renders the dashboard shell with all four tabs', () => {
    const f = make();
    expect(f.nativeElement.querySelector('[data-testid="analytics-dashboard"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="analytics-tab-overview"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="analytics-tab-live"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="analytics-tab-funnel"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="analytics-tab-social"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="analytics-tab-sections"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="analytics-tab-forms"]')).toBeTruthy();
  });

  it('lands on By Section when ?tab=sections (AN27)', () => {
    qpm.next(convertToParamMap({ tab: 'sections' }));
    const f = make();
    expect(f.componentInstance.tab()).toBe('sections');
    expect(f.nativeElement.querySelector('[data-testid="stub-sections"]')).toBeTruthy();
  });

  it('lands on Forms when ?tab=forms (AN17)', () => {
    qpm.next(convertToParamMap({ tab: 'forms' }));
    const f = make();
    expect(f.componentInstance.tab()).toBe('forms');
    expect(f.nativeElement.querySelector('[data-testid="stub-forms"]')).toBeTruthy();
  });

  it('mints a read-only share link for the selected site when the Share button is clicked (AN48)', () => {
    const f = make();
    f.nativeElement.querySelector('[data-testid="share-readonly-btn"]').click();
    expect(apiPost).toHaveBeenCalledWith('/sites/site_1/analytics/share', {});
  });

  it('exports the selected site’s analytics CSV when the Export button is clicked (AN42)', () => {
    const f = make();
    f.nativeElement.querySelector('[data-testid="export-csv-btn"]').click();
    expect(apiGet).toHaveBeenCalledWith('/sites/site_1/analytics/export');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('lands on Visitor Funnel when ?tab=visitor (AN19)', () => {
    qpm.next(convertToParamMap({ tab: 'visitor' }));
    const f = make();
    expect(f.componentInstance.tab()).toBe('visitor');
    expect(f.nativeElement.querySelector('[data-testid="stub-visitor"]')).toBeTruthy();
  });

  it('lands on Site Health when ?tab=health (#59 Site Doctor)', () => {
    qpm.next(convertToParamMap({ tab: 'health' }));
    const f = make();
    expect(f.componentInstance.tab()).toBe('health');
    expect(f.nativeElement.querySelector('[data-testid="stub-health"]')).toBeTruthy();
  });

  it('lands on Social when ?tab=social', () => {
    qpm.next(convertToParamMap({ tab: 'social' }));
    const f = make();
    expect(f.nativeElement.querySelector('[data-testid="stub-social"]')).toBeTruthy();
  });

  it('defaults to the Overview tab when no ?tab is present', () => {
    const f = make();
    expect(f.componentInstance.tab()).toBe('overview');
    expect(f.nativeElement.querySelector('[data-testid="stub-overview"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="stub-live"]')).toBeFalsy();
  });

  it('lands on Live Events when ?tab=live (legacy /admin/analytics-live deep link)', () => {
    qpm.next(convertToParamMap({ tab: 'live' }));
    const f = make();
    expect(f.componentInstance.tab()).toBe('live');
    expect(f.nativeElement.querySelector('[data-testid="stub-live"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="stub-overview"]')).toBeFalsy();
  });

  it('lands on the Activation Funnel when ?tab=funnel (legacy /admin/activation-funnel deep link)', () => {
    qpm.next(convertToParamMap({ tab: 'funnel' }));
    const f = make();
    expect(f.componentInstance.tab()).toBe('funnel');
    expect(f.nativeElement.querySelector('[data-testid="stub-funnel"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="stub-overview"]')).toBeFalsy();
  });

  it('navigates with merged ?tab=live when the Live Events tab is clicked', () => {
    const f = make();
    f.nativeElement.querySelector('[data-testid="analytics-tab-live"]').click();
    expect(navigate).toHaveBeenCalled();
    const [, extras] = navigate.calls.mostRecent().args;
    expect(extras.queryParams).toEqual({ tab: 'live' });
    expect(extras.queryParamsHandling).toBe('merge');
  });
});
