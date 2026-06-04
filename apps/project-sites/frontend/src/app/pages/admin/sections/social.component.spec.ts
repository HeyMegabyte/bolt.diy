import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { AdminSocialComponent } from './social.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Guards the P0 site-reactive-load class-bug fix for the Social section.
 * accounts + posts are site-scoped and there is NO data-refresh timer (the
 * only setInterval is the per-OAuth popup poll), so on a deep-link — where the
 * site resolves AFTER mount — the constructor effect (not ngOnInit-once) must
 * fire loadAccounts + loadPosts the instant selectedSite() resolves.
 */
describe('AdminSocialComponent (site-reactive load)', () => {
  let fixture: ComponentFixture<AdminSocialComponent>;
  let selectedSite: WritableSignal<{ id: string } | null>;
  let get: jasmine.Spy;

  const accountsCalls = (): unknown[][] =>
    get.calls.allArgs().filter((a) => a[0] === '/social/accounts');
  const postsCalls = (): unknown[][] =>
    get.calls.allArgs().filter((a) => a[0] === '/social/posts');

  function build(initial: { id: string } | null): void {
    selectedSite = signal<{ id: string } | null>(initial);
    get = jasmine.createSpy('get').and.callFake((path: string) => {
      if (path === '/social/auto-pilot/config') return of({ data: null });
      return of({ data: [] });
    });
    TestBed.configureTestingModule({
      imports: [AdminSocialComponent],
      providers: [
        { provide: ApiService, useValue: { get, post: jasmine.createSpy('post').and.returnValue(of({ data: {} })), delete: jasmine.createSpy('delete').and.returnValue(of({})) } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: Router, useValue: { navigateByUrl: jasmine.createSpy('navigateByUrl') } },
        { provide: AdminStateService, useValue: { selectedSite } },
      ],
    });
    fixture = TestBed.createComponent(AdminSocialComponent);
    fixture.detectChanges(); // ngOnInit + first effect flush
  }

  afterEach(() => TestBed.resetTestingModule());

  it('does NOT load accounts/posts on mount when no site is selected (deep-link)', () => {
    build(null);
    expect(accountsCalls().length).toBe(0);
    expect(postsCalls().length).toBe(0);
    expect(get).toHaveBeenCalledWith('/social/auto-pilot/config'); // org-level still loads
  });

  it('loads accounts + posts the instant the site resolves after mount', () => {
    build(null);
    expect(accountsCalls().length).toBe(0);

    selectedSite.set({ id: 'site-deep' });
    fixture.detectChanges(); // flush the constructor effect — NOT a timer

    expect(get).toHaveBeenCalledWith('/social/accounts', { site_id: 'site-deep' });
    expect(postsCalls().length).toBe(1);
    expect(postsCalls()[0][1]).toEqual({ site_id: 'site-deep' });
  });

  it('re-loads when the operator switches sites', () => {
    build({ id: 'site-a' });
    expect(get).toHaveBeenCalledWith('/social/accounts', { site_id: 'site-a' });

    selectedSite.set({ id: 'site-b' });
    fixture.detectChanges();

    expect(get).toHaveBeenCalledWith('/social/accounts', { site_id: 'site-b' });
  });
});

/**
 * Guards the link-preview fallback card: when a link is entered but OG data is
 * absent (the og-preview route may 404 / return empty), the composer shows a
 * branded fallback card (hostname + url) instead of silently showing nothing.
 */
