import { TestBed } from '@angular/core/testing';
import { NEVER, of, throwError } from 'rxjs';
import { Router, provideRouter } from '@angular/router';
import { AppInstancesComponent } from './apps-instances.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { ConfirmService } from '../../../services/confirm.service';

/**
 * First coverage for the App Instances lifecycle list (untested). Security-relevant:
 *  - deleteInstance is CONFIRM-GATED — no DELETE fires when the user cancels the confirm
 *  - restart/stop POST to the right per-instance endpoint
 *  - runAction guards against a double-fire (one action in flight at a time) and on
 *    success toasts + reloads + clears the acting flag
 *  - toggleMenu opens/closes one row popover at a time
 * overrideComponent strips the template so ngOnInit's load + polling don't auto-fire.
 */
function make(over: { post?: jasmine.Spy; del?: jasmine.Spy; confirm?: () => Promise<boolean> } = {}): {
  c: AppInstancesComponent;
  api: { get: jasmine.Spy; post: jasmine.Spy; delete: jasmine.Spy };
  toast: { success: jasmine.Spy; error: jasmine.Spy };
} {
  const api = {
    get: jasmine.createSpy('get').and.returnValue(of({ instances: [] })),
    post: over.post ?? jasmine.createSpy('post').and.returnValue(of({})),
    delete: over.del ?? jasmine.createSpy('delete').and.returnValue(of({})),
  };
  const toast = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') };
  TestBed.configureTestingModule({
    imports: [AppInstancesComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toast },
      { provide: ConfirmService, useValue: { confirm: over.confirm ?? (() => Promise.resolve(true)) } },
      { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
    ],
  });
  TestBed.overrideComponent(AppInstancesComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(AppInstancesComponent).componentInstance, api, toast };
}

const inst = (id = 'i1') => ({ id, app_id: 'medusa', hostname: 'x.projectsites.dev', status: 'running' } as never);

