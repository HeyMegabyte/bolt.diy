import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AdminInboxComponent } from './inbox.component';
import { ApiService } from '../../../services/api.service';
import { FeatureFlagService } from '../../../services/feature-flag.service';

/**
 * Guards the Inbox conversations-load error gating: a non-404 load failure used
 * to be SILENT (no toast) and fall through to the "No conversations" empty state
 * (a fetch error masquerading as an empty inbox). Now it sets a persistent,
 * retryable convError. 404 = flag-off (disabled banner, no error). The flag/poll
 * wiring lives in ngOnInit, so createComponent (no detectChanges) lets us drive
 * loadConversations() directly.
 */
function make(get: jasmine.Spy): AdminInboxComponent {
  TestBed.configureTestingModule({
    imports: [AdminInboxComponent],
    providers: [
      { provide: ApiService, useValue: { get, post: () => of({}), patch: () => of({}) } },
      { provide: FeatureFlagService, useValue: { isOn: () => of(false) } },
    ],
  });
  TestBed.overrideComponent(AdminInboxComponent, { set: { template: '<div></div>', imports: [] } });
  return TestBed.createComponent(AdminInboxComponent).componentInstance;
}

describe('AdminInboxComponent (conversations load error)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('success populates conversations and clears convError', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ conversations: [{ id: 'c1', status: 'open', unread_count: 0 }], hasMore: false })));
    c.loadConversations();
    expect(c.convError()).toBeNull();
    expect(c.conversations().length).toBe(1);
    expect(c.flagEnabled()).toBe(true);
    expect(c.loading()).toBe(false);
  });

  it('a non-404 error sets a persistent convError (not a silent empty inbox)', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    c.loadConversations();
    expect(c.convError()).toContain("Couldn't load");
    expect(c.loading()).toBe(false);
  });

  it('a 404 sets flag-disabled without a convError', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 404 }))));
    c.loadConversations();
    expect(c.flagEnabled()).toBe(false);
    expect(c.convError()).toBeNull();
  });

  it('retry after an error clears the prior convError', () => {
    const get = jasmine.createSpy('get').and.returnValues(
      throwError(() => ({ status: 500 })),
      of({ conversations: [], hasMore: false }),
    );
    const c = make(get);
    c.loadConversations();
    expect(c.convError()).not.toBeNull();
    c.loadConversations();
    expect(c.convError()).toBeNull();
  });

  it('statusCount tallies loaded conversations per pill (r21 cyan/black count badge)', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({
      conversations: [
        { id: 'c1', status: 'open', unread_count: 1 },
        { id: 'c2', status: 'open', unread_count: 0 },
        { id: 'c3', status: 'pending', unread_count: 0 },
        { id: 'c4', status: 'resolved', unread_count: 0 },
      ],
      hasMore: false,
    })));
    c.loadConversations();
    expect(c.statusCount('open')).toBe(2);
    expect(c.statusCount('pending')).toBe(1);
    expect(c.statusCount('spam')).toBe(0);
    expect(c.statusCount('all')).toBe(4);
    expect(c.openCount()).toBe(2);
    expect(c.unreadCount()).toBe(1);
  });
});

describe('AdminInboxComponent — empty state (real template)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the rich app-empty-state (not bare text) when there are no conversations', () => {
    TestBed.configureTestingModule({
      imports: [AdminInboxComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ conversations: [], hasMore: false }), post: () => of({}), patch: () => of({}) } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(true) } },
        provideRouter([]),
      ],
    });
    const fx = TestBed.createComponent(AdminInboxComponent);
    const c = fx.componentInstance;
    c.flagEnabled.set(true);
    c.convError.set(null);
    c.conversations.set([]);
    c.loading.set(false);
    fx.detectChanges();
    const host = fx.nativeElement as HTMLElement;
    expect(host.querySelector('app-empty-state')).withContext('uses the reusable empty-state primitive').not.toBeNull();
    expect(host.textContent ?? '').not.toContain('No open conversations.');
  });
});

/**
 * Thread-load error gating: opening a conversation whose messages fail to load
 * must show a retryable in-panel error, NOT a silent blank thread (the toast
 * fires, but the thread panel itself was previously empty/stale).
 */
describe('AdminInboxComponent (thread message-load error)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('selecting a conversation loads its messages + leaves messagesError null', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(of({ conversation: { id: 'c1' }, messages: [{ id: 'm1', body: 'hi', direction: 'inbound', sent_at: 'now' }] })));
    c.selectConversation({ id: 'c1', status: 'open', unread_count: 0 } as never);
    expect(c.messages().length).toBe(1);
    expect(c.messagesError()).toBeNull();
  });

  it('a failed thread load sets messagesError + empties messages (no silent blank thread)', () => {
    const c = make(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    c.selectConversation({ id: 'c1', status: 'open', unread_count: 0 } as never);
    expect(c.messagesError()).withContext('the thread failure is surfaced, not blank').not.toBeNull();
    expect(c.messages().length).toBe(0);
  });

  it('reloadMessages retries the selected conversation + clears the prior error on success', () => {
    const get = jasmine.createSpy('get').and.returnValues(
      throwError(() => ({ status: 500 })),
      of({ conversation: { id: 'c1' }, messages: [{ id: 'm1', body: 'hi', direction: 'inbound', sent_at: 'now' }] }),
    );
    const c = make(get);
    c.selectConversation({ id: 'c1', status: 'open', unread_count: 0 } as never);
    expect(c.messagesError()).not.toBeNull();
    c.reloadMessages();
    expect(c.messagesError()).toBeNull();
    expect(c.messages().length).toBe(1);
  });
});
