import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError, NEVER } from 'rxjs';
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

  it('selectStatus refetches with the new status (server-side filter — not a dead pill)', () => {
    const get = jasmine.createSpy('get').and.returnValue(of({ conversations: [], hasMore: false }));
    const c = make(get);
    get.calls.reset();
    c.selectStatus('resolved');
    expect(c.selectedStatus()).toBe('resolved');
    expect((get.calls.mostRecent().args[1] as { status?: string }).status)
      .withContext('a fresh fetch fired with the new status').toBe('resolved');
  });

  it('selectStatus is a no-op when the status is unchanged (no redundant refetch)', () => {
    const get = jasmine.createSpy('get').and.returnValue(of({ conversations: [], hasMore: false }));
    const c = make(get); // default selectedStatus is 'open'
    get.calls.reset();
    c.selectStatus('open');
    expect(get).not.toHaveBeenCalled();
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
 * Header stats must NOT render when the feature is flag-disabled. Previously the
 * "N open / N unread" rolling counters were OUTSIDE the flagEnabled() gate, so a
 * disabled inbox showed a lying "0 open / 0 unread" (implying it loaded + is
 * empty, when it's actually OFF). The stats now live behind @if (flagEnabled()).
 */
describe('AdminInboxComponent — stats hidden while flag-disabled (real template)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(flagOn: boolean): HTMLElement {
    TestBed.configureTestingModule({
      imports: [AdminInboxComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ conversations: [], hasMore: false }), post: () => of({}), patch: () => of({}) } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(flagOn) } },
        provideRouter([]),
      ],
    });
    const fx = TestBed.createComponent(AdminInboxComponent);
    fx.componentInstance.flagEnabled.set(flagOn);
    fx.componentInstance.loading.set(false);
    fx.detectChanges();
    return fx.nativeElement as HTMLElement;
  }

  it('hides the open/unread stats when the inbox is flag-disabled (no lying "0 open")', () => {
    const host = render(false);
    expect(host.querySelector('[data-testid="inbox-stats"]')).withContext('no fake counts for a disabled feature').toBeNull();
    expect(host.querySelector('.inbox-flag-gate')).withContext('flag-disabled card shown instead').not.toBeNull();
  });

  it('hides the open/unread stats while conversations are still loading (no premature "0 open · 0 unread")', () => {
    // openCount/unreadCount derive from conversations() (empty during load) — so
    // the stats must wait for the load, else they assert "0 open" over a skeleton list.
    TestBed.configureTestingModule({
      imports: [AdminInboxComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => NEVER, post: () => of({}), patch: () => of({}) } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(true) } },
        provideRouter([]),
      ],
    });
    const fx = TestBed.createComponent(AdminInboxComponent);
    fx.componentInstance.flagEnabled.set(true);
    fx.detectChanges(); // conversations fetch is in-flight (NEVER) → loading stays true
    const host = fx.nativeElement as HTMLElement;
    expect(fx.componentInstance.loading()).withContext('load in-flight').toBeTrue();
    expect(host.querySelector('[data-testid="inbox-stats"]')).withContext('no premature counts over the skeleton list').toBeNull();
  });

  it('the flag-gate Feature-Flags link is an inline, UNDERLINED, working RouterLink (cohesion with enterprise/trust/stripe gates)', () => {
    const host = render(false);
    const link = host.querySelector('.inbox-flag-gate a[routerLink="/admin/feature-flags"]') as HTMLAnchorElement;
    expect(link).withContext('flag-gate links to Feature Flags').not.toBeNull();
    // In-text link affordance must match the sibling flag-gate cards (underline,
    // not the old color-only standalone CTA) + be a real SPA link (renders href).
    expect(link.className).toContain('underline');
    expect(link.getAttribute('href')).toBe('/admin/feature-flags');
  });

  it('shows the stats when the inbox is enabled', () => {
    const host = render(true);
    expect(host.querySelector('[data-testid="inbox-stats"]')).not.toBeNull();
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

  it('an AI-drafted reply bubble carries the .ai-drafted class (violet grouping, wires the formerly-dead binding)', () => {
    TestBed.configureTestingModule({
      imports: [AdminInboxComponent],
      providers: [
        // One object serves both the conversations-list load (reads .conversations)
        // and the thread load (reads .messages) — selectedConversation() is computed
        // from conversations(), so c1 must be in the list the init load populates.
        { provide: ApiService, useValue: { get: () => of({
          conversation: { id: 'c1', channel: 'web', status: 'open', subject: 'Hi' },
          conversations: [{ id: 'c1', status: 'open', unread_count: 0, channel: 'web', subject: 'Hi' }],
          hasMore: false,
          messages: [
            { id: 'm1', body: 'human q', direction: 'inbound', ai_drafted: false, sent_at: 'now' },
            { id: 'm2', body: 'ai reply', direction: 'outbound', ai_drafted: true, sent_at: 'now' },
          ],
        }), post: () => of({}), patch: () => of({}) } },
        { provide: FeatureFlagService, useValue: { isOn: () => of(true) } },
        provideRouter([]),
      ],
    });
    const fx = TestBed.createComponent(AdminInboxComponent);
    fx.componentInstance.flagEnabled.set(true);
    fx.detectChanges(); // init load populates conversations() with c1
    fx.componentInstance.selectConversation({ id: 'c1', status: 'open', unread_count: 0, channel: 'web', subject: 'Hi' } as never);
    fx.detectChanges();
    const msgs = Array.from((fx.nativeElement as HTMLElement).querySelectorAll('.inbox-msg'));
    expect(msgs.length).withContext('thread rendered both messages').toBe(2);
    const aiMsg = msgs.find((m) => m.classList.contains('ai-drafted'));
    expect(aiMsg).withContext('the AI-drafted reply is grouped via .ai-drafted (the violet bubble accent targets it)').toBeTruthy();
    expect(aiMsg!.querySelector('.inbox-msg-ai-tag')?.textContent).withContext('and shows the AI-draft tag').toContain('AI');
    expect(msgs.find((m) => !m.classList.contains('ai-drafted'))).withContext('the human message is NOT marked ai-drafted').toBeTruthy();
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
