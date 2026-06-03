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
