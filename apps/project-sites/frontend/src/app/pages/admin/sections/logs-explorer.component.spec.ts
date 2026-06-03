import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AdminLogsExplorerComponent } from './logs-explorer.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Guards the Log Explorer search-state logic: a fetch error sets a PERSISTENT
 * in-panel error (so it never masquerades as the "No logs found" empty state),
 * a 404 surfaces the flag-disabled banner (no error), and success clears the
 * error. overrideComponent strips the heavy template (render-free, robust).
 */
function make(post: jasmine.Spy): { c: AdminLogsExplorerComponent; toastErr: jasmine.Spy } {
  const toastErr = jasmine.createSpy('error');
  TestBed.configureTestingModule({
    imports: [AdminLogsExplorerComponent],
    providers: [
      { provide: ApiService, useValue: { post, get: () => of({ data: { routes: [], grand_total: 0 } }) } },
      { provide: ToastService, useValue: { error: toastErr, success: jasmine.createSpy('success') } },
      { provide: AdminStateService, useValue: { selectedSite: signal(null) } },
    ],
  });
  TestBed.overrideComponent(AdminLogsExplorerComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(AdminLogsExplorerComponent).componentInstance, toastErr };
}

describe('AdminLogsExplorerComponent (search state)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('success populates rows and clears searching/error', () => {
    const post = jasmine.createSpy('post').and.returnValue(of({ data: { items: [{ id: 'l1' }], next_cursor: null, total_returned: 1 } }));
    const { c } = make(post);
    c.search();
    expect(c.searching()).toBe(false);
    expect(c.searched()).toBe(true);
    expect(c.searchError()).toBeNull();
    expect(c.rows().length).toBe(1);
  });

  it('a non-404 error sets a persistent searchError (not a silent empty) + toasts', () => {
    const post = jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 500 })));
    const { c, toastErr } = make(post);
    c.search();
    expect(c.searching()).toBe(false);
    expect(c.searchError()).toContain("Couldn't load logs");
    expect(c.featureDisabled()).toBe(false);
    expect(toastErr).toHaveBeenCalled();
  });

  it('a 404 surfaces the flag-disabled banner without an error message or toast', () => {
    const post = jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 404 })));
    const { c, toastErr } = make(post);
    c.search();
    expect(c.featureDisabled()).toBe(true);
    expect(c.searchError()).toBeNull();
    expect(toastErr).not.toHaveBeenCalled();
  });

  it('re-searching after an error clears the prior error', () => {
    const post = jasmine.createSpy('post').and.returnValues(
      throwError(() => ({ status: 500 })),
      of({ data: { items: [], next_cursor: null, total_returned: 0 } }),
    );
    const { c } = make(post);
    c.search(); // fails
    expect(c.searchError()).not.toBeNull();
    c.search(); // succeeds
    expect(c.searchError()).toBeNull();
  });
});
