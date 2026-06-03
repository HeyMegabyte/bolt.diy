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

  it('a load error sets a persistent loadError (not a fake empty state)', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    c.reload();
    expect(c.loadError()).toContain('Could not load');
    expect(c.endpoints().length).toBe(0);
    expect(c.loading()).toBe(false);
  });

  it('retry after an error clears the prior loadError', () => {
    const get = jasmine.createSpy('get').and.returnValues(throwError(() => ({ status: 500 })), of({ data: [] }));
    const c = make(get);
    c.reload();
    expect(c.loadError()).not.toBeNull();
    c.reload();
    expect(c.loadError()).toBeNull();
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
});
