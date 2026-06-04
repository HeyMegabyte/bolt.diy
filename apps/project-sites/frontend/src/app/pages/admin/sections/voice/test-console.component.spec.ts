import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { VoiceTestConsoleComponent } from './test-console.component';
import { ApiService } from '../../../../services/api.service';
import { ToastService } from '../../../../services/toast.service';
import { AdminStateService } from '../../admin-state.service';

/**
 * Call-token fetch error gating: a 501 means voice isn't provisioned → the
 * component shows an inline `notConfigured` panel (no toast). The POST was
 * non-{silent}, so ApiService's generic "Can't reach the server" toast
 * double-fired: over the notConfigured panel on a 501, and over the component's
 * own specific toast on a non-501. Now {silent} → exactly one accurate surface.
 * overrideComponent strips the (WebRTC-heavy) template; fetchToken is driven directly.
 */
function make(post: jasmine.Spy): { c: VoiceTestConsoleComponent; toastErr: jasmine.Spy } {
  const toastErr = jasmine.createSpy('error');
  TestBed.configureTestingModule({
    imports: [VoiceTestConsoleComponent],
    providers: [
      { provide: ApiService, useValue: { post, get: () => of({ data: [] }) } },
      { provide: ToastService, useValue: { error: toastErr, success: () => 0, info: () => 0 } },
      { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
    ],
  });
  TestBed.overrideComponent(VoiceTestConsoleComponent, { set: { template: '<div></div>', imports: [] } });
  return { c: TestBed.createComponent(VoiceTestConsoleComponent).componentInstance, toastErr };
}

type WithFetch = { fetchToken: () => Promise<unknown> };

describe('VoiceTestConsoleComponent (call-token fetch — no double-toast; 501 → notConfigured)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('fetches the call-token {silent} so the component owns the sole failure surface', async () => {
    const post = jasmine.createSpy('post').and.returnValue(of({ data: { token: 't' } }));
    const { c } = make(post);
    await (c as unknown as WithFetch).fetchToken();
    expect(post).toHaveBeenCalled();
    expect(post.calls.mostRecent().args[0]).toBe('/voice/test/call-token');
    expect(post.calls.mostRecent().args[2]).withContext('silenced → no generic double-toast').toEqual({ silent: true });
  });

  it('a 501 sets the inline notConfigured panel WITHOUT an error toast', async () => {
    const post = jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 501 })));
    const { c, toastErr } = make(post);
    await (c as unknown as WithFetch).fetchToken();
    expect(c.notConfigured()).withContext('501 = voice un-provisioned → inline panel').toBeTrue();
    expect(toastErr).withContext('no toast on the not-configured path').not.toHaveBeenCalled();
  });

  it('a non-501 error surfaces exactly one specific component toast', async () => {
    const post = jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 500 })));
    const { c, toastErr } = make(post);
    await (c as unknown as WithFetch).fetchToken();
    expect(toastErr).toHaveBeenCalledTimes(1);
    expect(c.notConfigured()).toBeFalse();
  });
});
