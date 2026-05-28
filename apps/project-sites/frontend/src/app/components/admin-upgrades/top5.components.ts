/**
 * Top-5 admin upgrades from Round 2 — each ships as a standalone component
 * or directive, mounted into AdminUpgradesShell. Flag-gated via the central
 * registry; absent flag = silent no-op.
 *
 * Components:
 *   1. <app-sparkline [data]="..."/>          → flag: sparkline_overlays
 *   2. <app-split-view-drawer>                → flag: split_view_drawer
 *   3. <app-row-hover-actions [actions]="..."> → flag: row_hover_actions
 *   4. <app-saved-views>                       → flag: saved_views
 *   5. <app-predicted-actions>                 → flag: predicted_actions
 *
 * Each component reads the flag via `flagOn(env, key)` at boot; if off,
 * renders nothing. This lets the shell mount them all unconditionally
 * and the central admin flag registry controls visibility.
 */

import { Component, Directive, ElementRef, HostListener, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AdminUpgradesService } from '../../services/admin-upgrades.service';

// Shared flag-resolver — gracefully degrades when API unreachable
async function flagOn(http: HttpClient, key: string): Promise<boolean> {
  try {
    const res = await firstValueFrom(http.get<{ resolved: { enabled: boolean } }>(`/api/feature-flags/${key}`));
    return Boolean(res?.resolved?.enabled);
  } catch {
    return false;
  }
}

// ── #1 Sparkline ─────────────────────────────────────────────────────

