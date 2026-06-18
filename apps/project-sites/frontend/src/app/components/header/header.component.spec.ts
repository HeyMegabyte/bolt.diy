import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { HeaderComponent } from './header.component';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';

/**
 * §17 deployed-site fix: the global header rendered a "Sign In" button on the
 * /signin page itself — a self-referential dead-end (click it, go nowhere new).
 * The fix swaps that button for real marketing nav (Home / Pricing / Contact)
 * ONLY on /signin; every other logged-out route keeps the useful Sign In CTA.
 */
describe('HeaderComponent (signin: no redundant Sign In link)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(
    loggedIn: boolean,
  ): import('@angular/core/testing').ComponentFixture<HeaderComponent> {
    TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { isLoggedIn: () => loggedIn } },
        {
          provide: ApiService,
          useValue: { get: () => of({ data: [] }), patch: () => of({}), post: () => of({}) },
        },
      ],
    });
    return TestBed.createComponent(HeaderComponent);
  }

  it('on /signin (logged out): hides the redundant Sign In button, shows Home/Pricing/Contact', () => {
    const fx = render(false);
    fx.componentInstance.currentPath.set('/signin');
    fx.detectChanges();
    const el = fx.nativeElement as HTMLElement;

    expect(el.querySelector('.header-signin-btn'))
      .withContext('no self-referential Sign In button on /signin')
      .toBeNull();

    const nav = el.querySelector('[data-testid="header-signin-nav"]');
    expect(nav).withContext('marketing utility nav appears in its place').toBeTruthy();
    const text = nav?.textContent ?? '';
    expect(text).toContain('Home');
    expect(text).toContain('Pricing');
    expect(text).toContain('Contact');

    // Contact must be a valid hyperlink (no dead /contact route exists) — mailto.
    expect(el.querySelector('[data-testid="header-signin-nav"] a[href^="mailto:"]'))
      .withContext('Contact resolves to a real mailto, never a dead route')
      .toBeTruthy();
  });

  it('on other logged-out routes: keeps the Sign In button (not redundant there)', () => {
    const fx = render(false);
    fx.componentInstance.currentPath.set('/blog');
    fx.detectChanges();
    const el = fx.nativeElement as HTMLElement;

    expect(el.querySelector('.header-signin-btn'))
      .withContext('Sign In CTA stays useful away from /signin')
      .toBeTruthy();
    expect(el.querySelector('[data-testid="header-signin-nav"]')).toBeNull();
  });

  it('strips query + fragment when deciding the signin page', () => {
    const fx = render(false);
    fx.componentInstance.currentPath.set('/signin');
    expect(fx.componentInstance.onSigninPage()).withContext('exact path matches').toBeTrue();
    fx.componentInstance.currentPath.set('/developers');
    expect(fx.componentInstance.onSigninPage()).toBeFalse();
  });
});
