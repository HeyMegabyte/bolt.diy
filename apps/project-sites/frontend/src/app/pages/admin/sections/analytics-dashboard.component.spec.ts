import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { AdminAnalyticsDashboardComponent } from './analytics-dashboard.component';

// Lightweight stubs so the wrapper test never instantiates the heavy real
// Analytics / Live Events children (which fan out API calls on construction).
// They share the real selectors so the wrapper template resolves to them.
@Component({ selector: 'app-admin-analytics', standalone: true, template: '<div data-testid="stub-overview"></div>' })
class StubOverviewComponent {}
@Component({ selector: 'app-admin-analytics-live', standalone: true, template: '<div data-testid="stub-live"></div>' })
class StubLiveComponent {}
@Component({ selector: 'app-admin-activation-funnel', standalone: true, template: '<div data-testid="stub-funnel"></div>' })
class StubFunnelComponent {}

describe('AdminAnalyticsDashboardComponent', () => {
  const qpm = new BehaviorSubject<ParamMap>(convertToParamMap({}));
  const navigate = jasmine.createSpy('navigate');

  function make() {
    TestBed.configureTestingModule({
      imports: [AdminAnalyticsDashboardComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: qpm.asObservable() } },
        { provide: Router, useValue: { navigate } },
      ],
    });
    TestBed.overrideComponent(AdminAnalyticsDashboardComponent, {
      set: { imports: [StubOverviewComponent, StubLiveComponent, StubFunnelComponent] },
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

  it('renders the dashboard shell with all three tabs', () => {
    const f = make();
    expect(f.nativeElement.querySelector('[data-testid="analytics-dashboard"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="analytics-tab-overview"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="analytics-tab-live"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="analytics-tab-funnel"]')).toBeTruthy();
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
