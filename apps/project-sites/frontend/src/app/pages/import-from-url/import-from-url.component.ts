import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService, type ImportFromUrlResult } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { TelemetryService } from '../../services/telemetry.service';
import { RevealDirective } from '../../directives/reveal.directive';
import { RippleDirective } from '../../animations/ripple.directive';
import { RollingCounterComponent } from '../../components/rolling-counter/rolling-counter.component';

/**
 * One-click site import — paste any URL (Squarespace / Wix / WordPress /
 * plain HTML), watch the worker crawl every advertised page, and route to
 * the existing build-progress view.
 *
 * @remarks
 * The component runs a single `POST /api/sites/import-from-url` round-trip.
 * That endpoint is intentionally synchronous-on-success: it crawls the source
 * during the request (5-15s typical), persists the URL inventory to R2,
 * spins up the AI rebuild workflow, and returns the new `site_id` + a
 * preview payload (page count, homepage title, theme color) so this view
 * can render an instant pre-build summary before routing the user to the
 * waiting screen.
 *
 * The pre-crawl preview is rendered using the `<app-rolling-counter>`
 * primitive for the discovered-URL count — every numeric stat in the
 * cinematic-ui-patterns skill must roll, and the page count is the load-bearing
 * number on this screen. `prefers-reduced-motion` is respected via the
 * counter's built-in fallback (snaps to final value).
 *
 * @example
 * Routed at `/admin/import` (lazy).
 */
@Component({
  selector: 'app-import-from-url',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RevealDirective, RippleDirective, RollingCounterComponent],
  templateUrl: './import-from-url.component.html',
  styleUrl: './import-from-url.component.scss',
})
export class ImportFromUrlComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private telemetry = inject(TelemetryService);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);

  /** Free-text URL input. Bound to the hero input via `ngModel`. */
  url = signal('');
  /** Optional override; the server falls back to scraped `<title>`. */
  businessName = signal('');
  /** Optional subdomain override; defaults to slugified business name. */
  targetSlug = signal('');
  /** UI is `idle | crawling | success | error` — drives button + preview state. */
  state = signal<'idle' | 'crawling' | 'success' | 'error'>('idle');
  /** Last error message surfaced from the worker. */
  errorMessage = signal('');
  /** Pre-crawl preview returned from the worker on success. */
  result = signal<ImportFromUrlResult | null>(null);

  /**
   * True when the form is in a state to fire a request — URL must look
   * plausible (https://… with a dot in the host) and we're not already
   * mid-crawl. Trims whitespace defensively before checking.
   */
  canSubmit = computed(() => {
    if (this.state() === 'crawling') return false;
    const raw = this.url().trim();
    if (raw.length < 8) return false;
    try {
      const u = new URL(raw);
      return /^https?:$/i.test(u.protocol) && u.hostname.includes('.');
    } catch {
      return false;
    }
  });

  /**
   * Submit the import request. Routes to the existing waiting screen on
   * success so the user lands inside the same build-progress UI they would
   * have hit through the standard "Create new site" flow.
   */
  submit(): void {
    if (!this.canSubmit()) return;
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/signin'], { queryParams: { returnUrl: '/admin/import' } });
      return;
    }

    const raw = this.url().trim();
    this.state.set('crawling');
    this.errorMessage.set('');
    this.telemetry.track('import.from_url.submitted', { url_host: this.safeHost(raw) });

    const body = {
      url: raw,
      business_name: this.businessName().trim() || undefined,
      target_slug: this.targetSlug().trim() || undefined,
    };

    this.api.importFromUrl(body).subscribe({
      next: (res) => {
        this.state.set('success');
        this.result.set(res.data);
        this.telemetry.track('import.from_url.succeeded', {
          url_host: this.safeHost(raw),
          url_count: res.data.source_url_count,
          slug: res.data.slug,
        });
        this.toast.success(`Discovered ${res.data.source_url_count} pages. Starting build...`);
        // Brief pause so the user sees the preview animate in before we route.
        // Respect prefers-reduced-motion — skip the delay for AT users.
        const delay = this.prefersReducedMotion() ? 0 : 1_400;
        if (isPlatformBrowser(this.platformId)) {
          window.setTimeout(() => {
            this.router.navigate(['/waiting'], {
              queryParams: { id: res.data.site_id, slug: res.data.slug },
            });
          }, delay);
        }
      },
      error: (err) => {
        this.state.set('error');
        const msg = this.extractErrorMessage(err);
        this.errorMessage.set(msg);
        this.telemetry.track('import.from_url.failed', {
          url_host: this.safeHost(raw),
          reason: msg.slice(0, 120),
        });
      },
    });
  }

  /** Reset back to the input pane after an error. */
  retry(): void {
    this.state.set('idle');
    this.errorMessage.set('');
    this.result.set(null);
  }

  /** Strip the host portion of a URL safely — for telemetry tagging. */
  private safeHost(raw: string): string {
    try {
      return new URL(raw).host;
    } catch {
      return '';
    }
  }

  /** Best-effort message extraction matching the worker's error envelope. */
  private extractErrorMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'error' in err) {
      const inner = (err as { error?: { error?: { message?: string }; message?: string } }).error;
      if (inner?.error?.message) return inner.error.message;
      if (inner?.message) return inner.message;
    }
    if (err && typeof err === 'object' && 'message' in err) {
      const m = (err as { message?: string }).message;
      if (typeof m === 'string') return m;
    }
    return 'Import failed. Please double-check the URL and try again.';
  }

  /** WCAG 2.2 — never animate when the user has asked the OS not to. */
  private prefersReducedMotion(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  /** Render-helper — used by the template to enumerate by_source rows. */
  bySourceEntries(): Array<{ key: string; label: string; count: number }> {
    const r = this.result();
    if (!r) return [];
    const labels: Record<string, string> = {
      sitemap: 'sitemap.xml',
      robots: 'robots.txt',
      wayback: 'Wayback archive',
      html_bfs: 'Homepage crawl',
    };
    return Object.entries(r.preview.by_source).map(([key, count]) => ({
      key,
      label: labels[key] ?? key,
      count,
    }));
  }
}
