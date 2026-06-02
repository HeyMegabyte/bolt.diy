import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NotificationBellComponent } from '../notification-bell/notification-bell.component';
import { UserMenuComponent } from '../user-menu/user-menu.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [NotificationBellComponent, UserMenuComponent],
  template: `
    <header class="header" role="banner">
      <div class="header-inner">
        <a class="logo" (click)="goHome()">
          <img src="/logo-header-icon.png" alt="ProjectSites" width="48" height="48" class="logo-icon" />
          <img src="/logo-text.png" alt="projectsites.dev" height="48" class="logo-text-img" />
        </a>
        <div class="header-right">
          @if (auth.isLoggedIn()) {
            <app-notification-bell />
            <app-user-menu />
          } @else {
            <button class="header-signin-btn" (click)="goSignin()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              Sign In
            </button>
          }
        </div>
      </div>
    </header>
  `,
  styles: [`
    .header {
      position: fixed; top: 0; left: 0; right: 0; z-index: var(--z-header);
      padding: 0 24px; height: 64px; display: flex; align-items: center;
      background: #07071a;
      border-bottom: 1px solid rgba(0, 212, 255, 0.06);
      box-shadow: 0 1px 20px rgba(0, 0, 0, 0.4);
    }
    .header-inner {
      width: 1200px; max-width: 100%; margin: 0 auto;
      display: flex; align-items: center; justify-content: space-between;
    }
    .logo {
      display: flex; align-items: center; gap: 10px;
      text-decoration: none; cursor: pointer;
      transition: opacity 0.2s;
    }
    .logo:hover { opacity: 0.85; }
    .logo:active { opacity: 0.7; }
    .logo-icon {
      flex-shrink: 0;
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease;
      background: transparent;
    }
    .logo:hover .logo-icon { transform: scale(1.05) rotate(-3deg); }
    .logo-text-img {
      flex-shrink: 0;
      /* Match the 48px icon height exactly; render fully opaque per brand-kit rules. */
      height: 48px;
      width: auto;
      opacity: 1;
      transition: none;
    }
    .logo:hover .logo-text-img { opacity: 1; }
    @media (max-width: 480px) {
      .logo-text-img { display: none; }
    }
    .header-right { display: flex; align-items: center; gap: 12px; }

    /* Sign In button */
    .header-signin-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 20px; border-radius: 10px;
      border: 1px solid rgba(0, 212, 255, 0.25);
      background: rgba(0, 212, 255, 0.06);
      color: var(--accent); font-size: 0.85rem; font-weight: 600;
      cursor: pointer; font-family: var(--font);
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }
    .header-signin-btn::before {
      content: '';
      position: absolute; inset: 0;
      background: linear-gradient(135deg, rgba(0, 212, 255, 0.1), transparent);
      opacity: 0;
      transition: opacity 0.3s;
    }
    .header-signin-btn:hover {
      background: rgba(0, 212, 255, 0.12);
      border-color: rgba(0, 212, 255, 0.5);
      box-shadow: 0 0 20px rgba(0, 212, 255, 0.15), inset 0 0 20px rgba(0, 212, 255, 0.05);
      transform: translateY(-1px);
    }
    .header-signin-btn:hover::before { opacity: 1; }
    .header-signin-btn:active {
      transform: translateY(0);
      box-shadow: 0 0 8px rgba(0, 212, 255, 0.1);
    }
    .header-signin-btn svg {
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .header-signin-btn:hover svg { transform: translateX(2px); }
  `],
})
export class HeaderComponent {
  readonly auth = inject(AuthService);
  private router = inject(Router);

  goHome(): void {
    this.router.navigate(['/']);
  }

  goSignin(): void {
    this.router.navigate(['/signin']);
  }
}
