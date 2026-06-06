import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError, NEVER } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { AdminSiteCopilotComponent } from './site-copilot.component';
import { ToastService } from '../../../services/toast.service';

/**
 * Guards the copilot-sessions load-error gating (first coverage): a non-404
 * loadSessions failure used to just stop loading → the "No sessions yet" empty
 * state showed (masquerade). Now a non-404 error sets loadError + a Retry row;
 * a 404 stays the honest flag-disabled state; success/retry clear it.
 * overrideComponent strips the template; loadSessions() is driven directly.
 */
function make(get: jasmine.Spy): AdminSiteCopilotComponent {
  TestBed.configureTestingModule({
    imports: [AdminSiteCopilotComponent],
    providers: [
      { provide: HttpClient, useValue: { get, put: () => of({ ok: true }) } },
      { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
    ],
  });
  TestBed.overrideComponent(AdminSiteCopilotComponent, { set: { template: '<div></div>', imports: [] } });
  const c = TestBed.createComponent(AdminSiteCopilotComponent).componentInstance;
  c.siteId = 's1';
  return c;
}

describe('AdminSiteCopilotComponent (sessions load-error gating)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('success populates sessions and clears loadError', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ sessions: [{ id: 'a' }], distribution: [] })));
    c.loadSessions();
    expect(c.loadError()).toBeNull();
    expect(c.sessions().length).toBe(1);
    expect(c.loading()).toBe(false);
  });

  it('a 404 marks the feature flag-disabled WITHOUT a loadError (honest state, not a masquerade)', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 404 }))));
    c.loadSessions();
    expect(c.flagEnabled()).toBe(false);
    expect(c.loadError()).toBeNull();
    expect(c.loading()).toBe(false);
  });

  it('a non-404 error sets a persistent loadError (not a fake empty)', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    c.loadSessions();
    expect(c.loadError()).toContain('Could not load');
    expect(c.loading()).toBe(false);
  });

  it('retry after an error clears the prior loadError', () => {
    const get = jasmine.createSpy('get').and.returnValues(
      throwError(() => ({ status: 500 })),
      of({ sessions: [], distribution: [] }),
    );
    const c = make(get);
    c.loadSessions();
    expect(c.loadError()).not.toBeNull();
    c.loadSessions();
    expect(c.loadError()).toBeNull();
  });
});

/**
 * toggleEnabled must NOT be a moot mutation when multimodal_copilot is flag-off.
 * The enable toggle sits in the header (always rendered), but when the flag is
 * off (flagEnabled=false → gate notice shown) the per-site config route 404s, so
 * a toggle there is contradictory + dead. The template disables it; the handler
 * also no-ops + reverts the native checkbox defensively.
 */
let toggleToastErr: jasmine.Spy;
function makeToggle(put: jasmine.Spy): AdminSiteCopilotComponent {
  toggleToastErr = jasmine.createSpy('error');
  TestBed.configureTestingModule({
    imports: [AdminSiteCopilotComponent],
    providers: [
      { provide: HttpClient, useValue: { get: () => of({ sessions: [], distribution: [] }), put } },
      { provide: ToastService, useValue: { error: toggleToastErr, success: () => 0 } },
    ],
  });
  TestBed.overrideComponent(AdminSiteCopilotComponent, { set: { template: '<div></div>', imports: [] } });
  const c = TestBed.createComponent(AdminSiteCopilotComponent).componentInstance;
  c.siteId = 's1';
  return c;
}

describe('AdminSiteCopilotComponent (enable toggle gated by the feature flag)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('toggleEnabled is a no-op when the flag is off — no PUT to a gated route + reverts the checkbox', () => {
    const put = jasmine.createSpy('put').and.returnValue(of({ ok: true }));
    const c = makeToggle(put);
    c.flagEnabled.set(false);
    c.enabled.set(false);
    const input = { checked: true } as HTMLInputElement; // user just flipped it on
    c.toggleEnabled({ target: input } as unknown as Event);
    expect(put).withContext('no PUT when the feature is flag-disabled').not.toHaveBeenCalled();
    expect(input.checked).withContext('native checkbox reverts to the real state').toBe(false);
  });

  it('toggleEnabled PUTs the config when the flag is on', () => {
    const put = jasmine.createSpy('put').and.returnValue(of({ ok: true }));
    const c = makeToggle(put);
    c.flagEnabled.set(true);
    c.toggleEnabled({ target: { checked: true } as HTMLInputElement } as unknown as Event);
    expect(put).toHaveBeenCalledWith('/api/sites/s1/copilot/config', { enabled: true });
    expect(c.enabled()).toBe(true);
  });

  it('a failed toggle PUT surfaces an error toast (no silent failure) + leaves enabled() unchanged', () => {
    const put = jasmine.createSpy('put').and.returnValue(throwError(() => ({ status: 500 })));
    const c = makeToggle(put);
    c.flagEnabled.set(true);
    c.enabled.set(false);
    c.toggleEnabled({ target: { checked: true } as HTMLInputElement } as unknown as Event);
    expect(toggleToastErr).withContext('failed mutation must not fail silently').toHaveBeenCalled();
    expect(c.enabled()).withContext('signal unchanged on failure → [checked] binding reverts the checkbox').toBe(false);
  });
});

