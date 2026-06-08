import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ShareLinkDialogComponent } from './share-link-dialog.component';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';

/**
 * Coverage for the Share-link modal (replaces the removed /admin/review-links
 * page). Contract: create+auto-copy, optional password (generate/strength/min-6
 * validation), expiry presets, and a flag-off → calm gate. The create path
 * routes through ApiService (bearer-carrying) — never raw HttpClient.
 */
describe('ShareLinkDialogComponent', () => {
  let fixture: ComponentFixture<ShareLinkDialogComponent>;
  let cmp: ShareLinkDialogComponent;
  let post: jasmine.Spy;
  let get: jasmine.Spy;
  let writeText: jasmine.Spy;

  function make(siteId = 's1') {
    get = jasmine.createSpy('get').and.returnValue(of({ ok: true, links: [] }));
    post = jasmine.createSpy('post').and.returnValue(of({ ok: true, id: 'rl-1', url: '/review/rl-1', expiresAt: '2026-07-01T00:00:00.000Z', passwordProtected: false }));
    TestBed.configureTestingModule({
      imports: [ShareLinkDialogComponent],
      providers: [
        { provide: ApiService, useValue: { get, post } },
        { provide: ToastService, useValue: { success: () => 0, error: () => 0 } },
      ],
    });
    fixture = TestBed.createComponent(ShareLinkDialogComponent);
    fixture.componentRef.setInput('siteId', siteId);
    cmp = fixture.componentInstance;
    fixture.detectChanges(); // ngOnInit → loadLinks
  }

  let originalClipboard: PropertyDescriptor | undefined;

  beforeEach(() => {
    // Stub the async clipboard so auto-copy resolves deterministically. We swap
    // in our OWN object (not spyOn) to avoid "already spied" collisions with
    // other spec files that spy navigator.clipboard, and restore it afterEach.
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    writeText = jasmine.createSpy('writeText').and.resolveTo();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });

  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else delete (navigator as { clipboard?: unknown }).clipboard;
    TestBed.resetTestingModule();
  });

  it('loads existing links on init via ApiService (bearer-carrying), never raw HttpClient', () => {
    make();
    expect(get).toHaveBeenCalledWith('/sites/s1/review-links', undefined, { silent: true });
  });

  it('generatePassword fills a memorable word-word-NN! passphrase and reveals it', () => {
    make();
    cmp.generatePassword();
    expect(cmp.password()).toMatch(/^[a-z]+-[a-z]+-\d{2}!$/);
    expect(cmp.showPassword()).toBeTrue();
  });

  it('toggling password ON auto-generates a value; OFF clears it', () => {
    make();
    cmp.togglePassword({ target: { checked: true } } as unknown as Event);
    expect(cmp.passwordEnabled()).toBeTrue();
    expect(cmp.password().length).toBeGreaterThan(0);
    cmp.togglePassword({ target: { checked: false } } as unknown as Event);
    expect(cmp.passwordEnabled()).toBeFalse();
    expect(cmp.password()).toBe('');
  });

  it('passwordError: silent when disabled or empty, message under 6 chars', () => {
    make();
    expect(cmp.passwordError()).toBe('');
    cmp.passwordEnabled.set(true);
    cmp.password.set('');
    expect(cmp.passwordError()).withContext('empty → no nag yet').toBe('');
    cmp.password.set('abc');
    expect(cmp.passwordError()).toContain('at least 6');
    cmp.password.set('abcdef');
    expect(cmp.passwordError()).toBe('');
  });

  it('canCreate gates on a valid password only when protection is enabled', () => {
    make();
    expect(cmp.canCreate()).toBeTrue(); // open link, always creatable
    cmp.passwordEnabled.set(true);
    cmp.password.set('abc');
    expect(cmp.canCreate()).withContext('short password blocks create').toBeFalse();
    cmp.password.set('strong-pass');
    expect(cmp.canCreate()).toBeTrue();
  });

  it('strength score climbs with length + character variety', () => {
    make();
    cmp.password.set('abc');
    const weak = cmp.strength().score;
    cmp.password.set('Abcd1234!xyz');
    expect(cmp.strength().score).toBeGreaterThan(weak);
  });

  it('create() posts ttlDays (+password when enabled) and auto-copies the link', async () => {
    make();
    cmp.expiryDays.set(30);
    cmp.create();
    expect(post).toHaveBeenCalledWith('/sites/s1/review-links', { ttlDays: 30 }, { silent: true });
    await fixture.whenStable();
    expect(cmp.created()?.url).toContain('/review/rl-1');
    expect(writeText).toHaveBeenCalled(); // auto-copied
  });

  it('create() with a password forwards it and copies link+password together', async () => {
    make();
    post.and.returnValue(of({ ok: true, id: 'rl-2', url: '/review/rl-2', expiresAt: 'x', passwordProtected: true }));
    cmp.passwordEnabled.set(true);
    cmp.password.set('amber-otter-42!');
    cmp.create();
    expect(post).toHaveBeenCalledWith('/sites/s1/review-links', { ttlDays: 7, password: 'amber-otter-42!' }, { silent: true });
    await fixture.whenStable();
    expect(cmp.created()?.passwordProtected).toBeTrue();
    // The auto-copy block carries BOTH the link and the password.
    const copied = writeText.calls.mostRecent().args[0] as string;
    expect(copied).toContain('/review/rl-2');
    expect(copied).toContain('amber-otter-42!');
  });

  it('create() 404 → calm flag-gate (not an error toast)', async () => {
    make();
    post.and.returnValue(throwError(() => ({ status: 404 })));
    cmp.create();
    await fixture.whenStable();
    expect(cmp.flagDisabled()).toBeTrue();
    expect(cmp.createError()).toBeNull();
  });

  it('close() emits the closed output', () => {
    make();
    const spy = jasmine.createSpy('closed');
    cmp.closed.subscribe(spy);
    cmp.close();
    expect(spy).toHaveBeenCalled();
  });
});
