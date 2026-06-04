import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { AdminSnapshotsDiffComponent } from './snapshots-diff.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * First coverage for the snapshot-diff viewer (untested) + the Retry added this round:
 *  - load() guards: no site / missing from|to ids → a clear error (no fetch)
 *  - load() success populates the diff + clears error
 *  - load() failure sets the error message + toasts (Retry recovers)
 * overrideComponent strips the diff template; load() is driven directly.
 */
function make(get: jasmine.Spy, siteId: string | null = 's1'): {
  c: AdminSnapshotsDiffComponent;
  toast: { error: jasmine.Spy };
} {
  const toast = { error: jasmine.createSpy('error'), success: () => 0 };
  TestBed.configureTestingModule({
    imports: [AdminSnapshotsDiffComponent],
    providers: [
      { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null }) } },
      { provide: ApiService, useValue: { get } },
      { provide: ToastService, useValue: toast },
      { provide: AdminStateService, useValue: { selectedSite: signal(siteId ? { id: siteId } : null) } },
    ],
  });
  TestBed.overrideComponent(AdminSnapshotsDiffComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(AdminSnapshotsDiffComponent).componentInstance, toast };
}

describe('AdminSnapshotsDiffComponent (diff load + guards)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('errors (no fetch) when no site is selected', async () => {
    const get = jasmine.createSpy('get');
    const { c } = make(get, null);
    c.fromId.set('a'); c.toId.set('b');
    await c.load();
    expect(c.error()).toContain('No site selected');
    expect(get).not.toHaveBeenCalled();
  });

  it('errors (no fetch) when from/to ids are missing', async () => {
    const get = jasmine.createSpy('get');
    const { c } = make(get);
    c.fromId.set(''); c.toId.set('');
    await c.load();
    expect(c.error()).toContain('required in the URL');
    expect(get).not.toHaveBeenCalled();
  });

  it('success populates the diff and clears the error', async () => {
    const get = jasmine.createSpy('get').and.returnValue(of({ added: [], removed: [], modified: [] }));
    const { c } = make(get);
    c.fromId.set('a'); c.toId.set('b');
    await c.load();
    expect(c.diff()).not.toBeNull();
    expect(c.error()).toBeNull();
    expect(c.loading()).toBe(false);
  });

  it('a fetch failure sets the inline error banner ONLY (read is {silent}, no toast on top); Retry then recovers', async () => {
    const get = jasmine.createSpy('get').and.returnValues(
      throwError(() => new Error('boom')),
      of({ added: [], removed: [], modified: [] }),
    );
    const { c, toast } = make(get);
    c.fromId.set('a'); c.toId.set('b');
    await c.load();
    expect(c.error()).toContain('Could not load diff');
    // banner is the UX; the read is {silent} so the generic toast can't fire and
    // the component no longer toasts on top of its own banner.
    expect(toast.error).not.toHaveBeenCalled();
    expect(get.calls.first().args[2]).toEqual({ silent: true });
    expect(c.loading()).toBe(false);
    // Retry path (the button added this round)
    await c.load();
    expect(c.error()).toBeNull();
    expect(c.diff()).not.toBeNull();
  });
});
