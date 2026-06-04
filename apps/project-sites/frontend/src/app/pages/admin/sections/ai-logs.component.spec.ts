import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AdminAiLogsComponent } from './ai-logs.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Guards the AI-logs traces load-error state: a failed traces fetch used to be
 * SILENT (error: () => loading.set(false)) → an empty grid masqueraded as "no
 * traces". Now reload() sets a persistent loadError (the banner renders only
 * when there are no rows, so stale data stays visible on a poll blip).
 * overrideComponent strips the ag-grid-heavy template; reload() is driven directly.
 */
function make(get: jasmine.Spy): AdminAiLogsComponent {
  TestBed.configureTestingModule({
    imports: [AdminAiLogsComponent],
    providers: [
      { provide: ApiService, useValue: { get, post: () => of({}) } },
      { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
      { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      { provide: Router, useValue: { navigate: jasmine.createSpy('navigate'), navigateByUrl: jasmine.createSpy('navigateByUrl'), events: of() } },
    ],
  });
  TestBed.overrideComponent(AdminAiLogsComponent, { set: { template: '<div></div>', imports: [] } });
  return TestBed.createComponent(AdminAiLogsComponent).componentInstance;
}

describe('AdminAiLogsComponent (traces load-error)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('success populates rows and clears loadError', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [{ id: 't1' }] })));
    c.reload();
    expect(c.loadError()).toBeNull();
    expect(c.rows().length).toBe(1);
    expect(c.loading()).toBe(false);
  });

  it('a load error sets a persistent loadError (not a silent empty grid)', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    c.reload();
    expect(c.loadError()).toContain('Could not load');
    expect(c.loading()).toBe(false);
  });

  it('reload() reads {silent:true} — the loadError banner is the UX, not a generic toast', () => {
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 })));
    const c = make(get);
    c.reload();
    expect(c.loadError()).toContain('Could not load');
    expect(get.calls.mostRecent().args[2]).toEqual({ silent: true });
  });

  it('retry after an error clears the prior loadError', () => {
    const get = jasmine.createSpy('get').and.returnValues(throwError(() => ({ status: 500 })), of({ data: [] }));
    const c = make(get);
    c.reload();
    expect(c.loadError()).not.toBeNull();
    c.reload();
    expect(c.loadError()).toBeNull();
  });
});

describe('AdminAiLogsComponent (grid state — skeleton vs empty vs data)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the skeleton only while loading with no rows yet', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [] })));
    c.loading.set(true);
    c.rows.set([]);
    expect(c.gridLoadingSkeleton()).toBe(true);
    expect(c.gridEmpty()).toBe(false);
  });

  it('shows the friendly empty state when idle, error-free, and zero rows', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [] })));
    c.loading.set(false);
    c.loadError.set(null);
    c.rows.set([]);
    expect(c.gridEmpty()).toBe(true);
    expect(c.gridLoadingSkeleton()).toBe(false);
  });

  it('suppresses the empty state on a load error (the error card owns that case)', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [] })));
    c.loading.set(false);
    c.loadError.set('boom');
    c.rows.set([]);
    expect(c.gridEmpty()).toBe(false);
    expect(c.gridLoadingSkeleton()).toBe(false);
  });

  it('hides both skeleton and empty state once rows arrive', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [{ id: 't1' }] })));
    c.reload();
    expect(c.gridLoadingSkeleton()).toBe(false);
    expect(c.gridEmpty()).toBe(false);
    expect(c.rows().length).toBe(1);
  });
});

/**
 * Master/detail contract for the traces grid — the faux-expansion behaviour
 * (synthetic full-width detail rows spliced into displayRows()) + the text
 * filter. This is the EXACT behaviour the ag-grid→TanStack perf wave must
 * preserve, so locking it here is the migration's regression safety net.
 * Pure signal logic — no ag-grid, no prod data.
 */
