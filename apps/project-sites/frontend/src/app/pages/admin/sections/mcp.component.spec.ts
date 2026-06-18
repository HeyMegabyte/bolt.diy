import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { of, throwError, Subject } from 'rxjs';
import { AdminMcpComponent } from './mcp.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';
import { RevealDirective } from '../../../directives/reveal.directive';

/**
 * Guards the MCP connections load-error gating: a failed connections fetch sets
 * a persistent loadError banner — otherwise the provider cards render every
 * provider as "not connected" (a connected one looks disconnected = misleading
 * stale state). Success/retry clear it. overrideComponent strips the template so
 * the constructor effect doesn't auto-fire; load() is driven directly.
 */
function make(get: jasmine.Spy): { c: AdminMcpComponent; toastErr: jasmine.Spy } {
  const toastErr = jasmine.createSpy('error');
  TestBed.configureTestingModule({
    imports: [AdminMcpComponent],
    providers: [
      { provide: ApiService, useValue: { get, post: () => of({}), delete: () => of({}) } },
      { provide: ToastService, useValue: { error: toastErr, success: jasmine.createSpy('success'), warning: jasmine.createSpy('warning') } },
      { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
    ],
  });
  TestBed.overrideComponent(AdminMcpComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(AdminMcpComponent).componentInstance, toastErr };
}

describe('AdminMcpComponent (connections load-error gating)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('success populates connections and clears loadError', () => {
    const { c } = make(jasmine.createSpy('get').and.returnValue(of({ data: { connections: [{ id: 'x', provider: 'stripe', connected: true }] } })));
    c.load();
    expect(c.loadError()).toBeNull();
    expect(c.connections().length).toBe(1);
    expect(c.loading()).toBe(false);
  });

  it('a load error sets a persistent loadError banner ONLY — no redundant toast (read is {silent})', () => {
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 })));
    const { c, toastErr } = make(get);
    c.load();
    expect(c.loadError()).toContain('stale');
    expect(c.loading()).toBe(false);
    // The sticky banner is the persistent UX; a transient toast on top (plus the
    // now-silenced generic ApiService toast) was redundant triple-feedback.
    expect(toastErr).not.toHaveBeenCalled();
    // {silent:true} so ApiService's generic "Can't reach the server" toast never
    // double-fires over the banner.
    expect(get).toHaveBeenCalledWith('/sites/s1/mcp/connections', undefined, { silent: true });
  });

  it('retry after an error clears the prior loadError', () => {
    const get = jasmine.createSpy('get').and.returnValues(
      throwError(() => ({ status: 500 })),
      of({ data: { connections: [] } }),
    );
    const { c } = make(get);
    c.load();
    expect(c.loadError()).not.toBeNull();
    c.load();
    expect(c.loadError()).toBeNull();
  });

  // The shared <app-error-card> surfaces a copyable worker request_id so a stuck
  // user can hand it to support — capture it from the failed response body.
  it('captures the worker request_id into loadErrorRef for the support reference', () => {
    const get = jasmine.createSpy('get').and.returnValue(
      throwError(() => ({ status: 500, error: { error: { request_id: 'req-abc-123' } } })),
    );
    const { c } = make(get);
    c.load();
    expect(c.loadErrorRef()).toBe('req-abc-123');
  });

  it('loadErrorRef is an empty string when the failed response carries no request_id', () => {
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 })));
    const { c } = make(get);
    c.load();
    expect(c.loadErrorRef()).toBe('');
  });

  it('a successful load clears loadErrorRef (no stale support reference)', () => {
    const get = jasmine.createSpy('get').and.returnValues(
      throwError(() => ({ status: 500, error: { error: { request_id: 'req-stale' } } })),
      of({ data: { connections: [] } }),
    );
    const { c } = make(get);
    c.load();
    expect(c.loadErrorRef()).toBe('req-stale');
    c.load();
    expect(c.loadErrorRef()).toBe('');
  });
});

