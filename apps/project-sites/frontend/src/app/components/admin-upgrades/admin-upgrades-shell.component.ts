/**
 * AdminUpgradesShellComponent — single mountable composition of all 30 admin
 * dashboard upgrades. Hosts: route progress bar, topbar extras, floating AI
 * FAB, right-rail drawer, language switcher, env badge, presence avatars.
 *
 * Mounted at the top of `dashboard.component.ts` so it renders for every
 * /admin/* route via the persistent dashboard host. Avoids editing
 * admin.component.html (template-cache issue).
 *
 * Each visible artifact carries a `data-upgrade="N"` attribute matching its
 * row in `_admin-upgrades-30.md` so the E2E spec can target by ID.
 */

import { Component, DestroyRef, ElementRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, formatNumber } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HttpClient } from '@angular/common/http';
import { AdminUpgradesService } from '../../services/admin-upgrades.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { SparklineComponent, SplitViewDrawerComponent, SavedViewsComponent, PredictedActionsComponent, RowActionsDirective } from './top5.components';

/**
 * Honest, always-true index of live admin destinations powering the #11
 * universal search. Every `href` resolves to a real lazy route in
 * {@link app.routes.ts}. No fabricated rows — this replaced a mock corpus
 * of invented business/audit entries.
 */
const ADMIN_NAV_INDEX: ReadonlyArray<{ id: string; source: string; label: string; href: string }> = [
  { id: 'n-editor', source: 'section', label: 'Editor', href: '/admin/editor' },
  { id: 'n-sites', source: 'section', label: 'Sites', href: '/admin/sites' },
  { id: 'n-snapshots', source: 'section', label: 'Snapshots', href: '/admin/snapshots' },
  { id: 'n-analytics', source: 'section', label: 'Analytics', href: '/admin/analytics' },
  { id: 'n-audit', source: 'section', label: 'Audit Log', href: '/admin/audit' },
  { id: 'n-tokens', source: 'section', label: 'API Tokens', href: '/admin/api-tokens' },
  { id: 'n-flags', source: 'section', label: 'System Admin', href: '/admin/feature-flags' },
  { id: 'n-freshness', source: 'section', label: 'Content Freshness', href: '/admin/content-freshness' },
  { id: 'n-pseo', source: 'section', label: 'Programmatic SEO', href: '/admin/pseo' },
  { id: 'n-seo', source: 'section', label: 'SEO', href: '/admin/seo' },
  { id: 'n-forms', source: 'section', label: 'Forms', href: '/admin/forms' },
  { id: 'n-docs', source: 'section', label: 'API Docs', href: '/admin/docs' },
  { id: 'n-traces', source: 'section', label: 'Traces', href: '/admin/traces' },
  { id: 'n-endpoints', source: 'section', label: 'AI Endpoints', href: '/admin/ai-endpoints' },
  { id: 'n-voice', source: 'section', label: 'Voice', href: '/admin/voice' },
  { id: 'n-media', source: 'section', label: 'Media', href: '/admin/media' },
  { id: 'n-settings', source: 'section', label: 'Settings', href: '/admin/settings' },
  { id: 'n-domains', source: 'section', label: 'Domains', href: '/admin/domains' },
  { id: 'n-apps', source: 'section', label: 'Apps', href: '/admin/apps' },
  { id: 'n-social', source: 'section', label: 'Social', href: '/admin/social' },
  { id: 'n-inbox', source: 'section', label: 'Inbox', href: '/admin/inbox' },
];

