/**
 * @module pages/roadmap
 *
 * @description
 * Public roadmap page rendered at `/roadmap`. Renders a Trello-style four-column
 * board (Shipped, In Progress, Next Quarter, Future) backed by
 * `GET /api/public/roadmap`. Lazy-loaded from `app.routes.ts`.
 *
 * @remarks
 * - Standalone, OnPush change detection, signals only.
 * - Brand tokens from `_polish.scss`. No hard-coded brand hex codes.
 * - "Suggest a feature" button opens a pre-populated `mailto:` so prospects
 *   can ask for things without an account.
 */
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MetaService } from '../../services/meta.service';

/**
 * Shape returned by `GET /api/public/roadmap`. Mirrors the worker's
 * `RoadmapResponse` interface to keep client/server in lock-step.
 */
interface RoadmapItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: 'shipped' | 'in_progress' | 'planned';
  readonly quarter: string;
}

interface RoadmapApiResponse {
  readonly quarters: readonly {
    readonly quarter: string;
    readonly items: readonly RoadmapItem[];
  }[];
  readonly count: number;
  readonly shipped_count: number;
  readonly in_progress_count: number;
  readonly planned_count: number;
}

interface BoardColumn {
  readonly id: 'shipped' | 'in_progress' | 'next' | 'future';
  readonly title: string;
  readonly description: string;
  readonly items: readonly RoadmapItem[];
}

/**
 * Public roadmap page.
 *
 * @example
 * ```ts
 * // app.routes.ts
 * { path: 'roadmap', loadComponent: () =>
 *   import('./pages/roadmap/roadmap.component').then((m) => m.RoadmapComponent) }
 * ```
 */
