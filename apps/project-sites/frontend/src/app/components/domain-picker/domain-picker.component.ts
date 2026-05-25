/**
 * Admin top-bar domain picker — collapses the first two breadcrumb segments
 * ("ProjectSites › {site name}") into a single home-icon + dropdown widget.
 *
 * @remarks
 * - Default state: cyan home glyph routes to `/admin`; dropdown trigger
 *   shows the active hostname (custom domain when present, else the
 *   `{slug}.projectsites.dev` fallback).
 * - Click the trigger → opens a glass-blur panel with three stacked
 *   sections: search input (auto-focused), YOUR DOMAINS list (assigned
 *   hostnames with status pills + actions), AVAILABLE TO REGISTER list
 *   (Workers-AI-enriched suggestions via `/api/domains/search-enrich`),
 *   plus a CNAME copy footer.
 * - Keyboard: arrow keys move selection within sections, Tab moves
 *   between sections, Enter selects the highlighted row, Esc closes
 *   and returns focus to the trigger.
 * - `prefers-reduced-motion` honoured — enter animation collapses to a
 *   plain opacity-only fade when the media query matches.
 *
 * @example
 * ```html
 * <app-domain-picker></app-domain-picker>
 * ```
 */
import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { AdminStateService } from '../../pages/admin/admin-state.service';
import { ApiService, type Hostname, type DomainSuggestion } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';

interface PickerHostname extends Hostname {
  /** Convenience flag — `true` for the row that matches `site.primary_hostname`. */
  isActive: boolean;
}

