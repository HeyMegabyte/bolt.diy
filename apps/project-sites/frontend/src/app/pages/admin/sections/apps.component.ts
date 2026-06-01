import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  signal,
  type AfterViewInit,
  type OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EmptyStateComponent } from '../empty-state.component';
import { RevealDirective } from '../../../directives/reveal.directive';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { HlmInputDirective } from '../../../ui';
import { BrnTooltipImports } from '@spartan-ng/brain/tooltip';
import {
  APP_CATEGORIES,
  APPS_CATALOG,
  isAppSupported,
  type AppCategory,
  type CatalogApp,
  type InfraDep,
} from './apps-catalog.data';

/** Lifecycle filter — Live=deployable today, soon=catalog-only placeholder. */
type LifecycleFilter = 'all' | 'live' | 'soon';

/**
 * Per-infra-dep glyph + display label for the card pill row. Matches the
 * task brief: 🐘 postgres / 🟥 redis / 🪣 s3 / 💾 sqlite / 📦 volume / 📬 mailrelay.
 */
const INFRA_META: Readonly<Record<InfraDep, { glyph: string; label: string }>> = {
  postgres: { glyph: '🐘', label: 'Postgres' },
  redis: { glyph: '🟥', label: 'Redis' },
  s3: { glyph: '🪣', label: 'R2 / S3' },
  sqlite: { glyph: '💾', label: 'SQLite' },
  volume: { glyph: '📦', label: 'Volume' },
  mailrelay: { glyph: '📬', label: 'Mail relay' },
} as const;

/**
 * Admin → Apps catalog.
 *
 * @remarks
 * Browses the curated self-hostable app catalog (38 apps × 11 categories),
 * filtered live by category chip + fuzzy search. Click a card →
 * `/admin/apps/:id` detail. Cmd+/ focuses the search input.
 */