describe('AdminSocialComponent (link fallback card)', () => {
  let fixture: ComponentFixture<AdminSocialComponent>;
  let host: HTMLElement;

  function build(): void {
    const selectedSite = signal<{ id: string } | null>({ id: 's1' });
    const get = jasmine.createSpy('get').and.callFake((path: string) =>
      path === '/social/auto-pilot/config' ? of({ data: null }) : of({ data: [] }),
    );
    TestBed.configureTestingModule({
      imports: [AdminSocialComponent],
      providers: [
        { provide: ApiService, useValue: { get, post: jasmine.createSpy('post').and.returnValue(of({ data: {} })), delete: jasmine.createSpy('delete').and.returnValue(of({})) } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: Router, useValue: { navigateByUrl: jasmine.createSpy('navigateByUrl') } },
        { provide: AdminStateService, useValue: { selectedSite } },
      ],
    });
    fixture = TestBed.createComponent(AdminSocialComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }
  afterEach(() => TestBed.resetTestingModule());

  it('derives the link hostname (strips www)', () => {
    build();
    fixture.componentInstance.link.set('https://www.example.com/some/page');
    expect(fixture.componentInstance.linkHost()).toBe('example.com');
    fixture.componentInstance.link.set('not a url');
    expect(fixture.componentInstance.linkHost()).toBe('');
  });

  it('renders a fallback card with the hostname when a link is entered and no OG data', () => {
    build();
    fixture.componentInstance.link.set('https://blog.acme.io/post');
    fixture.componentInstance.og.set(null);
    fixture.detectChanges();
    const card = host.querySelector('[data-testid="link-fallback-card"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('blog.acme.io');
    expect(host.querySelector('[data-testid="og-card"]')).toBeNull();
  });

  it('shows the real OG card (not the fallback) when OG data is present', () => {
    build();
    fixture.componentInstance.link.set('https://blog.acme.io/post');
    fixture.componentInstance.og.set({ title: 'Real Title', description: 'd', site_name: 'Acme', image: '' });
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="og-card"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="link-fallback-card"]')).toBeNull();
  });
});

/**
 * Guards the RSS "Copy links" action that replaced the 501-dead "Schedule all":
 * copies the previewed feed items to the clipboard as `Title — URL` lines.
 */
describe('AdminSocialComponent (RSS copy links)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('copies previewed feed items to the clipboard and toasts success', async () => {
    const success = jasmine.createSpy('success');
    const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    TestBed.configureTestingModule({
      imports: [AdminSocialComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post: () => of({ data: {} }), delete: () => of({}) } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success, warning: jasmine.createSpy('warning') } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: Router, useValue: { navigateByUrl: jasmine.createSpy('navigateByUrl') } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    const fixture = TestBed.createComponent(AdminSocialComponent);
    fixture.detectChanges();
    fixture.componentInstance.rssItems.set([
      { title: 'A', url: 'https://x.com/a' },
      { title: 'B', url: 'https://x.com/b' },
    ]);
    await fixture.componentInstance.copyRssLinks();
    expect(writeText).toHaveBeenCalledWith('A — https://x.com/a\nB — https://x.com/b');
    expect(success).toHaveBeenCalled();
  });

  it('imports previewed items as drafts via POST and refreshes', () => {
    const success = jasmine.createSpy('success');
    const post = jasmine.createSpy('post').and.returnValue(of({ ok: true, created: 2 }));
    TestBed.configureTestingModule({
      imports: [AdminSocialComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post, delete: () => of({}) } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success, warning: jasmine.createSpy('warning') } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: Router, useValue: { navigateByUrl: jasmine.createSpy('navigateByUrl') } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    const fixture = TestBed.createComponent(AdminSocialComponent);
    fixture.detectChanges();
    fixture.componentInstance.rssUrl = 'https://blog.com/feed.xml';
    fixture.componentInstance.rssItems.set([{ title: 'A', url: 'https://x.com/a' }, { title: 'B', url: 'https://x.com/b' }]);
    fixture.componentInstance.importRssDrafts();
    expect(post).toHaveBeenCalledWith('/social/import-rss', { url: 'https://blog.com/feed.xml', site_id: 's1' }, { silent: true });
    expect(success).toHaveBeenCalled();
    expect(fixture.componentInstance.rssItems().length).toBe(0); // cleared after import
  });
});

