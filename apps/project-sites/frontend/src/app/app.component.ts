import { Component, type OnInit, type OnDestroy, HostListener, inject, signal } from '@angular/core';
import { RouterOutlet, Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { HeaderComponent } from './components/header/header.component';
import { ToastComponent } from './components/toast/toast.component';
import { BgOrbsComponent } from './components/bg-orbs/bg-orbs.component';
import { EasterEggsComponent } from './components/easter-eggs/easter-eggs.component';
import { CommandPaletteComponent } from './components/command-palette/command-palette.component';
import { ShortcutsOverlayComponent } from './components/shortcuts-overlay/shortcuts-overlay.component';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from './services/auth.service';
import { ApiService } from './services/api.service';
import { MetaService } from './services/meta.service';
import { AppShellService, type AppLanguage } from './services/app-shell.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, ToastComponent, BgOrbsComponent, EasterEggsComponent, CommandPaletteComponent, ShortcutsOverlayComponent],
  template: `
    <a class="skip-link" href="#main-content">Skip to main content</a>
    @if (showHeader()) { <app-header role="banner" /> }
    <app-bg-orbs />
    <app-easter-eggs />
    <app-toast />
    @if (showCommandPalette() && !inAdmin()) {
      <app-command-palette
        (closed)="showCommandPalette.set(false)"
        (showShortcuts)="onPaletteShowShortcuts()"
      />
    }
    @if (showShortcuts()) {
      <app-shortcuts-overlay (closed)="showShortcuts.set(false)" />
    }
    <main id="main-content" role="main" class="app" [class.no-pad]="!showHeader()">
      <router-outlet />
    </main>
  `,
  styles: [`
    .app {
      min-height: 100vh;
      padding-top: 64px;
      position: relative;
    }
    .app.no-pad {
      padding-top: 0;
    }
  `],
})
export class AppComponent implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private meta = inject(MetaService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private translate = inject(TranslateService);
  private appShell = inject(AppShellService);

  showHeader = signal(true);
  showCommandPalette = signal(false);
  showShortcuts = signal(false);
  inAdmin = signal(false);

  private cursorFollowerEl?: HTMLElement;
  private cursorAnimationId?: number;
  private cursorListeners: { type: string; handler: EventListener }[] = [];

  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    // Cmd+K / Ctrl+K — toggle command palette EXCEPT inside /admin,
    // which mounts its own richer palette. Two palettes opening at once was
    // a real bug (#4 in the Part 1 brief).
    if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
      if (this.router.url.startsWith('/admin')) return; // let admin's palette handle it
      event.preventDefault();
      this.showCommandPalette.update(v => !v);
      this.showShortcuts.set(false);
      return;
    }
    // '?' — show shortcuts overlay (only when not typing in an input/textarea)
    if (event.key === '?' && !this.isInputFocused()) {
      this.showShortcuts.update(v => !v);
      this.showCommandPalette.set(false);
      return;
    }
    // '/' — focus the first visible search input (only when not typing)
    if (event.key === '/' && !this.isInputFocused()) {
      event.preventDefault();
      const search = document.querySelector<HTMLInputElement>('input[type="text"][placeholder*="earch"]');
      if (search) search.focus();
    }
  }

  /** Show shortcuts from the command palette action */
  onPaletteShowShortcuts(): void {
    this.showCommandPalette.set(false);
    this.showShortcuts.set(true);
  }

  private isInputFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
  }

  ngOnInit(): void {
    this.meta.init();
    this.applyStoredTheme();
    this.cleanupLegacyOnboardingKeys();
    this.handleAuthCallback();
    this.restoreSession();
    this.trackRoute();
    this.initCursorFollower();
    this.wireLanguage();
  }

  /**
   * Keep `<html lang>` in sync with `TranslateService.currentLang` for WCAG
   * 3.1.1 Language of Page. Stamps the initial value and re-applies on every
   * change. Falls back to `'en'` when the translate service has not yet
   * resolved a language.
   */
  private wireLanguage(): void {
    const initial = (this.translate.currentLang as AppLanguage | undefined) ?? 'en';
    this.appShell.applyLanguage(initial === 'es' ? 'es' : 'en');
    this.translate.onLangChange.subscribe((evt: { lang: string }) => {
      const next: AppLanguage = evt.lang === 'es' ? 'es' : 'en';
      this.appShell.applyLanguage(next);
    });
  }

  /** Reads the persisted theme (dark|light|system), density (compact|comfortable|spacious),
   * and high-contrast flag from localStorage and stamps the matching `data-*`
   * attributes on `<html>` at app boot. Without this, /admin/user → Appearance
   * settings would only apply after the user clicks a swatch — refresh or first
   * load would always be dark + comfortable + normal-contrast. */
  private applyStoredTheme(): void {
    const html = document.documentElement;
    try {
      const t = (localStorage.getItem('ps_theme') as 'dark' | 'light' | 'system') || 'dark';
      html.setAttribute('data-theme', t);
    } catch {
      html.setAttribute('data-theme', 'dark');
    }
    try {
      const d = (localStorage.getItem('ps_density') as 'compact' | 'comfortable' | 'spacious') || 'comfortable';
      html.setAttribute('data-density', d);
    } catch { html.setAttribute('data-density', 'comfortable'); }
    try {
      html.setAttribute('data-contrast', localStorage.getItem('ps_contrast') === 'high' ? 'high' : 'normal');
    } catch { html.setAttribute('data-contrast', 'normal'); }
  }

  private cleanupLegacyOnboardingKeys(): void {
    try {
      localStorage.removeItem('ps_onboarding');
      localStorage.removeItem('ps_onboarding_seen');
    } catch {
      // ignore — private mode / quota
    }
  }

  private isHeaderlessRoute(url: string): boolean {
    const path = url.split('?')[0];
    // Homepage has its own nav; admin/billing/editor have their own chrome
    if (path === '/' || path === '') return true;
    return ['/admin', '/billing', '/editor'].some(r => path.startsWith(r));
  }

  private trackRoute(): void {
    // Set initial value
    this.showHeader.set(!this.isHeaderlessRoute(this.router.url));
    this.inAdmin.set(this.router.url.startsWith('/admin'));
    // Listen for route changes
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        this.showHeader.set(!this.isHeaderlessRoute(e.urlAfterRedirects));
        this.inAdmin.set(e.urlAfterRedirects.startsWith('/admin'));
        // Closing the global palette when entering /admin prevents the
        // double-palette regression even if a user toggled it elsewhere.
        if (e.urlAfterRedirects.startsWith('/admin')) this.showCommandPalette.set(false);
      });
  }

  ngOnDestroy(): void {
    // Clean up cursor follower
    for (const { type, handler } of this.cursorListeners) {
      document.removeEventListener(type, handler);
    }
    this.cursorListeners = [];
    if (this.cursorAnimationId != null) {
      cancelAnimationFrame(this.cursorAnimationId);
    }
    this.cursorFollowerEl?.remove();
  }

  private addDocListener(type: string, handler: EventListener): void {
    document.addEventListener(type, handler);
    this.cursorListeners.push({ type, handler });
  }

  private initCursorFollower(): void {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(hover: hover)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Honor the per-user opt-out from /admin/user → Appearance → Cursor follower.
    try { if (localStorage.getItem('ps_cursor') === 'off') return; } catch { /* */ }

    const follower = document.createElement('div');
    follower.className = 'cursor-follower';
    document.body.appendChild(follower);
    this.cursorFollowerEl = follower;

    let mouseX = 0;
    let mouseY = 0;
    let followerX = 0;
    let followerY = 0;

    this.addDocListener('mousemove', (e) => {
      const me = e as MouseEvent;
      mouseX = me.clientX;
      mouseY = me.clientY;
      if (!follower.classList.contains('visible')) {
        follower.classList.add('visible');
      }
    });

    this.addDocListener('mouseleave', () => {
      follower.classList.remove('visible');
    });

    const interactiveSelector = 'a, button, input, textarea, select, [data-tooltip], .search-result, .address-option';
    this.addDocListener('mouseover', (e) => {
      if ((e.target as HTMLElement).closest(interactiveSelector)) {
        follower.classList.add('hover');
      }
    });
    this.addDocListener('mouseout', (e) => {
      if ((e.target as HTMLElement).closest(interactiveSelector)) {
        follower.classList.remove('hover');
      }
    });

    this.addDocListener('click', (e) => {
      const me = e as MouseEvent;
      const ripple = document.createElement('div');
      ripple.className = 'click-ripple';
      ripple.style.left = me.clientX + 'px';
      ripple.style.top = me.clientY + 'px';
      ripple.style.width = '80px';
      ripple.style.height = '80px';
      document.body.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove());
    });

    const animate = () => {
      followerX += (mouseX - followerX) * 0.15;
      followerY += (mouseY - followerY) * 0.15;
      follower.style.left = followerX + 'px';
      follower.style.top = followerY + 'px';
      this.cursorAnimationId = requestAnimationFrame(animate);
    };
    this.cursorAnimationId = requestAnimationFrame(animate);
  }

  private handleAuthCallback(): void {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const email = params.get('email');
    // auth_callback is informational (which provider). token+email is sufficient
    // to establish a session — the earlier requirement caused Google/GitHub OAuth
    // logins to silently drop the session because those callbacks shipped
    // token+email without the marker. Magic-link still ships it, so we keep
    // reading it for analytics + URL cleanup but don't gate session creation on it.
    const authCallback = params.get('auth_callback');

    if (token && email) {
      this.auth.setSession(token, email);
      // Clean URL
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      url.searchParams.delete('email');
      url.searchParams.delete('auth_callback');
      window.history.replaceState({}, '', url.toString());

      // Restore business and navigate
      const business = this.auth.getSelectedBusiness();
      if (business) {
        this.router.navigate(['/create']);
      } else {
        this.router.navigate(['/admin']);
      }
      // Best-effort analytics — never blocks the session.
      if (authCallback) {
        this.api.post('/analytics/track', { event: 'auth.callback', provider: authCallback })
          .subscribe({ error: () => undefined });
      }
    }
  }

  /**
   * Async session validation. Only clears the local session on a definitive
   * 401 (the auth interceptor already handles redirect). Transient errors
   * (network blip, 5xx, timeout) MUST NOT log the user out — that was the
   * "forced re-sign-in on every refresh" bug.
   */
  private restoreSession(): void {
    if (!this.auth.isLoggedIn()) return;
    this.api.getMe().subscribe({
      error: (err: { status?: number }) => {
        // The api.service interceptor already clears + redirects on 401.
        // Anything else (0 = offline, 5xx, timeout) is transient — keep the
        // session so a refresh once connectivity returns Just Works.
        if (err?.status !== 401) {
          // Intentional no-op — leave the local token in place.
        }
      },
    });
  }
}
