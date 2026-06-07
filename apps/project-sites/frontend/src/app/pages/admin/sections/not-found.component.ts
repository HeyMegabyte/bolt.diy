import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';

/**
 * Admin-scoped 404 — renders INSIDE the admin shell's router-outlet (the cockpit
 * nav + top-bar stay) instead of letting an unknown `/admin/*` path fall through
 * to the ROOT `**` (the public marketing 404, which drops the user out of the
 * cockpit into a "Search for a business" page).
 *
 * Wired as the LAST child of the `admin` route in app.routes.ts. Angular matches
 * it only when no real admin child matches the path — e.g. a stale bookmark to a
 * renamed route (ai-logs→traces, github→snapshots) or a param-route hit without
 * its param (`/admin/swarm` when the real route is `/admin/swarm/:siteId`).
 *
 * Soft-404: the SPA serves HTTP 200 for unknown routes, so set robots=noindex
 * while mounted (mirrors the public not-found) and restore on SPA nav-away.
 */
@Component({
  selector: 'app-admin-not-found',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="p-7 flex-1 overflow-y-auto max-md:p-4 flex items-center justify-center min-h-[60vh]" data-testid="admin-not-found">
      <div class="anf-card" role="status" aria-live="polite">
        <div class="anf-glyph" aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </div>
        <p class="anf-eyebrow">Error 404</p>
        <h1 class="anf-title glow-h-grad">This admin page doesn't exist</h1>
        <p class="anf-body">
          It may have been renamed or moved, or the link needs a site selected.
          Head back to your dashboard or jump straight to a section.
        </p>
        <div class="anf-actions">
          <a routerLink="/admin" class="btn-gradient" data-testid="admin-not-found-home">Back to dashboard</a>
        </div>
        <nav class="anf-links" aria-label="Jump to an admin section">
          <a routerLink="/admin/sites" class="anf-link">Sites</a>
          <a routerLink="/admin/analytics" class="anf-link">Analytics</a>
          <a routerLink="/admin/feature-flags" class="anf-link">System Admin</a>
          <a routerLink="/admin/snapshots" class="anf-link">Snapshots</a>
        </nav>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .anf-card {
      max-width: 480px; width: 100%; text-align: center;
      padding: 2.5rem 2rem;
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 14%, transparent);
      border-radius: var(--ps-radius-xl, 22px);
      background: color-mix(in oklch, var(--ps-accent, #00e5ff) 3%, transparent);
      animation: anfIn 0.45s ease-out;
    }
    /* Cyan glyph halo — the cockpit empty/error glyph treatment. */
    .anf-glyph {
      width: 60px; height: 60px; margin: 0 auto 1rem;
      display: flex; align-items: center; justify-content: center;
      border-radius: 18px;
      color: var(--ps-accent, #00e5ff);
      background: color-mix(in oklch, var(--ps-accent, #00e5ff) 10%, transparent);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 24%, transparent);
    }
    .anf-eyebrow {
      font-size: 0.66rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--ps-accent, #00e5ff); margin: 0 0 0.4rem;
    }
    .anf-title { font-size: 1.35rem; font-weight: 600; margin: 0 0 0.6rem; }
    .anf-body {
      font-size: 0.88rem; line-height: 1.55; margin: 0 auto 1.5rem; max-width: 380px;
      color: var(--ps-ink-secondary, #94a3b8);
    }
    .anf-actions { margin-bottom: 1.25rem; }
    .anf-links {
      display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center;
      border-top: 1px solid rgba(255,255,255,0.07); padding-top: 1.1rem;
    }
    .anf-link {
      font-size: 0.78rem; padding: 0.4rem 0.85rem; border-radius: 999px;
      color: var(--ps-ink, #f4f4ff); text-decoration: none;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.02);
      transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
    }
    .anf-link:hover {
      color: var(--ps-accent, #00e5ff);
      border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 40%, transparent);
      background: color-mix(in oklch, var(--ps-accent, #00e5ff) 8%, transparent);
    }
    .anf-link:focus-visible {
      outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px;
    }
    @keyframes anfIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @media (prefers-reduced-motion: reduce) { .anf-card { animation: none; } }
  `],
})
export class AdminNotFoundComponent implements OnInit, OnDestroy {
  private title = inject(Title);
  private meta = inject(Meta);
  private previousRobots: string | null = null;

  ngOnInit(): void {
    this.title.setTitle('Admin page not found (404) · ProjectSites');
    this.previousRobots = this.meta.getTag('name="robots"')?.content ?? null;
    this.meta.updateTag({ name: 'robots', content: 'noindex, follow' });
  }

  ngOnDestroy(): void {
    if (this.previousRobots !== null) {
      this.meta.updateTag({ name: 'robots', content: this.previousRobots });
    }
  }
}
