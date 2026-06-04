import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError, Subject } from 'rxjs';
import { AdminMcpComponent } from './mcp.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

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