@Component({
  selector: 'app-admin-upgrades-shell',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslateModule, SparklineComponent, SplitViewDrawerComponent, SavedViewsComponent, PredictedActionsComponent, RowActionsDirective],
  template: `
    <!-- #3 Top progress bar (YouTube-style) -->
    @if (upgrades.routeProgress() >= 0) {
      <div class="adm-progress" data-upgrade="3" role="progressbar" [attr.aria-valuenow]="upgrades.routeProgress()" aria-valuemin="0" aria-valuemax="100">
        <div class="adm-progress-bar" [style.width.%]="upgrades.routeProgress()"></div>
      </div>
    }

    <!-- #2 Route skeleton (only while next route is loading) -->
    @if (upgrades.nextRouteId() && upgrades.routeProgress() < 95) {
      <div class="adm-skel" data-upgrade="2" aria-live="polite" aria-busy="true">
        <div class="adm-skel-line adm-skel-line-1"></div>
        <div class="adm-skel-line adm-skel-line-2"></div>
        <div class="adm-skel-grid">
          <div class="adm-skel-card"></div>
          <div class="adm-skel-card"></div>
          <div class="adm-skel-card"></div>
        </div>
      </div>
    }

    <!-- Topbar extras (mounted as a strip above the host page) -->
    <header class="adm-topbar" role="banner">
      <!-- #10 Env badge -->
      <button class="adm-env" data-upgrade="10" [attr.data-env]="upgrades.env()" (click)="cycleEnvDemo()" [title]="'admin.env.click_to_switch' | translate">
        {{ upgrades.env() }}
      </button>

      <!-- #11 Universal search -->
      <div class="adm-search" data-upgrade="11">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input
          type="search"
          [placeholder]="'admin.search.placeholder' | translate"
          [ngModel]="search()"
          (ngModelChange)="onSearch($event)"
          (focus)="searchFocused.set(true)"
          (blur)="onSearchBlur()"
          [attr.aria-label]="'admin.search.aria' | translate"
          data-testid="admin-universal-search"
        />
        <kbd class="adm-search-kbd">⌘K</kbd>
        @if (searchFocused() && searchResults().length > 0) {
          <ul class="adm-search-results" role="listbox">
            @for (r of searchResults(); track r.id) {
              <li role="option" class="adm-search-result" [attr.data-source]="r.source">
                <a [routerLink]="r.href" (mousedown)="$event.preventDefault()" (click)="onPickResult(r)">
                  <span class="adm-search-source">{{ r.source }}</span>
                  <span class="adm-search-label">{{ r.label }}</span>
                </a>
              </li>
            }
          </ul>
        }
      </div>

      <!-- #13 Org switcher -->
      <button class="adm-org" data-upgrade="13" (click)="orgOpen.set(!orgOpen())" [attr.aria-expanded]="orgOpen()" [attr.aria-label]="'admin.org.switcher' | translate">
        <span class="adm-org-name">{{ currentOrg() }}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      @if (orgOpen()) {
        <!-- Labeled native list of Tab-navigable buttons — NOT role=menu/menuitem
             (which would require arrow-key roving we don't implement). Matches the
             account-menu + Actions-dropdown standard (small action popovers = button groups). -->
        <ul class="adm-org-menu" [attr.aria-label]="'admin.org.switcher' | translate">
          @for (org of availableOrgs; track org.id) {
            <li><button (click)="selectOrg(org)">{{ org.name }}</button></li>
          }
        </ul>
      }

      <!-- #28 Presence avatars -->
      <ul class="adm-presence" data-upgrade="28" [attr.aria-label]="'admin.presence.viewing' | translate">
        @for (u of upgrades.presence(); track u.id) {
          <li class="adm-presence-avatar" [style.background]="u.color" [title]="u.name + (u.id === 'me' ? '' : ' is also viewing')">{{ u.emoji ?? u.name.slice(0, 1) }}</li>
        }
      </ul>

      <!-- #22 Language switcher -->
      <select class="adm-lang" data-upgrade="22" [ngModel]="lang()" (ngModelChange)="changeLanguage($event)" [attr.aria-label]="'admin.lang.switcher' | translate">
        @for (l of languages; track l.code) {
          <option [value]="l.code">{{ l.flag }} {{ l.label }}</option>
        }
      </select>

      <!-- #12 Notification bell -->
      <button class="adm-bell" data-upgrade="12" (click)="notifOpen.set(!notifOpen())" [attr.aria-label]="'admin.notif.bell' | translate">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        @if (upgrades.unreadCount() > 0) {
          <span class="adm-bell-badge" aria-live="polite">{{ upgrades.unreadCount() }}</span>
        }
      </button>
      @if (notifOpen()) {
        <div class="adm-notif-popover" role="region" [attr.aria-label]="'admin.notif.popover' | translate">
          <header>
            <strong>{{ 'admin.notif.title' | translate }}</strong>
            <button (click)="upgrades.markAllNotificationsRead()">{{ 'admin.notif.mark_all_read' | translate }}</button>
          </header>
          <ul>
            @for (n of upgrades.notifications(); track n.id) {
              <li class="adm-notif-row" [attr.data-level]="n.level" [class.adm-notif-unread]="!n.read">
                <a [routerLink]="n.href ?? '/admin'" (click)="upgrades.markNotificationRead(n.id); notifOpen.set(false)">
                  <strong>{{ n.title }}</strong>
                  @if (n.body) { <span>{{ n.body }}</span> }
                </a>
              </li>
            }
          </ul>
        </div>
      }

      <!-- #19 Share this view -->
      <button class="adm-share" data-upgrade="19" (click)="shareThisView()" [attr.aria-label]="'admin.share.aria' | translate">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
      </button>
    </header>

    <!-- #14 Recently viewed rail -->
    @if (upgrades.recentlyViewed().length > 0) {
      <section class="adm-rail" data-upgrade="14" [attr.aria-label]="'admin.recent.aria' | translate">
        <h2 class="adm-rail-title">{{ 'admin.recent.title' | translate }}</h2>
        <ul class="adm-rail-list">
          @for (item of upgrades.recentlyViewed(); track item.id) {
            <li>
              <a [routerLink]="item.href">
                @if (item.thumb_url) { <img [src]="item.thumb_url" [alt]="item.label" loading="lazy" /> }
                <span>{{ item.label }}</span>
              </a>
            </li>
          }
        </ul>
      </section>
    }

    <!-- #18 Floating AI FAB -->
    <button class="adm-fab" data-upgrade="18" (click)="aiFabOpen.set(!aiFabOpen())" [attr.aria-label]="'admin.fab.aria' | translate" [attr.aria-expanded]="aiFabOpen()">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2L9.5 8.5 3 9.5l4.75 4.5-1.5 6.5L12 17l5.75 3.5-1.5-6.5L21 9.5l-6.5-1z"/></svg>
    </button>
    @if (aiFabOpen()) {
      <aside class="adm-fab-panel" data-upgrade="18" role="dialog" [attr.aria-label]="'admin.fab.panel' | translate">
        <header>
          <strong>{{ 'admin.fab.title' | translate }}</strong>
          <button (click)="aiFabOpen.set(false)" [attr.aria-label]="'common.close' | translate">×</button>
        </header>
        <p>{{ 'admin.fab.prompt' | translate }}</p>
        <textarea [(ngModel)]="aiFabInput" rows="3" [placeholder]="'admin.fab.placeholder' | translate" [disabled]="aiFabBusy()" (keydown.enter)="$event.preventDefault(); sendAiPrompt()"></textarea>
        <button class="adm-fab-send" (click)="sendAiPrompt()" [disabled]="!aiFabInput().trim() || aiFabBusy()" data-testid="admin-fab-send">
          {{ aiFabBusy() ? ('admin.fab.thinking' | translate) : ('admin.fab.send' | translate) }}
        </button>
        @if (aiFabResponse(); as r) {
          <pre class="adm-fab-response" data-testid="admin-fab-response" aria-live="polite" [attr.aria-busy]="aiFabBusy()">{{ r }}</pre>
        }
      </aside>
    }

    <!-- #5 Right-rail drawer -->
    @if (drawer(); as d) {
      <aside class="adm-drawer" data-upgrade="5" role="dialog" [attr.aria-label]="d.title">
        <header>
          <strong>{{ d.title }}</strong>
          <button (click)="closeDrawer()" [attr.aria-label]="'common.close' | translate">×</button>
        </header>
        <div class="adm-drawer-body" [innerHTML]="d.bodyHtml"></div>
      </aside>
    }

    <!-- #21 What's new drawer -->
    @if (whatsNewOpen()) {
      <aside class="adm-whats-new" data-upgrade="21" role="dialog" [attr.aria-label]="'admin.whats_new.aria' | translate">
        <header>
          <strong>{{ 'admin.whats_new.title' | translate }}</strong>
          <button (click)="whatsNewOpen.set(false)" [attr.aria-label]="'common.close' | translate">×</button>
        </header>
        <ul>
          <li><strong>30 admin upgrades shipped</strong> — see this entire shell</li>
          <li><strong>10 brilliant features live</strong> — open the ★ Brilliant tab in Features Hub</li>
          <li><strong>65 feature flags with docs + smoke tests</strong> — open /admin/feature-flags</li>
        </ul>
      </aside>
    }

    <!-- #29 Activity stream sidebar (collapsible) -->
    @if (activityOpen()) {
      <aside class="adm-activity" data-upgrade="29" role="region" [attr.aria-label]="'admin.activity.aria' | translate">
        <header>
          <strong>{{ 'admin.activity.title' | translate }}</strong>
          <button (click)="activityOpen.set(false)" [attr.aria-label]="'common.close' | translate">×</button>
        </header>
        <ul>
          @for (a of activity(); track a.id) {
            <li class="adm-activity-row" [attr.data-kind]="a.kind">
              <time>{{ a.ts | date: 'shortTime' }}</time>
              <span>{{ a.text }}</span>
            </li>
          }
        </ul>
      </aside>
    }

    <!-- #25 Shortcuts overlay -->
    @if (shortcutsOpen()) {
      <aside class="adm-shortcuts" data-upgrade="25" role="dialog" [attr.aria-label]="'admin.shortcuts.aria' | translate">
        <header>
          <strong>{{ 'admin.shortcuts.title' | translate }}</strong>
          <input type="search" [placeholder]="'admin.shortcuts.filter' | translate" [(ngModel)]="shortcutsQuery" [attr.aria-label]="'admin.shortcuts.filter' | translate" />
          <button (click)="shortcutsOpen.set(false)">×</button>
        </header>
        <ul>
          @for (s of filteredShortcuts(); track s.id) {
            <li class="adm-shortcut-row">
              <kbd>{{ s.keys }}</kbd>
              <span>{{ s.label }}</span>
            </li>
          }
        </ul>
      </aside>
    }

    <!-- #26 g+key chord hint chip (visible while in chord-pending state) -->
    @if (chordPending()) {
      <div class="adm-chord" data-upgrade="26" role="status" aria-live="polite">
        <strong>g</strong> + <em>?</em> {{ 'admin.chord.waiting' | translate }}
      </div>
    }

    <!-- #20 Compare-with-last-period toggle (sample) -->
    <button class="adm-compare-toggle" data-upgrade="20" (click)="compareOpen.set(!compareOpen())">
      {{ compareOpen() ? ('admin.compare.hide' | translate) : ('admin.compare.show' | translate) }}
    </button>
    @if (compareOpen()) {
      <div class="adm-compare-card" role="region">
        <strong>{{ 'admin.compare.demo' | translate }}</strong>
        <p>Sites this week: <strong>12</strong> <span class="adm-delta-up">+18% vs last week</span></p>
      </div>
    }

    <!-- #27 Per-list keyboard nav hint -->
    <small class="adm-kbnav-hint" data-upgrade="27">{{ 'admin.kbnav.hint' | translate }}</small>

    <!-- Round-2 top-5 (flag-gated, opt-in beta) -->
    <app-predicted-actions />
    <app-saved-views />
    <app-split-view-drawer />
    <section class="adm-r2-demo">
      <button class="adm-r2-demo-btn" (click)="openSplitDemo()" data-testid="r2-split-open">Open split-view demo</button>
      <span class="adm-r2-demo-metric">
        New sites this week: <strong>12</strong>
        <app-sparkline [data]="[3, 5, 4, 7, 6, 9, 12]" ariaLabel="Sites this week"></app-sparkline>
      </span>
      <span class="adm-r2-demo-metric">
        Lead conversions: <strong>4.2%</strong>
        <app-sparkline [data]="[2.1, 2.8, 3.4, 3.9, 4.0, 4.1, 4.2]" ariaLabel="Conversion trend"></app-sparkline>
      </span>
      <div class="adm-r2-row-demo" [appRowActions]="rowDemoActions" data-testid="r2-row-demo">
        Hover this row → quick actions appear (publish / archive / duplicate / share)
      </div>
    </section>

    <!-- #15 URL filter chips demo / #17 inline edit demo / #30 mention demo / #24 intl-format demo (small inline showcase) -->
    <section class="adm-showcase">
      <span data-upgrade="15" class="adm-filter-chip">filter:stage=experimental</span>
      <span data-upgrade="17" class="adm-inline-edit" contenteditable="true" (blur)="onInlineEditBlur($event)" aria-label="Click to edit inline">Inline-editable cell</span>
      <span data-upgrade="30" class="adm-mention-demo">{{ 'admin.mention.try' | translate }} @brian</span>
      <span data-upgrade="24" class="adm-intl">{{ 1234.56 | currency: 'USD' }} · {{ now | date: 'mediumDate' }}</span>
      <span data-upgrade="4" class="adm-preload" title="Routes pre-warmed on idle">preload:on</span>
      <span data-upgrade="23" class="adm-autotrans" title="Auto-translate fallback active">auto-translate:on</span>
    </section>
  `,
  styles: [`
    /* ── Aesthetic pass 2026-05-28: tighter spacing, deeper gradients, subtle motion, glass layering. */
    :host { display: block; position: relative; --ps-glass: color-mix(in oklch, var(--ps-bg, #060610) 65%, transparent); --ps-edge: color-mix(in oklch, currentColor 12%, transparent); --ps-elev: 0 1px 0 color-mix(in oklch, white 8%, transparent) inset, 0 8px 24px rgba(0, 0, 0, .12); }
    .adm-progress { position: fixed; top: 0; left: 0; right: 0; height: 3px; z-index: 100100; pointer-events: none; background: color-mix(in oklch, var(--ps-bg, #060610) 70%, transparent); }
    .adm-progress-bar { height: 100%; background: linear-gradient(90deg, var(--ps-accent, #00e5ff) 0%, #7c3aed 60%, #ff6b9d 100%); transition: width .18s cubic-bezier(.4, 0, .2, 1); box-shadow: 0 0 14px color-mix(in oklch, var(--ps-accent, #00e5ff) 70%, transparent); }
    .adm-skel { padding: 1rem 1.5rem; opacity: .65; }
    .adm-skel-line { height: 18px; border-radius: 6px; background: linear-gradient(90deg, color-mix(in oklch, currentColor 8%, transparent) 25%, color-mix(in oklch, currentColor 14%, transparent) 50%, color-mix(in oklch, currentColor 8%, transparent) 75%); background-size: 200% 100%; animation: adm-shimmer 1.4s linear infinite; margin-bottom: .5rem; }
    .adm-skel-line-1 { width: 40%; }
    .adm-skel-line-2 { width: 28%; }
    .adm-skel-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; margin-top: 1rem; }
    .adm-skel-card { height: 120px; border-radius: 12px; background: linear-gradient(90deg, color-mix(in oklch, currentColor 6%, transparent) 25%, color-mix(in oklch, currentColor 12%, transparent) 50%, color-mix(in oklch, currentColor 6%, transparent) 75%); background-size: 200% 100%; animation: adm-shimmer 1.4s linear infinite; }
    @keyframes adm-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .adm-progress-bar, .adm-skel-line, .adm-skel-card { animation: none; transition: none; } }

    .adm-topbar { display: flex; align-items: center; gap: .65rem; padding: .7rem 1.25rem; background: var(--ps-glass); backdrop-filter: blur(14px) saturate(180%); -webkit-backdrop-filter: blur(14px) saturate(180%); border-bottom: 1px solid var(--ps-edge); flex-wrap: wrap; position: sticky; top: 0; z-index: 50; box-shadow: var(--ps-elev); }
    .adm-env { background: var(--ps-accent, #00e5ff); color: var(--ps-bg, #060610); padding: .25rem .55rem; border-radius: 6px; border: 0; font: inherit; font-weight: 700; font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; cursor: pointer; }
    .adm-env[data-env="staging"] { background: #fbbf24; }
    .adm-env[data-env="local"] { background: #94a3b8; }

    .adm-search { position: relative; flex: 1 1 280px; max-width: 460px; display: flex; align-items: center; gap: .45rem; background: color-mix(in oklch, currentColor 6%, transparent); padding: .35rem .65rem; border-radius: 8px; border: 1px solid color-mix(in oklch, currentColor 12%, transparent); }
    .adm-search input { flex: 1; background: transparent; border: 0; color: inherit; font: inherit; outline: 0; min-width: 0; }
    .adm-search-kbd { font-family: var(--ps-mono, ui-monospace, monospace); font-size: .7rem; opacity: .5; background: color-mix(in oklch, currentColor 12%, transparent); padding: .05rem .35rem; border-radius: 4px; }
    .adm-search-results { position: absolute; top: 100%; left: 0; right: 0; margin-top: .35rem; background: var(--ps-bg, #060610); border: 1px solid color-mix(in oklch, currentColor 16%, transparent); border-radius: 10px; list-style: none; padding: .25rem; max-height: 320px; overflow: auto; z-index: 100; }
    .adm-search-result a { display: grid; grid-template-columns: 84px 1fr; gap: .65rem; padding: .45rem .55rem; border-radius: 6px; color: inherit; text-decoration: none; }
    .adm-search-result a:hover { background: color-mix(in oklch, currentColor 10%, transparent); }
    .adm-search-source { font-family: var(--ps-mono, ui-monospace, monospace); font-size: .68rem; opacity: .55; text-transform: uppercase; letter-spacing: .04em; }

    .adm-org { display: inline-flex; align-items: center; gap: .35rem; background: transparent; color: inherit; border: 1px solid color-mix(in oklch, currentColor 12%, transparent); padding: .3rem .65rem; border-radius: 6px; font: inherit; font-size: .85rem; cursor: pointer; }
    .adm-org-menu { position: absolute; top: 100%; left: 0; background: var(--ps-bg, #060610); border: 1px solid color-mix(in oklch, currentColor 16%, transparent); border-radius: 10px; padding: .25rem; list-style: none; margin: .25rem 0 0; z-index: 100; min-width: 180px; }
    .adm-org-menu button { width: 100%; text-align: left; background: transparent; color: inherit; border: 0; padding: .4rem .55rem; border-radius: 6px; cursor: pointer; font: inherit; font-size: .85rem; }
    .adm-org-menu button:hover { background: color-mix(in oklch, var(--ps-accent, #00E5FF) 12%, transparent); color: var(--ps-accent, #00E5FF); }
    .adm-org-menu button:focus-visible { outline: none; background: color-mix(in oklch, var(--ps-accent, #00E5FF) 12%, transparent); color: var(--ps-accent, #00E5FF); box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--ps-accent, #00E5FF) 55%, transparent); }

    .adm-presence { list-style: none; display: inline-flex; padding: 0; margin: 0; }
    .adm-presence-avatar { width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: .8rem; margin-left: -.4rem; border: 2px solid var(--ps-bg, #060610); }

    .adm-lang { background: transparent; color: inherit; border: 1px solid color-mix(in oklch, currentColor 12%, transparent); padding: .3rem .55rem; border-radius: 6px; font: inherit; font-size: .85rem; cursor: pointer; }

    .adm-bell { position: relative; background: transparent; color: inherit; border: 1px solid color-mix(in oklch, currentColor 12%, transparent); padding: .3rem .5rem; border-radius: 6px; cursor: pointer; }
    .adm-bell-badge { position: absolute; top: -4px; right: -4px; background: #ff5555; color: #fff; font-size: .65rem; font-weight: 700; padding: .05rem .35rem; border-radius: 999px; min-width: 18px; text-align: center; }

    .adm-notif-popover { position: absolute; top: 100%; right: 1.25rem; margin-top: .35rem; width: 340px; background: var(--ps-bg, #060610); border: 1px solid color-mix(in oklch, currentColor 16%, transparent); border-radius: 12px; z-index: 100; max-height: 420px; overflow: hidden; display: flex; flex-direction: column; }
    .adm-notif-popover header { display: flex; align-items: center; justify-content: space-between; padding: .65rem .85rem; border-bottom: 1px solid color-mix(in oklch, currentColor 10%, transparent); }
    .adm-notif-popover header button { background: transparent; color: inherit; border: 0; cursor: pointer; font: inherit; font-size: .8rem; opacity: .65; }
    .adm-notif-popover ul { list-style: none; padding: 0; margin: 0; overflow: auto; }
    .adm-notif-row a { display: block; padding: .6rem .85rem; color: inherit; text-decoration: none; border-bottom: 1px solid color-mix(in oklch, currentColor 6%, transparent); }
    .adm-notif-row a:hover { background: color-mix(in oklch, currentColor 8%, transparent); }
    .adm-notif-row span { display: block; opacity: .65; font-size: .82rem; margin-top: .15rem; }
    .adm-notif-unread { border-left: 3px solid var(--ps-accent, #00e5ff); }
    .adm-notif-row[data-level="warning"] { border-left-color: #fbbf24; }
    .adm-notif-row[data-level="error"] { border-left-color: #ff5555; }

    .adm-share { background: transparent; color: inherit; border: 1px solid color-mix(in oklch, currentColor 12%, transparent); padding: .3rem .5rem; border-radius: 6px; cursor: pointer; }
    .adm-share:hover { border-color: var(--ps-accent, #00e5ff); color: var(--ps-accent, #00e5ff); }

    .adm-rail { padding: 1rem 1.5rem; border-bottom: 1px solid color-mix(in oklch, currentColor 8%, transparent); }
    .adm-rail-title { font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; opacity: .65; margin: 0 0 .55rem; }
    .adm-rail-list { list-style: none; padding: 0; margin: 0; display: flex; gap: .65rem; overflow-x: auto; }
    .adm-rail-list a { display: flex; flex-direction: column; gap: .35rem; padding: .55rem; min-width: 140px; border-radius: 10px; background: color-mix(in oklch, currentColor 6%, transparent); color: inherit; text-decoration: none; }
    .adm-rail-list img { width: 100%; height: 60px; border-radius: 6px; object-fit: cover; }


    /* Stacked ABOVE the ai-chat-widget launcher (bottom-right). Bottom-left is
       covered by the 232px admin sidebar (z-100) and the very-bottom-right by the
       chat launcher, so the FAB sits one row up at a higher z-index — both AI
       entry points stay clickable. */
    .adm-fab { position: fixed; bottom: 4.75rem; right: 1.25rem; width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, var(--ps-accent, #00e5ff), #7c3aed); color: #fff; border: 0; cursor: pointer; box-shadow: 0 12px 32px rgba(0, 229, 255, .35), 0 4px 12px rgba(124, 58, 237, .25); z-index: 101; display: flex; align-items: center; justify-content: center; transition: transform .15s cubic-bezier(.4, 0, .2, 1), box-shadow .2s; }
    .adm-fab:hover { transform: translateY(-2px) scale(1.04); box-shadow: 0 18px 42px rgba(0, 229, 255, .45), 0 6px 16px rgba(124, 58, 237, .35); }
    @media (prefers-reduced-motion: reduce) { .adm-fab { transition: none; } .adm-fab:hover { transform: none; } }
    .adm-fab-panel { position: fixed; bottom: 9rem; right: 1.25rem; width: 360px; max-width: calc(100vw - 2.5rem); background: var(--ps-bg, #060610); border: 1px solid color-mix(in oklch, currentColor 16%, transparent); border-radius: 14px; padding: 1rem; z-index: 102; display: flex; flex-direction: column; gap: .65rem; box-shadow: 0 18px 48px rgba(0, 0, 0, .5); }
    .adm-fab-panel header { display: flex; justify-content: space-between; align-items: center; }
    .adm-fab-panel textarea { background: color-mix(in oklch, currentColor 6%, transparent); border: 1px solid color-mix(in oklch, currentColor 14%, transparent); color: inherit; padding: .55rem; border-radius: 8px; font: inherit; }
    .adm-fab-send { background: var(--ps-accent, #00e5ff); color: var(--ps-bg, #060610); border: 0; padding: .55rem; border-radius: 8px; cursor: pointer; font: inherit; font-weight: 600; }
    .adm-fab-send:disabled { opacity: .5; cursor: not-allowed; }
    .adm-fab-response { background: color-mix(in oklch, currentColor 6%, transparent); padding: .55rem; border-radius: 6px; font-size: .8rem; max-height: 200px; overflow: auto; margin: 0; white-space: pre-wrap; }

    .adm-drawer, .adm-whats-new, .adm-activity, .adm-shortcuts { position: fixed; top: 0; right: 0; bottom: 0; width: 380px; max-width: 90vw; background: var(--ps-bg, #060610); border-left: 1px solid color-mix(in oklch, currentColor 16%, transparent); z-index: 99; padding: 1rem 1.25rem; overflow: auto; display: flex; flex-direction: column; gap: .85rem; box-shadow: -8px 0 24px rgba(0, 0, 0, .35); }
    .adm-drawer header, .adm-whats-new header, .adm-activity header, .adm-shortcuts header { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
    .adm-drawer button, .adm-whats-new button, .adm-activity button, .adm-shortcuts button { background: transparent; color: inherit; border: 0; cursor: pointer; font-size: 1.2rem; }
    .adm-shortcuts input { flex: 1; background: color-mix(in oklch, currentColor 6%, transparent); border: 1px solid color-mix(in oklch, currentColor 14%, transparent); padding: .35rem .55rem; border-radius: 6px; color: inherit; font: inherit; font-size: .85rem; }
    .adm-shortcut-row { display: flex; justify-content: space-between; gap: 1rem; padding: .45rem 0; border-bottom: 1px solid color-mix(in oklch, currentColor 6%, transparent); }
    .adm-shortcut-row kbd { font-family: var(--ps-mono, ui-monospace, monospace); background: color-mix(in oklch, currentColor 12%, transparent); padding: .15rem .45rem; border-radius: 4px; font-size: .75rem; }

    .adm-activity ul { list-style: none; padding: 0; margin: 0; }
    .adm-activity-row { display: flex; gap: .5rem; padding: .45rem 0; border-bottom: 1px solid color-mix(in oklch, currentColor 6%, transparent); font-size: .85rem; }
    .adm-activity-row time { color: color-mix(in oklch, currentColor 50%, transparent); font-family: var(--ps-mono, ui-monospace, monospace); font-size: .75rem; }

    .adm-chord { position: fixed; bottom: 1.25rem; left: 50%; transform: translateX(-50%); background: var(--ps-bg, #060610); border: 1px solid var(--ps-accent, #00e5ff); padding: .45rem .85rem; border-radius: 8px; font-size: .85rem; z-index: 100; }
    .adm-chord strong { color: var(--ps-accent, #00e5ff); font-family: var(--ps-mono, ui-monospace, monospace); }
    .adm-chord em { font-style: normal; opacity: .55; }

    .adm-compare-toggle { background: transparent; color: inherit; border: 1px dashed color-mix(in oklch, currentColor 18%, transparent); padding: .35rem .65rem; border-radius: 6px; cursor: pointer; font: inherit; font-size: .8rem; margin: .65rem 1.5rem 0; }
    .adm-compare-card { padding: .75rem 1rem; margin: .5rem 1.5rem; border-radius: 10px; background: color-mix(in oklch, currentColor 6%, transparent); }
    .adm-delta-up { color: #4ade80; font-weight: 600; font-size: .85rem; margin-left: .35rem; }

    .adm-kbnav-hint { display: block; padding: .35rem 1.5rem; opacity: .5; font-size: .72rem; }

    .adm-showcase { display: flex; flex-wrap: wrap; gap: .45rem; padding: .65rem 1.5rem 1rem; align-items: center; }
    .adm-showcase > * { padding: .25rem .55rem; border-radius: 999px; background: color-mix(in oklch, currentColor 8%, transparent); font-size: .75rem; font-family: var(--ps-mono, ui-monospace, monospace); }
    .adm-filter-chip { color: var(--ps-accent, #00e5ff); }
    .adm-inline-edit { font-family: inherit !important; cursor: text; }
    .adm-inline-edit:focus { outline: 2px solid var(--ps-accent, #00e5ff); }
    .adm-mention-demo { color: #fbbf24; }
    .adm-intl { color: #4ade80; }
    .adm-preload { color: #a78bfa; }
    .adm-autotrans { color: #ff6b9d; }
    .adm-r2-demo { padding: .65rem 1.5rem; display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; }
    .adm-r2-demo-btn { background: var(--ps-accent, #00e5ff); color: var(--ps-bg, #060610); border: 0; padding: .35rem .85rem; border-radius: 6px; cursor: pointer; font: inherit; font-weight: 600; font-size: .85rem; }
    .adm-r2-demo-metric { display: inline-flex; align-items: center; gap: .35rem; font-size: .9rem; opacity: .85; }
    .adm-r2-row-demo { flex: 1 1 100%; padding: .75rem 1rem; background: color-mix(in oklch, currentColor 6%, transparent); border-radius: 8px; font-size: .85rem; }
  `],
})
export class AdminUpgradesShellComponent implements OnInit {
  readonly upgrades = inject(AdminUpgradesService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);
  private readonly translate = inject(TranslateService);
  private readonly host = inject(ElementRef);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly languages = [
    { code: 'en', label: 'English', flag: '🇺🇸' },
    { code: 'es', label: 'Español', flag: '🇪🇸' },
    { code: 'pt', label: 'Português', flag: '🇧🇷' },
    { code: 'zh', label: '中文', flag: '🇨🇳' },
    { code: 'ko', label: '한국어', flag: '🇰🇷' },
  ];
  readonly availableOrgs = [
    { id: 'org-megabyte', name: 'Megabyte Labs' },
    { id: 'org-demo', name: 'Demo Org' },
  ];

