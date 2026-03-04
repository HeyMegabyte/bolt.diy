import { Component, inject, computed, signal, HostListener, ElementRef, ViewChild } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { IonHeader, IonToolbar } from '@ionic/angular/standalone';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [IonHeader, IonToolbar],
  template: `
    <ion-header class="app-header">
      <ion-toolbar>
        <a class="logo" (click)="goHome()" slot="start">
          <img src="/logo-icon.svg" alt="Project Sites" width="32" height="32" />
          <span class="brand-text">Project Sites</span>
        </a>
        <div class="nav-links" slot="start">
          @if (isHomepage()) {
            <a class="nav-link" (click)="scrollTo('how-it-works')">How It Works</a>
            <a class="nav-link" (click)="scrollTo('pricing-section')">Pricing</a>
            <a class="nav-link" (click)="scrollTo('faq-section')">FAQ</a>
            <a class="nav-link" (click)="scrollTo('contact-section')">Contact</a>
          }
        </div>
        <div class="header-actions" slot="end">
          @if (auth.isLoggedIn()) {
            <div class="user-menu-wrapper">
              <button #menuTrigger class="user-menu-trigger" (click)="toggleUserMenu($event)" data-testid="user-menu-trigger">
                <span class="user-avatar">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                </span>
                <span class="user-email">{{ auth.email() }}</span>
                <svg class="chevron" [class.open]="userMenuOpen()" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
            </div>
          } @else {
            <button class="header-btn header-btn-signin" (click)="goSignin()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
              Sign In
            </button>
          }
        </div>
      </ion-toolbar>
    </ion-header>
    @if (userMenuOpen()) {
      <div class="user-dropdown" [style.top.px]="dropdownTop()" [style.right.px]="dropdownRight()" (click)="$event.stopPropagation()">
        <button class="dropdown-item" (click)="goAdmin(); closeUserMenu()" data-testid="menu-dashboard">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
          </svg>
          Dashboard
        </button>
        <button class="dropdown-item" (click)="goBilling(); closeUserMenu()" data-testid="menu-billing">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
          </svg>
          Manage Billing
        </button>
        <div class="dropdown-divider"></div>
        <button class="dropdown-item dropdown-item-muted" (click)="logout(); closeUserMenu()" data-testid="menu-signout">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Sign Out
        </button>
      </div>
    }
  `,
  styles: [`
    .app-header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 1000;
    }
    ion-toolbar {
      --background: rgba(0, 0, 0, 0.92);
      --border-color: rgba(0, 229, 255, 0.06);
      --min-height: 60px;
      --padding-start: 24px;
      --padding-end: 24px;
      backdrop-filter: blur(24px);
      box-shadow: 0 1px 12px rgba(0, 0, 0, 0.4);
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      cursor: pointer;
    }
    .logo img { flex-shrink: 0; }
    .brand-text {
      font-size: 1rem;
      font-weight: 700;
      color: #fff;
      letter-spacing: -0.01em;
      white-space: nowrap;
    }
    .nav-links {
      display: flex;
      gap: 6px;
      margin-left: 16px;
    }
    .nav-link {
      color: var(--text-secondary, #b0bec5);
      font-size: 0.82rem;
      font-weight: 500;
      text-decoration: none;
      cursor: pointer;
      padding: 6px 10px;
      border-radius: 6px;
      outline: none;
      transition: color 0.2s, background 0.2s;
    }
    .nav-link:hover {
      color: var(--accent, #00e5ff);
      background: rgba(0, 229, 255, 0.06);
    }
    .nav-link:focus-visible {
      outline: 2px solid var(--accent, #00e5ff);
      outline-offset: 1px;
    }
    .nav-link:active {
      background: rgba(0, 229, 255, 0.10);
      color: var(--accent, #00e5ff);
    }
    @media (max-width: 768px) {
      .nav-links { display: none; }
      .brand-text { display: none; }
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .user-menu-wrapper {
      position: relative;
    }
    .user-menu-trigger {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 12px 5px 6px;
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      cursor: pointer;
      outline: none;
      transition: all 0.2s;
      font-family: var(--font, 'Inter', sans-serif);
    }
    .user-menu-trigger:hover {
      background: rgba(255, 255, 255, 0.07);
      border-color: rgba(0, 229, 255, 0.15);
    }
    .user-menu-trigger:focus-visible {
      outline: 2px solid var(--accent, #00e5ff);
      outline-offset: 2px;
    }
    .user-menu-trigger:active {
      background: rgba(255, 255, 255, 0.09);
    }
    .user-avatar {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: rgba(0, 229, 255, 0.12);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent, #00e5ff);
      flex-shrink: 0;
    }
    .user-email {
      color: rgba(255, 255, 255, 0.75);
      font-size: 0.8rem;
      font-weight: 500;
      max-width: 170px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chevron {
      color: rgba(255, 255, 255, 0.35);
      transition: transform 0.2s;
      flex-shrink: 0;
    }
    .chevron.open {
      transform: rotate(180deg);
    }
    .user-dropdown {
      position: fixed;
      min-width: 200px;
      background: #0a0a14;
      border: 1px solid rgba(0, 229, 255, 0.10);
      border-radius: 12px;
      padding: 4px;
      z-index: 1100;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(0, 229, 255, 0.04);
      animation: dropIn 0.14s ease;
    }
    @keyframes dropIn {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .dropdown-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 14px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: rgba(255, 255, 255, 0.85);
      font-size: 0.82rem;
      font-weight: 500;
      font-family: var(--font, 'Inter', sans-serif);
      cursor: pointer;
      outline: none;
      transition: background 0.12s, color 0.12s;
      text-align: left;
      white-space: nowrap;
    }
    .dropdown-item svg {
      color: rgba(255, 255, 255, 0.4);
      flex-shrink: 0;
      transition: color 0.12s;
    }
    .dropdown-item:hover {
      background: rgba(0, 229, 255, 0.06);
      color: #fff;
    }
    .dropdown-item:hover svg {
      color: var(--accent, #00e5ff);
    }
    .dropdown-item:focus-visible {
      outline: 2px solid var(--accent, #00e5ff);
      outline-offset: -2px;
    }
    .dropdown-item:active {
      background: rgba(0, 229, 255, 0.10);
    }
    .dropdown-item-muted {
      color: rgba(255, 255, 255, 0.45);
    }
    .dropdown-item-muted:hover {
      color: rgba(255, 255, 255, 0.75);
      background: rgba(255, 255, 255, 0.04);
    }
    .dropdown-item-muted:hover svg {
      color: rgba(255, 255, 255, 0.6);
    }
    .dropdown-divider {
      height: 1px;
      background: rgba(255, 255, 255, 0.06);
      margin: 4px 8px;
    }
    .header-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 600;
      font-family: var(--font, 'Inter', sans-serif);
      cursor: pointer;
      border: none;
      outline: none;
      white-space: nowrap;
      transition: all 0.2s;
      svg { flex-shrink: 0; }
    }
    .header-btn:focus-visible {
      outline: 2px solid var(--accent, #00e5ff);
      outline-offset: 2px;
    }
    .header-btn-signin {
      background: linear-gradient(135deg, var(--accent, #00e5ff) 0%, var(--secondary, #00b8d4) 100%);
      color: #000;
      padding: 8px 18px;
    }
    .header-btn-signin:hover {
      filter: brightness(1.12);
      box-shadow: 0 2px 12px rgba(0, 229, 255, 0.35);
    }
    .header-btn-signin:active {
      filter: brightness(0.92);
      transform: scale(0.97);
    }
    @media (max-width: 768px) {
      .user-email { display: none; }
      .chevron { display: none; }
      .user-menu-trigger { padding: 4px; border-radius: 50%; }
    }
    @media (max-width: 480px) {
      .header-btn { padding: 6px 10px; font-size: 0.78rem; }
      .header-btn svg { display: none; }
    }
  `],
})
export class HeaderComponent {
  readonly auth = inject(AuthService);
  private router = inject(Router);

