import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { RevealDirective } from '../../../directives/reveal.directive';

/** A navigable top-level admin route + its friendly label (for "Did you mean"). */
export interface AdminRouteHint {
  path: string;
  label: string;
}

/** Top-level admin routes a stale/typo'd URL might be aiming for. */
export const ADMIN_ROUTE_HINTS: AdminRouteHint[] = [
  { path: 'sites', label: 'Sites' },
  { path: 'analytics', label: 'Analytics' },
  { path: 'billing', label: 'Billing' },
  { path: 'audit', label: 'Audit Log' },
  { path: 'snapshots', label: 'Snapshots' },
  { path: 'feature-flags', label: 'Feature Flags' },
  { path: 'site-features', label: 'Features' },
  { path: 'domains', label: 'Domains' },
  { path: 'seo', label: 'SEO' },
  { path: 'pseo', label: 'Programmatic SEO' },
  { path: 'social', label: 'Social' },
  { path: 'voice', label: 'Voice' },
  { path: 'media', label: 'Media' },
  { path: 'inbox', label: 'Inbox' },
  { path: 'forms', label: 'Forms' },
  { path: 'webhooks', label: 'Webhooks' },
  { path: 'api-tokens', label: 'API Tokens' },
  { path: 'apps', label: 'Apps' },
  { path: 'docs', label: 'API Docs' },
  { path: 'traces', label: 'AI Traces' },
  { path: 'ai-endpoints', label: 'AI Endpoints' },
  { path: 'settings', label: 'Settings' },
  { path: 'user', label: 'Account' },
  { path: 'marketplace', label: 'Marketplace' },
  { path: 'trust', label: 'Trust Center' },
  { path: 'enterprise', label: 'Enterprise' },
  { path: 'logs', label: 'Logs' },
  { path: 'bulk-ops', label: 'Bulk Ops' },
  { path: 'deliverability', label: 'Deliverability' },
  { path: 'content-freshness', label: 'Content Freshness' },
];

/** Known renamed routes → current path (stale bookmarks the component comment notes). */
const RENAMED_ROUTES: Record<string, string> = {
  'ai-logs': 'traces',
  github: 'snapshots',
};

/** Classic Levenshtein edit distance — small route-segment strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = Array.from({ length: n + 1 }, (_, i) => i);
  const curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/**
 * Closest real admin route for a stale/typo'd segment, or `null` when nothing is
 * close enough (so a garbage path never gets a misleading guess). Renamed routes
 * map exactly; everything else uses Levenshtein within a length-scaled threshold.
 */
export function suggestRoute(segment: string): AdminRouteHint | null {
  const seg = (segment || '').toLowerCase().trim();
  if (!seg) return null;
  const renamed = RENAMED_ROUTES[seg];
  if (renamed) {
    const hit = ADMIN_ROUTE_HINTS.find((r) => r.path === renamed);
    if (hit) return hit;
  }
  let best: AdminRouteHint | null = null;
  let bestDist = Infinity;
  for (const r of ADMIN_ROUTE_HINTS) {
    const d = levenshtein(seg, r.path);
    if (d < bestDist) {
      bestDist = d;
      best = r;
    }
  }
  const threshold = Math.max(2, Math.floor(seg.length * 0.4));
  return best && bestDist <= threshold ? best : null;
}

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
  imports: [RouterLink, RevealDirective],
  template: `
    <div class="p-7 flex-1 overflow-y-auto max-md:p-4 flex items-center justify-center min-h-[60vh]" data-testid="admin-not-found">
      <div class="anf-card" role="status" aria-live="polite" appReveal>
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
        @if (suggestion) {
          <a [routerLink]="['/admin', suggestion.path]" class="anf-suggest" data-testid="admin-not-found-suggest">
            Did you mean <strong>{{ suggestion.label }}</strong>?
            <span class="anf-suggest-arrow" aria-hidden="true">→</span>
          </a>
        }
        <div class="anf-actions">
          <a routerLink="/admin" class="btn-gradient" data-testid="admin-not-found-home">Back to dashboard</a>
        </div>
        <nav class="anf-links" aria-label="Jump to an admin section">
          <a routerLink="/admin/sites" class="anf-link">Sites</a>
          <a routerLink="/admin/analytics" class="anf-link">Analytics</a>
          <a routerLink="/admin/feature-flags" class="anf-link">Feature Flags</a>
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
    /* "Did you mean" recovery — prominent cyan pill above the generic actions. */
    .anf-suggest {
      display: inline-flex; align-items: center; gap: 0.4rem;
      margin: 0 auto 1.25rem; padding: 0.5rem 1rem;
      font-size: 0.82rem; text-decoration: none;
      color: var(--ps-accent, #00e5ff);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 35%, transparent);
      background: color-mix(in oklch, var(--ps-accent, #00e5ff) 9%, transparent);
      border-radius: 999px;
      transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
    }
    .anf-suggest strong { font-weight: 700; }
    .anf-suggest-arrow { transition: transform 0.18s ease; }
    .anf-suggest:hover {
      border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 55%, transparent);
      background: color-mix(in oklch, var(--ps-accent, #00e5ff) 14%, transparent);
    }
    .anf-suggest:hover .anf-suggest-arrow { transform: translateX(3px); }
    .anf-suggest:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) {
      .anf-suggest, .anf-suggest-arrow { transition: none; }
      .anf-suggest:hover .anf-suggest-arrow { transform: none; }
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
  private router = inject(Router);
  private previousRobots: string | null = null;

  /** Closest real admin route for the attempted (stale/typo'd) path, or null. */
  suggestion: AdminRouteHint | null = null;

  ngOnInit(): void {
    this.title.setTitle('Admin page not found (404) · ProjectSites');
    this.previousRobots = this.meta.getTag('name="robots"')?.content ?? null;
    this.meta.updateTag({ name: 'robots', content: 'noindex, follow' });
    this.suggestion = suggestRoute(this.attemptedSegment());
  }

  /** First path segment after `admin` in the attempted URL (query/fragment stripped). */
  private attemptedSegment(): string {
    const path = this.router.url.split('?')[0].split('#')[0];
    const segs = path.split('/').filter(Boolean);
    const i = segs.indexOf('admin');
    return i >= 0 && segs[i + 1] ? segs[i + 1] : '';
  }

  ngOnDestroy(): void {
    if (this.previousRobots !== null) {
      this.meta.updateTag({ name: 'robots', content: this.previousRobots });
    }
  }
}