describe('AppInstancesComponent (instance lifecycle)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('deleteInstance does NOT fire a DELETE when the confirm is cancelled', async () => {
    const { c, api } = make({ confirm: () => Promise.resolve(false) });
    await c.deleteInstance(inst());
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('deleteInstance fires a DELETE only after the confirm is accepted', async () => {
    const { c, api, toast } = make({ confirm: () => Promise.resolve(true) });
    await c.deleteInstance(inst('i9'));
    expect(api.delete).toHaveBeenCalledWith('/apps/instances/i9');
    expect(toast.success).toHaveBeenCalled();
    expect(c.acting()).toBeNull();
  });

  it('restartInstance POSTs to the restart endpoint and reloads on success', () => {
    const { c, api } = make();
    c.restartInstance(inst('i3'));
    expect(api.post).toHaveBeenCalledWith('/apps/instances/i3/restart', {});
    expect(api.get).toHaveBeenCalled(); // reload after success
    expect(c.acting()).toBeNull();
  });

  // Stopping a RUNNING instance takes a live customer-facing service offline
  // (down until manually restarted) — a misclick in the ⋯ menu (right above
  // Delete) shouldn't drop the app. Confirm-gated like delete (reversible, so
  // non-danger), never a silent outage.
  it('stopInstance POSTs to the stop endpoint only after the confirm is accepted', async () => {
    const { c, api } = make({ confirm: () => Promise.resolve(true) });
    await c.stopInstance(inst('i4'));
    expect(api.post).toHaveBeenCalledWith('/apps/instances/i4/stop', {});
  });

  it('stopInstance does NOT POST when the confirm is cancelled (no accidental outage)', async () => {
    const { c, api } = make({ confirm: () => Promise.resolve(false) });
    await c.stopInstance(inst('i4'));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('a second action is blocked while one is in flight (no double-run)', () => {
    // runAction guards on acting(): with one already in flight, the observable is
    // never subscribed → no success toast, no reload, acting unchanged.
    const { c, api, toast } = make();
    api.get.calls.reset();
    c.acting.set('busy');
    c.restartInstance(inst('i5'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled(); // no reload triggered
    expect(c.acting()).toBe('busy'); // guard left it untouched
  });

  it('an action failure clears the acting flag (recoverable)', () => {
    const { c } = make({ post: jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 500 }))) });
    c.restartInstance(inst('i6'));
    expect(c.acting()).toBeNull();
  });

  it('toggleMenu opens then closes the same row popover', () => {
    const { c } = make();
    const ev = { preventDefault() {}, stopPropagation() {} } as MouseEvent;
    c.toggleMenu(inst('i7'), ev);
    expect(c.menuOpenId()).toBe('i7');
    c.toggleMenu(inst('i7'), ev);
    expect(c.menuOpenId()).toBeNull();
  });

  // ── Instances load-error gating: a failed fetch must NOT masquerade as the
  // "No app instances yet" empty state (which could prompt re-installing an app
  // the user already has). It records a retryable loadError instead.
  it('load() success leaves loadError null + populates instances + stamps syncedAt', () => {
    const { c, api } = make();
    api.get.and.returnValue(of({ instances: [inst('a')] }));
    expect(c.syncedAt()).toBeNull();
    c.load();
    expect(c.loadError()).toBeNull();
    expect(c.instances().length).toBe(1);
    expect(c.loading()).toBeFalse();
    expect(c.syncedAt()).withContext('a successful load feeds the live freshness pill').not.toBeNull();
  });

  it('load() failure leaves syncedAt null (no false freshness)', () => {
    const { c, api } = make();
    api.get.and.returnValue(throwError(() => ({ status: 500 })));
    c.load();
    expect(c.syncedAt()).toBeNull();
  });

  it('load() failure sets a retryable loadError (not a fake empty) + clears loading', () => {
    const { c, api } = make();
    api.get.and.returnValue(throwError(() => ({ status: 500 })));
    c.load();
    expect(c.loadError()).withContext('error recorded, not swallowed into a fake empty').not.toBeNull();
    expect(c.instances().length).toBe(0);
    expect(c.loading()).toBeFalse();
  });

  // The inline loadError <app-error-card> (+ Retry) is the accurate, persistent
  // failure UX, so the read must be {silent:true} — otherwise ApiService's
  // generic "Can't reach the server" toast double-fires on top of the card.
  it('load() reads {silent:true} so the inline error card is the sole feedback (no generic toast)', () => {
    const { c, api } = make();
    c.load();
    expect(api.get).toHaveBeenCalledWith('/apps/instances', undefined, { silent: true });
  });

  it('retry after an error clears the prior loadError on success', () => {
    const { c, api } = make();
    api.get.and.returnValue(throwError(() => ({ status: 500 })));
    c.load();
    expect(c.loadError()).not.toBeNull();
    api.get.and.returnValue(of({ instances: [] }));
    c.load();
    expect(c.loadError()).toBeNull();
  });

  // ── Stale-route fake-empty guard (documented prod bug class) ──
  // A STALE worker route returns a parseable-but-shapeless 200 (SPA/marketing
  // HTML or `{}`). ApiService's 2xx→404 remap only fires on an UNPARSEABLE
  // body, so a shapeless 200 flows straight through the SUCCESS path. Without
  // an Array.isArray guard, `r.instances ?? []` fake-empties — surfacing the
  // "No app instances yet" empty state even though the org HAS running apps
  // (which could prompt re-installing an app they already have). On a FIRST
  // load it must degrade honestly to the retryable error card.
  it('load() success with a shapeless 200 (no instances array) does NOT fake-empty — records loadError', () => {
    const { c, api } = make();
    api.get.and.returnValue(of({} as never)); // stale-route shapeless 200
    c.load();
    expect(c.instances().length).withContext('no fake-empty list from a shapeless 200').toBe(0);
    expect(c.loadError()).withContext('degrades honestly to the retry card, not a fake empty').not.toBeNull();
    expect(c.loading()).toBeFalse();
  });

  it('load() success with a non-array instances field (stale HTML string) does NOT crash + records loadError', () => {
    const { c, api } = make();
    api.get.and.returnValue(of({ instances: '<!doctype html>' } as never)); // marketing HTML leaked through
    c.load();
    expect(c.instances().length).toBe(0);
    expect(c.loadError()).not.toBeNull();
  });

  // On a POLL refresh (already have a list), a stale tick must NOT wipe the
  // healthy list or flip to a full error card mid-poll — keep the prior data
  // and surface a single error toast instead.
  it('a stale poll tick keeps the prior instances list (no mid-poll wipe)', () => {
    const { c, api, toast } = make();
    api.get.and.returnValue(of({ instances: [inst('keep')] }));
    c.load();
    expect(c.instances().length).toBe(1);
    api.get.and.returnValue(of({} as never)); // stale tick while polling
    c.refresh();
    expect(c.instances().length).withContext('prior healthy list preserved on a stale poll tick').toBe(1);
    expect(c.loadError()).withContext('no full error card mid-poll').toBeNull();
    expect(toast.error).toHaveBeenCalled();
  });
});