describe('AdminMcpComponent — mutations pass {silent:true} (own toast.error → no generic double-toast)', () => {
  let post: jasmine.Spy, del: jasmine.Spy;
  function buildSpies(): AdminMcpComponent {
    post = jasmine.createSpy('post').and.returnValue(of({}));
    del = jasmine.createSpy('delete').and.returnValue(of({}));
    TestBed.configureTestingModule({
      imports: [AdminMcpComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: { connections: [] } }), post, delete: del } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, warning: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    TestBed.overrideComponent(AdminMcpComponent, { set: { template: '<div></div>', imports: [] } });
    return TestBed.createComponent(AdminMcpComponent).componentInstance;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('submitPaste → paste POST is {silent}', () => {
    const c = buildSpies();
    c.pastedKey = 'sk_test_abc123';
    c.submitPaste('stripe');
    expect(post).toHaveBeenCalledWith('/mcp/stripe/paste?site_id=s1', { api_key: 'sk_test_abc123' }, { silent: true });
  });

  it('performDisconnect → DELETE is {silent}', () => {
    const c = buildSpies();
    (c as unknown as { performDisconnect: (conn: unknown, siteId: string) => void })
      .performDisconnect({ id: 'conn9', provider: 'stripe' }, 's1');
    expect(del).toHaveBeenCalledWith('/sites/s1/mcp/connections/conn9', { silent: true });
  });
});

/**
 * submitPaste double-submit guard: clicking "Save" twice (or hammering Enter)
 * while the paste POST is in flight must NOT fire a second POST (double-toast +
 * double load()). An in-flight `pasting` signal gates the handler + disables the
 * button with a "Saving…" affordance.
 */
describe('AdminMcpComponent — submitPaste in-flight guard (no double-submit)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function make(post: jasmine.Spy): AdminMcpComponent {
    TestBed.configureTestingModule({
      imports: [AdminMcpComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: { connections: [] } }), post, delete: () => of({}) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, warning: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    TestBed.overrideComponent(AdminMcpComponent, { set: { template: '<div></div>', imports: [] } });
    const c = TestBed.createComponent(AdminMcpComponent).componentInstance;
    c.pasteMode.set('resend');
    c.pastedKey = 're_abc123';
    return c;
  }

  it('a second submitPaste while the first is in flight does NOT double-POST', () => {
    const pending = new Subject<unknown>();
    const post = jasmine.createSpy('post').and.returnValue(pending.asObservable());
    const c = make(post);
    c.submitPaste('resend');
    expect(c.pasting()).withContext('first submit marks in-flight').toBe(true);
    c.submitPaste('resend'); // user double-clicks Save / mashes Enter
    expect(post).withContext('the in-flight guard blocks the 2nd POST').toHaveBeenCalledTimes(1);
  });

  it('clears the in-flight flag + closes the paste form on success', () => {
    const post = jasmine.createSpy('post').and.returnValue(of({}));
    const c = make(post);
    c.submitPaste('resend');
    expect(c.pasting()).withContext('flag reset so a later paste can save').toBe(false);
    expect(c.pasteMode()).withContext('form closes on success').toBeNull();
  });

  it('clears the in-flight flag on error so the user can retry', () => {
    const post = jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 500 })));
    const c = make(post);
    c.submitPaste('resend');
    expect(c.pasting()).withContext('a failed paste re-enables Save').toBe(false);
  });
});

/**
 * OAuth connect double-submit + busy-affordance guard. "Connect via OAuth" fires
 * a full-page `window.location.href` redirect; without a guard a double-click (or
 * a slow browser unload) triggers TWO navigations, and the button gives no
 * "Connecting…" / aria-busy feedback while the redirect is pending. The
 * `connectingProvider` signal gates re-entry + drives the busy affordance,
 * mirroring the paste/disconnect in-flight pattern.
 */
describe('AdminMcpComponent — OAuth connect in-flight guard (no double-redirect)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function make(): { c: AdminMcpComponent; nav: jasmine.Spy; get: jasmine.Spy } {
    const nav = jasmine.createSpy('navigate');
    // `/connect` stays in-flight (NEVER) so the guard can hold across a double
    // click; the connections load resolves normally.
    const get = jasmine.createSpy('get').and.callFake((path: string) =>
      /\/connect$/.test(path) ? NEVER : of({ data: { connections: [] } }),
    );
    TestBed.configureTestingModule({
      imports: [AdminMcpComponent],
      providers: [
        { provide: ApiService, useValue: { get, post: () => of({}), delete: () => of({}) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, warning: () => 0, info: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    TestBed.overrideComponent(AdminMcpComponent, { set: { template: '<div></div>', imports: [] } });
    const c = TestBed.createComponent(AdminMcpComponent).componentInstance;
    // Stub the redirect so the test runner doesn't actually navigate away.
    (c as unknown as { redirectTo: (url: string) => void }).redirectTo = nav;
    return { c, nav, get };
  }

  it('a second OAuth connect while the first is in-flight does NOT fire a second connect request', () => {
    const { c, get } = make();
    c.connect('stripe');
    expect(c.isConnecting('stripe')).withContext('first connect marks in-flight').toBeTrue();
    c.connect('stripe'); // user double-clicks "Connect via OAuth"
    const connectCalls = get.calls.allArgs().filter((a: unknown[]) => /\/connect$/.test(String(a[0])));
    expect(connectCalls.length).withContext('the in-flight guard blocks the 2nd request').toBe(1);
  });

  it('paste-flow providers do NOT mark an OAuth connecting state', () => {
    const { c, nav } = make();
    c.connect('resend'); // resend is paste-key, not OAuth
    expect(c.isConnecting('resend')).withContext('paste flow opens inline, no redirect').toBeFalse();
    expect(nav).not.toHaveBeenCalled();
    expect(c.pasteMode()).toBe('resend');
  });
});

import { NEVER } from 'rxjs';

/**
 * performDisconnect double-submit guard: the disconnect is armed via a 7s toast
 * action, so the action can be clicked twice before the first DELETE resolves +
 * the list reloads. A second disconnect of the same connection while one is in
 * flight must NOT fire a second DELETE.
 */
describe('AdminMcpComponent — performDisconnect in-flight guard (no double-DELETE)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('ignores a re-entrant disconnect of the same connection while one is in flight', () => {
    const del = jasmine.createSpy('delete').and.returnValue(NEVER);
    TestBed.configureTestingModule({
      imports: [AdminMcpComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: { connections: [] } }), post: () => of({}), delete: del } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, warning: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    TestBed.overrideComponent(AdminMcpComponent, { set: { template: '<div></div>', imports: [] } });
    const c = TestBed.createComponent(AdminMcpComponent).componentInstance;
    const pd = (c as unknown as { performDisconnect: (conn: unknown, siteId: string) => void }).performDisconnect.bind(c);
    pd({ id: 'conn9', provider: 'stripe' }, 's1');
    pd({ id: 'conn9', provider: 'stripe' }, 's1'); // re-entrant while the first is pending
    expect(del).withContext('no duplicate DELETE').toHaveBeenCalledTimes(1);
    expect((c as unknown as { isDisconnecting: (id: string) => boolean }).isDisconnecting('conn9')).toBeTrue();
  });
});