@Component({
  selector: 'app-roadmap',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="roadmap-page">
      <div class="roadmap-inner">
        <header class="roadmap-header">
          <p class="eyebrow">Roadmap</p>
          <h1>What we are building next</h1>
          <p class="subtitle">
            Public roadmap for Project Sites. Tracked items move left to right as we ship.
          </p>
          <div class="stats" aria-label="Roadmap counts">
            <div class="stat">
              <span class="stat-num">{{ shippedCount() }}</span>
              <span class="stat-label">Shipped</span>
            </div>
            <div class="stat">
              <span class="stat-num">{{ inProgressCount() }}</span>
              <span class="stat-label">In progress</span>
            </div>
            <div class="stat">
              <span class="stat-num">{{ plannedCount() }}</span>
              <span class="stat-label">Planned</span>
            </div>
          </div>
          <div class="cta-row">
            <a class="cta-primary" [href]="suggestMailto" rel="noopener">
              Suggest a feature
            </a>
            <a class="cta-secondary" routerLink="/changelog">Read the changelog</a>
          </div>
        </header>

        @if (loading()) {
          <p class="state-msg">Loading roadmap…</p>
        } @else if (error()) {
          <p class="state-msg state-error">{{ error() }}</p>
        } @else {
          <div class="board" role="list">
            @for (col of columns(); track col.id) {
              <article class="column" role="listitem" [attr.data-col]="col.id">
                <header class="column-head">
                  <h2>{{ col.title }}</h2>
                  <span class="count-pill">{{ col.items.length }}</span>
                </header>
                <p class="column-desc">{{ col.description }}</p>
                <div class="card-stack">
                  @for (item of col.items; track item.id) {
                    <div class="card" [attr.data-status]="item.status">
                      <div class="card-top">
                        <span class="quarter-tag">{{ item.quarter }}</span>
                        <span class="status-dot" [attr.data-status]="item.status"></span>
                      </div>
                      <h3 class="card-title">{{ item.title }}</h3>
                      <p class="card-desc">{{ item.description }}</p>
                    </div>
                  } @empty {
                    <p class="empty-col">Nothing here yet.</p>
                  }
                </div>
              </article>
            }
          </div>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        background: var(--ps-bg, #060610);
        color: var(--ps-ink, #f4f4ff);
      }

      .roadmap-page {
        min-height: calc(100vh - 60px);
        padding: 56px 24px 96px;
      }

      .roadmap-inner {
        max-width: 1280px;
        margin: 0 auto;
      }

      .roadmap-header {
        text-align: center;
        margin-bottom: 48px;
      }

      .eyebrow {
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--ps-accent, #00e5ff);
        margin: 0 0 12px;
      }

      h1 {
        font-size: clamp(2rem, 5vw, 3.25rem);
        font-weight: 800;
        letter-spacing: -0.03em;
        margin: 0 0 14px;
        background: linear-gradient(
          135deg,
          var(--ps-ink, #f4f4ff) 0%,
          color-mix(in oklch, var(--ps-accent, #00e5ff) 70%, var(--ps-ink, #f4f4ff)) 100%
        );
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .subtitle {
        font-size: 1.05rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent);
        max-width: 640px;
        margin: 0 auto 28px;
        line-height: 1.55;
      }

      .stats {
        display: inline-flex;
        gap: 36px;
        padding: 14px 28px;
        border-radius: var(--ps-radius-xl, 22px);
        background: color-mix(in oklch, var(--ps-bg, #060610) 92%, var(--ps-accent, #00e5ff));
        border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 18%, transparent);
        margin-bottom: 24px;
      }

      .stat {
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .stat-num {
        font-size: 1.6rem;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        color: var(--ps-ink, #f4f4ff);
      }

      .stat-label {
        font-size: 0.7rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
        margin-top: 2px;
      }

      .cta-row {
        display: flex;
        gap: 12px;
        justify-content: center;
        flex-wrap: wrap;
        margin-top: 8px;
      }

      .cta-primary,
      .cta-secondary {
        display: inline-flex;
        align-items: center;
        padding: 10px 22px;
        border-radius: 999px;
        font-size: 0.92rem;
        font-weight: 600;
        text-decoration: none;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }

      .cta-primary {
        color: var(--ps-bg, #060610);
        background: var(--ps-accent, #00e5ff);
      }

      .cta-primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 28px color-mix(in oklch, var(--ps-accent, #00e5ff) 35%, transparent);
      }

      .cta-secondary {
        color: var(--ps-ink, #f4f4ff);
        background: transparent;
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 20%, transparent);
      }

      .cta-secondary:hover {
        border-color: var(--ps-accent, #00e5ff);
        color: var(--ps-accent, #00e5ff);
      }

      .state-msg {
        text-align: center;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent);
        padding: 60px 0;
      }

      .state-error {
        color: #f87171;
      }

      .board {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 18px;
      }

      @media (max-width: 1024px) {
        .board {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 600px) {
        .board {
          grid-template-columns: 1fr;
        }
      }

      .column {
        background: color-mix(in oklch, var(--ps-bg, #060610) 88%, var(--ps-ink, #f4f4ff));
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 8%, transparent);
        border-radius: var(--ps-radius-xl, 22px);
        padding: 20px 18px 22px;
        display: flex;
        flex-direction: column;
      }

      .column[data-col='shipped'] {
        border-top: 3px solid #22c55e;
      }

      .column[data-col='in_progress'] {
        border-top: 3px solid var(--ps-accent, #00e5ff);
      }

      .column[data-col='next'] {
        border-top: 3px solid #a78bfa;
      }

      .column[data-col='future'] {
        border-top: 3px solid #64748b;
      }

      .column-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 4px;
      }

      .column h2 {
        font-size: 1rem;
        font-weight: 700;
        margin: 0;
        letter-spacing: -0.01em;
      }

      .count-pill {
        font-size: 0.7rem;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 999px;
        background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent);
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 75%, transparent);
        font-variant-numeric: tabular-nums;
      }

      .column-desc {
        font-size: 0.78rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent);
        margin: 6px 0 16px;
        line-height: 1.5;
      }

      .card-stack {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .card {
        padding: 14px 14px 16px;
        background: color-mix(in oklch, var(--ps-bg, #060610) 70%, var(--ps-ink, #f4f4ff));
        border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 7%, transparent);
        border-radius: 12px;
        transition: transform 0.2s ease, border-color 0.2s ease;
      }

      .card:hover {
        transform: translateY(-2px);
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 35%, transparent);
      }

      .card-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }

      .quarter-tag {
        font-size: 0.68rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
        font-weight: 600;
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }

      .status-dot[data-status='shipped'] {
        background: #22c55e;
        box-shadow: 0 0 8px #22c55e80;
      }

      .status-dot[data-status='in_progress'] {
        background: var(--ps-accent, #00e5ff);
        box-shadow: 0 0 8px color-mix(in oklch, var(--ps-accent, #00e5ff) 70%, transparent);
        animation: pulse 1.8s infinite ease-in-out;
      }

      .status-dot[data-status='planned'] {
        background: #a78bfa;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }

      .card-title {
        font-size: 0.95rem;
        font-weight: 700;
        margin: 0 0 6px;
        line-height: 1.3;
        color: var(--ps-ink, #f4f4ff);
      }

      .card-desc {
        font-size: 0.82rem;
        line-height: 1.5;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 70%, transparent);
        margin: 0;
      }

      .empty-col {
        font-size: 0.78rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 40%, transparent);
        font-style: italic;
        padding: 8px 0;
        margin: 0;
      }

      @media (prefers-reduced-motion: reduce) {
        .card,
        .cta-primary {
          transition: none;
        }
        .status-dot[data-status='in_progress'] {
          animation: none;
        }
      }
    `,
  ],
})
export class RoadmapComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly meta = inject(MetaService);

  /** Loading flag — true between component mount and the first fetch resolution. */
  protected readonly loading = signal<boolean>(true);
  /** Populated when the HTTP fetch fails so the template can render the empty state. */
  protected readonly error = signal<string | null>(null);
  /** Raw API response. Drives every downstream computed signal. */
  protected readonly response = signal<RoadmapApiResponse | null>(null);

  /** Counts surfaced in the header strip. Default to zero before the fetch resolves. */
  protected readonly shippedCount = computed(() => this.response()?.shipped_count ?? 0);
  protected readonly inProgressCount = computed(() => this.response()?.in_progress_count ?? 0);
  protected readonly plannedCount = computed(() => this.response()?.planned_count ?? 0);

  /**
   * Pre-populated mailto for the "Suggest a feature" CTA. Subject + body are
   * URL-encoded once so the template can bind without per-render work.
   */
  protected readonly suggestMailto =
    'mailto:hey@megabyte.space' +
    '?subject=' +
    encodeURIComponent('Project Sites — Roadmap suggestion') +
    '&body=' +
    encodeURIComponent(
      'Hey,\n\nI would love to see this on the Project Sites roadmap:\n\n— ',
    );

  /**
   * Four-column board derived from the API response. Items are bucketed by
   * status and chronologically grouped within each bucket so the user sees
   * the next quarter's planned work above the long-term backlog.
   */
  protected readonly columns = computed<readonly BoardColumn[]>(() => {
    const data = this.response();
    if (!data) {
      return [];
    }
    const shipped: RoadmapItem[] = [];
    const inProgress: RoadmapItem[] = [];
    const planned: RoadmapItem[] = [];
    for (const quarter of data.quarters) {
      for (const item of quarter.items) {
        if (item.status === 'shipped') shipped.push(item);
        else if (item.status === 'in_progress') inProgress.push(item);
        else planned.push(item);
      }
    }
    const currentQuarter = this.detectCurrentQuarter();
    const next = planned.filter((p) => p.quarter === this.nextQuarter(currentQuarter));
    const future = planned.filter((p) => p.quarter !== this.nextQuarter(currentQuarter));
    return [
      {
        id: 'shipped',
        title: 'Shipped',
        description: 'Live in production today.',
        items: shipped,
      },
      {
        id: 'in_progress',
        title: 'In Progress',
        description: 'Active development this quarter.',
        items: inProgress,
      },
      {
        id: 'next',
        title: 'Next Quarter',
        description: 'Queued for the upcoming release window.',
        items: next.length > 0 ? next : planned.slice(0, 2),
      },
      {
        id: 'future',
        title: 'Future',
        description: 'Long-term direction. Order may change.',
        items: future.length > 0 ? future : planned.slice(2),
      },
    ];
  });

  ngOnInit(): void {
    this.meta.init();
    this.fetchRoadmap();
  }

  /**
   * Fetch the roadmap from the public API. Errors are surfaced via the
   * `error` signal rather than thrown so the user sees a recoverable state.
   */
  private fetchRoadmap(): void {
    this.http.get<RoadmapApiResponse>('/api/public/roadmap').subscribe({
      next: (data) => {
        this.response.set(data);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load roadmap';
        console.warn('[roadmap] fetch failed:', message);
        this.error.set('Could not load the roadmap. Please refresh.');
        this.loading.set(false);
      },
    });
  }

  /**
   * Detect the current calendar quarter as a `Q# YYYY` string so the
   * board can place "next quarter" cards into a dedicated column.
   */
  private detectCurrentQuarter(): string {
    const now = new Date();
    const quarter = Math.floor(now.getMonth() / 3) + 1;
    return `Q${quarter} ${now.getFullYear()}`;
  }

  /**
   * Return the quarter immediately following `current`. Wraps Q4 to Q1 of
   * the next calendar year.
   */
  private nextQuarter(current: string): string {
    const match = current.match(/^Q(\d)\s+(\d{4})$/);
    if (!match) return current;
    const quarter = Number(match[1]);
    const year = Number(match[2]);
    if (quarter === 4) return `Q1 ${year + 1}`;
    return `Q${quarter + 1} ${year}`;
  }
}
