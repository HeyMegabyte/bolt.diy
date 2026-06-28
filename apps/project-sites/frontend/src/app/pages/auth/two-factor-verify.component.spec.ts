import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TwoFactorVerifyComponent } from './two-factor-verify.component';
import { AuthApiService } from './auth-api.service';

describe('TwoFactorVerifyComponent', () => {
  let authApi: jasmine.SpyObj<AuthApiService>;

  beforeEach(async () => {
    authApi = jasmine.createSpyObj<AuthApiService>('AuthApiService', ['verifyTotp']);

    await TestBed.configureTestingModule({
      imports: [TwoFactorVerifyComponent],
      // provideRouter([]) — components with routerLink fail NG0201 without it.
      providers: [provideRouter([]), { provide: AuthApiService, useValue: authApi }],
    }).compileComponents();
  });

  function create() {
    const fixture = TestBed.createComponent(TwoFactorVerifyComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the challenge page with the trust-device checkbox', () => {
    const fixture = create();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="two-factor-verify-page"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="two-factor-verify-code"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="two-factor-verify-trust"]')).toBeTruthy();
  });

  it('blocks submit() on an invalid code (submit guard)', async () => {
    const fixture = create();
    const cmp = fixture.componentInstance;
    cmp.code.set('99');
    await cmp.submit();
    expect(authApi.verifyTotp).not.toHaveBeenCalled();
    expect(cmp.showCodeError()).toBeTrue();
  });

  it('passes trustDevice: true when the checkbox is checked', async () => {
    authApi.verifyTotp.and.resolveTo({ ok: true, data: { status: true } });
    const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl');

    const fixture = create();
    const cmp = fixture.componentInstance;
    cmp.code.set('654321');
    cmp.trustDevice.set(true);
    await cmp.submit();

    expect(authApi.verifyTotp).toHaveBeenCalledWith({ code: '654321', trustDevice: true });
    expect(cmp.success()).toBeTrue();
    expect(navigate).toHaveBeenCalledWith('/admin');
  });

  it('passes trustDevice: false when the checkbox is unchecked', async () => {
    authApi.verifyTotp.and.resolveTo({ ok: true, data: { status: true } });
    spyOn(TestBed.inject(Router), 'navigateByUrl');

    const fixture = create();
    const cmp = fixture.componentInstance;
    cmp.code.set('111222');
    await cmp.submit();

    expect(authApi.verifyTotp).toHaveBeenCalledWith({ code: '111222', trustDevice: false });
  });

  it('surfaces the error and does not navigate when verify fails', async () => {
    authApi.verifyTotp.and.resolveTo({ ok: false, error: 'Invalid code.' });
    const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl');

    const fixture = create();
    const cmp = fixture.componentInstance;
    cmp.code.set('000000');
    await cmp.submit();

    expect(cmp.error()).toBe('Invalid code.');
    expect(cmp.success()).toBeFalse();
    expect(navigate).not.toHaveBeenCalled();
  });
});
