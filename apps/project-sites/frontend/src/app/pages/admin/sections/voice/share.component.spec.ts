import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { VoiceShareComponent } from './share.component';
import { ApiService } from '../../../../services/api.service';
import { ToastService } from '../../../../services/toast.service';
import { AdminStateService } from '../../admin-state.service';

/**
 * Guards the share tab's load-failure handling. A failed numbers fetch used to
 * silently empty the list → the UI told the user to "buy a number on the
 * Numbers tab" even when they already owned one. Now a failure sets loadError
 * (Retry affordance) and never wipes already-loaded numbers.
 * overrideComponent strips the template so the load effect stays inert; the
 * load is driven via the public retryLoad().
 */
function make(get: jasmine.Spy): VoiceShareComponent {
  TestBed.configureTestingModule({
    imports: [VoiceShareComponent],
    providers: [
      { provide: ApiService, useValue: { get } },
      { provide: ToastService, useValue: { success: () => 0, error: () => 0, info: () => 0 } },
      { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
    ],
  });
  TestBed.overrideComponent(VoiceShareComponent, { set: { template: '<div></div>', imports: [] } });
  return TestBed.createComponent(VoiceShareComponent).componentInstance;
}

describe('VoiceShareComponent (load failure ≠ "buy a number")', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('retryLoad success populates numbers and clears loadError', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [{ id: 'n1', capabilities: { voice: true } }] })));
    c.retryLoad();
    expect(c.numbers().length).toBe(1);
    expect(c.loadError()).toBeNull();
    expect(c.primaryNumber()).toBeNull(); // no phone_number on the stub, but no crash
  });

  it('retryLoad failure sets loadError (so the UI offers Retry, not "buy a number")', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    c.retryLoad();
    expect(c.loadError()).toBeTruthy();
  });

  it('a transient failure PRESERVES already-loaded numbers (no wipe)', () => {
    const get = jasmine.createSpy('get').and.returnValue(of({ data: [{ id: 'n1', capabilities: { voice: true } }] }));
    const c = make(get);
    c.retryLoad();
    expect(c.numbers().length).toBe(1);
    get.and.returnValue(throwError(() => ({ status: 503 })));
    c.retryLoad();
    expect(c.numbers().length).withContext('keep the number on a blip').toBe(1);
    expect(c.loadError()).toBeTruthy();
  });
});
