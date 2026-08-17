import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SignInComponent, sanitizeReturnUrl } from './sign-in.component';
import { AuthApiService } from './auth-api.service';
import { AuthService } from '../../services/auth.service';

describe('sanitizeReturnUrl (open-redirect safety)', () => {
  it('honors a same-origin absolute path', () => {
    expect(sanitizeReturnUrl('/admin/billing')).toBe('/admin/billing');
    expect(sanitizeReturnUrl('/sites/abc?tab=logs')).toBe('/sites/abc?tab=logs');
  });
  it('rejects protocol-relative, external, scheme, and empty → /admin', () => {
    for (const bad of ['//evil.com', 'https://evil.com', 'javascript:alert(1)', '', null, undefined, 'admin']) {
      expect(sanitizeReturnUrl(bad)).toBe('/admin');
    }
  });
});

describe('SignInComponent', () => {
  const signInEmail = jasmine.createSpy('signInEmail');
  const sendMagicLink = jasmine.createSpy('sendMagicLink');
  const getSession = jasmine.createSpy('getSession');
  const setSession = jasmine.createSpy('setSession');
  let loggedIn = false;
  let navigateByUrl: jasmine.Spy;

  function make() {
    TestBed.configureTestingModule({
      imports: [SignInComponent],
      providers: [
        { provide: AuthApiService, useValue: { signInEmail, sendMagicLink, getSession } },
        { provide: AuthService, useValue: { isLoggedIn: () => loggedIn, setSession } },
        provideRouter([]),
      ],
    });
    const f = TestBed.createComponent(SignInComponent);
    navigateByUrl = spyOn(TestBed.inject(Router), 'navigateByUrl');
    f.detectChanges();
    return f;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    signInEmail.calls.reset();
    sendMagicLink.calls.reset();
    getSession.calls.reset();
    setSession.calls.reset();
    loggedIn = false;
    signInEmail.and.resolveTo({ ok: true, data: {} });
    sendMagicLink.and.resolveTo({ ok: true, data: {} });
    // Default: no cookie-backed BA session — the bridge stays inert.
    getSession.and.resolveTo({ ok: false, error: 'no session' });
  });

  it('renders email + password inputs and the submit button', () => {
    const f = make();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="sign-in-page"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sign-in-email"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sign-in-password"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sign-in-submit"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sign-in-magic-link"]')).toBeTruthy();
  });

  it('disables submit until both fields are valid (submit guard)', () => {
    const f = make();
    const btn = f.nativeElement.querySelector(
      '[data-testid="sign-in-submit"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    f.componentInstance.email.set('user@example.com');
    f.componentInstance.password.set('secret');
    f.detectChanges();
    expect(btn.disabled).toBe(false);
  });

  it('does not call the API when submit fires while invalid', async () => {
    const f = make();
    await f.componentInstance.submit();
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it('signs in, mints the local session, and navigates to /admin on success', async () => {
    signInEmail.and.resolveTo({ ok: true, data: { token: 'ba-tok-1' } });
    const f = make();
    f.componentInstance.email.set('user@example.com');
    f.componentInstance.password.set('secret');
    await f.componentInstance.submit();
    expect(signInEmail).toHaveBeenCalledWith({ email: 'user@example.com', password: 'secret' });
    // The guard keys off localStorage ps_session — BA only sets a cookie, so
    // the component must mint the local session itself or /admin bounces back.
    expect(setSession).toHaveBeenCalledWith('ba-tok-1', 'user@example.com');
    expect(navigateByUrl).toHaveBeenCalledWith('/admin');
  });

  it('bridges a live BA cookie session into ps_session on arrival', async () => {
    getSession.and.resolveTo({
      ok: true,
      data: { session: { token: 'ba-cookie-tok' }, user: { email: 'user@example.com' } },
    });
    const f = make();
    await f.whenStable();
    expect(getSession).toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith('ba-cookie-tok', 'user@example.com');
    expect(navigateByUrl).toHaveBeenCalledWith('/admin');
  });

  it('leaves the bridge inert when no BA session exists', async () => {
    const f = make();
    await f.whenStable();
    expect(setSession).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('skips the bridge probe entirely when already logged in', async () => {
    loggedIn = true;
    const f = make();
    await f.whenStable();
    expect(getSession).not.toHaveBeenCalled();
  });

  it('surfaces the error on a failed sign-in', async () => {
    signInEmail.and.resolveTo({ ok: false, error: 'Invalid email or password.' });
    const f = make();
    f.componentInstance.email.set('user@example.com');
    f.componentInstance.password.set('nope');
    await f.componentInstance.submit();
    expect(f.componentInstance.error()).toBe('Invalid email or password.');
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('steers to a working method (no dead-end) when password sign-in is captcha-gated', async () => {
    // Better Auth's captcha plugin returns "Missing CAPTCHA response" because this
    // password form renders no Turnstile widget — the raw string must NOT strand the
    // user; guide them to the live magic-link / OAuth paths instead.
    signInEmail.and.resolveTo({ ok: false, error: 'Missing CAPTCHA response' });
    const f = make();
    f.componentInstance.email.set('user@example.com');
    f.componentInstance.password.set('secret');
    await f.componentInstance.submit();
    const err = f.componentInstance.error() ?? '';
    expect(err).toContain('magic link');
    expect(err).not.toContain('CAPTCHA'); // the cryptic raw error is gone
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('sends a magic link and shows the sent state', async () => {
    const f = make();
    f.componentInstance.email.set('user@example.com');
    await f.componentInstance.emailMagicLink();
    expect(sendMagicLink).toHaveBeenCalledWith(
      jasmine.objectContaining({ email: 'user@example.com', callbackURL: '/admin' }),
    );
    expect(f.componentInstance.magicSent()).toBe(true);
  });
});
