import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SignInComponent } from './sign-in.component';
import { AuthApiService } from './auth-api.service';

describe('SignInComponent', () => {
  const signInEmail = jasmine.createSpy('signInEmail');
  const sendMagicLink = jasmine.createSpy('sendMagicLink');
  let navigateByUrl: jasmine.Spy;

  function make() {
    TestBed.configureTestingModule({
      imports: [SignInComponent],
      providers: [
        { provide: AuthApiService, useValue: { signInEmail, sendMagicLink } },
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
    signInEmail.and.resolveTo({ ok: true, data: {} });
    sendMagicLink.and.resolveTo({ ok: true, data: {} });
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

  it('signs in and navigates to /admin on success', async () => {
    const f = make();
    f.componentInstance.email.set('user@example.com');
    f.componentInstance.password.set('secret');
    await f.componentInstance.submit();
    expect(signInEmail).toHaveBeenCalledWith({ email: 'user@example.com', password: 'secret' });
    expect(navigateByUrl).toHaveBeenCalledWith('/admin');
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

  it('sends a magic link and shows the sent state', async () => {
    const f = make();
    f.componentInstance.email.set('user@example.com');
    await f.componentInstance.emailMagicLink();
    expect(sendMagicLink).toHaveBeenCalledWith({ email: 'user@example.com' });
    expect(f.componentInstance.magicSent()).toBe(true);
  });
});
