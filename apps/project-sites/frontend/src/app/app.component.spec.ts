import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { AppComponent } from './app.component';
import { AuthService } from './services/auth.service';
import { ApiService } from './services/api.service';
import { MetaService } from './services/meta.service';
import { AppShellService } from './services/app-shell.service';
import { TelemetryService } from './services/telemetry.service';
import { TranslateService } from '@ngx-translate/core';

/**
 * Shell contract for AppComponent — the app root that wraps every route. Locks:
 *  - the WCAG 2.4.1 skip-to-content link exists, is the first focusable element,
 *    and targets the #main-content landmark (a regression here silently breaks
 *    keyboard bypass for the whole app)
 *  - the single <main id="main-content" role="main"> landmark is present
 *  - isHeaderlessRoute logic: '/', /admin, /billing, /editor own their chrome
 *
 * ngOnInit is benign under test: AuthService.isLoggedIn()=false short-circuits
 * restoreSession, matchMedia('(hover: hover)') is false in headless so the cursor
 * follower never attaches, and window.location.search is empty so handleAuthCallback
 * is a no-op.
 */
function build(): ComponentFixture<AppComponent> {
  TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { isLoggedIn: () => false, getSelectedBusiness: () => null, getMode: () => 'create', setSession: () => undefined } },
      { provide: ApiService, useValue: { getMe: () => of({ data: null }), post: () => of({}) } },
      { provide: MetaService, useValue: { init: () => undefined } },
      { provide: AppShellService, useValue: { applyLanguage: () => undefined } },
      { provide: TelemetryService, useValue: { init: () => undefined, pageView: () => undefined, track: () => undefined, identify: () => undefined } },
      { provide: TranslateService, useValue: { currentLang: 'en', onLangChange: new Subject() } },
    ],
  });
  const fixture = TestBed.createComponent(AppComponent);
  fixture.detectChanges();
  return fixture;
}

describe('AppComponent (shell a11y + chrome contract)', () => {
  let fixture: ComponentFixture<AppComponent>;
  let host: HTMLElement;

  beforeEach(() => {
    fixture = build();
    host = fixture.nativeElement as HTMLElement;
  });
  afterEach(() => {
    fixture.destroy(); // triggers ngOnDestroy cleanup (cursor listeners etc.)
    TestBed.resetTestingModule();
  });

  it('renders a skip-to-content link as the first element, targeting #main-content', () => {
    const skip = host.querySelector('a.skip-link') as HTMLAnchorElement | null;
    expect(skip).not.toBeNull();
    expect(skip?.getAttribute('href')).toBe('#main-content');
    // It must be the first focusable element in the DOM order (before header).
    const firstAnchor = host.querySelector('a');
    expect(firstAnchor).toBe(skip);
  });

  it('exposes the single <main id="main-content" role="main" tabindex="-1"> landmark', () => {
    const mains = host.querySelectorAll('main');
    expect(mains.length).toBe(1);
    const main = mains[0];
    expect(main.id).toBe('main-content');
    expect(main.getAttribute('role')).toBe('main');
    // tabindex=-1 so the skip-link can MOVE focus here (a <main> isn't natively
    // focusable) — without it the skip link only scrolls, focus falls to body.
    expect(main.getAttribute('tabindex')).toBe('-1');
  });

  it('treats homepage + admin/billing/editor as headerless (their own chrome)', () => {
    const c = fixture.componentInstance as unknown as { isHeaderlessRoute(u: string): boolean };
    expect(c.isHeaderlessRoute('/')).toBe(true);
    expect(c.isHeaderlessRoute('/admin/snapshots')).toBe(true);
    expect(c.isHeaderlessRoute('/billing')).toBe(true);
    expect(c.isHeaderlessRoute('/editor/abc')).toBe(true);
    expect(c.isHeaderlessRoute('/blog')).toBe(false); // marketing route keeps the shared header
  });
});
