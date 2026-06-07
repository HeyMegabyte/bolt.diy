import { Component, computed, inject, type OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { RollingCounterComponent } from '../../../../components/rolling-counter/rolling-counter.component';
import { RevealDirective } from '../../../../directives/reveal.directive';
import { ToastService } from '../../../../services/toast.service';
import { DocsSpecService, renderMarkdown, type Operation } from '../docs.component';

/**
 * `/admin/docs` (no endpoint id) — cinematic API overview.
 *
 * Replaces the previous markdown-only page with a hero stats grid, quick-start,
 * recent additions, and category coverage map. Reads from the shared
 * {@link DocsSpecService} provided by the shell (so it never double-fetches
 * the OpenAPI spec) and from the `/admin/docs/stats` endpoint for the
 * aggregate counters.
 *
 * The lower-half "reference" block is still rendered through `renderMarkdown`
 * so the prose can ship at SPA-deploy speed (R2 push) rather than waiting on
 * a worker deploy.
 *
 * @example
 * ```ts
 * { path: '', component: DocsOverviewComponent }
 * ```
 */
@Component({
  selector: 'app-docs-overview',
  standalone: true,
  imports: [RollingCounterComponent, RevealDirective, RouterLink],
  template: `
    <section class="docs-detail card docs-overview" aria-label="API overview" data-testid="docs-overview-root">

      <!-- ── Hero ────────────────────────────────────────────────── -->
      <header class="ov-hero" appReveal>
        <div class="ov-kicker">API documentation</div>
        <h1 class="ov-title">Build on ProjectSites.</h1>
        <p class="ov-tagline">
          One bearer token, {{ stats()?.total ?? operations().length }} endpoints, zero ceremony. Every call below is signed with your active session — try them inline, copy a cURL, ship.
        </p>
        <div class="ov-hero-actions">
          <a class="ov-btn is-primary" routerLink="/admin/user" fragment="api-keys">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            <span>Grab an API key</span>
          </a>
          <a class="ov-btn is-secondary" href="/api/admin/docs/openapi.json" target="_blank" rel="noopener noreferrer">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10l5-5 5 5"/><path d="M12 5v14"/></svg>
            <span>Raw OpenAPI</span>
          </a>
        </div>
      </header>

      <!-- ── Hero stats grid (4 cards, rolling counters) ─────────── -->
      <div class="ov-stats" appReveal [revealDelay]="80" role="list" aria-label="API stats">
        <div class="ov-stat" role="listitem">
          <div class="ov-stat-label">Total endpoints</div>
          <div class="ov-stat-value"><app-rolling-counter [value]="stats()?.total ?? operations().length" /></div>
          <div class="ov-stat-spark" aria-hidden="true">
            <svg viewBox="0 0 80 22" preserveAspectRatio="none">
              <polyline points="0,18 12,14 24,16 36,9 48,11 60,4 72,6 80,2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>
        <div class="ov-stat" role="listitem">
          <div class="ov-stat-label">Public</div>
          <div class="ov-stat-value is-good"><app-rolling-counter [value]="stats()?.public ?? publicCount()" /></div>
          <div class="ov-stat-foot">Turnstile or open</div>
        </div>
        <div class="ov-stat" role="listitem">
          <div class="ov-stat-label">Authenticated</div>
          <div class="ov-stat-value is-violet"><app-rolling-counter [value]="stats()?.authed ?? authedCount()" /></div>
          <div class="ov-stat-foot">Bearer token required</div>
        </div>
        <div class="ov-stat" role="listitem">
          <div class="ov-stat-label">Rate limited</div>
          <div class="ov-stat-value is-amber"><app-rolling-counter [value]="stats()?.rate_limited ?? rateLimitedCount()" /></div>
          <div class="ov-stat-foot">Custom budgets</div>
        </div>
      </div>

      <!-- ── Quick-start 3 steps ─────────────────────────────────── -->
      <section class="ov-card" appReveal [revealDelay]="160" aria-labelledby="ov-qs-h">
        <header class="ov-card-head">
          <h2 id="ov-qs-h" class="ov-card-h">Quick start</h2>
          <p class="ov-card-sub">Sign in → grab a key → call the API. Three minutes from cold start to a live call.</p>
        </header>
        <ol class="ov-steps">
          <li class="ov-step">
            <div class="ov-step-num">1</div>
            <div class="ov-step-body">
              <div class="ov-step-h">Sign in</div>
              <p>Magic link or Google OAuth — sessions live in <code>localStorage</code> and auto-attach to every call from this explorer.</p>
            </div>
          </li>
          <li class="ov-step">
            <div class="ov-step-num">2</div>
            <div class="ov-step-body">
              <div class="ov-step-h">Mint a programmatic key</div>
              <p>Browser sessions expire when the tab closes; CLIs and CI need a dedicated key from <a routerLink="/admin/user" fragment="api-keys">/admin/user</a>.</p>
            </div>
          </li>
          <li class="ov-step">
            <div class="ov-step-num">3</div>
            <div class="ov-step-body">
              <div class="ov-step-h">Call your first endpoint</div>
              <pre class="ov-snippet"><button class="ov-copy" type="button" (click)="copySnippet(QUICK_CURL, $event)" aria-label="Copy curl snippet">Copy</button><code>{{ QUICK_CURL }}</code></pre>
            </div>
          </li>
        </ol>
      </section>

      <!-- ── Recent additions ────────────────────────────────────── -->
      @if (recentAdditions().length > 0) {
        <section class="ov-card" appReveal [revealDelay]="240" aria-labelledby="ov-recent-h">
          <header class="ov-card-head">
            <h2 id="ov-recent-h" class="ov-card-h">Recently shipped</h2>
            <p class="ov-card-sub">Endpoints added in the last 30 days, newest first.</p>
          </header>
          <ul class="ov-recent">
            @for (r of recentAdditions(); track r.path + r.method) {
              <li class="ov-recent-row">
                <a class="ov-recent-link"
                   [routerLink]="['/admin/docs', operationIdFor(r.method, r.path)]"
                >
                  <span class="method method-{{ r.method.toLowerCase() }}">{{ r.method }}</span>
                  <code class="ov-recent-path">{{ r.path }}</code>
                  @if (r.category) {
                    <span class="ov-recent-cat">{{ r.category }}</span>
                  }
                  <time class="ov-recent-date" [attr.datetime]="r.addedAt">{{ formatRelative(r.addedAt) }}</time>
                </a>
              </li>
            }
          </ul>
        </section>
      }

      <!-- ── Category map ────────────────────────────────────────── -->
      @if (categoryRows().length > 0) {
        <section class="ov-card" appReveal [revealDelay]="320" aria-labelledby="ov-cat-h">
          <header class="ov-card-head">
            <h2 id="ov-cat-h" class="ov-card-h">By category</h2>
            <p class="ov-card-sub">Coverage map — every grouping that appears in the left rail.</p>
          </header>
          <div class="ov-cats">
            @for (c of categoryRows(); track c.name) {
              <div class="ov-cat" [style.--cat-share]="c.share + '%'">
                <div class="ov-cat-h">
                  <span class="ov-cat-name">{{ c.name }}</span>
                  <span class="ov-cat-n"><app-rolling-counter [value]="c.count" /></span>
                </div>
                <div class="ov-cat-bar" aria-hidden="true"><span class="ov-cat-fill"></span></div>
              </div>
            }
          </div>
        </section>
      }

      <!-- ── Versioning + reference markdown (kept, condensed) ───── -->
      <section class="ov-card prose-docs" appReveal [revealDelay]="400" (click)="onMarkdownClick($event)" [innerHTML]="referenceHtml()"></section>

    </section>
  `,
  styles: [`
    :host { display: contents; }

    /* ── Outer detail shell (same shape as endpoint card) ────────── */
    .docs-detail {
      padding: 24px !important;
      display: flex; flex-direction: column; gap: 20px;
      max-height: 78vh; overflow-y: auto;
      scrollbar-width: thin; scrollbar-color: rgba(0,229,255,0.18) transparent;
      border: 1px solid rgba(255,255,255,0.06) !important;
      box-shadow: var(--ps-shadow-md, 0 6px 18px -8px rgba(0, 0, 0, 0.42));
    }
    .docs-detail::-webkit-scrollbar { width: 6px; }
    .docs-detail::-webkit-scrollbar-thumb { background: rgba(0,229,255,0.18); border-radius: 3px; }

    /* ── Hero ────────────────────────────────────────────────────── */
    .ov-hero {
      position: relative;
      padding: 28px 28px 24px;
      border-radius: 16px;
      background:
        radial-gradient(circle at 12% 0%, rgba(0,229,255,0.14), transparent 55%),
        radial-gradient(circle at 92% 100%, rgba(124,58,237,0.16), transparent 55%),
        linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
      border: 1px solid rgba(0,229,255,0.18);
      overflow: hidden;
    }
    .ov-hero::after {
      content: '';
      position: absolute; inset: 0;
      background: linear-gradient(180deg, transparent 70%, rgba(0,229,255,0.04));
      pointer-events: none;
    }
    .ov-kicker {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.62rem; font-weight: 700; letter-spacing: 0.16em;
      text-transform: uppercase; color: var(--ps-accent, #00E5FF);
      margin-bottom: 10px;
    }
    .ov-title {
      margin: 0;
      font-family: 'Sora', ui-sans-serif, system-ui, sans-serif;
      font-size: clamp(1.7rem, 2.4vw + 1rem, 2.8rem);
      font-weight: 800; letter-spacing: -0.025em; line-height: 1.05;
      background: linear-gradient(95deg, #fff 10%, #00E5FF 55%, #7C3AED);
      -webkit-background-clip: text; background-clip: text; color: transparent;
      text-wrap: balance;
    }
    .ov-tagline {
      margin: 12px 0 18px; max-width: 60ch;
      color: rgba(255,255,255,0.78); font-size: 0.92rem; line-height: 1.6;
      text-wrap: pretty;
    }
    .ov-hero-actions { display: inline-flex; gap: 8px; flex-wrap: wrap; }
    .ov-btn {
      display: inline-flex; align-items: center; gap: 7px;
      min-height: 36px; padding: 0 1rem;
      border-radius: 8px; cursor: pointer;
      font-size: 0.8rem; font-weight: 600;
      text-decoration: none;
      transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease, border-color 140ms ease;
    }
    .ov-btn:focus-visible { outline: 2px solid #00E5FF; outline-offset: 2px; }
    .ov-btn.is-primary {
      color: #060610;
      background: linear-gradient(135deg, #00E5FF, #7C3AED);
      border: 1px solid rgba(0,229,255,0.55);
      box-shadow: 0 8px 22px -10px rgba(0, 229, 255, 0.65);
    }
    .ov-btn.is-primary:hover { transform: translateY(-1px); box-shadow: 0 12px 28px -10px rgba(0,229,255,0.85); }
    .ov-btn.is-secondary {
      color: rgba(255,255,255,0.78);
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.1);
    }
    .ov-btn.is-secondary:hover { color: #fff; background: rgba(0,229,255,0.08); border-color: rgba(0,229,255,0.32); }

    /* ── Hero stats ──────────────────────────────────────────────── */
    .ov-stats {
      display: grid; gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    }
    .ov-stat {
      position: relative;
      padding: 14px 16px;
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));
      border: 1px solid rgba(255,255,255,0.06);
      backdrop-filter: blur(8px);
      transition: border-color 160ms ease, transform 160ms ease;
    }
    .ov-stat:hover { border-color: rgba(0,229,255,0.28); transform: translateY(-1px); }
    .ov-stat-label {
      font-size: 0.6rem; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: #94a3b8;
    }
    .ov-stat-value {
      margin-top: 4px;
      font-family: 'Sora', ui-sans-serif, system-ui, sans-serif;
      font-size: clamp(1.55rem, 1.4vw + 1rem, 2.1rem);
      font-weight: 700; letter-spacing: -0.02em; color: #fff;
      font-variant-numeric: tabular-nums;
    }
    .ov-stat-value.is-good   { color: #4ade80; }
    .ov-stat-value.is-violet { color: #c084fc; }
    .ov-stat-value.is-amber  { color: #fbbf24; }
    .ov-stat-foot {
      margin-top: 2px;
      font-size: 0.66rem; color: rgba(255,255,255,0.45);
    }
    .ov-stat-spark {
      margin-top: 6px; height: 22px; color: #00E5FF; opacity: 0.7;
    }
    .ov-stat-spark svg { width: 100%; height: 100%; display: block; }

    /* ── Card primitive ──────────────────────────────────────────── */
    .ov-card {
      padding: 20px 22px;
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(255,255,255,0.022), rgba(255,255,255,0.008));
      border: 1px solid rgba(255,255,255,0.06);
    }
    .ov-card-head { margin-bottom: 14px; }
    .ov-card-h {
      margin: 0 0 4px;
      font-family: 'Sora', ui-sans-serif, system-ui, sans-serif;
      font-size: 1.05rem; font-weight: 700; letter-spacing: -0.015em; color: #fff;
    }
    .ov-card-sub { margin: 0; font-size: 0.78rem; color: rgba(255,255,255,0.55); line-height: 1.5; }

    /* ── Quick start steps ───────────────────────────────────────── */
    .ov-steps { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 14px; }
    .ov-step { display: grid; grid-template-columns: 32px 1fr; gap: 14px; align-items: flex-start; }
    .ov-step-num {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 999px;
      background: linear-gradient(135deg, rgba(0,229,255,0.16), rgba(124,58,237,0.16));
      border: 1px solid rgba(0,229,255,0.32);
      color: #00E5FF;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.78rem; font-weight: 700;
    }
    .ov-step-h {
      font-size: 0.84rem; font-weight: 700; color: #fff;
      margin-bottom: 2px;
    }
    .ov-step-body p { margin: 0; font-size: 0.78rem; color: rgba(255,255,255,0.65); line-height: 1.55; }
    .ov-step-body code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.72rem; padding: 1px 6px; border-radius: 4px;
      color: #fff; background: rgba(0,229,255,0.08); border: 1px solid rgba(0,229,255,0.18);
    }
    .ov-step-body a { color: #00E5FF; text-decoration: none; border-bottom: 1px dashed rgba(0,229,255,0.4); }
    .ov-step-body a:hover { border-bottom-color: #00E5FF; color: #fff; }
    .ov-snippet {
      position: relative; margin: 8px 0 0;
      padding: 12px 14px; border-radius: 8px;
      background: rgba(0,0,0,0.32);
      border: 1px solid rgba(255,255,255,0.06);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.74rem; line-height: 1.55; color: #fff;
      overflow: auto;
    }
    .ov-copy {
      position: absolute; top: 6px; right: 6px;
      padding: 3px 8px; border-radius: 5px;
      background: rgba(0,229,255,0.10); color: #00E5FF;
      border: 1px solid rgba(0,229,255,0.28);
      font-size: 0.58rem; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; cursor: pointer;
      transition: background 140ms ease;
    }
    .ov-copy:hover { background: rgba(0,229,255,0.18); color: #fff; }

    /* ── Recent additions list ───────────────────────────────────── */
    .ov-recent { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
    .ov-recent-link {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border-radius: 8px;
      color: rgba(255,255,255,0.78); text-decoration: none;
      transition: background 140ms ease, color 140ms ease;
    }
    .ov-recent-link:hover { background: rgba(0,229,255,0.06); color: #fff; }
    .ov-recent-link:focus-visible { outline: 2px solid #00E5FF; outline-offset: 2px; }
    .ov-recent-path {
      flex: 1; min-width: 0;
      font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.78rem;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .ov-recent-cat {
      font-size: 0.6rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--ps-accent, #00E5FF);
      padding: 2px 6px; border-radius: 4px;
      background: rgba(0,229,255,0.06); border: 1px solid rgba(0,229,255,0.18);
    }
    .ov-recent-date {
      font-size: 0.68rem; color: rgba(255,255,255,0.42);
      font-variant-numeric: tabular-nums; flex-shrink: 0;
    }

    /* ── Category coverage map ───────────────────────────────────── */
    .ov-cats { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .ov-cat { display: flex; flex-direction: column; gap: 6px; }
    .ov-cat-h { display: flex; align-items: baseline; justify-content: space-between; }
    .ov-cat-name { font-size: 0.78rem; font-weight: 600; color: #fff; }
    .ov-cat-n {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.78rem; color: rgba(255,255,255,0.5);
      font-variant-numeric: tabular-nums;
    }
    .ov-cat-bar {
      height: 4px; border-radius: 999px; overflow: hidden;
      background: rgba(255,255,255,0.05);
    }
    .ov-cat-fill {
      display: block; height: 100%;
      width: var(--cat-share, 0%);
      background: linear-gradient(90deg, #00E5FF, #7C3AED);
      border-radius: inherit;
      transition: width 600ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    /* ── Markdown / Prose docs (reference at bottom) ─────────────── */
    :host ::ng-deep .prose-docs { padding: 24px !important; }
    :host ::ng-deep .prose-docs :first-child { margin-top: 0; }
    :host ::ng-deep .prose-docs h2 {
      font-family: 'Sora', ui-sans-serif, system-ui, sans-serif;
      font-size: 1.05rem; font-weight: 700; color: #fff;
      margin: 24px 0 10px;
      letter-spacing: -0.015em; line-height: 1.2;
    }
    :host ::ng-deep .prose-docs h3 {
      position: relative; padding-left: 18px;
      font-family: 'Sora', ui-sans-serif, system-ui, sans-serif;
      font-size: 0.95rem; font-weight: 600; color: #fff;
      margin: 18px 0 6px;
    }
    :host ::ng-deep .prose-docs h3::before {
      content: '#'; position: absolute; left: 0; top: 0;
      font-family: ui-monospace, monospace; color: #00E5FF;
      font-weight: 700; opacity: 0.7;
    }
    :host ::ng-deep .prose-docs p {
      color: #cbd5e1; font-size: 0.85rem; line-height: 1.65;
      margin: 0 0 12px; max-width: 72ch;
    }
    :host ::ng-deep .prose-docs ul { list-style: none; padding-left: 0; margin: 0 0 12px; display: flex; flex-direction: column; gap: 3px; }
    :host ::ng-deep .prose-docs li {
      position: relative; padding-left: 18px;
      color: #cbd5e1; font-size: 0.82rem; line-height: 1.55;
    }
    :host ::ng-deep .prose-docs li::before {
      content: ''; position: absolute; left: 4px; top: 0.65em;
      width: 5px; height: 5px; border-radius: 999px;
      background: #00E5FF; box-shadow: 0 0 6px rgba(0,229,255,0.6);
    }
    :host ::ng-deep .prose-docs code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.78rem;
      background: rgba(0,229,255,0.08); color: #fff;
      padding: 1px 6px; border-radius: 4px;
      border: 1px solid rgba(0,229,255,0.18);
    }
    :host ::ng-deep .prose-docs pre {
      position: relative;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.74rem; line-height: 1.55;
      background: rgba(0,0,0,0.32);
      border: 1px solid rgba(255,255,255,0.06); border-radius: 8px;
      padding: 12px 14px; overflow: auto;
      margin: 8px 0 12px;
    }
    :host ::ng-deep .prose-docs pre code { background: transparent; border: 0; padding: 0; font-size: inherit; color: #fff; }
    :host ::ng-deep .prose-docs pre .copy-code-btn {
      position: absolute; top: 6px; right: 6px;
      padding: 3px 8px; border-radius: 5px;
      background: rgba(0,229,255,0.10); color: #00E5FF;
      border: 1px solid rgba(0,229,255,0.28);
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 0.58rem; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; cursor: pointer;
      opacity: 0; transform: translateY(-2px);
      transition: opacity 140ms ease, transform 140ms ease, background 140ms ease;
    }
    :host ::ng-deep .prose-docs pre:hover .copy-code-btn,
    :host ::ng-deep .prose-docs pre:focus-within .copy-code-btn { opacity: 1; transform: translateY(0); }
    :host ::ng-deep .prose-docs pre .copy-code-btn:hover { background: rgba(0,229,255,0.18); color: #fff; }
    :host ::ng-deep .prose-docs pre .copy-code-btn.is-copied { background: rgba(74,222,128,0.18); color: #4ade80; border-color: rgba(74,222,128,0.32); opacity: 1; }
    :host ::ng-deep .prose-docs a { color: #00E5FF; text-decoration: none; border-bottom: 1px dashed rgba(0,229,255,0.4); }
    :host ::ng-deep .prose-docs a:hover { border-bottom-color: #00E5FF; color: #fff; }
    :host ::ng-deep .prose-docs strong { color: #fff; font-weight: 700; }
    :host ::ng-deep .prose-docs em { color: rgba(255,255,255,0.85); font-style: italic; }

    @media (prefers-reduced-motion: reduce) {
      .ov-stat, .ov-btn { transition: none !important; }
      .ov-cat-fill { transition: none !important; }
    }
  `],
})
export class DocsOverviewComponent implements OnInit {
  private title = inject(Title);
  private meta = inject(Meta);
  private toast = inject(ToastService);
  readonly specService = inject(DocsSpecService);

  /** Copy-paste curl shown in step 3 of the quick-start. */
  readonly QUICK_CURL = `curl -sS https://projectsites.dev/api/auth/me \\
  -H "Authorization: Bearer $PS_TOKEN"`;

  readonly operations = computed<ReadonlyArray<Operation>>(() => this.specService.operations());
  readonly stats = computed(() => this.specService.stats());

  /** Spec-derived fallbacks when the stats endpoint hasn't resolved yet. */
  readonly publicCount = computed<number>(() => this.operations().filter((o) => !o.authRequired).length);
  readonly authedCount = computed<number>(() => this.operations().filter((o) => o.authRequired).length);
  readonly rateLimitedCount = computed<number>(() => this.operations().filter((o) => o.rateLimit !== null).length);

  /** Up to 10 recent additions — joins stats output with the operations list. */
  readonly recentAdditions = computed(() => {
    const fromStats = this.stats()?.recent;
    if (fromStats && fromStats.length > 0) return fromStats;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return this.operations()
      .filter((o) => o.addedAt && Date.parse(o.addedAt) >= cutoff)
      .sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
      .slice(0, 10)
      .map((o) => ({ method: o.method, path: o.path, addedAt: o.addedAt ?? '', category: o.category }));
  });

  /**
   * Category-by-count rows sorted descending. Shares are computed against the
   * largest category so the bar visualises relative weight, not absolute %.
   */
  readonly categoryRows = computed<ReadonlyArray<{ name: string; count: number; share: number }>>(() => {
    const counts = this.stats()?.category_counts ?? this.categoryCountsFromSpec();
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return [];
    const max = entries[0]?.[1] ?? 1;
    return entries.map(([name, count]) => ({ name, count, share: Math.round((count / max) * 100) }));
  });

  /** Lower-prose reference markdown — auth + rate limits + versioning + conventions. */
  readonly referenceHtml = computed<string>(() => renderMarkdown(REFERENCE_MARKDOWN));

  ngOnInit(): void {
    this.title.setTitle('API Docs — ProjectSites');
    this.meta.updateTag({
      name: 'description',
      content: 'ProjectSites API — endpoints, auth, rate limits, quick-start, and a live OpenAPI explorer.',
    });
  }

  /**
   * Lookup the OpenAPI `operationId` for a given `method` + `path`. Falls back
   * to a stable slug so the recent-additions row stays clickable even when
   * the spec hasn't fully hydrated (race on first paint).
   */
  operationIdFor(method: string, path: string): string {
    const op = this.operations().find((o) => o.method === method && o.path === path);
    if (op) return op.operationId;
    return `${method.toLowerCase()}_${path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
  }

  /** Pretty-print a recent-shipped ISO date as "3d ago" / "2w ago". */
  formatRelative(iso: string): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    const diff = Date.now() - t;
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    if (days < 1) return 'today';
    if (days === 1) return '1d ago';
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks === 1) return '1w ago';
    return `${weeks}w ago`;
  }

  /** Copy a snippet to the clipboard and flip the button into a "Copied ✓" state. */
  copySnippet(text: string, ev: Event): void {
    try {
      void navigator.clipboard.writeText(text);
      const btn = ev.target as HTMLButtonElement | null;
      if (btn) {
        const original = btn.textContent ?? 'Copy';
        btn.textContent = 'Copied ✓';
        setTimeout(() => (btn.textContent = original), 1200);
      }
      this.toast.success('Copied');
    } catch {
      this.toast.error('Clipboard unavailable');
    }
  }

  /**
   * Delegated click handler for copy buttons inside the rendered reference
   * markdown. Catches clicks on `.copy-code-btn` inside any `<pre>` block,
   * copies the sibling `<code>` text, and flips the button into a
   * "Copied ✓" state for 1.2s.
   */
  onMarkdownClick(ev: Event): void {
    const t = ev.target as HTMLElement | null;
    if (!t) return;
    const btn = t.closest('button.copy-code-btn') as HTMLButtonElement | null;
    if (!btn) return;
    const pre = btn.closest('pre');
    const code = pre?.querySelector('code');
    const text = code?.textContent ?? '';
    if (!text) return;
    try {
      void navigator.clipboard.writeText(text);
      const original = btn.textContent ?? 'Copy';
      btn.textContent = 'Copied ✓';
      btn.classList.add('is-copied');
      this.toast.success('Copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('is-copied');
      }, 1200);
    } catch {
      this.toast.error('Clipboard unavailable');
    }
  }

  /**
   * Compute category counts purely from the spec when the stats endpoint
   * hasn't resolved yet. Identical shape to `DocsStats.category_counts`.
   */
  private categoryCountsFromSpec(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const op of this.operations()) {
      out[op.category] = (out[op.category] ?? 0) + 1;
    }
    return out;
  }
}

/**
 * Lower-half reference markdown. Hand-written so it ships at SPA-deploy speed
 * (R2 push) rather than worker-deploy speed.
 */
const REFERENCE_MARKDOWN = String.raw`## Authentication

Every authenticated endpoint accepts a bearer token:

` + '```http' + `
Authorization: Bearer ps_sk_live_…
` + '```' + `

Tokens come from one of two places:

- **Browser sessions** — issued by magic-link or Google OAuth and stored in ` + '`localStorage`' + `. The Docs explorer below uses this automatically.
- **Programmatic API keys** — generate dedicated, scoped keys at [/admin/user#api-keys](/admin/user#api-keys). Use these for CLIs, CI jobs, and server-to-server integrations.

## Rate limits

The API is rate-limited to **60 requests per minute per token** by default. Endpoints with custom budgets advertise them in their detail card. Overage returns:

` + '```http' + `
HTTP/1.1 429 Too Many Requests
Retry-After: 18
` + '```' + `

Honor the ` + '`Retry-After`' + ` value — it is seconds (integer), not a date.

## Response shape

Every successful response is JSON with a ` + '`data`' + ` key and an optional ` + '`meta`' + ` block:

` + '```json' + `
{ "data": { "id": "uuid" }, "meta": { "request_id": "req_01HW…" } }
` + '```' + `

Every error is JSON with an ` + '`error`' + ` key. The shape never changes:

` + '```json' + `
{ "error": { "code": "NOT_FOUND", "message": "Site not found", "request_id": "req_01HW…" } }
` + '```' + `

Every response carries an ` + '`X-Request-ID`' + ` header. Quote it when filing support tickets.

## Versioning

The current major version is **v1**. Routes prefixed ` + '`/api/`' + ` follow the stable contract; additive changes (new optional fields, new endpoints, new ` + '`meta`' + ` keys) ship without a version bump. Breaking changes ship behind ` + '`/api/v2/`' + ` and run side-by-side for at least 12 months before the v1 deprecation date.

## Conventions

- **IDs** are UUID v4 strings. Slugs are kebab-case ASCII.
- **Timestamps** are ISO-8601 UTC.
- **Idempotency** — ` + '`POST`' + ` and ` + '`DELETE`' + ` accept an ` + '`Idempotency-Key`' + ` header (any UUID); the same key replays the original response for 24 hours.
`;
