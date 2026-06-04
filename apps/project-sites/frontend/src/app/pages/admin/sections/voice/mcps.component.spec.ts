import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { VoiceMcpsComponent } from './mcps.component';
import { ApiService } from '../../../../services/api.service';
import { ToastService } from '../../../../services/toast.service';
import { AdminStateService } from '../../admin-state.service';

/**
 * First coverage for the voice MCP attachments section:
 *  - reload() failure surfaces a loadError (Retry card) instead of a fake
 *    "No connections yet" empty state
 *  - reload() success populates connections + clears the error
 *  - save() PUTs {silent:true} so its own toast.error doesn't double-fire with
 *    ApiService's generic toast
 * overrideComponent strips the template so the load effect stays inert; reload
 * + save are driven directly.
 */
function make(get: jasmine.Spy, put = jasmine.createSpy('put').and.returnValue(of({ data: { voice: [], sms: [] } }))): {
  c: VoiceMcpsComponent;
  put: jasmine.Spy;
  toast: { error: jasmine.Spy; success: jasmine.Spy };
} {
  const toast = { error: jasmine.createSpy('error'), success: jasmine.createSpy('success'), info: jasmine.createSpy('info') };
  TestBed.configureTestingModule({
    imports: [VoiceMcpsComponent],
    providers: [
      { provide: ApiService, useValue: { get, put } },
      { provide: ToastService, useValue: toast },
      { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
    ],
  });
  TestBed.overrideComponent(VoiceMcpsComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(VoiceMcpsComponent).componentInstance, put, toast };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('VoiceMcpsComponent (load error + save double-toast)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('reload() success populates connections and clears loadError', async () => {
    const { c } = make(jasmine.createSpy('get').and.returnValue(of({ data: [{ id: 'm1' }] })));
    c.reload();
    await flush();
    expect(c.connections().length).toBe(1);
    expect(c.loadError()).toBeNull();
    expect(c.loading()).toBeFalse();
  });

  it('reload() connections-fetch failure sets loadError (not a fake empty)', async () => {
    // get fails for the connections call; the attachments call resolves empty.
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 })));
    const { c } = make(get);
    c.reload();
    await flush();
    expect(c.loadError()).toContain('did not respond');
    expect(c.loading()).toBeFalse();
  });

  it('save() PUTs {silent:true} so the failure toast does not double-fire', () => {
    const { c, put } = make(jasmine.createSpy('get').and.returnValue(of({ data: [] })));
    c.save();
    expect(put.calls.mostRecent().args[2]).toEqual({ silent: true });
  });
});
