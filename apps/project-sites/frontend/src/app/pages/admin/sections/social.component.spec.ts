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
    expect(post).toHaveBeenCalledWith('/social/import-rss', { url: 'https://blog.com/feed.xml', site_id: 's1' });
    expect(success).toHaveBeenCalled();
    expect(fixture.componentInstance.rssItems().length).toBe(0); // cleared after import
  });
});
