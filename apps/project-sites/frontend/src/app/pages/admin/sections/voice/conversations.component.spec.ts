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

/**
 * Honest empty-state: the feed's empty branch said "No conversations yet" even
 * when conversations EXIST but an active search/channel/escalated filter
 * excludes them all — implying the caller's records vanished. It must instead
 * say "no match" + offer Clear. The filters are signals so the list re-filters
 * live (a Clear button that resets plain props would never update the view).
 */
describe('VoiceConversationsComponent (filter no-match ≠ truly empty)', () => {
  afterEach(() => TestBed.resetTestingModule());
  const conv = (id: string, over: Record<string, unknown> = {}) =>
    ({ id, from_number: '+15551234567', channel: 'call', status: 'open', message_preview: '', summary: '', created_at: new Date().toISOString(), ...over }) as never;

  it('conversations exist but the filter excludes all → filterNoMatch (not a fake "No conversations yet")', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [] })));
    c.conversations.set([conv('a'), conv('b')]);
    c.searchQ.set('zzz-nothing-matches');
    expect(c.filtered().length).withContext('filter excludes all').toBe(0);
    expect(c.filterNoMatch()).withContext('no-match, not truly empty').toBeTrue();
  });

  it('truly empty (no conversations at all) → NOT filterNoMatch', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [] })));
    c.conversations.set([]);
    c.searchQ.set('anything');
    expect(c.filterNoMatch()).withContext('genuinely empty is not a filter problem').toBeFalse();
  });

  it('clearFilters() resets search + channel + escalated and reveals the rows (live, signal-reactive)', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ data: [] })));
    c.conversations.set([conv('a'), conv('b')]);
    c.searchQ.set('zzz'); c.channelFilter.set('sms'); c.escalatedOnly.set(true);
    expect(c.filtered().length).withContext('filtered to none').toBe(0);
    c.clearFilters();
    expect(c.searchQ()).toBe('');
    expect(c.channelFilter()).toBe('all');
    expect(c.escalatedOnly()).toBeFalse();
    expect(c.filtered().length).withContext('all rows visible after clear').toBe(2);
  });
});
