/**
 * Perplexity-like immersive AI dashboard at `/admin`.
 *
 * Layout:
 *   - Empty state: hero "Ask anything about your sites" + pill row of features
 *   - Streamed response: parsed widget envelopes animate in above the input
 *   - Bottom-center glass pill input (~800px) that slides up on submit
 *   - `/`-triggered slash palette with fuzzy search over 14 commands
 *
 * The chat surface speaks to `POST /api/dashboard/chat` (SSE). The model
 * is instructed to emit `<widget name="..." />` envelopes; the renderer
 * routes each envelope to the matching standalone widget component.
 */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DashboardChatService } from './dashboard/dashboard-chat.service';
import {
  SlashCommandRegistryService,
  type SlashCommand,
} from './dashboard/slash-command-registry.service';
import { WidgetRendererComponent } from './dashboard/widgets';
import { RevealDirective } from '../../../directives/reveal.directive';
import { AdminUpgradesShellComponent } from '../../../components/admin-upgrades/admin-upgrades-shell.component';
import { AdminStateService } from '../admin-state.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, WidgetRendererComponent, RevealDirective, AdminUpgradesShellComponent],
  template: `
    <section class="dash" aria-label="Dashboard">
      <!-- 30 admin-dashboard upgrades shell — all features mounted here so
           they render across every /admin/* route via the persistent
           dashboard host. Each feature carries data-upgrade="N" for E2E. -->
      <app-admin-upgrades-shell></app-admin-upgrades-shell>
      <!-- Features Hub + Feature Flags discovery banner. Both also have sidebar
           nav entries (added 2026-06-04); this banner is an intentional, more
           prominent dashboard entry point to the two highest-value meta surfaces. -->
      <section class="features-banner" role="navigation" aria-label="Newly shipped features">
        <a class="features-banner-card" routerLink="/admin/features">
          <span class="features-banner-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>
          <span class="features-banner-body">
            <strong>Features Hub</strong>
            <span class="features-banner-sub">Every feature in one place — Stack / CWV / GEO / A11y / Editor / Monetize / Observability / Media / Platform / Gaps. Live "Try it" buttons.</span>
          </span>
          <span class="features-banner-cta" aria-hidden="true">→</span>
        </a>
        <a class="features-banner-card features-banner-card-alt" routerLink="/admin/feature-flags">
          <span class="features-banner-icon features-banner-icon--alt" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></span>
          <span class="features-banner-body">
            <strong>Feature Flags</strong>
            <span class="features-banner-sub">Toggle, roll out, killswitch 50+ feature flags. Stage filter, per-flag inspect, hash-chain audit trail.</span>
          </span>
          <span class="features-banner-cta" aria-hidden="true">→</span>
        </a>
      </section>
      @if (chat.messages().length === 0) {
        <section class="hero" appReveal>
          <div class="halo" aria-hidden="true"></div>
          <h1 class="h">Ask anything about your sites</h1>
          <p class="s">
            Type a question, or click a feature pill. The AI responds with live widgets — metrics,
            charts, calendars, code — not just text.
          </p>
          <ul class="examples">
            @for (ex of examples; track ex) {
              <li>
                <button type="button" (click)="quick(ex)" [disabled]="chat.streaming()">{{ ex }}</button>
              </li>
            }
          </ul>
        </section>
      } @else {
        <!-- role=log + aria-live so a streamed AI reply is ANNOUNCED to screen
             readers (mirrors the inbox message list). aria-busy holds the
             announcement until the stream finishes → SR hears the complete reply,
             not each token. -->
        <section class="thread" #thread role="log" aria-live="polite"
                 aria-label="Conversation with the dashboard AI"
                 [attr.aria-busy]="chat.streaming()">
          @for (msg of chat.messages(); track msg.id) {
            <article
              class="msg"
              [class.user]="msg.role === 'user'"
              [class.asst]="msg.role === 'assistant'"
            >
              @if (msg.role === 'user') {
                <div class="user-bubble">{{ msg.text }}</div>
              } @else {
                @if (msg.done && msg.parts?.length) {
                  <div class="asst-parts">
                    @for (p of msg.parts; track $index) {
                      <div class="part" appReveal [revealDelay]="$index * 80">
                        @if (p.kind === 'prose') {
                          <p class="prose">{{ p.text }}</p>
                        } @else {
                          <app-widget-renderer [name]="p.widget.name" [props]="p.widget.props" />
                        }
                      </div>
                    }
                  </div>
                } @else {
                  <div class="streaming">
                    <span class="dot"></span><span class="dot"></span><span class="dot"></span>
                    <span class="strm-tx">{{ msg.text }}</span>
                  </div>
                }
              }
            </article>
          }
        </section>
      }

      <!-- ── Pill row of features ─────────────────────────────── -->
      <nav class="pills" aria-label="Quick features">
        @for (cmd of pills(); track cmd.id) {
          <button
            type="button"
            class="pill"
            [class.on]="chat.lastPill() === cmd.id"
            [attr.title]="cmd.description"
            [disabled]="chat.streaming()"
            (click)="pillClick(cmd)"
          >
            <span class="g" aria-hidden="true">{{ glyph(cmd.glyph) }}</span>
            <span>{{ cmd.label }}</span>
          </button>
        }
      </nav>

      <!-- ── Bottom-center glass input pill ───────────────────── -->
      <form class="dock" (submit)="onSubmit($event)" role="search">
        <div class="dock-inner">
          <span class="dock-slash" aria-hidden="true">/</span>
          <input
            #input
            type="text"
            [(ngModel)]="draft"
            name="q"
            placeholder="Ask anything — try /snapshot or /analytics 7d"
            autocomplete="off"
            aria-label="Ask the dashboard AI"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="dash-palette"
            [attr.aria-expanded]="palette()"
            [attr.aria-activedescendant]="palette() ? 'dash-palette-opt-' + paletteIdx() : null"
            (input)="onInput()"
            (keydown)="onKey($event)"
          />
          <button
            type="submit"
            class="dock-go"
            [disabled]="!draft.trim() || chat.streaming()"
            [attr.aria-busy]="chat.streaming()"
          >
            {{ chat.streaming() ? '…' : 'Ask' }}
          </button>
        </div>

        @if (palette()) {
          <div class="palette" id="dash-palette" role="listbox" aria-label="Slash commands">
            @for (m of matches(); track m.id; let i = $index) {
              <button
                type="button"
                role="option"
                class="p-row"
                [id]="'dash-palette-opt-' + i"
                [class.on]="i === paletteIdx()"
                [attr.aria-selected]="i === paletteIdx()"
                (mousedown)="$event.preventDefault(); pickPalette(m)"
                (mouseenter)="paletteIdx.set(i)"
              >
                <span class="p-g">{{ glyph(m.glyph) }}</span>
                <span class="p-tx">
                  <span class="p-id"
                    >/{{ m.id }}
                    @if (m.argHint) {
                      <span class="p-arg"> {{ m.argHint }}</span>
                    }
                  </span>
                  <span class="p-d">{{ m.description }}</span>
                </span>
              </button>
            }
            <div class="p-hint" aria-hidden="true">
              <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
              <span><kbd>↵</kbd> run</span>
              <span><kbd>tab</kbd> complete</span>
              <span><kbd>esc</kbd> close</span>
            </div>
          </div>
        }
      </form>
    </section>
  `,
  styles: [
    `
    .features-banner { display: grid; grid-template-columns: 1fr 1fr; gap: .85rem; padding: 1.25rem 1.5rem 0; }
    @media (max-width: 720px) { .features-banner { grid-template-columns: 1fr; } }
    .features-banner-card { display: flex; align-items: center; gap: 1rem; padding: 1rem 1.15rem; background: color-mix(in oklch, var(--ps-bg, #060610) 50%, transparent); border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent); border-radius: 14px; text-decoration: none; color: inherit; transition: border-color .15s ease, transform .15s ease; }
    .features-banner-card:hover { border-color: var(--ps-accent, #00e5ff); transform: translateY(-1px); }
    .features-banner-card-alt { border-color: color-mix(in oklch, #fbbf24 30%, transparent); }
    .features-banner-card-alt:hover { border-color: #fbbf24; }
    .features-banner-icon { flex-shrink: 0; display: inline-flex; color: var(--ps-accent, #00e5ff); }
    .features-banner-icon svg { width: 26px; height: 26px; display: block; }
    .features-banner-icon--alt { color: #fbbf24; }
    .features-banner-body { display: flex; flex-direction: column; gap: .15rem; flex: 1; }
    .features-banner-body strong { font-size: 1.05rem; }
    .features-banner-sub { font-size: .8rem; color: color-mix(in oklch, currentColor 65%, transparent); line-height: 1.45; }
    .features-banner-cta { font-size: 1.4rem; opacity: .65; }
    .features-banner-card:hover .features-banner-cta { opacity: 1; }
    `,
    `
      :host {
        display: block;
        position: relative;
        height: 100%;
        min-height: calc(100vh - 64px);
        overflow: hidden;
      }
      .dash {
        position: relative;
        height: 100%;
        min-height: calc(100vh - 64px);
        padding: 28px 24px 220px;
        max-width: 1100px;
        margin: 0 auto;
        color: var(--ps-ink, #f4f4ff);
      }

      /* Hero */
      .hero {
        text-align: center;
        padding: 80px 12px 36px;
        position: relative;
      }
      .halo {
        position: absolute;
        inset: -40px 10% auto 10%;
        height: 280px;
        background:
          radial-gradient(ellipse 60% 100% at 50% 0%, rgba(0, 229, 255, 0.18), transparent 70%),
          radial-gradient(ellipse 40% 80% at 30% 30%, rgba(124, 58, 237, 0.18), transparent 70%);
        filter: blur(40px);
        z-index: -1;
        pointer-events: none;
      }
      .h {
        font-family: 'Sora', system-ui, sans-serif;
        font-size: clamp(2rem, 4vw, 3.4rem);
        font-weight: 600;
        letter-spacing: -0.02em;
        margin: 0 0 14px;
        background: linear-gradient(135deg, #00e5ff 0%, #7c3aed 50%, #f4f4ff 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }
      .s {
        font-size: 1rem;
        opacity: 0.7;
        max-width: 580px;
        margin: 0 auto;
        text-wrap: balance;
      }
      .examples {
        list-style: none;
        padding: 0;
        margin: 28px 0 0;
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
      }
      .examples button {
        padding: 8px 14px;
        min-height: 36px;
        border-radius: 999px;
        background: rgba(0, 229, 255, 0.05);
        border: 1px solid rgba(0, 229, 255, 0.18);
        color: var(--ps-ink, #f4f4ff);
        cursor: pointer;
        font: inherit;
        font-size: 0.82rem;
        transition:
          background 200ms ease,
          transform 200ms ease;
      }
      .examples button:hover:not([disabled]) {
        background: rgba(0, 229, 255, 0.12);
        transform: translateY(-1px);
      }
      .examples button[disabled] {
        opacity: 0.45;
        cursor: not-allowed;
      }

      /* Thread */
      .thread {
        display: flex;
        flex-direction: column;
        gap: 22px;
        padding: 8px 0 12px;
      }
      .msg.user .user-bubble {
        align-self: flex-end;
        max-width: 80%;
        margin-left: auto;
        padding: 10px 14px;
        background: rgba(0, 229, 255, 0.12);
        border: 1px solid rgba(0, 229, 255, 0.22);
        border-radius: 18px 18px 4px 18px;
        font-size: 0.92rem;
      }
      .msg.asst {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .asst-parts {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .prose {
        margin: 0;
        font-size: 0.95rem;
        line-height: 1.55;
        opacity: 0.92;
        text-wrap: pretty;
      }
      .streaming {
        display: inline-flex;
        gap: 6px;
        align-items: center;
        padding: 10px 14px;
        background: rgba(124, 58, 237, 0.08);
        border-radius: 14px;
      }
      .streaming .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: rgba(0, 229, 255, 0.8);
        animation: bob 1.4s ease-in-out infinite;
      }
      .streaming .dot:nth-child(2) {
        animation-delay: 0.16s;
      }
      .streaming .dot:nth-child(3) {
        animation-delay: 0.32s;
      }
      .strm-tx {
        font-size: 0.85rem;
        opacity: 0.75;
        margin-left: 8px;
        max-height: 1.4em;
        overflow: hidden;
      }
      @keyframes bob {
        0%,
        60%,
        100% {
          transform: translateY(0);
          opacity: 0.5;
        }
        30% {
          transform: translateY(-4px);
          opacity: 1;
        }
      }

      /* Pill row */
      .pills {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 96px;
        display: flex;
        gap: 8px;
        padding: 8px max(24px, env(safe-area-inset-left)) 8px max(24px, env(safe-area-inset-right));
        overflow-x: auto;
        scrollbar-width: none;
        justify-content: center;
        z-index: 30;
        pointer-events: auto;
      }
      .pills::-webkit-scrollbar {
        display: none;
      }
      .pill {
        flex: 0 0 auto;
        min-height: 36px;
        padding: 0 14px;
        border-radius: 999px;
        background: rgba(8, 8, 32, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: var(--ps-ink, #f4f4ff);
        cursor: pointer;
        font: inherit;
        font-size: 0.78rem;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        backdrop-filter: blur(10px);
        transition:
          border-color 180ms ease,
          transform 180ms ease;
      }
      .pill:hover:not([disabled]) {
        border-color: rgba(0, 229, 255, 0.4);
        transform: translateY(-1px);
      }
      .pill[disabled] {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .pill.on {
        border-color: rgba(0, 229, 255, 0.55);
        box-shadow:
          0 0 0 1px rgba(0, 229, 255, 0.3) inset,
          0 12px 28px -16px rgba(0, 229, 255, 0.4);
      }
      .pill .g {
        font-size: 0.95rem;
      }

      /* Dock */
      .dock {
        position: fixed;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        width: min(800px, calc(100vw - 32px));
        z-index: 40;
      }
      .dock-inner {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 6px 6px 18px;
        border-radius: 999px;
        background: rgba(8, 8, 32, 0.78);
        border: 1px solid rgba(0, 229, 255, 0.22);
        box-shadow:
          0 22px 64px rgba(0, 0, 0, 0.55),
          0 0 0 1px rgba(255, 255, 255, 0.04) inset;
        backdrop-filter: blur(20px);
      }
      .dock-slash {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.95rem;
        color: rgba(0, 229, 255, 0.55);
      }
      .dock-inner input {
        flex: 1;
        background: transparent;
        border: 0;
        outline: none;
        color: var(--ps-ink, #f4f4ff);
        font: inherit;
        font-size: 0.95rem;
        padding: 12px 0;
      }
      .dock-inner input::placeholder {
        color: rgba(255, 255, 255, 0.4);
      }
      .dock-go {
        min-height: 40px;
        min-width: 64px;
        padding: 0 18px;
        border-radius: 999px;
        background: linear-gradient(135deg, #00e5ff, #7c3aed);
        border: 0;
        color: #060610;
        font-weight: 700;
        cursor: pointer;
        transition:
          transform 200ms ease,
          box-shadow 200ms ease;
      }
      .dock-go:hover:not([disabled]) {
        transform: translateY(-1px);
        box-shadow: 0 16px 36px -16px rgba(0, 229, 255, 0.6);
      }
      .dock-go[disabled] {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Slash palette */
      .palette {
        position: absolute;
        left: 0;
        right: 0;
        bottom: calc(100% + 8px);
        background: rgba(12, 12, 32, 0.95);
        border-radius: 18px;
        border: 1px solid rgba(0, 229, 255, 0.18);
        box-shadow: 0 22px 64px rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(20px);
        max-height: 320px;
        overflow-y: auto;
        padding: 6px;
      }
      .p-row {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 8px 12px;
        min-height: 44px;
        background: transparent;
        border: 0;
        border-radius: 10px;
        color: var(--ps-ink, #f4f4ff);
        cursor: pointer;
        text-align: left;
      }
      .p-row.on {
        background: rgba(0, 229, 255, 0.1);
      }
      .p-g {
        font-size: 1.1rem;
        opacity: 0.75;
        width: 24px;
        text-align: center;
      }
      .p-tx {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .p-id {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.85rem;
        color: rgba(0, 229, 255, 0.9);
      }
      .p-arg {
        opacity: 0.5;
      }
      .p-d {
        font-size: 0.76rem;
        opacity: 0.65;
      }
      .p-hint {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        padding: 8px 10px 4px;
        margin-top: 4px;
        border-top: 1px solid rgba(0, 229, 255, 0.12);
        font-size: 0.64rem;
        color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent);
      }
      .p-hint kbd {
        font-family: inherit;
        font-size: 0.62rem;
        padding: 1px 5px;
        margin-right: 3px;
        border-radius: 5px;
        background: rgba(0, 229, 255, 0.1);
        border: 1px solid rgba(0, 229, 255, 0.25);
        color: var(--ps-accent, #00e5ff);
      }

      @media (max-width: 720px) {
        .dash {
          padding: 18px 14px 220px;
        }
        .pills {
          bottom: 86px;
        }
        .hero {
          padding: 40px 8px 24px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .streaming .dot {
          animation: none;
        }
      }
    `,
  ],
})
export class AdminDashboardComponent {
  chat = inject(DashboardChatService);
  registry = inject(SlashCommandRegistryService);
  private router = inject(Router);
  state = inject(AdminStateService);

