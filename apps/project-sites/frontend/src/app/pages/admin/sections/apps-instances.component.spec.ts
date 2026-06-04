import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
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

  it('stopInstance POSTs to the stop endpoint', () => {
    const { c, api } = make();
    c.stopInstance(inst('i4'));
    expect(api.post).toHaveBeenCalledWith('/apps/instances/i4/stop', {});
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

  it('retry after an error clears the prior loadError on success', () => {
    const { c, api } = make();
    api.get.and.returnValue(throwError(() => ({ status: 500 })));
    c.load();
    expect(c.loadError()).not.toBeNull();
    api.get.and.returnValue(of({ instances: [] }));
    c.load();
    expect(c.loadError()).toBeNull();
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
  function makeDetail(confirm: () => Promise<boolean>): { c: AppInstanceDetailComponent; del: jasmine.Spy } {
    const del = jasmine.createSpy('delete').and.returnValue(of({}));
    TestBed.configureTestingModule({
      imports: [AppInstanceDetailComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ instance: null }), post: () => of({}), delete: del } },
        { provide: ToastService, useValue: { success: () => 0, error: () => 0, warning: () => 0 } },
        { provide: ConfirmService, useValue: { confirm } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'i1' } }, paramMap: of({ get: () => 'i1' }) } },
        provideRouter([]),
      ],
    });
    const c = TestBed.createComponent(AppInstanceDetailComponent).componentInstance; // no detectChanges → skip ngOnInit
    c.instance.set({ id: 'i1', app_id: 'medusa' } as never);
    return { c, del };
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
});
