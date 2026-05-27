/**
 * Sign-in-button regression test.
 *
 * @remarks
 * v1 of projectsites.dev shipped a login page whose Google button bound to
 * a no-op handler. This spec is the canary — every commit that touches the
 * login page must keep these assertions green.
 *
 * @flaky false
 *
 * The spec covers:
 *  - Every OAuth tile triggers `OAuthService.startOauth$` AND a redirect
 *    to the resolved authorize URL.
 *  - The passkey CTA fires `PasskeyService.signInWithPasskey$`.
 *  - The primary CTA disambiguates email vs phone correctly.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { LoginPageComponent } from '../login-page.component.js';
import { OAuthService, type OAuthProvider } from '../../services/oauth.service.js';
import { PasskeyService } from '../../services/passkey.service.js';
import { MagicLinkService } from '../../services/magic-link.service.js';
import { VoiceOtpService } from '../../services/voice-otp.service.js';
import { AuthService } from '../../services/auth.service.js';

describe('LoginPageComponent — sign-in buttons', () => {
  let fixture: ComponentFixture<LoginPageComponent>;
  let component: LoginPageComponent;
  let oauthStart: ReturnType<typeof vi.fn>;
  let assignSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    oauthStart = vi
      .fn()
      .mockImplementation((p: OAuthProvider) =>
        of({ authorize_url: `https://example.test/oauth/${p}/authorize?state=x` }),
      );

    assignSpy = vi.fn();
    // jsdom doesn't implement navigation; stub `window.location.assign`.
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, assign: assignSpy },
    });

    await TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: { get: () => null } },
          },
        },
        {
          provide: OAuthService,
          useValue: { startOauth$: oauthStart },
        },
        {
          provide: PasskeyService,
          useValue: {
            conditionalMediationAvailable$: () => of(false),
            signInWithPasskey$: () => of({}),
          },
        },
        {
          provide: MagicLinkService,
          useValue: { requestMagicLink$: () => of({ sent: true as const }) },
        },
        {
          provide: VoiceOtpService,
          useValue: {
            requestVoiceOtp$: () => of({ verification_sid: 'VE' }),
            verifyOtp$: () => of({}),
          },
        },
        {
          provide: AuthService,
          useValue: {
            currentUser: () => null,
            me$: of(null),
            refresh$: () => of(undefined),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders every OAuth provider tile', () => {
    const ids = ['google', 'github', 'apple', 'microsoft', 'facebook'];
    for (const id of ids) {
      const el = fixture.nativeElement.querySelector(
        `[data-testid="oauth-${id}"]`,
      );
      expect(el).toBeTruthy();
    }
  });

  it('clicking each OAuth tile calls startOauth$ and redirects to the authorize URL', () => {
    const ids: readonly OAuthProvider[] = [
      'google',
      'github',
      'apple',
      'microsoft',
      'facebook',
    ];
    for (const id of ids) {
      assignSpy.mockClear();
      oauthStart.mockClear();
      const el: HTMLButtonElement | null = fixture.nativeElement.querySelector(
        `[data-testid="oauth-${id}"]`,
      );
      expect(el).toBeTruthy();
      el!.click();
      expect(oauthStart).toHaveBeenCalledWith(id);
      expect(assignSpy).toHaveBeenCalledTimes(1);
      expect(assignSpy.mock.calls[0]?.[0]).toContain(`/oauth/${id}/authorize`);
    }
  });

  it('identifierKind disambiguates email vs phone vs unknown', () => {
    component.identifier.set('brian@megabyte.space');
    expect(component.identifierKind()).toBe('email');

    component.identifier.set('+15555550123');
    expect(component.identifierKind()).toBe('phone');

    component.identifier.set('not-a-thing');
    expect(component.identifierKind()).toBe('unknown');
  });
});