  @ViewChild('input') inputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('thread') threadRef?: ElementRef<HTMLElement>;

  draft = '';
  palette = signal(false);
  paletteIdx = signal(0);
  matches = signal<SlashCommand[]>([]);

  readonly pills = computed(() => this.registry.commands());
  readonly examples = [
    'How is my site doing today?',
    'Show recent form submissions',
    '/snapshot',
    '/analytics 30d',
    '/calendar',
    '/billing',
  ];

  // ── Input handling ───────────────────────────────────────
  onInput(): void {
    const v = this.draft;
    if (v.startsWith('/')) {
      this.matches.set(this.registry.search(v));
      this.palette.set(this.matches().length > 0);
      this.paletteIdx.set(0);
    } else {
      this.palette.set(false);
    }
  }

  onKey(ev: KeyboardEvent): void {
    if (!this.palette()) return;
    const max = this.matches().length;
    if (ev.key === 'ArrowDown') {
      this.paletteIdx.update((i) => (i + 1) % max);
      ev.preventDefault();
    } else if (ev.key === 'ArrowUp') {
      this.paletteIdx.update((i) => (i - 1 + max) % max);
      ev.preventDefault();
    } else if (ev.key === 'Escape') {
      this.palette.set(false);
    } else if (ev.key === 'Tab') {
      const sel = this.matches()[this.paletteIdx()];
      if (sel) {
        this.draft = `/${sel.id}${sel.argHint ? ' ' : ''}`;
        this.palette.set(false);
        ev.preventDefault();
      }
    } else if (ev.key === 'Enter') {
      const sel = this.matches()[this.paletteIdx()];
      if (sel && this.draft.trim() === `/${sel.id}`) {
        ev.preventDefault();
        this.runCommand(sel, '');
      }
    }
  }