describe('AdminAiLogsComponent (master/detail + filter contract)', () => {
  afterEach(() => TestBed.resetTestingModule());

  const mk = (id: string, model = 'gpt'): unknown => ({
    id, model, trace_kind: 'chat', endpoint_slug: null, tool_name: null,
    output_preview: null, error_message: null, actor_email: null, status: 'ok', created_at: 'now',
  });
  // fetchDetail (called on expand) hits api.get — keep it harmless.
  const mkComp = () => make(jasmine.createSpy('get').and.returnValue(of({ data: {} })));

  it('displayRows is just the master rows when nothing is expanded', () => {
    const c = mkComp();
    c.rows.set([mk('a'), mk('b')] as never);
    expect(c.displayRows().map((r) => r.id)).toEqual(['a', 'b']);
    expect(c.displayRows().some((r) => r._isDetail)).toBeFalse();
  });

  it('expanding a row splices a synthetic _isDetail row directly after its master', () => {
    const c = mkComp();
    c.rows.set([mk('a'), mk('b')] as never);
    c.toggleExpand({ id: 'a' } as never);
    expect(c.displayRows().map((r) => r.id)).toEqual(['a', 'a::detail', 'b']);
    const master = c.displayRows().find((r) => r.id === 'a');
    expect(master?._expanded).toBeTrue();
    const detail = c.displayRows().find((r) => r.id === 'a::detail');
    expect(detail?._isDetail).toBeTrue();
    expect(detail?._parentId).toBe('a');
  });

  it('collapsing removes the detail row again (toggle off)', () => {
    const c = mkComp();
    c.rows.set([mk('a'), mk('b')] as never);
    c.toggleExpand({ id: 'a' } as never);
    c.toggleExpand({ id: 'a' } as never);
    expect(c.displayRows().map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('two expanded rows each get their own detail row after their master', () => {
    const c = mkComp();
    c.rows.set([mk('a'), mk('b')] as never);
    c.toggleExpand({ id: 'a' } as never);
    c.toggleExpand({ id: 'b' } as never);
    expect(c.displayRows().map((r) => r.id)).toEqual(['a', 'a::detail', 'b', 'b::detail']);
  });

  it('the text filter narrows the base rows (and the detail follows its master)', () => {
    const c = mkComp();
    c.rows.set([mk('a', 'claude'), mk('b', 'gpt')] as never);
    c.filter.set('claude');
    expect(c.displayRows().map((r) => r.id)).toEqual(['a']);
    c.toggleExpand({ id: 'a' } as never);
    expect(c.displayRows().map((r) => r.id)).toEqual(['a', 'a::detail']);
  });
});

/**
 * Double-toast guard: explainTrace + rerunTrace each show their OWN specific
 * toast.error in the error callback, so the api.post must pass {silent:true} or
 * a failure fires TWO toasts (generic ApiService + the section-specific one).
 */
describe('AdminAiLogsComponent (mutations are {silent} — no double-toast)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function makePost(post: jasmine.Spy): AdminAiLogsComponent {
    TestBed.configureTestingModule({
      imports: [AdminAiLogsComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: {} }), post } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, warning: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
        { provide: Router, useValue: { navigate: () => 0, navigateByUrl: () => 0, events: of() } },
      ],
    });
    TestBed.overrideComponent(AdminAiLogsComponent, { set: { template: '<div></div>', imports: [] } });
    return TestBed.createComponent(AdminAiLogsComponent).componentInstance;
  }

  it('explainTrace POSTs {silent:true}', () => {
    const post = jasmine.createSpy('post').and.returnValue(of({ data: { markdown: 'x' } }));
    const c = makePost(post);
    c.explainTrace('t1');
    expect(post).toHaveBeenCalledWith('/admin/traces/t1/explain', {}, { silent: true });
  });

  it('rerunTrace POSTs {silent:true}', () => {
    const post = jasmine.createSpy('post').and.returnValue(of({ data: {} }));
    const c = makePost(post);
    c.rerunTrace({ id: 't1', endpoint_slug: 'greet', input_json: '{"a":1}' } as never);
    expect(post.calls.mostRecent().args[0]).toBe('/sites/s1/ai-endpoints/greet/invoke');
    expect(post.calls.mostRecent().args[2]).toEqual({ silent: true });
  });
});