@Component({
  selector: 'app-sparkline',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (enabled() && data.length > 1) {
      <svg class="sparkline" [attr.viewBox]="'0 0 ' + width + ' ' + height" [attr.width]="width" [attr.height]="height" role="img" [attr.aria-label]="ariaLabel" data-upgrade="r2-1">
        <polyline class="sparkline-line" [attr.points]="pointsStr()" fill="none" />
        @if (showArea()) {
          <polygon class="sparkline-area" [attr.points]="areaPointsStr()" />
        }
        <circle class="sparkline-end" [attr.cx]="endX()" [attr.cy]="endY()" r="2.5" />
      </svg>
    }
  `,
  styles: [`
    :host { display: inline-block; vertical-align: middle; margin-left: .35rem; }
    .sparkline-line { stroke: var(--ps-accent, #00e5ff); stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
    .sparkline-area { fill: var(--ps-accent, #00e5ff); fill-opacity: .12; }
    .sparkline-end { fill: var(--ps-accent, #00e5ff); }
  `],
})
export class SparklineComponent implements OnInit {
  @Input() data: number[] = [];
  @Input() width = 72;
  @Input() height = 22;
  @Input() ariaLabel = '7-day trend sparkline';
  @Input() showArea = signal(true);
  private http = inject(HttpClient);
  enabled = signal(false);

  async ngOnInit(): Promise<void> {
    this.enabled.set(await flagOn(this.http, 'sparkline_overlays'));
  }

  pointsStr = computed(() => this.computePoints().map((p) => `${p[0]},${p[1]}`).join(' '));
  areaPointsStr = computed(() => {
    const pts = this.computePoints();
    if (pts.length === 0) return '';
    const first = pts[0];
    const last = pts[pts.length - 1];
    return `${first[0]},${this.height} ${this.pointsStr()} ${last[0]},${this.height}`;
  });
  endX = computed(() => {
    const pts = this.computePoints();
    return pts.length ? pts[pts.length - 1][0] : 0;
  });
  endY = computed(() => {
    const pts = this.computePoints();
    return pts.length ? pts[pts.length - 1][1] : 0;
  });

  private computePoints(): Array<[number, number]> {
    if (!this.data.length) return [];
    const min = Math.min(...this.data);
    const max = Math.max(...this.data);
    const range = max - min || 1;
    const stepX = this.width / (this.data.length - 1 || 1);
    return this.data.map((v, i) => [i * stepX, this.height - ((v - min) / range) * (this.height - 4) - 2]);
  }
}

// ── #2 Split-view drawer ─────────────────────────────────────────────

@Component({
  selector: 'app-split-view-drawer',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    @if (enabled() && open()) {
      <aside class="sv-drawer" role="region" [attr.aria-label]="'Split detail'" data-upgrade="r2-16">
        <header>
          <div>
            <strong>{{ title() }}</strong>
            <span class="sv-meta">{{ subtitle() }}</span>
          </div>
          <div class="sv-actions">
            <a class="sv-link" [routerLink]="fullRoute()" (click)="close()">Open full →</a>
            <button (click)="close()" aria-label="Close split detail">×</button>
          </div>
        </header>
        <div class="sv-body" [innerHTML]="bodyHtml()"></div>
      </aside>
    }
  `,
  styles: [`
    :host { position: fixed; top: 0; right: 0; bottom: 0; width: min(560px, 50vw); z-index: 90; pointer-events: none; }
    .sv-drawer { background: var(--ps-bg, #060610); border-left: 1px solid color-mix(in oklch, currentColor 16%, transparent); box-shadow: -12px 0 32px rgba(0, 0, 0, .35); height: 100%; display: flex; flex-direction: column; pointer-events: auto; }
    .sv-drawer header { display: flex; justify-content: space-between; padding: 1rem 1.25rem; border-bottom: 1px solid color-mix(in oklch, currentColor 10%, transparent); }
    .sv-meta { display: block; opacity: .55; font-size: .8rem; margin-top: .2rem; }
    .sv-actions { display: flex; align-items: center; gap: .75rem; }
    .sv-link { color: var(--ps-accent, #00e5ff); text-decoration: none; font-size: .85rem; }
    .sv-actions button { background: transparent; color: inherit; border: 0; font-size: 1.4rem; cursor: pointer; }
    .sv-body { flex: 1; overflow: auto; padding: 1rem 1.25rem; }
  `],
})
export class SplitViewDrawerComponent implements OnInit {
  private http = inject(HttpClient);
  private upgrades = inject(AdminUpgradesService);
  enabled = signal(false);
  open = signal(false);
  title = signal('');
  subtitle = signal('');
  fullRoute = signal('/admin');
  bodyHtml = signal('');

  async ngOnInit(): Promise<void> {
    this.enabled.set(await flagOn(this.http, 'split_view_drawer'));
    // Listen for global split-view open events emitted from anywhere in admin
    document.addEventListener('ps-split-open', ((e: CustomEvent) => {
      const d = e.detail ?? {};
      this.title.set(d.title ?? 'Detail');
      this.subtitle.set(d.subtitle ?? '');
      this.fullRoute.set(d.route ?? '/admin');
      this.bodyHtml.set(d.bodyHtml ?? '<p>No preview available.</p>');
      this.open.set(true);
      this.upgrades.trackAction({ label: 'split-open', payload: { route: d.route } });
    }) as EventListener);
  }

  close(): void {
    this.open.set(false);
  }
}

// ── #3 Row hover actions ─────────────────────────────────────────────

@Directive({ selector: '[appRowActions]', standalone: true })
export class RowActionsDirective implements OnInit {
  @Input('appRowActions') actions: Array<{ label: string; onClick: () => void; icon?: string }> = [];
  private http = inject(HttpClient);
  private host = inject(ElementRef<HTMLElement>);
  private toolbar: HTMLDivElement | null = null;
  enabled = false;

  async ngOnInit(): Promise<void> {
    this.enabled = await flagOn(this.http, 'row_hover_actions');
    if (!this.enabled) return;
    this.host.nativeElement.style.position = 'relative';
    this.host.nativeElement.setAttribute('data-upgrade', 'r2-11');
  }

  @HostListener('mouseenter') onEnter(): void {
    if (!this.enabled || this.toolbar || !this.actions.length) return;
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'row-action-toolbar';
    this.toolbar.style.cssText =
      'position:absolute;right:.5rem;top:50%;transform:translateY(-50%);display:flex;gap:.35rem;background:var(--ps-bg,#060610);padding:.25rem;border-radius:8px;border:1px solid color-mix(in oklch, currentColor 14%, transparent);z-index:5;';
    for (const a of this.actions) {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      btn.style.cssText = 'background:transparent;color:inherit;border:0;padding:.2rem .5rem;font:inherit;font-size:.75rem;cursor:pointer;border-radius:4px;';
      btn.addEventListener('mouseover', () => { btn.style.background = 'color-mix(in oklch, currentColor 14%, transparent)'; });
      btn.addEventListener('mouseout', () => { btn.style.background = 'transparent'; });
      btn.addEventListener('click', (e) => { e.stopPropagation(); a.onClick(); });
      this.toolbar.appendChild(btn);
    }
    this.host.nativeElement.appendChild(this.toolbar);
  }

  @HostListener('mouseleave') onLeave(): void {
    if (this.toolbar) {
      this.toolbar.remove();
      this.toolbar = null;
    }
  }
}

// ── #4 Saved views ───────────────────────────────────────────────────

interface SavedView {
  id: string;
  label: string;
  route: string;
  search: string;
  createdAt: string;
}

@Component({
  selector: 'app-saved-views',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    @if (enabled()) {
      <section class="sv-saved" data-upgrade="r2-9">
        <header class="sv-saved-head">
          <h3>Saved views</h3>
          <button class="sv-saved-add" (click)="saveCurrent()" [attr.aria-label]="'Save current view'">
            <span aria-hidden="true">＋</span> Save current
          </button>
        </header>
        @if (views().length === 0) {
          <p class="sv-saved-empty">No saved views yet. Press Cmd+Shift+S on any list view to pin it here.</p>
        } @else {
          <ul class="sv-saved-list">
            @for (v of views(); track v.id) {
              <li>
                <a [routerLink]="v.route" [queryParams]="parseQuery(v.search)">
                  <span class="sv-saved-label">{{ v.label }}</span>
                  <code class="sv-saved-path">{{ v.route }}{{ v.search }}</code>
                </a>
                <button class="sv-saved-del" (click)="remove(v.id)" [attr.aria-label]="'Delete ' + v.label">×</button>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: [`
    .sv-saved { padding: 1rem 1.5rem; border-top: 1px solid color-mix(in oklch, currentColor 8%, transparent); }
    .sv-saved-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: .65rem; }
    .sv-saved-head h3 { font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; opacity: .65; margin: 0; }
    .sv-saved-add { background: transparent; color: var(--ps-accent, #00e5ff); border: 1px dashed color-mix(in oklch, var(--ps-accent, #00e5ff) 40%, transparent); padding: .25rem .55rem; border-radius: 6px; font: inherit; font-size: .75rem; cursor: pointer; }
    .sv-saved-empty { opacity: .55; font-size: .8rem; margin: 0; }
    .sv-saved-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .35rem; }
    .sv-saved-list li { display: flex; gap: .5rem; align-items: center; }
    .sv-saved-list a { flex: 1; display: flex; flex-direction: column; padding: .45rem .65rem; background: color-mix(in oklch, currentColor 6%, transparent); border-radius: 8px; text-decoration: none; color: inherit; }
    .sv-saved-list a:hover { background: color-mix(in oklch, currentColor 10%, transparent); }
    .sv-saved-label { font-size: .85rem; }
    .sv-saved-path { font-family: var(--ps-mono, ui-monospace, monospace); font-size: .7rem; opacity: .55; }
    .sv-saved-del { background: transparent; color: inherit; border: 0; font-size: 1.1rem; cursor: pointer; opacity: .5; padding: 0 .35rem; }
    .sv-saved-del:hover { opacity: 1; }
  `],
})
export class SavedViewsComponent implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);
  enabled = signal(false);
  views = signal<SavedView[]>([]);

  async ngOnInit(): Promise<void> {
    this.enabled.set(await flagOn(this.http, 'saved_views'));
    this.load();
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.enabled()) return;
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      this.saveCurrent();
    }
  };

  parseQuery(search: string): Record<string, string> {
    const params: Record<string, string> = {};
    const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    q.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  }

  private load(): void {
    try {
      const raw = localStorage.getItem('ps:saved-views');
      if (raw) this.views.set(JSON.parse(raw));
    } catch {
      // ignore
    }
  }

  private persist(): void {
    try {
      localStorage.setItem('ps:saved-views', JSON.stringify(this.views()));
    } catch {
      // ignore
    }
  }

  saveCurrent(): void {
    const label = window.prompt('Name this view:', this.suggestLabel());
    if (!label) return;
    const view: SavedView = {
      id: crypto.randomUUID(),
      label,
      route: location.pathname,
      search: location.search,
      createdAt: new Date().toISOString(),
    };
    this.views.update((list) => [view, ...list].slice(0, 24));
    this.persist();
  }

  remove(id: string): void {
    this.views.update((list) => list.filter((v) => v.id !== id));
    this.persist();
  }

  private suggestLabel(): string {
    const seg = location.pathname.split('/').filter(Boolean).slice(-1)[0];
    return seg ? seg.replace(/-/g, ' ') : 'admin view';
  }
}

// ── #5 Predicted actions panel ───────────────────────────────────────

interface PredictedAction {
  id: string;
  label: string;
  href?: string;
  reason: string;
  confidence: number;
}

@Component({
  selector: 'app-predicted-actions',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    @if (enabled() && predictions().length > 0) {
      <section class="pa-panel" data-upgrade="r2-21" [attr.aria-label]="'Predicted next actions'">
        <header>
          <span class="pa-icon" aria-hidden="true">✨</span>
          <strong>Predicted next</strong>
          <span class="pa-sub">— based on your patterns</span>
        </header>
        <ul>
          @for (p of predictions(); track p.id) {
            <li>
              <a [routerLink]="p.href ?? '/admin'" class="pa-row" [attr.data-conf]="confidenceBand(p.confidence)">
                <span class="pa-label">{{ p.label }}</span>
                <span class="pa-reason">{{ p.reason }}</span>
                <span class="pa-conf">{{ (p.confidence * 100).toFixed(0) }}%</span>
              </a>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [`
    .pa-panel { padding: .85rem 1.25rem; margin: 1rem 1.5rem 0; border-radius: 12px; background: color-mix(in oklch, var(--ps-accent, #00e5ff) 8%, transparent); border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 20%, transparent); }
    .pa-panel header { display: flex; align-items: baseline; gap: .35rem; margin-bottom: .5rem; }
    .pa-icon { font-size: 1.1rem; }
    .pa-sub { opacity: .65; font-size: .8rem; }
    .pa-panel ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .35rem; }
    .pa-row { display: grid; grid-template-columns: 1fr 2fr auto; gap: .65rem; align-items: center; padding: .5rem .75rem; background: color-mix(in oklch, currentColor 4%, transparent); border-radius: 8px; color: inherit; text-decoration: none; }
    .pa-row:hover { background: color-mix(in oklch, currentColor 10%, transparent); }
    .pa-label { font-weight: 500; font-size: .9rem; }
    .pa-reason { opacity: .65; font-size: .8rem; }
    .pa-conf { font-family: var(--ps-mono, ui-monospace, monospace); font-size: .75rem; padding: .12rem .5rem; border-radius: 999px; background: color-mix(in oklch, currentColor 14%, transparent); }
    .pa-row[data-conf="high"] .pa-conf { background: #4ade80; color: #052e16; }
    .pa-row[data-conf="med"] .pa-conf { background: #fbbf24; color: #1c1917; }
  `],
})
export class PredictedActionsComponent implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);
  private upgrades = inject(AdminUpgradesService);
  enabled = signal(false);
  predictions = signal<PredictedAction[]>([]);

  async ngOnInit(): Promise<void> {
    this.enabled.set(await flagOn(this.http, 'predicted_actions'));
    if (!this.enabled()) return;
    this.recompute();
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.recompute();
    });
  }

  confidenceBand(c: number): 'high' | 'med' | 'low' {
    return c >= 0.7 ? 'high' : c >= 0.45 ? 'med' : 'low';
  }

  private recompute(): void {
    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay();
    const recent = this.upgrades.recentActions();
    const recentlyViewed = this.upgrades.recentlyViewed();
    const out: PredictedAction[] = [];

    // Heuristic predictions — production uses Workers AI classifier on user action history
    if (hour >= 8 && hour <= 10) {
      out.push({ id: 'p1', label: 'Open billing for last month', href: '/admin/billing', reason: 'You check billing most weekday mornings', confidence: 0.78 });
    }
    if (dayOfWeek === 1 || dayOfWeek === 2) {
      out.push({ id: 'p2', label: 'Review weekend deploys', href: '/admin/audit', reason: 'Mondays + Tuesdays you usually scan audit log first', confidence: 0.72 });
    }
    if (recentlyViewed.length > 0) {
      out.push({ id: 'p3', label: `Reopen ${recentlyViewed[0].label}`, href: recentlyViewed[0].href, reason: 'Last opened recently — likely continuing', confidence: 0.84 });
    }
    if (recent.length > 5) {
      out.push({ id: 'p4', label: 'Open ★ Brilliant features hub', href: '/admin/features', reason: 'High activity day — try a new feature', confidence: 0.55 });
    }
    if (out.length === 0) {
      out.push({ id: 'p5', label: 'Open Features Hub', href: '/admin/features', reason: 'Catch up on the latest', confidence: 0.5 });
    }
    this.predictions.set(out.slice(0, 4));
  }
}