/**
 * Render: a first-load failure shows the inline Retry card (data-testid
 * apps-load-error), NOT the "No app instances yet" empty state.
 */
describe('AppInstancesComponent (load-error render)', () => {
  function render(getSpy: jasmine.Spy): import('@angular/core/testing').ComponentFixture<AppInstancesComponent> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AppInstancesComponent],
      providers: [
        provideRouter([]), // supplies Router + ActivatedRoute + routerLink DI for the full template
        { provide: ApiService, useValue: { get: getSpy, post: () => of({}), delete: () => of({}) } },
        { provide: ToastService, useValue: { success: () => 0, error: () => 0 } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
      ],
    });
    const fx = TestBed.createComponent(AppInstancesComponent);
    fx.detectChanges(); // ngOnInit → load()
    return fx;
  }
  afterEach(() => TestBed.resetTestingModule());

  // The list error state uses the SHARED app-error-card primitive (cohesion with
  // every other admin section) — not a bespoke red box. role=alert + Retry come
  // from the primitive.
  it('shows the shared error-card (not the empty state) when the first load fails', () => {
    const el: HTMLElement = render(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 })))).nativeElement;
    expect(el.querySelector('[data-testid="error-card"]')).withContext('uses the shared error-card primitive').toBeTruthy();
    expect(el.querySelector('[data-testid="error-retry"]')).toBeTruthy();
    expect(el.querySelector('app-empty-state')).withContext('no fake empty when the load failed').toBeNull();
  });

  it('shows the empty state (not the error card) when the load succeeds with zero instances', () => {
    const el: HTMLElement = render(jasmine.createSpy('get').and.returnValue(of({ instances: [] }))).nativeElement;
    expect(el.querySelector('[data-testid="error-card"]')).toBeNull();
    expect(el.querySelector('app-empty-state')).toBeTruthy();
  });
});

describe('AppInstancesComponent (⋯ row-menu Esc dismiss)', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('Esc closes the open row menu (keyboard dismiss)', () => {
    const { c } = make();
    c.menuOpenId.set('inst-1');
    expect(c.menuOpenId()).toBe('inst-1');
    c.onEscapeCloseMenu();
    expect(c.menuOpenId()).toBeNull();
  });
});

/**
 * Detail-view destroy() is a MODAL confirm (not the old auto-dismissing toast):
 * destroying releases the container + all data + the subdomain irreversibly, so
 * it must go through ConfirmService (focus-trapped, deliberate, can't be missed)
 * — matching the list view's deleteInstance + the one-dialog-primitive rule.
 */