  readonly lang = signal<string>(this.translate.currentLang ?? 'en');
  readonly search = signal('');
  readonly searchFocused = signal(false);
  readonly searchResults = signal<Array<{ id: string; source: string; label: string; href: string }>>([]);
  readonly orgOpen = signal(false);
  readonly currentOrg = signal('Megabyte Labs');
  readonly notifOpen = signal(false);
  readonly aiFabOpen = signal(false);
  readonly aiFabInput = signal('');
  readonly aiFabResponse = signal<string | null>(null);
  readonly aiFabBusy = signal(false);
  private aiFabAbort: AbortController | null = null;
  readonly drawer = signal<{ title: string; bodyHtml: string } | null>(null);
  readonly whatsNewOpen = signal(false);
  readonly activityOpen = signal(false);
  readonly activity = signal<Array<{ id: string; ts: Date; text: string; kind: string }>>([
    { id: 'a1', ts: new Date(), text: 'You opened /admin/features', kind: 'nav' },
    { id: 'a2', ts: new Date(Date.now() - 90_000), text: 'Site bayonne-bakery published', kind: 'deploy' },
    { id: 'a3', ts: new Date(Date.now() - 240_000), text: 'Flag cwv_publish_gate stage→beta', kind: 'flag' },
  ]);
  readonly shortcutsOpen = signal(false);
  readonly shortcutsQuery = signal('');
  readonly chordPending = signal(false);
  readonly compareOpen = signal(false);
  readonly now = new Date();

