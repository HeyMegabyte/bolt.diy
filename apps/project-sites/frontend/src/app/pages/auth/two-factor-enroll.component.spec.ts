import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TwoFactorEnrollComponent } from './two-factor-enroll.component';
import { AuthApiService } from './auth-api.service';

describe('TwoFactorEnrollComponent', () => {
  let authApi: jasmine.SpyObj<AuthApiService>;

  beforeEach(async () => {
    authApi = jasmine.createSpyObj<AuthApiService>('AuthApiService', [
      'enableTwoFactor',
      'verifyTotp',
    ]);

    await TestBed.configureTestingModule({
      imports: [TwoFactorEnrollComponent],
      // provideRouter([]) — components with routerLink fail NG0201 without it.
      providers: [provideRouter([]), { provide: AuthApiService, useValue: authApi }],
    }).compileComponents();
  });

  function create() {
    const fixture = TestBed.createComponent(TwoFactorEnrollComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the enrollment page (stage 1)', () => {
    const fixture = create();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="two-factor-enroll-page"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="two-factor-enroll-password"]')).toBeTruthy();
    // secret/code stage is hidden until enable() succeeds
    expect(el.querySelector('[data-testid="two-factor-enroll-secret"]')).toBeNull();
  });

  it('blocks enable() until a password is entered (submit guard)', async () => {
    const fixture = create();
    const cmp = fixture.componentInstance;

    await cmp.enable();
    expect(authApi.enableTwoFactor).not.toHaveBeenCalled();
    expect(cmp.showPasswordError()).toBeTrue();
  });

  it('reveals the parsed secret + backup codes after enable()', async () => {
    authApi.enableTwoFactor.and.resolveTo({
      ok: true,
      data: {
        totpURI: 'otpauth://totp/App:me?secret=JBSWY3DPEHPK3PXP&issuer=App',
        backupCodes: ['aaaa-bbbb', 'cccc-dddd'],
      },
    });

    const fixture = create();
    const cmp = fixture.componentInstance;
    cmp.password.set('hunter2');
    await cmp.enable();
    fixture.detectChanges();

    expect(authApi.enableTwoFactor).toHaveBeenCalledWith({ password: 'hunter2' });
    expect(cmp.secret()).toBe('JBSWY3DPEHPK3PXP');
    expect(cmp.backupCodes().length).toBe(2);

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="two-factor-enroll-secret"]')?.textContent).toContain(
      'JBSWY3DPEHPK3PXP',
    );
    expect(el.querySelector('[data-testid="two-factor-enroll-backup-codes"]')).toBeTruthy();
  });

  it('surfaces the error when enable() fails', async () => {
    authApi.enableTwoFactor.and.resolveTo({ ok: false, error: 'Wrong password.' });

    const fixture = create();
    const cmp = fixture.componentInstance;
    cmp.password.set('nope');
    await cmp.enable();

    expect(cmp.error()).toBe('Wrong password.');
    expect(cmp.secret()).toBe('');
  });

  it('confirms enrollment with a valid 6-digit code', async () => {
    authApi.enableTwoFactor.and.resolveTo({
      ok: true,
      data: { totpURI: 'otpauth://totp/App:me?secret=SECRET123', backupCodes: [] },
    });
    authApi.verifyTotp.and.resolveTo({ ok: true, data: { status: true } });

    const fixture = create();
    const cmp = fixture.componentInstance;
    cmp.password.set('pw');
    await cmp.enable();

    cmp.code.set('123456');
    await cmp.confirm();

    expect(authApi.verifyTotp).toHaveBeenCalledWith({ code: '123456' });
    expect(cmp.confirmed()).toBeTrue();
  });

  it('blocks confirm() on an invalid code (submit guard)', async () => {
    const fixture = create();
    const cmp = fixture.componentInstance;
    cmp.code.set('12');
    await cmp.confirm();
    expect(authApi.verifyTotp).not.toHaveBeenCalled();
  });
});