import { ActivatedRoute } from '@angular/router';
import { AppInstanceDetailComponent } from './apps-instances.component';
describe('AppInstanceDetailComponent (destroy is modal-confirm-gated)', () => {
  function makeDetail(confirm: () => Promise<boolean>): { c: AppInstanceDetailComponent; del: jasmine.Spy; post: jasmine.Spy; patch: jasmine.Spy } {
    const del = jasmine.createSpy('delete').and.returnValue(of({}));
    const post = jasmine.createSpy('post').and.returnValue(of({}));
    const patch = jasmine.createSpy('patch').and.returnValue(of({}));
    TestBed.configureTestingModule({
      imports: [AppInstanceDetailComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ instance: null }), post, patch, delete: del } },
        { provide: ToastService, useValue: { success: () => 0, error: () => 0, warning: () => 0 } },
        { provide: ConfirmService, useValue: { confirm } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'i1' } }, paramMap: of({ get: () => 'i1' }) } },
        provideRouter([]),
      ],
    });
    const c = TestBed.createComponent(AppInstanceDetailComponent).componentInstance; // no detectChanges → skip ngOnInit
    c.instance.set({ id: 'i1', app_id: 'medusa' } as never);
    return { c, del, post, patch };
  }
  afterEach(() => TestBed.resetTestingModule());

  it('does NOT DELETE when the confirm is cancelled', async () => {
    const { c, del } = makeDetail(() => Promise.resolve(false));
    await c.destroy();
    expect(del).not.toHaveBeenCalled();
  });

  it('DELETEs the instance only after the modal confirm is accepted', async () => {
    const { c, del } = makeDetail(() => Promise.resolve(true));
    await c.destroy();
    expect(del).toHaveBeenCalledWith('/apps/instances/i1');
  });

  // Detail-panel Stop takes the live service offline (down until restarted) — like
  // the list-view stopInstance + the detail destroy, it must confirm so a misclick
  // never drops a customer-facing app.
  it('stop() does NOT POST when the confirm is cancelled (no accidental outage)', async () => {
    const { c, post } = makeDetail(() => Promise.resolve(false));
    await c.stop();
    expect(post).not.toHaveBeenCalled();
  });

  it('stop() POSTs to /stop only after the confirm is accepted', async () => {
    const { c, post } = makeDetail(() => Promise.resolve(true));
    await c.stop();
    expect(post).toHaveBeenCalledWith('/apps/instances/i1/stop', {});
  });

  // "Save & restart" PATCHes env_overrides then restarts the container. A catalog
  // env var that is required AND has no `auto` (platform-filled) AND no `default`
  // MUST be supplied by the user — saving it empty restarts the app into a broken
  // boot loop. `morphic` is the one catalog app with such a var (OPENAI_API_KEY),
  // so saveEnv must block + flag the gap instead of silently restarting broken.
  it('saveEnv blocks the PATCH/restart when a user-required env var (no auto/default) is empty', () => {
    const { c, patch } = makeDetail(() => Promise.resolve(true));
    c.instance.set({ id: 'i1', app_id: 'morphic', status: 'running' } as never);
    c.envValues = {}; // OPENAI_API_KEY unfilled
    expect(c.requiredEnvMissing()).toContain('OPENAI_API_KEY');
    c.saveEnv();
    expect(patch).not.toHaveBeenCalled(); // no restart into a broken config
  });

  it('saveEnv PATCHes once the required env var is filled', () => {
    const { c, patch } = makeDetail(() => Promise.resolve(true));
    c.instance.set({ id: 'i1', app_id: 'morphic', status: 'running' } as never);
    c.envValues = { OPENAI_API_KEY: 'sk-test' };
    expect(c.requiredEnvMissing()).toEqual([]);
    c.saveEnv();
    expect(patch).toHaveBeenCalledWith('/apps/instances/i1/env', { env_overrides: { OPENAI_API_KEY: 'sk-test' } });
  });

  it('requiredEnvMissing ignores auto-filled + defaulted required vars (only truly-user-required count)', () => {
    const { c } = makeDetail(() => Promise.resolve(true));
    // medusa: every required var is auto-filled or has a default → nothing to demand from the user
    c.instance.set({ id: 'i1', app_id: 'medusa', status: 'running' } as never);
    c.envValues = {};
    expect(c.requiredEnvMissing()).toEqual([]);
  });
});

/**
 * refreshLogs() stale-route guard. The logs endpoint polls every 5s while the
 * instance is provisioning/running; a STALE worker route can return a shapeless
 * 200 (`{}` or marketing HTML). Without an Array.isArray guard `r.lines ?? []`
 * either fake-empties the log box or — worse — a non-array `lines` reaches the
 * `@for (l of logs())` template and crashes the render. The guard must preserve
 * the prior log buffer (it's a poll) and never set a non-array.
 */
