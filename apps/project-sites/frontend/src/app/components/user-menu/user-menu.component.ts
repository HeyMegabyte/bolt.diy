import { Component, inject, signal, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';

/**
 * @module components/user-menu
 *
 * @description
 * The signed-in account indicator: avatar (email initial) + a dropdown with
 * Dashboard / New Site / Billing / Sign Out. Extracted from the shared header
 * so EVERY surface that needs a logged-in indicator (the global header AND the
 * marketing homepage's own nav) renders the identical control — one source of
 * truth, no drift between "the menu on the homepage" and "the menu in admin".
 *
 * @remarks
 * - Self-contained: injects {@link AuthService} for identity + sign-out and
 *   {@link ApiService} only to open the Stripe billing portal.
 * - Closes on any document click (the inner dropdown stops propagation) and on
 *   navigation via each action handler.
 * - Caller decides WHEN to render it (`@if (auth.isLoggedIn())`); this component
 *   assumes a session exists.
 *
 * @example
 * ```html
 * @if (auth.isLoggedIn()) { <app-user-menu /> }
 * ```
 */
@Component({
  selector: 'app-user-menu',
  standalone: true,
  template: `
    <div class="user-menu" (click)="toggleMenu($event)">
      <div class="user-avatar">{{ getInitial() }}</div>
      <svg class="chevron" [class.open]="menuOpen()" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="m6 9 6 6 6-6" />
      </svg>
      @if (menuOpen()) {
        <div class="dropdown" (click)="$event.stopPropagation()" role="menu" aria-label="Account menu">
          <div class="dropdown-header">
            <div class="dropdown-avatar">{{ getInitial() }}</div>
            <div class="dropdown-user-info">
              <span class="dropdown-email">{{ auth.email() }}</span>
              <span class="dropdown-plan">Free Plan</span>
            </div>
          </div>
          <div class="dropdown-divider"></div>
          <button class="dropdown-item" role="menuitem" (click)="goAdmin()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            Dashboard
          </button>
          <button class="dropdown-item" role="menuitem" (click)="goCreate()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Site
          </button>
          <button class="dropdown-item" role="menuitem" (click)="goBilling()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" />
            </svg>
            Billing
          </button>
          <div class="dropdown-divider"></div>
          <button class="dropdown-item logout" role="menuitem" (click)="logout()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign Out
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .user-menu {
      position: relative;
      display: flex; align-items: center; gap: 8px;
      cursor: pointer;
      padding: 4px 10px 4px 4px;
      border-radius: 12px;
      transition: background 0.2s;
    }
    .user-menu:hover {
      background: rgba(0, 212, 255, 0.06);
    }
    .user-avatar {
      width: 34px; height: 34px; border-radius: 50%;
      background: linear-gradient(135deg, #00d4ff, #0891b2);
      display: flex; align-items: center; justify-content: center;
      font-size: 0.85rem; font-weight: 700; color: #050510;
      text-transform: uppercase;
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.15);
      transition: box-shadow 0.3s, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .user-menu:hover .user-avatar {
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35), 0 0 16px rgba(0, 212, 255, 0.15);
      transform: scale(1.05);
    }
    .chevron {
      color: var(--text-muted);
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.2s;
    }
    .chevron.open { transform: rotate(180deg); color: var(--accent); }

    .dropdown {
      position: absolute; top: calc(100% + 10px); right: -4px;
      min-width: 240px;
      background: rgba(10, 10, 32, 0.98);
      backdrop-filter: blur(24px) saturate(1.5);
      -webkit-backdrop-filter: blur(24px) saturate(1.5);
      border: 1px solid rgba(0, 212, 255, 0.1);
      border-radius: 16px;
      padding: 6px;
      box-shadow:
        0 16px 48px rgba(0, 0, 0, 0.5),
        0 0 0 1px rgba(0, 212, 255, 0.06),
        0 0 60px rgba(0, 212, 255, 0.04);
      animation: slideDown 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      z-index: var(--z-popover, 99950);
    }
    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .dropdown-header {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 14px 10px;
    }
    .dropdown-avatar {
      width: 32px; height: 32px; border-radius: 50%;
      background: linear-gradient(135deg, #00d4ff, #0891b2);
      display: flex; align-items: center; justify-content: center;
      font-size: 0.8rem; font-weight: 700; color: #050510;
      text-transform: uppercase; flex-shrink: 0;
    }
    .dropdown-user-info {
      display: flex; flex-direction: column; min-width: 0;
    }
    .dropdown-email {
      font-size: 0.8rem; color: var(--text-primary); font-weight: 500;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .dropdown-plan {
      font-size: 0.68rem; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;
    }
    .dropdown-divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(0, 212, 255, 0.1), transparent);
      margin: 4px 10px;
    }
    .dropdown-item {
      display: flex; align-items: center; gap: 12px;
      width: 100%; padding: 10px 14px;
      border: none; background: transparent;
      color: var(--text-primary); font-size: 0.88rem;
      font-family: var(--font); font-weight: 500; cursor: pointer;
      border-radius: 10px;
      transition: all 0.15s ease;
    }
    .dropdown-item svg {
      color: var(--text-muted);
      transition: color 0.15s, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      flex-shrink: 0;
    }
    .dropdown-item:hover {
      background: rgba(0, 212, 255, 0.08);
      color: var(--accent);
    }
    .dropdown-item:hover svg { color: var(--accent); transform: scale(1.1); }
    .dropdown-item:active { background: rgba(0, 212, 255, 0.12); }
    .dropdown-item:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
    .dropdown-item.logout:hover {
      background: rgba(239, 68, 68, 0.08);
      color: #ef4444;
    }
    .dropdown-item.logout:hover svg { color: #ef4444; }
  `],
})
export class UserMenuComponent {
  readonly auth = inject(AuthService);
  private router = inject(Router);
  private api = inject(ApiService);
  menuOpen = signal(false);

  getInitial(): string {
    const email = this.auth.email();
    return email ? email.charAt(0).toUpperCase() : '?';
  }

  toggleMenu(event: Event): void {
    event.stopPropagation();
    this.menuOpen.update((v) => !v);
  }

  @HostListener('document:click')
  closeMenu(): void {
    if (this.menuOpen()) {
      this.menuOpen.set(false);
    }
  }

  goCreate(): void {
    this.menuOpen.set(false);
    this.router.navigate(['/create']);
  }

  goAdmin(): void {
    this.menuOpen.set(false);
    this.router.navigate(['/admin']);
  }

  goBilling(): void {
    this.menuOpen.set(false);
    // Open the Stripe billing portal; fall back to the admin billing page when
    // the portal URL can't be minted (no subscription yet / API error).
    this.api.getBillingPortal(window.location.href).subscribe({
      next: (res) => {
        if (res.data?.portal_url) window.open(res.data.portal_url, '_blank');
        else this.router.navigate(['/admin/billing']);
      },
      error: () => this.router.navigate(['/admin/billing']),
    });
  }

  logout(): void {
    this.menuOpen.set(false);
    this.auth.logout();
    this.router.navigate(['/']);
  }
}
