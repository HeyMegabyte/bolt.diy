import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AdminAiEndpointsComponent } from './ai-endpoints.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';
import { ConfirmService } from '../../../services/confirm.service';

/**
 * Guards the AI-endpoints list load-error gating: a failed `/ai-endpoints` fetch
 * used to be fully silent (error: () => loading.set(false)) → the empty list fell
 * through to the "Build your first AI agent" empty state, HIDING agents the user
 * already created. Now reload() sets a persistent loadError + Retry card; the empty
 * state is suppressed while the error stands. overrideComponent strips the template
 * so the constructor/ngOnInit doesn't auto-fire; reload() is driven directly.
 */
function make(get: jasmine.Spy): AdminAiEndpointsComponent {
  TestBed.configureTestingModule({
    imports: [AdminAiEndpointsComponent],
    providers: [
      { provide: ApiService, useValue: { get, post: () => of({}), put: () => of({}), delete: () => of({}) } },
      { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
      { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
    ],
  });
  TestBed.overrideComponent(AdminAiEndpointsComponent, { set: { template: '<div></div>', imports: [] } });
  return TestBed.createComponent(AdminAiEndpointsComponent).componentInstance;
}

describe('AdminAiEndpointsComponent (endpoint-list load-error gating)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('success populates endpoints and leaves loadError null', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [{ endpoint_slug: 'e1' }], wfp_configured: true })));
    c.reload();
    expect(c.loadError()).toBeNull();
    expect(c.endpoints().length).toBe(1);
    expect(c.loading()).toBe(false);
  });

  it('a load error sets a persistent loadError (not a fake empty state) + reads {silent} so no toast double-fires', () => {
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 })));
    const c = make(get);
    c.reload();
    expect(c.loadError()).toContain('Could not load');
    expect(c.endpoints().length).toBe(0);
    expect(c.loading()).toBe(false);
    // the loadError banner is the UX; the list read is {silent} so ApiService's
    // generic toast can't fire over it.
    const call = get.calls.allArgs().find((a) => /\/ai-endpoints$/.test(String(a[0])));
    expect(call?.[2]).toEqual({ silent: true });
  });

  it('retry after an error clears the prior loadError', () => {
    const get = jasmine.createSpy('get').and.returnValues(throwError(() => ({ status: 500 })), of({ data: [] }));
    const c = make(get);
    c.reload();
    expect(c.loadError()).not.toBeNull();
    c.reload();
    expect(c.loadError()).toBeNull();
  });

  it('captures the worker request_id from a failed load → loadErrorRef (copyable support reference on the shared error card)', () => {
    const get = jasmine
      .createSpy('get')
      .and.returnValue(throwError(() => ({ status: 500, error: { error: { request_id: 'req_ai99' } } })));
    const c = make(get);
    c.reload();
    expect(c.loadErrorRef()).toBe('req_ai99');
  });

  it('resets loadErrorRef at the start of every reload (no stale reference)', () => {
    const get = jasmine
      .createSpy('get')
      .and.returnValues(throwError(() => ({ status: 500, error: { error: { request_id: 'req_z' } } })), of({ data: [] }));
    const c = make(get);
    c.reload();
    expect(c.loadErrorRef()).toBe('req_z');
    c.reload();
    expect(c.loadErrorRef()).toBe('');
  });

  // ── Per-endpoint logs load: a failed fetch must surface an error in the IDE
  // Logs panel, not read as a fake "No invocations yet".
  it('loadLogs success populates logs + leaves logsError null', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [{ id: 'l1', status: 'success', latency_ms: 12, created_at: 'now' }] })));
    c.loadLogs({ id: 'e1' } as never);
    expect(c.logs().length).toBe(1);
    expect(c.logsError()).toBeNull();
  });

  it('loadLogs failure sets logsError + empties logs (no fake "No invocations yet")', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    c.loadLogs({ id: 'e1' } as never);
    expect(c.logsError()).withContext('the failure is surfaced, not read as empty logs').not.toBeNull();
    expect(c.logs().length).toBe(0);
  });

  it('a successful loadLogs after a failure clears the prior logsError', () => {
    const get = jasmine.createSpy('get').and.returnValues(throwError(() => ({ status: 500 })), of({ data: [] }));
    const c = make(get);
    c.loadLogs({ id: 'e1' } as never);
    expect(c.logsError()).not.toBeNull();
    c.loadLogs({ id: 'e1' } as never);
    expect(c.logsError()).toBeNull();
  });

  // Each HTTP method gets a DISTINCT badge colour-class (was: only GET/POST,
  // so PUT/PATCH/DELETE all looked like POST).
  it('methodBadgeClass maps every method to a distinct class (PUT/PATCH/DELETE no longer alias POST)', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [] })));
    expect(c.methodBadgeClass('GET')).toBe('badge-get');
    expect(c.methodBadgeClass('POST')).toBe('badge-post');
    expect(c.methodBadgeClass('PUT')).toBe('badge-put');
    expect(c.methodBadgeClass('PATCH')).toBe('badge-patch');
    expect(c.methodBadgeClass('DELETE')).toBe('badge-delete');
    expect(c.methodBadgeClass('BOTH')).toBe('');
    expect(c.methodBadgeClass(null)).toBe('');
    const classes = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => c.methodBadgeClass(m));
    expect(new Set(classes).size).withContext('all five methods are visually distinct').toBe(5);
  });
});

/**
 * WCAG 4.1.2 — the agent filter input + the create-form method select & slug
 * input (in a bare div under a <span>URL</span> pseudo-label, NOT a <label>
 * wrapper) lacked accessible names. (Description/Language/AI-prompt ARE inside
 * <label class="block"> wrappers → already associated, untouched.)
 */