describe('AppInstanceDetailComponent (refreshLogs stale-route guard)', () => {
  function makeDetail(logsResp: unknown): { c: AppInstanceDetailComponent; get: jasmine.Spy } {
    const get = jasmine.createSpy('get').and.returnValue(of(logsResp));
    TestBed.configureTestingModule({
      imports: [AppInstanceDetailComponent],
      providers: [
        { provide: ApiService, useValue: { get, post: () => of({}), delete: () => of({}), patch: () => of({}) } },
        { provide: ToastService, useValue: { success: () => 0, error: () => 0, warning: () => 0 } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'i1' } }, paramMap: of({ get: () => 'i1' }) } },
        provideRouter([]),
      ],
    });
    const c = TestBed.createComponent(AppInstanceDetailComponent).componentInstance; // no detectChanges → skip ngOnInit
    c.instanceId.set('i1');
    return { c, get };
  }
  afterEach(() => TestBed.resetTestingModule());

  it('a shapeless 200 (no lines array) leaves logs() an array — never sets a crashable non-array', () => {
    const { c } = makeDetail({}); // stale-route shapeless 200
    c.refreshLogs();
    expect(Array.isArray(c.logs())).withContext('logs() stays a safe array for the @for render').toBeTrue();
    expect(c.logs().length).toBe(0);
    expect(c.logsLoading()).toBeFalse();
  });

  it('a non-array lines field (leaked HTML string) does NOT reach logs() (no @for crash)', () => {
    const { c } = makeDetail({ lines: '<!doctype html>' });
    c.refreshLogs();
    expect(Array.isArray(c.logs())).toBeTrue();
    expect(c.logs().length).toBe(0);
  });

  it('a stale logs tick preserves the prior log buffer (it is a poll, not a wipe)', () => {
    const line = { ts: 't', level: 'info', msg: 'boot' };
    const { c, get } = makeDetail({ lines: [line] });
    c.refreshLogs();
    expect(c.logs().length).toBe(1);
    get.and.returnValue(of({} as never)); // stale tick
    c.refreshLogs();
    expect(c.logs().length).withContext('prior logs kept on a stale poll tick').toBe(1);
  });
});

/**
 * a11y: the logs card exposes aria-busy while a refresh is in flight so screen
 * readers announce the in-progress state (matches the feature-flags aria-busy
 * pattern), and the Refresh button's accessible name reflects the busy state.
 */
describe('AppInstanceDetailComponent (logs refresh aria-busy)', () => {
  function render(): import('@angular/core/testing').ComponentFixture<AppInstanceDetailComponent> {
    TestBed.configureTestingModule({
      imports: [AppInstanceDetailComponent],
      providers: [
        // get never completes → logsLoading stays true after refreshLogs()
        { provide: ApiService, useValue: { get: () => NEVER, post: () => of({}), delete: () => of({}), patch: () => of({}) } },
        { provide: ToastService, useValue: { success: () => 0, error: () => 0, warning: () => 0 } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'i1' } }, paramMap: of({ get: () => 'i1' }) } },
        provideRouter([]),
      ],
    });
    const fx = TestBed.createComponent(AppInstanceDetailComponent);
    fx.componentInstance.instanceId.set('i1');
    fx.componentInstance.instance.set({ id: 'i1', app_id: 'medusa', status: 'running', hostname: 'x', created_at: '' } as never);
    return fx;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('logs card is aria-busy + button reads "Refreshing…" while a refresh is in flight', () => {
    const fx = render();
    fx.detectChanges(); // ngOnInit
    // ngOnInit re-reads the (empty) route paramMap, so re-pin id after it runs,
    // then start a refresh whose get() never completes → logsLoading stays true.
    fx.componentInstance.instanceId.set('i1');
    fx.componentInstance.refreshLogs();
    fx.detectChanges();
    const el: HTMLElement = fx.nativeElement;
    const busySection = el.querySelector('section[aria-busy="true"]');
    expect(busySection).withContext('logs card exposes aria-busy during refresh').toBeTruthy();
    const btn = Array.from(el.querySelectorAll('button')).find((b) => /Refreshing/.test(b.textContent ?? ''));
    expect(btn).withContext('Refresh button shows the busy label').toBeTruthy();
    expect(btn?.getAttribute('aria-label')).toBe('Refreshing logs');
    expect((btn as HTMLButtonElement | undefined)?.disabled).toBeTrue();
  });
});
