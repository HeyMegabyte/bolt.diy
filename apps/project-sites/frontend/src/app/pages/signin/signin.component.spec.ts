import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router, ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { SigninComponent } from './signin.component';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { TelemetryService } from '../../services/telemetry.service';
import { AuthApiService } from '../auth/auth-api.service';

/**
 * §1/P0 test-harness: wire the /signin UI to the secret-gated worker seam
 * (`POST /api/auth/test-login`). A password field renders ONLY under `?test=1`;
 * submit posts the canonical test email + password, stores the real bearer, and
 * redirects to the sanitized `returnUrl`. The live secret (`E2E_TEST_PASSWORD`)
 * is only needed for the eventual Playwright run — the wiring is Karma-proven
 * here with a mocked ApiService.
 */
describe('SigninComponent — test-login seam wiring (?test=1)', () => {
  let api: { testLogin: jasmine.Spy; sendMagicLink: jasmine.Spy };
  let auth: {
    isLoggedIn: jasmine.Spy;
    setSession: jasmine.Spy;
    getSelectedBusiness: () => null;
    getMode: () => string;
  };
  let toast: { error: jasmine.Spy };
  let authApi: { getSession: jasmine.Spy };

  afterEach(() => TestBed.resetTestingModule());

  function routeStub(params: Record<string, string | null>) {
    return { snapshot: { queryParamMap: { get: (k: string) => params[k] ?? null } } };
  }

  /** Flush the async ngOnInit Better Auth probe (microtasks) deterministically. */
  function flushInit(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function render(
    params: Record<string, string | null>,
    baSession?: { session?: { token?: string }; user?: { email?: string } },
  ): ComponentFixture<SigninComponent> {
    api = {
      testLogin: jasmine
        .createSpy('testLogin')
        .and.returnValue(
          of({
            data: { token: 'tok_1', email: 'brian@megabyte.space', user_id: 'u', org_id: 'o' },
          }),
        ),
      sendMagicLink: jasmine.createSpy('sendMagicLink').and.returnValue(of({ data: {} })),
    };
    auth = {
      isLoggedIn: jasmine.createSpy('isLoggedIn').and.returnValue(false),
      setSession: jasmine.createSpy('setSession'),
      getSelectedBusiness: () => null,
      getMode: () => 'build',
    };
    toast = { error: jasmine.createSpy('error') };
    // Better Auth bridge default: NO cookie session → the legacy form renders.
    authApi = {
      getSession: jasmine
        .createSpy('getSession')
        .and.resolveTo(
          baSession ? { ok: true, data: baSession } : { ok: false, error: 'No session' },
        ),
    };
    TestBed.configureTestingModule({
      imports: [SigninComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
        { provide: TelemetryService, useValue: { track: () => undefined } },
        { provide: AuthApiService, useValue: authApi },
        { provide: ActivatedRoute, useValue: routeStub(params) },
      ],
    });
    const fx = TestBed.createComponent(SigninComponent);
    fx.detectChanges();
    return fx;
  }

  it('hides the test panel without ?test=1', () => {
    const fx = render({});
    expect(fx.componentInstance.testMode()).toBeFalse();
    expect(
      (fx.nativeElement as HTMLElement).querySelector('[data-testid="test-signin-panel"]'),
    ).toBeNull();
  });

  it('shows the test panel when ?test=1', () => {
    const fx = render({ test: '1' });
    expect(fx.componentInstance.testMode()).toBeTrue();
    expect(
      (fx.nativeElement as HTMLElement).querySelector('[data-testid="test-signin-panel"]'),
    ).toBeTruthy();
  });

  it('testSignIn posts email+password, stores the bearer, redirects to returnUrl', () => {
    const fx = render({ test: '1', returnUrl: '/admin/billing' });
    const nav = spyOn(TestBed.inject(Router), 'navigateByUrl');
    const c = fx.componentInstance;
    c.testPassword = 'secret';
    c.testSignIn();
    expect(api.testLogin).toHaveBeenCalledWith('brian@megabyte.space', 'secret');
    expect(auth.setSession).toHaveBeenCalledWith('tok_1', 'brian@megabyte.space');
    expect(nav).toHaveBeenCalledWith('/admin/billing');
  });

  it('blocks submit with an inline error when no password is entered', () => {
    const fx = render({ test: '1' });
    const c = fx.componentInstance;
    c.testPassword = '';
    c.testSignIn();
    expect(api.testLogin).not.toHaveBeenCalled();
    expect(c.inlineError()).toBeTruthy();
  });

  it('surfaces the worker error inline + toast on failure', () => {
    const fx = render({ test: '1' });
    api.testLogin.and.returnValue(
      throwError(() => ({ error: { error: { message: 'Invalid test credentials.' } } })),
    );
    const c = fx.componentInstance;
    c.testPassword = 'wrong';
    c.testSignIn();
    expect(c.inlineError()).toBe('Invalid test credentials.');
    expect(toast.error).toHaveBeenCalled();
  });

  it('bridges a live Better Auth cookie session into a local session and redirects', async () => {
    const fx = render(
      { returnUrl: '/admin/sites' },
      { session: { token: 'ba_tok_1' }, user: { email: 'brian@megabyte.space' } },
    );
    const nav = spyOn(TestBed.inject(Router), 'navigateByUrl');
    await flushInit();
    expect(authApi.getSession).toHaveBeenCalled();
    expect(auth.setSession).toHaveBeenCalledWith('ba_tok_1', 'brian@megabyte.space');
    expect(nav).toHaveBeenCalledWith('/admin/sites');
    expect(fx.componentInstance).toBeTruthy();
  });

  it('leaves the form untouched when no Better Auth session exists', async () => {
    render({});
    await flushInit();
    expect(authApi.getSession).toHaveBeenCalled();
    expect(auth.setSession).not.toHaveBeenCalled();
  });
});