/**
 * Flag-gate cohesion (real template): the multimodal_copilot disabled card must
 * point at Feature Flags with the SAME inline, underlined RouterLink the sibling
 * flag-gate cards use (enterprise/trust/stripe/inbox/site-dna) — not a color-only
 * standalone CTA. Guards WCAG 1.4.1 (link affordance beyond color) + SPA nav.
 */
describe('AdminSiteCopilotComponent — flag-gate link cohesion (real template)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders an inline, UNDERLINED, working Feature-Flags RouterLink when the flag is off', () => {
    TestBed.configureTestingModule({
      imports: [AdminSiteCopilotComponent],
      providers: [
        { provide: HttpClient, useValue: { get: () => of({ sessions: [], distribution: [] }), put: () => of({ ok: true }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        provideRouter([]),
      ],
    });
    const fx = TestBed.createComponent(AdminSiteCopilotComponent);
    fx.componentInstance.flagEnabled.set(false);
    fx.detectChanges();
    const link = (fx.nativeElement as HTMLElement).querySelector(
      '.copilot-flag-gate a[routerLink="/admin/feature-flags"]',
    ) as HTMLAnchorElement;
    expect(link).withContext('flag-gate links to Feature Flags').toBeTruthy();
    expect(link.className).toContain('underline');
    expect(link.getAttribute('href')).toBe('/admin/feature-flags');
  });

  // The session-count stats ("0 sessions" + intent distribution) must NOT render
  // a definitive count while the sessions table is still loading — otherwise the
  // header asserts "0 sessions" OVER a skeleton-loading table (a contradictory,
  // premature stat). The stats appear only once data genuinely resolves.
  it('hides the session-count stats while loading (no "0 sessions" over a skeleton table)', () => {
    TestBed.configureTestingModule({
      imports: [AdminSiteCopilotComponent],
      providers: [
        { provide: HttpClient, useValue: { get: () => NEVER, put: () => of({ ok: true }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        provideRouter([]),
      ],
    });
    const fx = TestBed.createComponent(AdminSiteCopilotComponent);
    fx.componentInstance.flagEnabled.set(true); // flag on → table renders (not the gate notice)
    fx.detectChanges();
    const el = fx.nativeElement as HTMLElement;
    expect(fx.componentInstance.loading()).withContext('sessions fetch in-flight').toBeTrue();
    expect(el.querySelector('.copilot-stats')).withContext('no premature stats over a loading table').toBeNull();
    expect(el.querySelector('.copilot-table[aria-busy="true"]')).withContext('the loading table is the only state shown').not.toBeNull();
  });

  it('the sessions table is a keyboard-scrollable region (WCAG 1.4.10 — wide signal/status values scroll, never clip unreachably)', () => {
    TestBed.configureTestingModule({
      imports: [AdminSiteCopilotComponent],
      providers: [
        { provide: HttpClient, useValue: { get: () => of({ sessions: [], distribution: [] }), put: () => of({ ok: true }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        provideRouter([]),
      ],
    });
    const fx = TestBed.createComponent(AdminSiteCopilotComponent);
    fx.componentInstance.flagEnabled.set(true);
    fx.detectChanges();
    const region = (fx.nativeElement as HTMLElement).querySelector('[data-testid="copilot-table-scroll"]') as HTMLElement;
    expect(region).withContext('sessions table wrap present').toBeTruthy();
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('tabindex')).withContext('keyboard-scrollable').toBe('0');
    expect(region.querySelector('table')).withContext('table inside the scroll region').toBeTruthy();
  });

  it('shows the session-count stats once the load resolves', () => {
    TestBed.configureTestingModule({
      imports: [AdminSiteCopilotComponent],
      providers: [
        { provide: HttpClient, useValue: { get: () => of({ sessions: [], distribution: [] }), put: () => of({ ok: true }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        provideRouter([]),
      ],
    });
    const fx = TestBed.createComponent(AdminSiteCopilotComponent);
    fx.componentInstance.flagEnabled.set(true);
    fx.componentInstance.loading.set(false); // simulate a resolved sessions load
    fx.detectChanges();
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('.copilot-stats')).withContext('stats render once data loaded').not.toBeNull();
  });
});

describe('AdminSiteCopilotComponent — latency formatting', () => {
  afterEach(() => TestBed.resetTestingModule());

  // Raw "12345ms" reads badly; mirror the ai-logs cockpit pattern
  // (<1000 → "Xms", else "X.Ys") so the Latency column is human + consistent.
  it('formats session latency like the rest of the cockpit', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ sessions: [], distribution: [] })));
    expect(c.formatLatency(340)).toBe('340ms');
    expect(c.formatLatency(999)).toBe('999ms');
    expect(c.formatLatency(1000)).toBe('1.0s');
    expect(c.formatLatency(12345)).toBe('12.3s');
    expect(c.formatLatency(null as unknown as number)).toBe('—');
  });
});
