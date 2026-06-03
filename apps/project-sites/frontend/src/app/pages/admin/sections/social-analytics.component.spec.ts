import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AdminSocialAnalyticsComponent } from './social-analytics.component';
import { ApiService } from '../../../services/api.service';

/**
 * First coverage for the social-analytics aggregate view (model section, untested):
 *  - reload success populates data + clears error; failure sets the error-card message
 *  - setDays switches the window + reloads, but is a no-op when the window is unchanged
 *  - widgetProps bridges the loaded aggregate (or {} before load)
 * overrideComponent strips the widget/table template; methods driven directly.
 */
function make(get: jasmine.Spy): AdminSocialAnalyticsComponent {
  TestBed.configureTestingModule({
    imports: [AdminSocialAnalyticsComponent],
    providers: [{ provide: ApiService, useValue: { get } }],
  });
  TestBed.overrideComponent(AdminSocialAnalyticsComponent, { set: { template: '<div></div>', imports: [] } });
  return TestBed.createComponent(AdminSocialAnalyticsComponent).componentInstance;
}

describe('AdminSocialAnalyticsComponent (aggregate load + window)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('reload success populates data and clears error', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ platform_totals: [{ platform: 'x', posts: 1 }] })));
    c.reload();
    expect(c.error()).toBe('');
    expect(c.data()).not.toBeNull();
    expect(c.loading()).toBe(false);
  });

  it('a load error sets the error-card message and clears loading', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    c.reload();
    expect(c.error()).toContain('Could not load');
    expect(c.loading()).toBe(false);
  });

  it('setDays switches the window and triggers a fresh load', () => {
    const get = jasmine.createSpy('get').and.returnValue(of({ platform_totals: [] }));
    const c = make(get);
    const before = get.calls.count();
    c.setDays(7);
    expect(c.days()).toBe(7);
    expect(get.calls.count()).toBe(before + 1);
  });

  it('setDays is a no-op when the window is unchanged (no duplicate fetch)', () => {
    const get = jasmine.createSpy('get').and.returnValue(of({ platform_totals: [] }));
    const c = make(get);
    c.setDays(30); // default is already 30
    const before = get.calls.count();
    c.setDays(30);
    expect(get.calls.count()).toBe(before);
  });

  it('widgetProps is {} before load and the aggregate object once loaded', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ platform_totals: [{ platform: 'x', posts: 2 }] })));
    expect(c.widgetProps()).toEqual({});
    c.reload();
    expect((c.widgetProps() as { platform_totals: unknown[] }).platform_totals.length).toBe(1);
  });
});