  pickPalette(cmd: SlashCommand): void {
    if (cmd.argHint) {
      this.draft = `/${cmd.id} `;
      this.palette.set(false);
      this.inputRef?.nativeElement.focus();
      return;
    }
    this.runCommand(cmd, '');
  }

  // ── Submit ──────────────────────────────────────────────
  onSubmit(ev: Event): void {
    ev.preventDefault();
    const raw = this.draft.trim();
    if (!raw || this.chat.streaming()) return;
    const parsed = this.registry.parse(raw);
    if (parsed) {
      const cmd = this.registry.commands().find((c) => c.id === parsed.id);
      if (cmd) {
        this.runCommand(cmd, parsed.arg);
        return;
      }
    }
    void this.chat.submit(raw);
    this.draft = '';
    this.palette.set(false);
    queueMicrotask(() => this.scrollEnd());
  }

  quick(prompt: string): void {
    if (this.chat.streaming()) return; // controls are disabled mid-stream; guard the no-op
    this.draft = prompt;
    const parsed = this.registry.parse(prompt);
    if (parsed) {
      const cmd = this.registry.commands().find((c) => c.id === parsed.id);
      if (cmd) {
        this.runCommand(cmd, parsed.arg);
        return;
      }
    }
    void this.chat.submit(prompt);
    this.draft = '';
    queueMicrotask(() => this.scrollEnd());
  }