@Component({
  selector: 'app-admin-apps',
  standalone: true,
  imports: [FormsModule, RouterLink, EmptyStateComponent, RevealDirective, RollingCounterComponent, HlmInputDirective, ...BrnTooltipImports],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- ─────────────────── HERO HEADER ─────────────────── -->
      <header class="flex items-start justify-between gap-4 flex-wrap" appReveal>
        <div class="min-w-0">
          <div class="kicker">App store</div>
          <h2 class="section-h text-lg font-bold text-white m-0 mt-1 flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="text-accent"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            Apps
            <span class="header-pill" aria-label="Catalog size" title="Apps in the catalog">
              <span class="header-pill-dot" aria-hidden="true"></span>
              <app-rolling-counter [value]="totalCount" />&nbsp;apps
            </span>
          </h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1 max-w-prose leading-relaxed">
            Self-hostable services launched on Cloudflare Workers Containers — pick, configure, deploy in &lt;5 min.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <a class="btn-ghost" routerLink="/admin/apps/instances" [brnTooltip]="'View deployed app instances'">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            <span>My instances</span>
          </a>
        </div>
      </header>

      <!-- ─────────────────── SEARCH + CATEGORY CHIPS ─────────────────── -->
      <div class="space-y-3" appReveal>
        <label class="search-wrap" [class.is-focused]="searchFocused()">
          <svg class="search-glyph" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input
            #searchInput
            hlmInput
            [seamless]="true"
            type="search"
            class="flex-1 search-input"
            placeholder="Search apps by name, tagline, or tag…"
            aria-label="Search apps"
            data-testid="apps-search-input"
            [(ngModel)]="searchInputValue"
            (ngModelChange)="onSearchChange($event)"
            (focus)="searchFocused.set(true)"
            (blur)="searchFocused.set(false)"
            (keydown.escape)="clearSearch()" />
          <kbd class="search-kbd" aria-hidden="true">⌘/</kbd>
        </label>

        <!-- Lifecycle pill row (Live vs Coming soon) -->
        <div class="lifecycle-strip" role="tablist" aria-label="App lifecycle">
          <button
            type="button"
            role="tab"
            class="lifecycle-pill"
            [class.active]="lifecycle() === 'all'"
            [attr.aria-selected]="lifecycle() === 'all'"
            data-testid="apps-lifecycle-all"
            (click)="setLifecycle('all')">
            <span>All</span>
            <span class="lifecycle-count" aria-hidden="true">{{ totalCount }}</span>
          </button>
          <button
            type="button"
            role="tab"
            class="lifecycle-pill lifecycle-pill--live"
            [class.active]="lifecycle() === 'live'"
            [attr.aria-selected]="lifecycle() === 'live'"
            data-testid="apps-lifecycle-live"
            (click)="setLifecycle('live')">
            <span class="lifecycle-dot" aria-hidden="true"></span>
            <span>Live</span>
            <span class="lifecycle-count" aria-hidden="true">{{ liveCount }}</span>
          </button>
          <button
            type="button"
            role="tab"
            class="lifecycle-pill lifecycle-pill--soon"
            [class.active]="lifecycle() === 'soon'"
            [attr.aria-selected]="lifecycle() === 'soon'"
            data-testid="apps-lifecycle-soon"
            (click)="setLifecycle('soon')">
            <span>Coming soon</span>
            <span class="lifecycle-count" aria-hidden="true">{{ soonCount }}</span>
          </button>
        </div>

        <div class="chip-strip" role="tablist" aria-label="App category">
          <button
            type="button"
            role="tab"
            class="chip"
            [class.active]="activeCategory() === null"
            [attr.aria-selected]="activeCategory() === null"
            (click)="setCategory(null)">
            <span class="chip-glyph" aria-hidden="true">✨</span>
            <span>All</span>
            <span class="chip-count" aria-hidden="true">{{ totalCount }}</span>
          </button>
          @for (c of categories; track c.id) {
            <button
              type="button"
              role="tab"
              class="chip"
              [class.active]="activeCategory() === c.id"
              [attr.aria-selected]="activeCategory() === c.id"
              [attr.data-testid]="'apps-chip-' + c.id"
              (click)="setCategory(c.id)">
              <span class="chip-glyph" aria-hidden="true">{{ c.glyph }}</span>
              <span>{{ c.label }}</span>
              <span class="chip-count" aria-hidden="true">{{ countByCategory(c.id) }}</span>
            </button>
          }
        </div>
      </div>

      <!-- ─────────────────── GRID ─────────────────── -->
      @if (filteredApps().length === 0) {
        <app-empty-state
          icon="🔭"
          [title]="emptyTitle()"
          body="Try a different category or relax the search query."
          primary="Clear filters"
          (primaryClick)="resetFilters()"
        />
      } @else {
        <div class="apps-grid">
          @for (app of filteredApps(); track app.id) {
            <a
              appReveal
              class="app-card"
              [routerLink]="['/admin/apps', app.id]"
              [attr.data-testid]="'apps-card-' + app.id"
              [attr.aria-label]="app.name + ' — ' + app.tagline">
              <header class="app-card-head">
                <div class="app-glyph" aria-hidden="true">{{ app.glyph }}</div>
                <div class="min-w-0 flex-1">
                  <div class="app-name-row">
                    <div class="app-name">{{ app.name }}</div>
                    @if (isSupported(app.id)) {
                      <span
                        class="status-pill status-pill--live"
                        title="Deployable today — ships an upstream container"
                        aria-label="Live"
                        [attr.data-testid]="'apps-pill-live-' + app.id">
                        <span class="status-dot" aria-hidden="true"></span>
                        Live
                      </span>
                    } @else {
                      <span
                        class="status-pill status-pill--soon"
                        title="Catalog placeholder — runtime container ships in a future drop"
                        aria-label="Coming soon"
                        [attr.data-testid]="'apps-pill-soon-' + app.id">
                        Soon
                      </span>
                    }
                  </div>
                  <div class="app-tag">{{ app.tagline }}</div>
                </div>
              </header>

              @if (app.tags.length > 0) {
                <div class="tag-row">
                  @for (t of app.tags.slice(0, 3); track t) {
                    <span class="tag-pill">{{ t }}</span>
                  }
                  @if (app.tags.length > 3) {
                    <span class="tag-pill tag-pill--more" [title]="app.tags.slice(3).join(', ')">+{{ app.tags.length - 3 }} more</span>
                  }
                </div>
              }

              <div class="infra-row" aria-label="Infrastructure dependencies">
                @for (d of app.infra; track d) {
                  <span class="infra-pill" [title]="infraLabel(d)">
                    <span class="infra-glyph" aria-hidden="true">{{ infraGlyph(d) }}</span>
                    <span>{{ infraLabel(d) }}</span>
                  </span>
                }
                @if (app.infra.length === 0) {
                  <span class="infra-pill infra-pill--bare" title="Stateless container">
                    <span class="infra-glyph" aria-hidden="true">⚡</span>
                    <span>Stateless</span>
                  </span>
                }
              </div>

              <footer class="app-card-foot">
                <span class="mem-pill" title="RAM ceiling">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 6v12M11 6v12M15 6v12M19 6v12"/></svg>
                  {{ app.memoryMB }} MiB
                </span>
                <span class="cost-pill" [title]="'Estimated monthly cost — ' + app.name">
                  <span class="cost-currency" aria-hidden="true">$</span>
                  <app-rolling-counter [value]="app.estCostMonthly" />
                  <span class="cost-unit" aria-hidden="true">/mo</span>
                </span>
              </footer>
            </a>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .kicker {
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.62rem; font-weight: 700; letter-spacing: 0.14em;
      text-transform: uppercase; color: var(--ps-accent, #00E5FF); opacity: 0.85;
    }
    .section-h { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; letter-spacing: -0.02em; }
    .text-accent { color: var(--ps-accent, #00E5FF); }

    .header-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 3px 10px; border-radius: 999px;
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 10%, transparent);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 32%, transparent);
      color: var(--ps-accent, #00E5FF);
      font-family: 'Sora', system-ui, sans-serif;
      font-size: 0.65rem; font-weight: 600; letter-spacing: 0.02em;
    }
    .header-pill-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--ps-accent, #00E5FF);
      box-shadow: 0 0 6px color-mix(in oklch, var(--ps-accent, #00E5FF) 60%, transparent);
    }

    /* ─── Search ─── */
    .search-wrap {
      position: relative;
      display: flex; align-items: center; gap: 8px;
      padding: 0 0.85rem;
      background: rgba(0, 0, 0, 0.32);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: var(--ps-radius-lg, 14px);
      transition: border-color 160ms ease, background 160ms ease;
    }
    .search-wrap.is-focused {
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 45%, transparent);
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 4%, rgba(0, 0, 0, 0.32));
    }
    .search-glyph { color: var(--text-secondary, rgba(255,255,255,0.55)); flex-shrink: 0; }
    /* .search-input base/placeholder now Spartan hlmInput [seamless]; keep only the native search-cancel reset. */
    .search-input::-webkit-search-cancel-button { -webkit-appearance: none; }
    .search-kbd {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.62rem; padding: 2px 6px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 4px; color: rgba(255,255,255,0.55);
      flex-shrink: 0;
    }

    /* ─── Chip strip ─── */
    .chip-strip {
      display: flex; flex-wrap: wrap; gap: 6px;
    }
    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 0.42rem 0.78rem;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: rgba(255, 255, 255, 0.74);
      font-family: 'Sora', system-ui, sans-serif;
      font-size: 0.72rem; font-weight: 600;
      cursor: pointer;
      transition: background 160ms ease, color 160ms ease, border-color 160ms ease, transform 160ms ease;
    }
    .chip:hover {
      background: rgba(255, 255, 255, 0.07);
      color: var(--ps-ink, #fff);
      border-color: rgba(255, 255, 255, 0.16);
    }
    .chip.active {
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 16%, transparent);
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 55%, transparent);
      color: var(--ps-accent, #00E5FF);
      box-shadow: inset 2px 0 0 0 var(--ps-accent, #00E5FF), 0 4px 16px -8px color-mix(in oklch, var(--ps-accent, #00E5FF) 50%, transparent);
    }
    .chip:focus-visible {
      outline: var(--ps-ring-focus, 2px solid #00ffc8);
      outline-offset: 2px;
    }
    .chip-glyph { font-size: 0.86rem; line-height: 1; }
    .chip-count {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.6rem; opacity: 0.7;
      padding: 1px 6px;
      background: rgba(255,255,255,0.06); border-radius: 999px;
    }
    .chip.active .chip-count {
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 22%, transparent);
      opacity: 1;
    }

    /* ─── Grid ─── */
    .apps-grid {
      display: grid; gap: 1rem;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    @media (max-width: 1100px) { .apps-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 680px)  { .apps-grid { grid-template-columns: 1fr; } }

    /* ─── Card ─── */
    .app-card {
      display: flex; flex-direction: column; gap: 0.85rem;
      padding: 1.1rem;
      background: var(--ps-surface-1, rgba(13, 13, 40, 0.62));
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: var(--ps-radius-lg, 14px);
      color: inherit; text-decoration: none;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
      transition: transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease;
      cursor: pointer;
      min-height: 200px;
    }
    .app-card:hover {
      transform: translateY(-2px);
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 28%, transparent);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04),
                  0 12px 32px -16px color-mix(in oklch, var(--ps-accent, #00E5FF) 35%, transparent),
                  0 0 0 1px color-mix(in oklch, var(--ps-accent, #00E5FF) 14%, transparent);
    }
    .app-card:focus-visible {
      outline: var(--ps-ring-focus, 2px solid #00ffc8);
      outline-offset: 3px;
    }
    @media (prefers-reduced-motion: reduce) {
      .app-card { transition: none; }
      .app-card:hover { transform: none; }
    }

    .app-card-head {
      display: flex; align-items: flex-start; gap: 0.7rem;
    }
    .app-glyph {
      flex-shrink: 0;
      width: 44px; height: 44px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 1.4rem; line-height: 1;
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 8%, transparent);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 18%, transparent);
      border-radius: var(--ps-radius-sm, 10px);
    }
    .app-name-row {
      display: flex; align-items: center; gap: 8px;
      min-width: 0; flex-wrap: wrap;
    }
    .app-name {
      font-family: 'Sora', system-ui, sans-serif;
      font-size: 0.95rem; font-weight: 700;
      color: var(--ps-ink, #fff);
      letter-spacing: -0.01em;
      min-width: 0;
    }
    .status-pill {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 1px 8px 2px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.58rem; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase;
      border-radius: 999px;
      flex-shrink: 0;
    }
    .status-pill--live {
      color: var(--ps-accent, #00E5FF);
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 12%, transparent);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 40%, transparent);
    }
    .status-pill--soon {
      color: rgba(255,255,255,0.55);
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.09);
    }
    .status-dot {
      width: 5px; height: 5px; border-radius: 50%;
      background: var(--ps-accent, #00E5FF);
      box-shadow: 0 0 6px color-mix(in oklch, var(--ps-accent, #00E5FF) 60%, transparent);
      animation: status-pulse 2.4s ease-in-out infinite;
    }
    @keyframes status-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.55; }
    }
    @media (prefers-reduced-motion: reduce) {
      .status-dot { animation: none; }
    }

    /* Lifecycle pill row (above category chip strip) */
    .lifecycle-strip {
      display: inline-flex; gap: 4px; padding: 4px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 999px;
    }
    .lifecycle-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 0.32rem 0.78rem;
      border-radius: 999px;
      background: transparent;
      border: 1px solid transparent;
      color: rgba(255, 255, 255, 0.66);
      font-family: 'Sora', system-ui, sans-serif;
      font-size: 0.7rem; font-weight: 600;
      cursor: pointer;
      transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
    }
    .lifecycle-pill:hover {
      background: rgba(255, 255, 255, 0.05);
      color: var(--ps-ink, #fff);
    }
    .lifecycle-pill.active {
      background: rgba(255, 255, 255, 0.08);
      color: var(--ps-ink, #fff);
      border-color: rgba(255, 255, 255, 0.12);
    }
    .lifecycle-pill--live.active {
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 14%, transparent);
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 38%, transparent);
      color: var(--ps-accent, #00E5FF);
    }
    .lifecycle-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--ps-accent, #00E5FF);
      box-shadow: 0 0 6px color-mix(in oklch, var(--ps-accent, #00E5FF) 60%, transparent);
    }
    .lifecycle-count {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.62rem;
      padding: 1px 6px;
      background: rgba(0, 0, 0, 0.28);
      border-radius: 6px;
      color: rgba(255, 255, 255, 0.6);
    }
    .lifecycle-pill.active .lifecycle-count {
      background: rgba(0, 0, 0, 0.42);
      color: var(--ps-ink, #fff);
    }

    .app-tag {
      font-size: 0.74rem; line-height: 1.4;
      color: var(--text-secondary, rgba(255,255,255,0.62));
      margin-top: 2px;
    }

    .tag-row { display: flex; flex-wrap: wrap; gap: 4px; }
    .tag-pill {
      padding: 2px 8px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.62rem; font-weight: 600;
      color: rgba(255,255,255,0.65);
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 999px;
    }
    .tag-pill--more {
      color: var(--ps-accent, #00E5FF);
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 28%, transparent);
      cursor: help;
    }

    .infra-row { display: flex; flex-wrap: wrap; gap: 5px; }
    .infra-pill {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 3px 8px 3px 6px;
      font-size: 0.66rem; font-weight: 600;
      color: rgba(255,255,255,0.7);
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 6px;
    }
    .infra-pill--bare { color: #fbbf24; border-color: rgba(251,191,36,0.22); }
    .infra-glyph { font-size: 0.78rem; line-height: 1; }

    .app-card-foot {
      display: flex; align-items: center; justify-content: space-between;
      gap: 10px; margin-top: auto;
      padding-top: 0.6rem;
      border-top: 1px solid rgba(255,255,255,0.05);
    }
    .mem-pill {
      display: inline-flex; align-items: center; gap: 5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.66rem; color: rgba(255,255,255,0.55);
    }
    .mem-pill svg { color: rgba(255,255,255,0.5); }
    .cost-pill {
      display: inline-flex; align-items: baseline; gap: 1px;
      font-family: 'Sora', system-ui, sans-serif;
      font-size: 0.92rem; font-weight: 700;
      color: var(--ps-ink, #fff);
    }
    .cost-currency { font-size: 0.7rem; color: var(--ps-accent, #00E5FF); margin-right: 1px; }
    .cost-unit { font-size: 0.62rem; color: var(--text-secondary, rgba(255,255,255,0.5)); font-weight: 500; margin-left: 2px; }

    /* ─── Buttons (parity with sibling sections) ─── */
    .btn-ghost {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 0.5rem 0.85rem;
      border-radius: var(--ps-radius-sm, 8px);
      background: rgba(255, 255, 255, 0.04);
      color: rgba(255, 255, 255, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.1);
      cursor: pointer;
      font-size: 0.74rem; font-weight: 600;
      text-decoration: none;
      transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
    }
    .btn-ghost:hover { background: rgba(255, 255, 255, 0.08); color: #fff; border-color: rgba(255,255,255,0.16); }
    .btn-ghost:focus-visible { outline: var(--ps-ring-focus, 2px solid #00ffc8); outline-offset: 2px; }
  `],
})
export class AppsComponent implements AfterViewInit, OnInit {
  @ViewChild('searchInput') private searchInputRef?: ElementRef<HTMLInputElement>;

  private readonly route = inject(ActivatedRoute);

  readonly categories = APP_CATEGORIES;
  readonly totalCount = APPS_CATALOG.length;
  readonly liveCount = APPS_CATALOG.filter((a) => isAppSupported(a.id)).length;
  readonly soonCount = APPS_CATALOG.length - this.liveCount;
  readonly infraMeta = INFRA_META;

  activeCategory = signal<AppCategory | null>(null);
  /** Lifecycle filter — all|live|soon. Live = ships an upstream container today. */
  lifecycle = signal<LifecycleFilter>('all');
  searchQuery = signal<string>('');
  searchFocused = signal<boolean>(false);

  /** Template-bound mirror so `[(ngModel)]` doesn't need a signal-aware bridge. */
  searchInputValue = '';

  /** Live-filtered catalog driven by category + fuzzy query + lifecycle pill. */
  filteredApps = computed<readonly CatalogApp[]>(() => {
    const cat = this.activeCategory();
    const lc = this.lifecycle();
    const q = this.searchQuery().trim().toLowerCase();
    return APPS_CATALOG.filter((app) => {
      if (cat && app.category !== cat) return false;
      if (lc === 'live' && !isAppSupported(app.id)) return false;
      if (lc === 'soon' && isAppSupported(app.id)) return false;
      if (!q) return true;
      if (app.name.toLowerCase().includes(q)) return true;
      if (app.tagline.toLowerCase().includes(q)) return true;
      if (app.id.toLowerCase().includes(q)) return true;
      return app.tags.some((t) => t.toLowerCase().includes(q));
    });
  });

  emptyTitle = computed<string>(() => {
    const q = this.searchQuery().trim();
    return q ? `Nothing matches "${q}"` : 'No apps in this category';
  });

  ngAfterViewInit(): void {
    // No autofocus on mount — would steal focus from sibling routes.
  }

  /**
   * Honour `?category=ai|vector-db|...` deep links so external links can
   * filter the catalog on load (e.g. AI launchpad → `/admin/apps?category=ai`).
   * Unknown values fall back to the default "all" view.
   */
  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const raw = params.get('category');
      if (!raw) return;
      const validIds = APP_CATEGORIES.map((c) => c.id);
      if ((validIds as readonly string[]).includes(raw)) {
        this.activeCategory.set(raw as AppCategory);
      }
    });
  }

  /** Cmd+/ (Ctrl+/) focuses the search input. Matches the global mandate. */
  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === '/') {
      event.preventDefault();
      this.focusSearch();
    }
  }

  focusSearch(): void {
    requestAnimationFrame(() => this.searchInputRef?.nativeElement.focus({ preventScroll: true }));
  }

  setCategory(id: AppCategory | null): void {
    this.activeCategory.set(id);
  }

  /** Toggle the lifecycle pill row — All / Live / Coming soon. */
  setLifecycle(value: LifecycleFilter): void {
    this.lifecycle.set(value);
  }

  /** True when the catalog slug is wired to an upstream container today. */
  isSupported(id: string): boolean {
    return isAppSupported(id);
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
  }

  clearSearch(): void {
    this.searchInputValue = '';
    this.searchQuery.set('');
  }

  resetFilters(): void {
    this.activeCategory.set(null);
    this.clearSearch();
  }

  countByCategory(id: AppCategory): number {
    return APPS_CATALOG.filter((a) => a.category === id).length;
  }

  infraGlyph(d: InfraDep): string {
    return INFRA_META[d].glyph;
  }

  infraLabel(d: InfraDep): string {
    return INFRA_META[d].label;
  }
}