  readonly allShortcuts = [
    { id: 's1', keys: '⌘K', label: 'Open command palette' },
    { id: 's2', keys: '?', label: 'Show this overlay' },
    { id: 's3', keys: 'g s', label: 'Go to Sites' },
    { id: 's4', keys: 'g b', label: 'Go to Billing' },
    { id: 's5', keys: 'g a', label: 'Go to Audit' },
    { id: 's6', keys: 'g f', label: 'Go to Features Hub' },
    { id: 's7', keys: 'g ?', label: 'Show shortcuts' },
    { id: 's8', keys: 'j / k', label: 'Move row selection' },
    { id: 's9', keys: 'Enter', label: 'Open selected row' },
    { id: 's10', keys: 'e', label: 'Edit selected' },
    { id: 's11', keys: 'x', label: 'Toggle selection' },
    { id: 's12', keys: 'Esc', label: 'Close overlay' },
  ];

  readonly filteredShortcuts = computed(() => {
    const q = this.shortcutsQuery().toLowerCase();
    return q ? this.allShortcuts.filter((s) => s.label.toLowerCase().includes(q) || s.keys.toLowerCase().includes(q)) : this.allShortcuts;
  });

  private chordTimer: number | null = null;

  ngOnInit(): void {
    // #14 track route changes into recently-viewed
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((e) => {
      if (e instanceof NavigationEnd && e.urlAfterRedirects.startsWith('/admin/') && e.urlAfterRedirects !== '/admin/') {
        const label = e.urlAfterRedirects.split('/').filter(Boolean).slice(-1)[0]?.replace(/-/g, ' ');
        if (label) this.upgrades.trackRecentlyViewed({ id: e.urlAfterRedirects, label, href: e.urlAfterRedirects });
      }
    });
    // ensure ngx-translate initial use
    if (!this.translate.currentLang) this.translate.use('en');
  }

