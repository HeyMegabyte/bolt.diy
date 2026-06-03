import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
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

  it('a load error sets a persistent loadError banner + toasts', () => {
    const { c, toastErr } = make(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    c.load();
    expect(c.loadError()).toContain('stale');
    expect(c.loading()).toBe(false);
    expect(toastErr).toHaveBeenCalled();
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
