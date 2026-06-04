import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { VoiceConversationsComponent } from './conversations.component';
import { ApiService } from '../../../../services/api.service';
import { ToastService } from '../../../../services/toast.service';
import { AdminStateService } from '../../admin-state.service';

/**
 * First coverage for the voice conversation feed. The load previously swallowed
 * a fetch failure into conversations.set([]) — a fake "No conversations yet"
 * empty state that hides real calls. Now refresh() sets a loadError (Retry card)
 * and PRESERVES already-loaded calls on a transient poll blip rather than wiping
 * them. overrideComponent strips the template so the polling effect stays inert.
 */
function make(get: jasmine.Spy): VoiceConversationsComponent {
  TestBed.configureTestingModule({
    imports: [VoiceConversationsComponent],
    providers: [
      { provide: ApiService, useValue: { get } },
      { provide: ToastService, useValue: { success: () => 0, error: () => 0, info: () => 0 } },
      { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
    ],
  });
  TestBed.overrideComponent(VoiceConversationsComponent, { set: { template: '<div></div>', imports: [] } });
  return TestBed.createComponent(VoiceConversationsComponent).componentInstance;
}

describe('VoiceConversationsComponent (load error ≠ fake empty)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('refresh() success populates conversations and clears loadError', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [{ id: 'a' }] })));
    c.refresh();
    expect(c.conversations().length).toBe(1);
    expect(c.loadError()).toBeNull();
    expect(c.loading()).toBeFalse();
  });

  it('refresh() failure sets loadError (not a fake empty list)', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    c.refresh();
    expect(c.loadError()).toContain('did not respond');
    expect(c.loading()).toBeFalse();
  });

  it('a transient poll failure PRESERVES already-loaded calls (no wipe)', () => {
    const get = jasmine.createSpy('get').and.returnValue(of({ data: [{ id: 'a' }, { id: 'b' }] }));
    const c = make(get);
    c.refresh(); // first load succeeds → 2 calls
    expect(c.conversations().length).toBe(2);
    get.and.returnValue(throwError(() => ({ status: 503 }))); // next poll blips
    c.refresh();
    expect(c.conversations().length).withContext('existing calls survive a poll blip').toBe(2);
    expect(c.loadError()).toBeTruthy();
  });

  it('a successful refresh after an error clears loadError', () => {
    const get = jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 })));
    const c = make(get);
    c.refresh();
    expect(c.loadError()).toBeTruthy();
    get.and.returnValue(of({ data: [] }));
    c.refresh();
    expect(c.loadError()).toBeNull();
  });
});