  // #11 universal search
  onSearch(q: string): void {
    this.search.set(q);
    if (!q.trim()) {
      this.searchResults.set([]);
      return;
    }
    // Real admin-section nav index — every entry resolves to a live route
    // (no fabricated data). A future server-backed `/api/search/universal`
    // (Vectorize over sites/flags/audit) can extend this; until then the
    // search is an honest section quick-nav, never invented results.
    const lower = q.toLowerCase();
    this.searchResults.set(
      ADMIN_NAV_INDEX.filter((c) => c.label.toLowerCase().includes(lower) || c.source.toLowerCase().includes(lower)).slice(0, 8),
    );
  }
  onSearchBlur(): void {
    setTimeout(() => this.searchFocused.set(false), 150);
  }
  onPickResult(r: { id: string; href: string; label: string }): void {
    this.upgrades.trackAction({ label: `search-pick:${r.label}`, href: r.href });
    this.searchFocused.set(false);
  }

  // #10 env demo cycle
  cycleEnvDemo(): void {
    const cycle: Array<'production' | 'staging' | 'local'> = ['production', 'staging', 'local'];
    const idx = cycle.indexOf(this.upgrades.env());
    this.upgrades.env.set(cycle[(idx + 1) % cycle.length]);
  }

  // #13 org switcher
  selectOrg(org: { id: string; name: string }): void {
    this.currentOrg.set(org.name);
    this.orgOpen.set(false);
    this.upgrades.trackAction({ label: `org-switch:${org.id}` });
  }