/**
 * Cinematic first-paint cohesion: the section must apply the cockpit `appReveal`
 * stagger so its header + section/grid containers fade in on first paint, like
 * every sibling admin section (rather than rendering flat). The directive is
 * reduced-motion-safe, so this is a pure presentation upgrade. Full-render spec
 * (NOT overrideComponent) so the real template wires the directive instances.
 */
describe('AdminMcpComponent — appReveal first-paint cohesion', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('wires appReveal on the header + top-level section containers', () => {
    // {data:[]} keeps connections() iterable so the @for card grid renders the
    // reveal wrapper; a {data:{}} stub would make the list non-iterable + crash @for.
    TestBed.configureTestingModule({
      imports: [AdminMcpComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: { connections: [] } }), post: () => of({}), delete: () => of({}) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, warning: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    const fixture = TestBed.createComponent(AdminMcpComponent);
    fixture.detectChanges();

    const revealed = fixture.debugElement.queryAll(By.directive(RevealDirective));
    expect(revealed.length).withContext('header + grid wrapper both reveal').toBeGreaterThanOrEqual(2);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('header')?.hasAttribute('appReveal')).toBeTrue();
  });
});

/**
 * connect() — the MailChimp "auth required" fix. The `/mcp/:provider/connect`
 * route is bearer-auth-gated, so the OLD `window.location.href` browser nav
 * 401'd. connect() now FETCHES the authorize URL with the bearer (ApiService,
 * which injects it) THEN navigates the top window. A 501 (OAuth not configured)
 * falls back to the inline paste-key form instead of a broken redirect.
 */
describe('AdminMcpComponent — connect() OAuth via bearer fetch (MailChimp auth-required fix)', () => {
  function build(get: jasmine.Spy, info = jasmine.createSpy('info'), error = jasmine.createSpy('error')): AdminMcpComponent {
    TestBed.configureTestingModule({
      imports: [AdminMcpComponent],
      providers: [
        { provide: ApiService, useValue: { get, post: () => of({}), delete: () => of({}) } },
        { provide: ToastService, useValue: { error, success: () => 0, warning: () => 0, info } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    TestBed.overrideComponent(AdminMcpComponent, { set: { template: '<div></div>', imports: [] } });
    return TestBed.createComponent(AdminMcpComponent).componentInstance;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('fetches the authorize URL WITH the bearer (silent) then navigates the top window', () => {
    const authUrl = 'https://login.mailchimp.com/oauth2/authorize?x=1';
    const get = jasmine.createSpy('get').and.callFake((path: string) =>
      /\/connect$/.test(path)
        ? of({ data: { mode: 'oauth', authorize_url: authUrl } })
        : of({ data: { connections: [] } }),
    );
    const c = build(get);
    const nav = spyOn(c as unknown as { redirectTo: (u: string) => void }, 'redirectTo');
    c.connect('mailchimp');
    expect(get).toHaveBeenCalledWith('/mcp/mailchimp/connect', { site_id: 's1', return_url: '/admin/mcp' }, { silent: true });
    expect(nav).toHaveBeenCalledWith(authUrl);
    expect(c.connectingProvider()).toBeNull(); // cleared after success
  });

  it('falls back to the paste-key form (no broken redirect) when OAuth is not configured (501)', () => {
    const get = jasmine.createSpy('get').and.callFake((path: string) =>
      /\/connect$/.test(path)
        ? throwError(() => ({ status: 501, error: { error: 'oauth_not_configured' } }))
        : of({ data: { connections: [] } }),
    );
    const info = jasmine.createSpy('info');
    const c = build(get, info);
    const nav = spyOn(c as unknown as { redirectTo: (u: string) => void }, 'redirectTo');
    c.connect('mailchimp');
    expect(nav).not.toHaveBeenCalled();
    expect(c.pasteMode()).toBe('mailchimp');
    expect(info).toHaveBeenCalled();
    expect(c.connectingProvider()).toBeNull();
  });
});