@Component({
  selector: 'app-domain-picker',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dp-root">
      <!-- Home button — left of the trigger, always routes to /admin. -->
      <button
        type="button"
        class="dp-home"
        (click)="goHome()"
        title="Admin home"
        aria-label="Go to admin home"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </button>

      <!-- Trigger — collapses the first two breadcrumbs into one widget. -->
      <button
        #trigger
        type="button"
        class="dp-trigger"
        [class.dp-trigger--open]="open()"
        (click)="toggle()"
        [attr.aria-expanded]="open()"
        aria-haspopup="dialog"
        [attr.aria-label]="'Active domain: ' + activeHost() + '. Click to change.'"
      >
        <span class="dp-host">{{ activeHost() }}</span>
        <svg class="dp-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      @if (open()) {
        <!-- Click-outside backdrop. Transparent — the panel itself is the visible surface. -->
        <div class="dp-backdrop" (click)="close()" aria-hidden="true"></div>

        <div
          #panel
          class="dp-panel"
          role="dialog"
          aria-label="Domain picker"
          (keydown)="onPanelKeydown($event)"
        >
          <!-- 1. Auto-focused search input. -->
          <div class="dp-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              #searchInput
              type="text"
              data-testid="domain-picker-search"
              [(ngModel)]="query"
              (ngModelChange)="onQueryChange($event)"
              (keydown.enter)="onSearchEnter($event)"
              placeholder="Search assigned domains or find a new one…"
              aria-label="Search domains"
              autocomplete="off"
              spellcheck="false"
            />
            @if (searching()) {
              <span class="dp-spinner" aria-label="Searching"></span>
            }
          </div>

          <!-- 2. YOUR DOMAINS — every hostname bound to the current site. -->
          <div class="dp-section">
            <div class="dp-section-label">Your domains</div>
            @if (filteredAssigned().length === 0) {
              <div class="dp-empty">
                @if (query().length > 0) {
                  No assigned domains match "{{ query() }}".
                } @else {
                  No domains assigned to this site yet.
                }
              </div>
            }
            @for (h of filteredAssigned(); track h.id; let i = $index) {
              <div
                class="dp-row dp-row--host"
                [class.dp-row--active]="h.isActive"
                [class.dp-row--inactive]="h.status === 'deactivated'"
                [class.dp-row--focused]="focusedSection() === 'assigned' && focusedIndex() === i"
                (mouseenter)="setFocus('assigned', i)"
              >
                <button
                  type="button"
                  class="dp-row-main"
                  (click)="selectHost(h)"
                  [title]="'Switch to ' + h.hostname"
                >
                  <span class="dp-mono">{{ h.hostname }}</span>
                  @if (h.isActive) {
                    <span class="dp-pill dp-pill--primary">PRIMARY</span>
                  } @else if (h.status === 'active') {
                    <span class="dp-pill dp-pill--live">LIVE</span>
                  } @else if (h.status === 'deactivated') {
                    <span class="dp-pill dp-pill--mute">DEACTIVATED</span>
                  } @else {
                    <span class="dp-pill dp-pill--pending">{{ statusLabel(h.status) }}</span>
                  }
                </button>
                <div class="dp-row-actions">
                  @if (h.status === 'deactivated') {
                    <button type="button" class="dp-act dp-act--accent" (click)="reactivate(h)" title="Reactivate hostname">
                      Reactivate
                    </button>
                  } @else {
                    @if (!h.isActive) {
                      <button type="button" class="dp-act" (click)="setDefault(h)" title="Set as primary">
                        Set as default
                      </button>
                    }
                    <button type="button" class="dp-act dp-act--mute" (click)="deactivate(h)" title="Stop serving traffic on this hostname">
                      Deactivate
                    </button>
                  }
                </div>
              </div>
            }
          </div>

          <!-- 3. AVAILABLE TO REGISTER — Workers-AI-enriched suggestions. -->
          @if (suggestions().length > 0) {
            <div class="dp-section">
              <div class="dp-section-label">Available to register</div>
              @for (s of suggestions(); track s.domain; let i = $index) {
                <div
                  class="dp-row dp-row--reg"
                  [class.dp-row--focused]="focusedSection() === 'register' && focusedIndex() === i"
                  (mouseenter)="setFocus('register', i)"
                >
                  <div class="dp-row-head">
                    <span class="dp-mono">{{ s.domain }}</span>
                    @if (s.status === 'available') {
                      <span class="dp-status dp-status--ok" title="Available">✓ available</span>
                    } @else if (s.status === 'taken') {
                      <span class="dp-status dp-status--no" title="Taken">✗ taken</span>
                    } @else {
                      <span class="dp-status dp-status--load" title="Checking">…</span>
                    }
                    @if (s.price_usd_yr) {
                      <span class="dp-price">\${{ s.price_usd_yr }}/yr</span>
                    }
                  </div>
                  <div class="dp-reason">{{ s.reason }}</div>
                  <div class="dp-pitch">{{ s.pitch }}</div>
                  <button
                    type="button"
                    class="dp-register"
                    [disabled]="!s.available || registering() === s.domain"
                    (click)="register(s)"
                  >
                    @if (registering() === s.domain) {
                      Registering…
                    } @else if (s.available) {
                      Register
                    } @else {
                      Taken
                    }
                  </button>
                </div>
              }
            </div>
          }

          <!-- 4. Bottom — DNS instruction + CNAME copy. -->
          <div class="dp-footer">
            <div class="dp-foot-line">
              Manage your own DNS? Point a CNAME to
              <code class="dp-mono">projectsites.dev</code>
              <button type="button" class="dp-copy" (click)="copyCname()" title="Copy CNAME target">
                Copy
              </button>
              <span class="dp-foot-sub">— we’ll auto-issue SSL.</span>
            </div>
            <div class="dp-foot-line dp-foot-sub">
              To register and manage domains, use the search above.
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        position: relative;
        font: inherit;
      }
      .dp-root {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .dp-home {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: var(--ps-radius-sm, 8px);
        background: transparent;
        color: var(--ps-accent, #00e5ff);
        cursor: pointer;
        transition: border-color 0.18s, background 0.18s, transform 0.18s;
      }
      .dp-home:hover {
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 35%, transparent);
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 8%, transparent);
      }
      .dp-home:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff);
        outline-offset: 2px;
      }
      .dp-trigger {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 4px 10px 4px 12px;
        height: 28px;
        max-width: 340px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: var(--ps-radius-md, 12px);
        background: rgba(13, 13, 40, 0.55);
        color: var(--ps-ink, #f4f4ff);
        cursor: pointer;
        font: inherit;
        font-size: 0.82rem;
        transition: border-color 0.18s, background 0.18s, box-shadow 0.18s;
      }
      .dp-trigger:hover {
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 40%, transparent);
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--ps-accent, #00e5ff) 20%, transparent),
          0 6px 18px -10px color-mix(in oklch, var(--ps-accent, #00e5ff) 60%, transparent);
      }
      .dp-trigger--open {
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 55%, transparent);
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent);
      }
      .dp-trigger:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff);
        outline-offset: 2px;
      }
      .dp-host {
        font-family: var(--ps-font-mono, 'JetBrains Mono', ui-monospace, monospace);
        font-size: 0.78rem;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 280px;
      }
      .dp-caret {
        opacity: 0.55;
        flex-shrink: 0;
        transition: transform 0.18s;
      }
      .dp-trigger--open .dp-caret {
        transform: rotate(180deg);
        opacity: 0.85;
      }
      .dp-backdrop {
        position: fixed;
        inset: 0;
        z-index: calc(var(--ps-z-dropdown, 1000) - 1);
        background: transparent;
      }
      .dp-panel {
        position: absolute;
        top: calc(100% + 8px);
        left: 0;
        z-index: var(--ps-z-dropdown, 1000);
        width: min(520px, calc(100vw - 32px));
        max-height: min(72vh, 640px);
        overflow-y: auto;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: var(--ps-surface-glass, rgba(13, 13, 40, 0.78));
        backdrop-filter: blur(22px) saturate(140%);
        -webkit-backdrop-filter: blur(22px) saturate(140%);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: var(--ps-radius-lg, 16px);
        box-shadow: var(
          --ps-shadow-modal,
          0 24px 64px rgba(0, 0, 0, 0.55),
          0 0 80px rgba(0, 229, 255, 0.06)
        );
        animation: dp-in 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      .dp-panel::before {
        /* Rim-light — subtle cyan halo on the top edge. */
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        padding: 1px;
        background: linear-gradient(
          135deg,
          color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent),
          transparent 40%,
          transparent 60%,
          color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent)
        );
        -webkit-mask:
          linear-gradient(#000 0 0) content-box,
          linear-gradient(#000 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        pointer-events: none;
      }
      @keyframes dp-in {
        from {
          opacity: 0;
          transform: translateY(-6px) scale(0.985);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .dp-panel {
          animation: dp-fade 0.14s ease both;
        }
        @keyframes dp-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      }
      .dp-search {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: rgba(0, 0, 0, 0.28);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: var(--ps-radius-md, 12px);
        color: var(--ps-ink, #f4f4ff);
      }
      .dp-search:focus-within {
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 50%, transparent);
        box-shadow: 0 0 0 3px color-mix(in oklch, var(--ps-accent, #00e5ff) 14%, transparent);
      }
      .dp-search input {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: inherit;
        font: inherit;
        font-size: 0.86rem;
      }
      .dp-search input::placeholder {
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 45%, transparent);
      }
      .dp-spinner {
        width: 12px;
        height: 12px;
        border: 2px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 25%, transparent);
        border-top-color: var(--ps-accent, #00e5ff);
        border-radius: 50%;
        animation: dp-spin 0.85s linear infinite;
      }
      @keyframes dp-spin {
        to {
          transform: rotate(360deg);
        }
      }
      .dp-section {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .dp-section-label {
        font-family: var(--ps-font-mono, 'JetBrains Mono', ui-monospace, monospace);
        font-size: 0.62rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
        padding: 0 2px;
      }
      .dp-empty {
        padding: 12px;
        font-size: 0.78rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent);
        background: rgba(0, 0, 0, 0.18);
        border-radius: var(--ps-radius-sm, 8px);
      }
      .dp-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px 10px;
        border-radius: var(--ps-radius-sm, 8px);
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid transparent;
        transition: background 0.14s, border-color 0.14s;
      }
      .dp-row--host {
        flex-direction: row;
        align-items: center;
        gap: 10px;
      }
      .dp-row--focused,
      .dp-row:hover {
        background: rgba(255, 255, 255, 0.04);
        border-color: rgba(255, 255, 255, 0.08);
      }
      .dp-row--active {
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 8%, transparent);
        border-left: 2px solid var(--ps-accent, #00e5ff);
      }
      .dp-row--inactive .dp-mono {
        text-decoration: line-through;
        opacity: 0.6;
      }
      .dp-row-main {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 10px;
        background: transparent;
        border: none;
        padding: 0;
        text-align: left;
        cursor: pointer;
        color: inherit;
        font: inherit;
      }
      .dp-row-main:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff);
        outline-offset: 2px;
        border-radius: 4px;
      }
      .dp-mono {
        font-family: var(--ps-font-mono, 'JetBrains Mono', ui-monospace, monospace);
        font-size: 0.78rem;
        color: var(--ps-ink, #f4f4ff);
      }
      .dp-pill {
        display: inline-block;
        padding: 1px 6px;
        font-size: 0.58rem;
        letter-spacing: 0.08em;
        font-weight: 600;
        border-radius: 4px;
        font-family: var(--ps-font-mono, 'JetBrains Mono', ui-monospace, monospace);
      }
      .dp-pill--primary {
        color: var(--ps-bg, #060610);
        background: var(--ps-accent, #00e5ff);
      }
      .dp-pill--live {
        color: var(--ps-accent, #00e5ff);
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 12%, transparent);
      }
      .dp-pill--pending {
        color: #f59e0b;
        background: rgba(245, 158, 11, 0.12);
      }
      .dp-pill--mute {
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 45%, transparent);
        background: rgba(255, 255, 255, 0.04);
      }
      .dp-row-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .dp-act {
        padding: 3px 8px;
        font-size: 0.7rem;
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 75%, transparent);
        cursor: pointer;
        transition: border-color 0.14s, color 0.14s, background 0.14s;
      }
      .dp-act:hover {
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 40%, transparent);
        color: var(--ps-ink, #f4f4ff);
      }
      .dp-act:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff);
        outline-offset: 1px;
      }
      .dp-act--accent {
        color: var(--ps-accent, #00e5ff);
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 40%, transparent);
      }
      .dp-act--mute {
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent);
      }
      .dp-row--reg {
        gap: 4px;
      }
      .dp-row-head {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .dp-status {
        font-size: 0.66rem;
        font-family: var(--ps-font-mono, 'JetBrains Mono', ui-monospace, monospace);
        padding: 1px 6px;
        border-radius: 4px;
      }
      .dp-status--ok {
        color: #34d399;
        background: rgba(52, 211, 153, 0.1);
      }
      .dp-status--no {
        color: #f87171;
        background: rgba(248, 113, 113, 0.1);
      }
      .dp-status--load {
        color: #f59e0b;
        background: rgba(245, 158, 11, 0.12);
      }
      .dp-price {
        margin-left: auto;
        font-size: 0.7rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 70%, transparent);
        font-variant-numeric: tabular-nums;
      }
      .dp-reason {
        font-size: 0.74rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 80%, transparent);
        line-height: 1.35;
      }
      .dp-pitch {
        font-size: 0.7rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
        line-height: 1.35;
      }
      .dp-register {
        align-self: flex-end;
        margin-top: 4px;
        padding: 5px 12px;
        font-size: 0.72rem;
        font-weight: 600;
        color: var(--ps-bg, #060610);
        background: var(--ps-accent, #00e5ff);
        border: none;
        border-radius: 5px;
        cursor: pointer;
        transition: filter 0.14s, transform 0.14s;
      }
      .dp-register:not(:disabled):hover {
        filter: brightness(1.1);
        transform: translateY(-1px);
      }
      .dp-register:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff);
        outline-offset: 2px;
      }
      .dp-register:disabled {
        cursor: not-allowed;
        opacity: 0.45;
        background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 18%, transparent);
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
      }
      .dp-footer {
        margin-top: 4px;
        padding-top: 10px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .dp-foot-line {
        font-size: 0.7rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .dp-foot-sub {
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 45%, transparent);
      }
      .dp-copy {
        padding: 2px 8px;
        font-size: 0.66rem;
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 4px;
        color: var(--ps-accent, #00e5ff);
        cursor: pointer;
      }
      .dp-copy:hover {
        border-color: var(--ps-accent, #00e5ff);
      }
    `,
  ],
})
export class DomainPickerComponent {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);

  @ViewChild('trigger', { static: false }) trigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('searchInput', { static: false }) searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('panel', { static: false }) panel?: ElementRef<HTMLDivElement>;

  // Picker state.
  open = signal(false);
  query = signal('');
  searching = signal(false);
  registering = signal<string | null>(null);
  hostnames = signal<Hostname[]>([]);
  suggestions = signal<DomainSuggestion[]>([]);
  focusedSection = signal<'assigned' | 'register' | null>('assigned');
  focusedIndex = signal(0);

  // Active hostname display in the trigger.
  activeHost = computed<string>(() => {
    const site = this.state.selectedSite();
    if (!site) return 'projectsites.dev';
    if (site.primary_hostname) return site.primary_hostname;
    if (site.slug) return `${site.slug}.projectsites.dev`;
    return 'projectsites.dev';
  });

  // Decorated assigned hostnames + local filter against `query()`.
  filteredAssigned = computed<PickerHostname[]>(() => {
    const site = this.state.selectedSite();
    const q = this.query().trim().toLowerCase();
    const rows = this.hostnames().map((h) => ({
      ...h,
      isActive: !!site?.primary_hostname && h.hostname === site.primary_hostname,
    }));
    if (!q) return rows;
    return rows.filter((r) => r.hostname.toLowerCase().includes(q));
  });

  private searchSubject = new Subject<string>();

  constructor() {
    // Debounced parallel-fire of the enriched-domain search whenever the
    // query crosses the 2-char threshold AND isn't an exact assigned match.
    this.searchSubject
      .pipe(
        debounceTime(280),
        distinctUntilChanged(),
        switchMap((q) => {
          const trimmed = q.trim();
          if (trimmed.length < 2) {
            this.suggestions.set([]);
            this.searching.set(false);
            return of(null);
          }
          // Skip remote search if the query exactly matches an assigned host.
          const assignedMatch = this.hostnames().some(
            (h) => h.hostname.toLowerCase() === trimmed.toLowerCase(),
          );
          if (assignedMatch) {
            this.suggestions.set([]);
            this.searching.set(false);
            return of(null);
          }
          this.searching.set(true);
          const business = this.state.selectedSite()?.business_name || '';
          return this.api.searchDomainsEnriched(trimmed, business).pipe(
            catchError((err) => {
              console.warn('domain-picker search failed', err);
              return of({ results: [] });
            }),
          );
        }),
      )
      .subscribe((res) => {
        this.searching.set(false);
        if (res) {
          // If user typed a literal valid-looking domain, hoist it to top.
          const q = this.query().trim().toLowerCase();
          const looksLikeDomain = /^[a-z0-9-]+\.[a-z]{2,}$/i.test(q);
          let results = res.results || [];
          if (looksLikeDomain) {
            const exact = results.find((r) => r.domain.toLowerCase() === q);
            const others = results.filter((r) => r.domain.toLowerCase() !== q);
            results = exact ? [exact, ...others] : results;
          }
          this.suggestions.set(results.slice(0, 10));
        }
      });

    // Refresh hostnames when the selected site changes or panel opens.
    effect(() => {
      const site = this.state.selectedSite();
      if (site && this.open()) {
        this.refreshHostnames(site.id);
      }
    });
  }

  goHome(): void {
    this.router.navigateByUrl('/admin');
  }

  toggle(): void {
    if (this.open()) {
      this.close();
    } else {
      this.openPanel();
    }
  }

  openPanel(): void {
    this.open.set(true);
    const site = this.state.selectedSite();
    if (site) this.refreshHostnames(site.id);
    // Auto-focus the input after the @if (open()) block paints. Double
    // rAF guarantees the input element is mounted before we touch it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = this.searchInput?.nativeElement;
        if (el) {
          el.focus({ preventScroll: true });
          el.select();
        }
      });
    });
  }

  close(): void {
    this.open.set(false);
    this.query.set('');
    this.suggestions.set([]);
    this.focusedSection.set('assigned');
    this.focusedIndex.set(0);
    requestAnimationFrame(() => this.trigger?.nativeElement?.focus({ preventScroll: true }));
  }

  onQueryChange(v: string): void {
    this.query.set(v);
    this.searchSubject.next(v);
  }

  setFocus(section: 'assigned' | 'register', index: number): void {
    this.focusedSection.set(section);
    this.focusedIndex.set(index);
  }

  onPanelKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key === 'Enter') {
      const section = this.focusedSection();
      const idx = this.focusedIndex();
      if (section === 'assigned') {
        const row = this.filteredAssigned()[idx];
        if (row) {
          e.preventDefault();
          this.selectHost(row);
        }
      } else if (section === 'register') {
        const row = this.suggestions()[idx];
        if (row && row.available) {
          e.preventDefault();
          this.register(row);
        }
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const section = this.focusedSection() || 'assigned';
      const max =
        section === 'assigned' ? this.filteredAssigned().length : this.suggestions().length;
      if (max === 0) return;
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const next = (this.focusedIndex() + dir + max) % max;
      this.focusedIndex.set(next);
      return;
    }
    if (e.key === 'Tab') {
      // Tab toggles between sections when both have content.
      if (this.suggestions().length > 0 && this.filteredAssigned().length > 0) {
        e.preventDefault();
        this.focusedSection.set(this.focusedSection() === 'assigned' ? 'register' : 'assigned');
        this.focusedIndex.set(0);
      }
    }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.open()) this.close();
  }

  /**
   * Enter inside the search input.
   *
   * Per user spec (2026-05-25): if the input is empty, Enter means
   * "stick with the same URL" — i.e. close the panel without changing
   * the active hostname. If the user has typed a query, Enter selects
   * the first available result OR fires register on a literal
   * available domain (delegates to the existing top-match flow).
   */
  onSearchEnter(ev: Event): void {
    ev.preventDefault();
    const q = this.query().trim();
    if (q.length === 0) {
      // Empty search + Enter = no-op close, keep current URL.
      this.close();
      return;
    }
    // Non-empty query: pick the top result. Prefer an exact assigned-domain
    // match; otherwise the first AVAILABLE registerable suggestion.
    const assigned = this.filteredAssigned();
    if (assigned.length > 0) {
      this.setDefault(assigned[0]);
      return;
    }
    const top = this.suggestions().find((s) => s.available);
    if (top) {
      this.register(top);
    }
  }

  private refreshHostnames(siteId: string): void {
    this.api.getHostnames(siteId).subscribe({
      next: (res) => this.hostnames.set(res.data || []),
      error: () => this.hostnames.set([]),
    });
  }

  selectHost(h: PickerHostname): void {
    // Mutate the in-memory `selectedSite()` so the trigger flips immediately.
    // The actual primary swap is what `setDefault` does.
    const site = this.state.selectedSite();
    if (!site) return;
    if (h.status === 'deactivated') {
      this.toast.error('Reactivate this hostname before switching to it.');
      return;
    }
    const updated = { ...site, primary_hostname: h.hostname };
    this.state.sites.update((list) =>
      list.map((s) => (s.id === site.id ? updated : s)),
    );
    this.toast.success(`Active domain switched to ${h.hostname}`);
    this.close();
  }

  setDefault(h: PickerHostname): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.api.setPrimaryHostname(site.id, h.id).subscribe({
      next: () => {
        this.toast.success(`${h.hostname} is now the primary domain.`);
        this.state.sites.update((list) =>
          list.map((s) => (s.id === site.id ? { ...s, primary_hostname: h.hostname } : s)),
        );
        this.refreshHostnames(site.id);
      },
      error: () => this.toast.error('Failed to set primary domain.'),
    });
  }

  deactivate(h: PickerHostname): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.api.unsubscribeHostname(site.id, h.id).subscribe({
      next: () => {
        this.toast.success(`${h.hostname} deactivated.`);
        this.refreshHostnames(site.id);
      },
      error: () => this.toast.error('Failed to deactivate hostname.'),
    });
  }

  reactivate(h: PickerHostname): void {
    const site = this.state.selectedSite();
    if (!site) return;
    // Reactivation = re-provision via the existing add-hostname endpoint;
    // the worker treats an existing soft-deleted row as a reactivate.
    this.api.addHostname(site.id, h.hostname).subscribe({
      next: () => {
        this.toast.success(`${h.hostname} reactivated.`);
        this.refreshHostnames(site.id);
      },
      error: () => this.toast.error('Reactivation failed.'),
    });
  }

  register(s: DomainSuggestion): void {
    const site = this.state.selectedSite();
    if (!site) return;
    if (!s.available) return;
    this.registering.set(s.domain);
    this.api.registerDomain(s.domain, site.id).subscribe({
      next: (res) => {
        this.registering.set(null);
        this.toast.success(`${res.data.domain} is yours. Now ship something on it.`);
        this.refreshHostnames(site.id);
        // Auto-promote registered domain to primary for instant gratification.
        if (res.data.hostname_id) {
          this.api.setPrimaryHostname(site.id, res.data.hostname_id).subscribe({
            next: () => {
              this.state.sites.update((list) =>
                list.map((x) => (x.id === site.id ? { ...x, primary_hostname: s.domain } : x)),
              );
            },
            error: () => {},
          });
        }
      },
      error: (err) => {
        this.registering.set(null);
        // 424 graceful path — surface the unblock URL.
        const body = err?.error?.error;
        if (body?.code === 'REGISTRAR_NOT_CONFIGURED') {
          this.toast.error(
            `${body.message} → ${body.unblock_url}`,
            { duration: 0 } as never,
          );
          return;
        }
        this.toast.error(err?.error?.error?.message || 'Registration failed.');
      },
    });
  }

  statusLabel(s: string): string {
    return (s || 'unknown').toUpperCase();
  }

  copyCname(): void {
    navigator.clipboard?.writeText('projectsites.dev').then(
      () => this.toast.success('CNAME target copied — projectsites.dev'),
      () => this.toast.error('Copy failed.'),
    );
  }
}