  pillClick(cmd: SlashCommand): void {
    if (this.chat.streaming()) return; // controls are disabled mid-stream; guard the no-op
    this.chat.setPill(cmd.id);
    this.runCommand(cmd, '');
  }

  /**
   * Route slash commands. Most pre-fill `/<id> <arg>` and ask the LLM,
   * letting the model emit appropriate widgets. A few hard-route to
   * dedicated pages (editor, docs) instead of asking the LLM.
   */
  private runCommand(cmd: SlashCommand, arg: string): void {
    this.chat.setPill(cmd.id);
    const fullCmd = `/${cmd.id}${arg ? ` ${arg}` : ''}`;
    if (cmd.autoSubmit === false && !arg) {
      this.draft = fullCmd + ' ';
      this.palette.set(false);
      this.inputRef?.nativeElement.focus();
      return;
    }
    // Hard-route a few that genuinely jump pages rather than ask the LLM.
    if (cmd.id === 'editor') {
      this.router.navigate(['/admin/editor']);
      return;
    }
    if (cmd.id === 'docs') {
      this.router.navigate(['/admin/docs']);
      return;
    }
    if (cmd.id === 'social') {
      // `/social` → Pulse Social composer. `/social new` opens the composer
      // pre-focused via `?action=new` (AdminSocialComponent ngOnInit reads
      // the query param + focuses the main textarea).
      const action = arg.trim().toLowerCase();
      const queryParams = action === 'new' ? { action: 'new' } : undefined;
      this.router.navigate(['/admin/social'], queryParams ? { queryParams } : {});
      return;
    }
    if (cmd.id === 'import') {
      if (!arg) {
        this.router.navigate(['/admin/import']);
        return;
      }
    }
    void this.chat.submit(fullCmd, cmd.id);
    this.draft = '';
    this.palette.set(false);
    queueMicrotask(() => this.scrollEnd());
  }

  private scrollEnd(): void {
    const el = this.threadRef?.nativeElement;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  // ── Slash trigger via global `/` keypress ───────────────
  @HostListener('document:keydown', ['$event'])
  onGlobalKey(ev: KeyboardEvent): void {
    if (ev.key !== '/' || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const target = ev.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    ev.preventDefault();
    this.inputRef?.nativeElement.focus();
    if (!this.draft.startsWith('/')) this.draft = '/';
    this.onInput();
  }

  glyph(name: string): string {
    const map: Record<string, string> = {
      globe: '🌐',
      camera: '📸',
      rocket: '🚀',
      inbox: '📥',
      shield: '🛡',
      chart: '📈',
      'credit-card': '💳',
      download: '⬇',
      calendar: '📅',
      clock: '⏱',
      grid: '▦',
      book: '📖',
      help: '?',
      code: '⌨',
      message: '💬',
    };
    return map[name] ?? '✦';
  }
}