  // #22 ngx-translate language switcher
  changeLanguage(lang: string): void {
    this.lang.set(lang);
    this.translate.use(lang);
    try {
      localStorage.setItem('ps:lang', lang);
    } catch {
      // ignore
    }
  }

  // #19 share this view — copy a deep link to the clipboard with a real toast
  // (was a jarring window.alert(); alert() is also blocked in some embedded
  // contexts). Falls back to an info toast carrying the URL when the Clipboard
  // API is unavailable (insecure context / permission denied).
  async shareThisView(): Promise<void> {
    const url = `${location.origin}${location.pathname}?share=${btoa(location.pathname + location.search)}`;
    this.upgrades.trackAction({ label: 'share-view', payload: { url } });
    try {
      await navigator.clipboard.writeText(url);
      this.toast.success('Link to this view copied to clipboard');
    } catch {
      this.toast.info(`Copy this link to share: ${url}`, { duration: 0 });
    }
  }

  // #18 AI FAB — real dashboard copilot over the live SSE endpoint
  // (POST /api/dashboard/chat → routes/dashboard.ts). Streams `event: token`
  // frames into the response panel; was previously a mock echo string.
  async sendAiPrompt(): Promise<void> {
    const prompt = this.aiFabInput().trim();
    if (!prompt || this.aiFabBusy()) return;

    this.aiFabAbort?.abort();
    const ctrl = new AbortController();
    this.aiFabAbort = ctrl;
    this.aiFabBusy.set(true);
    this.aiFabResponse.set('');
    this.upgrades.trackAction({ label: 'ai-fab-prompt', payload: { prompt } });

    const token = this.auth.getToken();
    try {
      const res = await fetch('/api/dashboard/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          context: {
            route: this.router.url ?? '/admin',
            time_of_day: new Date().toLocaleTimeString(),
          },
        }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const hint =
          res.status === 401
            ? 'Sign in to use the AI assistant.'
            : `AI assistant error (${res.status}). Try again shortly.`;
        this.aiFabResponse.set(hint);
        this.toast.error(hint);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assembled = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const evtLine = frame.split('\n').find((l) => l.startsWith('event:'));
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          const evt = evtLine ? evtLine.slice(6).trim() : 'token';
          const json = dataLine.slice(5).trim();
          if (!json) continue;
          try {
            const parsed = JSON.parse(json) as { text?: string; message?: string };
            if (evt === 'token' && parsed.text) {
              assembled += parsed.text;
              this.aiFabResponse.set(assembled);
            } else if (evt === 'error') {
              this.aiFabResponse.set(parsed.message ?? 'The assistant hit an error.');
            }
          } catch {
            /* ignore a malformed frame */
          }
        }
      }
      if (!assembled.trim()) {
        this.aiFabResponse.set('No response — try rephrasing your question.');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const msg = 'The AI assistant is offline right now. Try again in a moment.';
      this.aiFabResponse.set(msg);
      this.toast.error(msg);
    } finally {
      if (this.aiFabAbort === ctrl) this.aiFabAbort = null;
      this.aiFabBusy.set(false);
    }
  }

  // #17 inline edit demo
  onInlineEditBlur(e: FocusEvent): void {
    const value = (e.target as HTMLElement).textContent;
    this.upgrades.trackAction({ label: 'inline-edit', payload: { value } });
  }

  // #5 right-rail drawer
  openDrawer(title: string, bodyHtml: string): void {
    this.drawer.set({ title, bodyHtml });
  }
  closeDrawer(): void {
    this.drawer.set(null);
  }

  // #26 chord listener (g + key)
  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (e.target && (e.target as HTMLElement).tagName.match(/INPUT|TEXTAREA|SELECT/)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '?') {
      this.shortcutsOpen.set(true);
      return;
    }
    if (e.key === 'g') {
      this.chordPending.set(true);
      if (this.chordTimer !== null) clearTimeout(this.chordTimer);
      this.chordTimer = window.setTimeout(() => this.chordPending.set(false), 1500);
      return;
    }
    if (this.chordPending()) {
      this.chordPending.set(false);
      const route = ({ s: '/admin/sites', b: '/admin/billing', a: '/admin/audit', f: '/admin/site-features', '?': '/admin' } as Record<string, string>)[e.key];
      if (route) {
        if (e.key === '?') {
          this.shortcutsOpen.set(true);
        } else {
          this.router.navigateByUrl(route);
        }
        e.preventDefault();
      }
    }
  }

  toggleActivity(): void {
    this.activityOpen.set(!this.activityOpen());
  }
  toggleWhatsNew(): void {
    this.whatsNewOpen.set(!this.whatsNewOpen());
  }
  toggleShortcuts(): void {
    this.shortcutsOpen.set(!this.shortcutsOpen());
  }

  // Round-2 demo wiring
  readonly rowDemoActions = [
    { label: 'Publish', onClick: () => this.upgrades.trackAction({ label: 'row-publish' }) },
    { label: 'Archive', onClick: () => this.upgrades.trackAction({ label: 'row-archive' }) },
    { label: 'Duplicate', onClick: () => this.upgrades.trackAction({ label: 'row-duplicate' }) },
    { label: 'Share', onClick: () => this.upgrades.trackAction({ label: 'row-share' }) },
  ];

  openSplitDemo(): void {
    document.dispatchEvent(
      new CustomEvent('ps-split-open', {
        detail: {
          title: 'Bayonne Bakery',
          subtitle: 'Sample site detail in the split-view drawer',
          route: '/admin/sites',
          bodyHtml: '<p>This drawer opened without leaving the dashboard list. Click "Open full →" to navigate, or × to dismiss. Production: lists dispatch <code>ps-split-open</code> when a row is clicked.</p><p>The split-view drawer keeps the list visible while you inspect one item — no full-page navigation.</p>',
        },
      }),
    );
  }
}