/**
 * Guards RSS feed-URL validation. The feed URL is fetched server-side
 * (SSRF-adjacent), so a non-https / junk / internal-host value must be rejected
 * client-side with a useful toast and NEVER reach /social/import-rss — both on
 * preview and on import.
 */
describe('AdminSocialComponent (RSS URL validation)', () => {
  let fixture: ComponentFixture<AdminSocialComponent>;
  let post: jasmine.Spy;
  let error: jasmine.Spy;

  function build(): void {
    post = jasmine.createSpy('post').and.returnValue(of({ items: [], ok: true, created: 0 }));
    error = jasmine.createSpy('error');
    TestBed.configureTestingModule({
      imports: [AdminSocialComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post, delete: () => of({}) } },
        { provide: ToastService, useValue: { error, success: jasmine.createSpy('success'), warning: jasmine.createSpy('warning') } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: Router, useValue: { navigateByUrl: jasmine.createSpy('navigateByUrl') } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    fixture = TestBed.createComponent(AdminSocialComponent);
    fixture.detectChanges();
  }
  afterEach(() => TestBed.resetTestingModule());

  it('rssPreview rejects a non-https feed URL — toasts + no POST', () => {
    build();
    fixture.componentInstance.rssUrl = 'http://evil.example.com/feed.xml';
    fixture.componentInstance.rssPreview();
    expect(post).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('rssPreview rejects a junk / internal-host URL', () => {
    build();
    fixture.componentInstance.rssUrl = 'https://localhost';
    fixture.componentInstance.rssPreview();
    expect(post).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('rssPreview accepts a valid https feed URL — POSTs a preview request', () => {
    build();
    fixture.componentInstance.rssUrl = 'https://example.com/feed.xml';
    fixture.componentInstance.rssPreview();
    expect(post).toHaveBeenCalledWith('/social/import-rss', { url: 'https://example.com/feed.xml', preview: true }, { silent: true });
  });

  it('importRssDrafts rejects a bad URL even with previewed items', () => {
    build();
    fixture.componentInstance.rssUrl = 'notaurl';
    fixture.componentInstance.rssItems.set([{ title: 'A', url: 'https://x.com/a' }]);
    fixture.componentInstance.importRssDrafts();
    expect(post).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('rssUrlValid() / rssUrlInvalid() reflect the typed value', () => {
    build();
    const c = fixture.componentInstance;
    c.rssUrl = '';
    expect(c.rssUrlValid()).toBe(false);
    expect(c.rssUrlInvalid()).toBe(false); // empty → incomplete, not invalid
    c.rssUrl = 'http://x';
    expect(c.rssUrlValid()).toBe(false);
    expect(c.rssUrlInvalid()).toBe(true);
    c.rssUrl = 'https://example.com/feed.xml';
    expect(c.rssUrlValid()).toBe(true);
    expect(c.rssUrlInvalid()).toBe(false);
  });
});

/**
 * publishBlockReason — the Publish button is disabled when a post isn't ready,
 * but a greyed-out button with no reason is a silent dead-end. This locks the
 * inline explanation (mirrors billing custom-amount + domains add-domain):
 * each disable condition maps to a specific, human reason, and a ready post
 * yields null + canPublish true. Reason order: platform → content → over-limit.
 */
describe('AdminSocialComponent (publish block reason)', () => {
  function make(): AdminSocialComponent {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminSocialComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post: () => of({ data: {} }), delete: () => of({}) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: Router, useValue: { navigateByUrl: () => undefined } },
        { provide: AdminStateService, useValue: { selectedSite: signal<{ id: string } | null>(null) } },
      ],
    });
    TestBed.overrideComponent(AdminSocialComponent, { set: { template: '<div></div>', imports: [] } });
    return TestBed.createComponent(AdminSocialComponent).componentInstance;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('no platform selected → explains "select a platform" (+ canPublish false)', () => {
    const c = make();
    c.content.set('hello world');
    c.selected.set([]);
    expect(c.publishBlockReason()).toContain('platform');
    expect(c.canPublish()).toBeFalse();
  });

  it('platform selected but empty content + no media → explains "write a message"', () => {
    const c = make();
    c.selected.set(['twitter']);
    c.content.set('   ');
    c.media.set([]);
    expect(c.publishBlockReason()).toContain('message');
    expect(c.canPublish()).toBeFalse();
  });

  it('over the platform char limit → names the platform + the overage', () => {
    const c = make();
    c.selected.set(['twitter']); // 280-char limit
    c.content.set('x'.repeat(281));
    const reason = c.publishBlockReason();
    expect(reason).toContain('X / Twitter');
    expect(reason).toContain('over its');
    expect(reason).toContain('1 character'); // exactly 1 over → singular
    expect(c.canPublish()).toBeFalse();
  });

  it('a ready post → reason is null and canPublish is true', () => {
    const c = make();
    c.selected.set(['twitter']);
    c.content.set('a perfectly valid post');
    expect(c.publishBlockReason()).toBeNull();
    expect(c.canPublish()).toBeTrue();
  });
});

/**
 * Destructive actions MUST be confirmed before they fire (standing-MEMORY: "verify
 * destructive actions"). deletePost (deletes a draft / cancels a user-SCHEDULED
 * queued post) and disconnect (drops a connected social account → re-OAuth to
 * restore) were firing api.delete IMMEDIATELY on click — one misclick, no undo.
 * They now use the file's existing action-armed toast.warning pattern (the same
 * cockpit confirm used by Discard-draft + sibling email/mcp/apps-instances):
 * the delete only runs when the operator clicks the toast's action.
 */
describe('AdminSocialComponent (destructive actions are confirm-guarded)', () => {
  let del: jasmine.Spy;
  let warning: jasmine.Spy;
  let lastAction: { label: string; run: () => void } | undefined;

  function build(): AdminSocialComponent {
    del = jasmine.createSpy('delete').and.returnValue(of({}));
    lastAction = undefined;
    warning = jasmine.createSpy('warning').and.callFake((_m: string, opts?: { action?: { label: string; run: () => void } }) => {
      lastAction = opts?.action;
      return 1;
    });
    TestBed.configureTestingModule({
      imports: [AdminSocialComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post: () => of({ data: {} }), delete: del } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, warning } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: Router, useValue: { navigateByUrl: () => undefined } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    return TestBed.createComponent(AdminSocialComponent).componentInstance;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('deletePost asks for confirmation first — no immediate api.delete; the delete is {silent} (no double-toast)', () => {
    const c = build();
    c.deletePost({ id: 'p1' } as never);
    expect(warning).toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    lastAction?.run();
    // {silent:true} so a failure shows ONLY the component's specific 'Delete failed'
    // toast, not ALSO the generic ApiService one.
    expect(del).toHaveBeenCalledWith('/social/posts/p1', { silent: true });
  });

  it('disconnect asks for confirmation first — no immediate account deletion; the delete is {silent} (no double-toast)', () => {
    const c = build();
    c.accounts.set([{ platform: 'twitter', connected: true, id: 'acct-1' }] as never);
    c.disconnect('twitter' as never);
    expect(warning).toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    lastAction?.run();
    expect(del).toHaveBeenCalledWith('/social/accounts/acct-1', { silent: true });
  });

  it('publishNow passes {silent:true} so a failure shows only the section-specific toast (no generic double-toast)', () => {
    const post = jasmine.createSpy('post').and.returnValue(of({ data: {} }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminSocialComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: [] }), post, delete: () => of({}) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0, warning: () => 0, info: () => 0 } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: Router, useValue: { navigateByUrl: () => undefined } },
        { provide: AdminStateService, useValue: { selectedSite: signal({ id: 's1' }) } },
      ],
    });
    const c = TestBed.createComponent(AdminSocialComponent).componentInstance;
    c.publishNow({ id: 'p9' } as never);
    expect(post).toHaveBeenCalledWith('/social/posts/p9/publish-now', {}, { silent: true });
  });
});