describe('AdminAiEndpointsComponent (control accessible names)', () => {
  function render() {
    TestBed.configureTestingModule({
      imports: [AdminAiEndpointsComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post: () => of({}), put: () => of({}), delete: () => of({}) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
      ],
    });
    const fx = TestBed.createComponent(AdminAiEndpointsComponent);
    fx.detectChanges();
    return fx;
  }
  const hasName = (el: HTMLElement, sel: string): boolean => {
    const c = el.querySelector(sel);
    return !!c && !!(c.getAttribute('aria-label') || (c.id && el.querySelector(`label[for="${c.id}"]`)));
  };
  afterEach(() => TestBed.resetTestingModule());

  it('the agent filter input has an accessible name', () => {
    const el = render().nativeElement as HTMLElement;
    expect(hasName(el, '[data-testid="ai-endpoints-filter"]')).toBeTrue();
  });

  it('the create-form method select + slug input have accessible names', () => {
    const fx = render();
    fx.componentInstance.creating.set(true);
    fx.detectChanges();
    const el = fx.nativeElement as HTMLElement;
    expect(hasName(el, '[data-testid="ai-endpoint-create-method"]')).withContext('method').toBeTrue();
    expect(hasName(el, '[data-testid="ai-endpoint-create-slug"]')).withContext('slug').toBeTrue();
  });
});

/**
 * WCAG 4.1.2 — the inline-edit (✎ on a row) HTTP-method select, slug input, and
 * description input had no accessible name (placeholder/badge-only, bare .url-row,
 * no <label>). Added aria-label. The save/cancel/edit ✎ buttons already had names.
 */
describe('AdminAiEndpointsComponent (inline-edit accessible names)', () => {
  const row = { id: 'e1', endpoint_slug: 'lead', method: 'POST', description: 'x', deploy_status: 'live', updated_at: '2026-01-01', language: 'ai-prompt' } as never;
  function render() {
    TestBed.configureTestingModule({
      imports: [AdminAiEndpointsComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: [row] }), post: () => of({}), put: () => of({}), delete: () => of({}) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
      ],
    });
    const fx = TestBed.createComponent(AdminAiEndpointsComponent);
    fx.detectChanges();
    fx.componentInstance.endpoints.set([row]);
    fx.componentInstance.startInlineEdit(row);
    fx.detectChanges();
    return fx.nativeElement as HTMLElement;
  }
  const hasName = (el: HTMLElement, sel: string): boolean => {
    const c = el.querySelector(sel);
    return !!c && !!(c.getAttribute('aria-label') || (c.id && el.querySelector(`label[for="${c.id}"]`)));
  };
  afterEach(() => TestBed.resetTestingModule());

  it('inline method select + slug + description inputs have accessible names', () => {
    const el = render();
    expect(hasName(el, '[data-testid="ai-endpoint-method-select"]')).withContext('method').toBeTrue();
    expect(hasName(el, '[data-testid="ai-endpoint-slug-input-lead"]')).withContext('slug').toBeTrue();
    expect(hasName(el, 'input[placeholder^="Short description"]')).withContext('description').toBeTrue();
  });
});

/**
 * Double-toast guard: each ai-endpoints mutation surfaces its OWN specific
 * toast.error, so the api call must be {silent:true} — else ApiService's generic
 * toast double-fires on failure. (saveInlineEdit/deploy/aiHelper/createEndpoint
 * are covered by the build + the typed-aware grep; duplicate+remove lock the
 * post + delete silent contracts with minimal state setup.)
 */
describe('AdminAiEndpointsComponent — mutations pass {silent:true} (no generic double-toast)', () => {
  let post: jasmine.Spy, del: jasmine.Spy, put: jasmine.Spy;
  function buildSpies(): AdminAiEndpointsComponent {
    post = jasmine.createSpy('post').and.returnValue(of({ data: {} }));
    del = jasmine.createSpy('delete').and.returnValue(of({}));
    put = jasmine.createSpy('put').and.returnValue(of({}));
    TestBed.configureTestingModule({
      imports: [AdminAiEndpointsComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post, put, delete: del } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, info: () => 0, warning: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
      ],
    });
    TestBed.overrideComponent(AdminAiEndpointsComponent, { set: { template: '<div></div>', imports: [] } });
    return TestBed.createComponent(AdminAiEndpointsComponent).componentInstance;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('duplicate → duplicate POST is {silent}', () => {
    const c = buildSpies();
    c.duplicate({ id: 'e9' } as never);
    expect(post).toHaveBeenCalledWith('/sites/s1/ai-endpoints/e9/duplicate', {}, { silent: true });
  });

  it('remove → DELETE is {silent} (after confirm)', async () => {
    const c = buildSpies();
    await c.remove({ id: 'e9' } as never);
    expect(del).toHaveBeenCalledWith('/sites/s1/ai-endpoints/e9', { silent: true });
  });

  it('saveDetail → PUT is {silent} (its own "Save failed" toast is the sole message)', () => {
    const c = buildSpies();
    c.detail.set({
      id: 'e9', language: 'ts', files: [], bindings: [],
      auth_mode: 'none', rate_limit_per_sec: 0, cache_ttl_seconds: 0, cron_expression: null,
    } as never);
    c.saveDetail();
    expect(put).toHaveBeenCalledWith('/sites/s1/ai-endpoints/e9', jasmine.any(Object), { silent: true });
  });
});

describe('AdminAiEndpointsComponent (⋯ popover Esc dismiss)', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('Esc closes the open ⋯ popover (keyboard dismiss)', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [] })));
    c.moreOpenId.set('ep-1');
    expect(c.moreOpenId()).toBe('ep-1');
    c.onEscapeCloseMore();
    expect(c.moreOpenId()).toBeNull();
  });
});
