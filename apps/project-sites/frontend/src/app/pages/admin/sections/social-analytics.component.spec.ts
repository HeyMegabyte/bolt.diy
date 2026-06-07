import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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

/**
 * Full-render a11y contract for the "All platforms" data table (WCAG 1.3.1):
 *  - each row's platform-name cell is a `<th scope="row">` so screen readers
 *    announce the platform when reading any numeric cell in that row (without
 *    it a SR user on the impressions cell hears a bare "1,234" with no anchor)
 *  - the row header carries a [title] so a capitalized/truncated platform name
 *    stays readable on hover
 */
describe('AdminSocialAnalyticsComponent (data-table a11y)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(): HTMLElement {
    const get = jasmine.createSpy('get').and.returnValue(
      of({
        window_days: 30,
        generated_at: '',
        platform_totals: [
          { platform: 'instagram', posts: 3, impressions: 1234, reach: 900, engagement: 87 },
        ],
        best_posts: [],
        best_times: { platform: 'instagram', slots: [] },
      }),
    );
    TestBed.configureTestingModule({
      imports: [AdminSocialAnalyticsComponent],
      providers: [provideRouter([]), { provide: ApiService, useValue: { get } }],
    });
    const fixture = TestBed.createComponent(AdminSocialAnalyticsComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the platform-name cell as a row header (th[scope=row])', () => {
    const el = render();
    const rowHeader = el.querySelector('tbody tr th[scope="row"]');
    expect(rowHeader).withContext('platform cell must be a th[scope=row]').toBeTruthy();
    expect(rowHeader?.textContent?.trim()).toBe('instagram');
    expect(el.querySelector('tbody tr td.platform'))
      .withContext('platform must no longer be a plain td')
      .toBeNull();
  });

  it('exposes the platform name via [title] for truncation recovery', () => {
    const el = render();
    const rowHeader = el.querySelector('tbody tr th[scope="row"]');
    expect(rowHeader?.getAttribute('title')).toBe('instagram');
  });
});
