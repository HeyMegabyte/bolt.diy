import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SignUpComponent } from './sign-up.component';
import { AuthApiService } from './auth-api.service';

describe('SignUpComponent', () => {
  const signUpEmail = jasmine.createSpy('signUpEmail');
  let navigateByUrl: jasmine.Spy;

  function make() {
    TestBed.configureTestingModule({
      imports: [SignUpComponent],
      providers: [
        { provide: AuthApiService, useValue: { signUpEmail } },
        provideRouter([]),
      ],
    });
    const f = TestBed.createComponent(SignUpComponent);
    navigateByUrl = spyOn(TestBed.inject(Router), 'navigateByUrl');
    f.detectChanges();
    return f;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    signUpEmail.calls.reset();
    signUpEmail.and.resolveTo({ ok: true, data: {} });
  });

  it('renders name + email + password inputs and submit', () => {
    const f = make();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="sign-up-page"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sign-up-name"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sign-up-email"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sign-up-password"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="sign-up-submit"]')).toBeTruthy();
  });

  it('keeps submit disabled until name + email + 8-char password are valid', () => {
    const f = make();
    const btn = f.nativeElement.querySelector(
      '[data-testid="sign-up-submit"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    f.componentInstance.name.set('Jane Doe');
    f.componentInstance.email.set('jane@example.com');
    f.componentInstance.password.set('short');
    f.detectChanges();
    expect(btn.disabled).toBe(true); // password too short

    f.componentInstance.password.set('longenough');
    f.detectChanges();
    expect(btn.disabled).toBe(false);
  });

  it('does not call the API when submit fires while invalid', async () => {
    const f = make();
    await f.componentInstance.submit();
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it('registers and navigates to /admin on success', async () => {
    const f = make();
    f.componentInstance.name.set('Jane Doe');
    f.componentInstance.email.set('jane@example.com');
    f.componentInstance.password.set('longenough');
    await f.componentInstance.submit();
    expect(signUpEmail).toHaveBeenCalledWith({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'longenough',
    });
    expect(navigateByUrl).toHaveBeenCalledWith('/admin');
  });

  it('surfaces the error on a failed sign-up', async () => {
    signUpEmail.and.resolveTo({ ok: false, error: 'Email already in use.' });
    const f = make();
    f.componentInstance.name.set('Jane Doe');
    f.componentInstance.email.set('jane@example.com');
    f.componentInstance.password.set('longenough');
    await f.componentInstance.submit();
    expect(f.componentInstance.error()).toBe('Email already in use.');
    expect(navigateByUrl).not.toHaveBeenCalled();
  });
});