  @ViewChild('menuTrigger', { read: ElementRef }) menuTriggerRef?: ElementRef<HTMLElement>;

  userMenuOpen = signal(false);
  dropdownTop = signal(0);
  dropdownRight = signal(0);

  private currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );

  isHomepage = computed(() => this.currentUrl() === '/');

  toggleUserMenu(event: Event): void {
    event.stopPropagation();
    if (!this.userMenuOpen()) {
      this.updateDropdownPosition();
    }
    this.userMenuOpen.update(v => !v);
  }

  private updateDropdownPosition(): void {
    const el = this.menuTriggerRef?.nativeElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    this.dropdownTop.set(rect.bottom + 8);
    this.dropdownRight.set(window.innerWidth - rect.right);
  }

  @HostListener('document:click')
  closeUserMenu(): void {
    this.userMenuOpen.set(false);
  }

  goHome(): void {
    this.router.navigate(['/']);
  }

  goSignin(): void {
    this.router.navigate(['/signin']);
  }

  goAdmin(): void {
    this.router.navigate(['/admin']);
  }

  goBilling(): void {
    // Navigate to admin with billing action
    this.router.navigate(['/admin'], { queryParams: { action: 'billing' } });
  }

  logout(): void {
    this.auth.clearSession();
    this.router.navigate(['/']);
  }

  scrollTo(sectionClass: string): void {
    const el = document.querySelector(`.${sectionClass}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}
