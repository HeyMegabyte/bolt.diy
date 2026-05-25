import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { RevealDirective } from '../../../directives/reveal.directive';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { BeforeAfterSliderComponent } from '../../../components/before-after-slider/before-after-slider.component';
import { TrustStripComponent } from '../../../components/trust-strip/trust-strip.component';
import { UnifiedAiSectionComponent } from './sections/unified-ai-section.component';
import { TelemetryService } from '../../../services/telemetry.service';
import { AuthService } from '../../../services/auth.service';

/**
 * Cinematic landing page — voice-of-the-product hero.
 *
 * @remarks
 * Persona-aligned (see `src/prompts/dashboard_persona.ts`): full-bleed dark
 * canvas, animated OKLCH gradient mesh, single declarative headline, a
 * typing-AI input that routes to `/create?name=…`, a cycling typewriter
 * sub-headline, the shared trust strip, three cinematic mini-stories with
 * rolling counters, the before/after slider, and a one-line footer with
 * easter-egg credits.
 *
 * **Mounted at `/`.** Old marketing homepage lives at `/classic` for
 * fallback. Pure Web Animations API + existing components — no new deps.
 *
 * Respects `prefers-reduced-motion`, brand tokens (`--ps-*`) only, mobile
 * responsive at the standard 6 breakpoints.
 *
 * @example
 * ```html
 * <app-cinematic-landing />
 * ```
 */
@Component({
  selector: 'app-cinematic-landing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    RevealDirective,
    RollingCounterComponent,
    BeforeAfterSliderComponent,
    TrustStripComponent,
    UnifiedAiSectionComponent,
  ],
  template: `
    <main class="cl-shell" data-testid="cinematic-landing">
      <!-- ── HERO ───────────────────────────────────────────── -->
      <section class="cl-hero">
        <div class="cl-mesh" aria-hidden="true">
          <span class="cl-mesh-blob cl-mesh-blob--cyan"></span>
          <span class="cl-mesh-blob cl-mesh-blob--violet"></span>
          <span class="cl-mesh-blob cl-mesh-blob--azure"></span>
          <span class="cl-mesh-grain"></span>
        </div>

        <div class="cl-hero-inner" appReveal>
          <span class="cl-eyebrow">projectsites.dev</span>
          <h1 class="cl-headline">
            We don&rsquo;t sell websites.<br />
            We deliver them.
          </h1>
          <p class="cl-sub" aria-live="polite">
            <span class="cl-sub-prefix">{{ subPrefix() }}</span>
            <span class="cl-sub-typed">{{ typed() }}</span>
            <span class="cl-caret" [class.is-blink]="caretBlink()">|</span>
          </p>

          <form
            class="cl-pill"
            data-testid="cinematic-pill"
            (submit)="onSubmit($event)"
            role="search"
            aria-label="Tell the AI what to build"
          >
            <span class="cl-pill-glyph" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2v4" />
                <path d="M12 18v4" />
                <path d="M4.93 4.93l2.83 2.83" />
                <path d="M16.24 16.24l2.83 2.83" />
                <path d="M2 12h4" />
                <path d="M18 12h4" />
                <path d="M4.93 19.07l2.83-2.83" />
                <path d="M16.24 7.76l2.83-2.83" />
              </svg>
            </span>
            <input
              #pill
              class="cl-pill-input"
              data-testid="cinematic-pill-input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              [(ngModel)]="draft"
              name="prompt"
              [placeholder]="placeholder()"
              aria-label="Describe your business"
            />
            <button
              type="submit"
              class="cl-pill-go"
              data-testid="cinematic-pill-go"
              [disabled]="!draft.trim()"
              aria-label="Begin"
            >
              <span>Begin</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </form>

          <p class="cl-microcopy" appReveal [revealDelay]="220">
            Press Enter. We&rsquo;ll handle the smoke.
          </p>
        </div>
      </section>

      <!-- ── UNIFIED AI SECTION ────────────────────────────── -->
      <app-unified-ai-section />

      <!-- ── TRUST STRIP ───────────────────────────────────── -->
      <section class="cl-strip" appReveal>
        <app-trust-strip />
      </section>

      <!-- ── CINEMATIC MINI-STORIES ────────────────────────── -->
      <section class="cl-stories" aria-label="What we deliver">
        <article class="cl-story" appReveal>
          <span class="cl-story-eyebrow">Speed</span>
          <h2 class="cl-story-h">From idea to live URL.</h2>
          <p class="cl-story-stat">
            <app-rolling-counter [value]="4" />
            <span class="cl-story-unit">minutes, end to end</span>
          </p>
          <p class="cl-story-body">
            One prompt. SSL. CDN. Schema. Done before the espresso settles.
          </p>
        </article>

        <article class="cl-story" appReveal [revealDelay]="140">
          <span class="cl-story-eyebrow">Editor</span>
          <h2 class="cl-story-h">Edit in your browser.</h2>
          <p class="cl-story-stat">
            <app-rolling-counter [value]="1" />
            <span class="cl-story-unit">click to push the PR</span>
          </p>
          <p class="cl-story-body">
            bolt.diy lives inside the admin. The AI writes the PR body for you.
          </p>
        </article>

        <article class="cl-story" appReveal [revealDelay]="280">
          <span class="cl-story-eyebrow">Apps</span>
          <h2 class="cl-story-h">Ten self-hostable apps.</h2>
          <p class="cl-story-stat">
            <app-rolling-counter [value]="10" />
            <span class="cl-story-unit">one click each, your edge</span>
          </p>
          <p class="cl-story-body">
            Umami, Plausible, Listmonk, Cal.com &mdash; deployed to your Workers.
          </p>
        </article>
      </section>

      <!-- ── BEFORE / AFTER ────────────────────────────────── -->
      <section class="cl-compare" appReveal>
        <header class="cl-compare-head">
          <span class="cl-eyebrow">Proof</span>
          <h2 class="cl-compare-h">Drag the line. See the difference.</h2>
        </header>
        <div class="cl-compare-frame">
          <app-before-after-slider
            beforeSrc="/assets/images/before-generic.png"
            afterSrc="/assets/images/after-projectsites.png"
            beforeLabel="Generic competitor"
            afterLabel="Built with projectsites.dev"
            ariaLabel="Reveal the projectsites.dev version"
          />
        </div>
      </section>

      <!-- ── FOOTER ────────────────────────────────────────── -->
      <footer class="cl-foot" appReveal>
        <p class="cl-foot-line">
          We don&rsquo;t sell websites. We deliver them.
        </p>
        <p class="cl-foot-meta">
          <a class="cl-foot-link" href="mailto:hey&#64;megabyte.space">hey&#64;megabyte.space</a>
          <span class="cl-foot-sep" aria-hidden="true">&middot;</span>
          <a class="cl-foot-link" routerLink="/classic">Classic homepage</a>
          <span class="cl-foot-sep" aria-hidden="true">&middot;</span>
          <span class="cl-foot-egg" title="cinematic-ui-patterns · monitor-cron · 2026">
            built by ghosts in the machine
          </span>
        </p>
      </footer>
    </main>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      background: var(--ps-bg, #060610);
      color: var(--ps-ink, #f4f4ff);
      font-family: 'Sora', 'Space Grotesk', system-ui, -apple-system, sans-serif;
    }
    .cl-shell {
      display: flex; flex-direction: column;
      max-width: 1280px; margin: 0 auto;
      padding: 0 clamp(16px, 4vw, 48px) 64px;
    }

    /* ── HERO ─────────────────────────────────────────── */
    .cl-hero {
      position: relative;
      isolation: isolate;
      min-height: clamp(560px, 86vh, 880px);
      padding: clamp(56px, 10vh, 120px) 0 clamp(40px, 8vh, 96px);
      display: grid; place-items: center;
      overflow: hidden;
    }
    .cl-mesh {
      position: absolute; inset: -10%;
      z-index: -1;
      pointer-events: none;
    }
    .cl-mesh-blob {
      position: absolute;
      width: clamp(380px, 60vw, 760px);
      aspect-ratio: 1;
      border-radius: 50%;
      filter: blur(110px) saturate(140%);
      opacity: 0.55;
      mix-blend-mode: screen;
      animation: clMeshFloat 18s ease-in-out infinite alternate;
    }
    .cl-mesh-blob--cyan {
      background: oklch(78% 0.22 195);
      top: -8%; left: -10%;
      animation-delay: -2s;
    }
    .cl-mesh-blob--violet {
      background: oklch(62% 0.26 295);
      bottom: -16%; right: -12%;
      animation-delay: -7s;
    }
    .cl-mesh-blob--azure {
      background: oklch(70% 0.20 245);
      top: 20%; right: 12%;
      animation-delay: -12s;
      width: clamp(280px, 42vw, 540px);
      opacity: 0.4;
    }
    .cl-mesh-grain {
      position: absolute; inset: 0;
      background-image: radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px);
      background-size: 3px 3px;
      opacity: 0.5;
    }
    @keyframes clMeshFloat {
      from { transform: translate3d(0,0,0) scale(1); }
      to { transform: translate3d(40px,-30px,0) scale(1.08); }
    }
    @media (prefers-reduced-motion: reduce) {
      .cl-mesh-blob { animation: none; }
    }

    .cl-hero-inner {
      text-align: center;
      max-width: 880px;
      display: flex; flex-direction: column; align-items: center;
      gap: clamp(18px, 3vh, 30px);
    }
    .cl-eyebrow {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: color-mix(in oklch, var(--ps-accent, #00e5ff) 70%, var(--ps-ink, #f4f4ff) 30%);
    }
    .cl-headline {
      margin: 0;
      font-family: 'Sora', system-ui, sans-serif;
      font-weight: 700;
      font-size: clamp(2.5rem, 7.5vw, 5.25rem);
      line-height: 1.02;
      letter-spacing: -0.025em;
      text-wrap: balance;
      background: linear-gradient(180deg,
        var(--ps-ink, #f4f4ff) 30%,
        color-mix(in oklch, var(--ps-ink, #f4f4ff) 70%, transparent 30%) 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .cl-sub {
      margin: 0;
      font-size: clamp(1rem, 1.5vw, 1.18rem);
      line-height: 1.5;
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 70%, transparent 30%);
      min-height: 1.8em;
      text-wrap: pretty;
    }
    .cl-sub-prefix { opacity: 0.7; margin-right: 6px; }
    .cl-sub-typed {
      color: var(--ps-ink, #f4f4ff);
      font-weight: 500;
    }
    .cl-caret {
      display: inline-block;
      width: 0.6ch;
      color: var(--ps-accent, #00e5ff);
      opacity: 0;
      transform: translateY(-1px);
    }
    .cl-caret.is-blink { opacity: 1; animation: clCaret 1s steps(1) infinite; }
    @keyframes clCaret { 50% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .cl-caret.is-blink { animation: none; opacity: 1; }
    }

    .cl-pill {
      display: flex; align-items: center;
      gap: 8px;
      width: min(640px, 100%);
      padding: 6px 6px 6px 16px;
      background: rgba(10, 10, 26, 0.7);
      border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 14%, transparent);
      border-radius: 999px;
      backdrop-filter: blur(18px) saturate(160%);
      -webkit-backdrop-filter: blur(18px) saturate(160%);
      box-shadow:
        0 18px 48px rgba(0,0,0,0.5),
        inset 0 1px 0 rgba(255,255,255,0.04);
      transition: border-color 220ms ease, transform 220ms ease, box-shadow 220ms ease;
    }
    .cl-pill:focus-within {
      border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 60%, transparent);
      transform: translateY(-1px);
      box-shadow:
        0 22px 56px rgba(0,0,0,0.55),
        0 0 0 4px color-mix(in oklch, var(--ps-accent, #00e5ff) 18%, transparent);
    }
    .cl-pill-glyph {
      display: inline-flex;
      color: color-mix(in oklch, var(--ps-accent, #00e5ff) 75%, var(--ps-ink, #f4f4ff) 25%);
    }
    .cl-pill-input {
      flex: 1;
      min-width: 0;
      height: 42px;
      background: transparent;
      border: 0;
      color: var(--ps-ink, #f4f4ff);
      font: inherit;
      font-size: 1rem;
      outline: none;
    }
    .cl-pill-input::placeholder {
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 45%, transparent);
    }
    .cl-pill-go {
      display: inline-flex; align-items: center; gap: 6px;
      height: 38px; padding: 0 16px;
      border-radius: 999px;
      background: linear-gradient(135deg,
        oklch(72% 0.22 195),
        oklch(62% 0.24 285));
      color: #060610;
      font-weight: 600; font-size: 0.88rem; letter-spacing: 0.01em;
      border: 0; cursor: pointer;
      transition: transform 180ms ease, filter 180ms ease;
    }
    .cl-pill-go:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
    .cl-pill-go:disabled { opacity: 0.4; cursor: not-allowed; }
    .cl-pill-go:focus-visible {
      outline: 2px solid var(--ps-accent, #00e5ff);
      outline-offset: 3px;
    }
    .cl-microcopy {
      margin: 0;
      font-size: 0.82rem;
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.04em;
    }

    /* ── STRIP ────────────────────────────────────────── */
    .cl-strip {
      margin-top: clamp(8px, 2vh, 24px);
      padding: 12px 0 32px;
      opacity: 0.92;
    }

    /* ── STORIES ──────────────────────────────────────── */
    .cl-stories {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: clamp(16px, 2vw, 28px);
      margin: clamp(40px, 8vh, 88px) 0;
    }
    .cl-story {
      position: relative;
      padding: clamp(22px, 3vw, 32px);
      background: linear-gradient(180deg,
        color-mix(in oklch, var(--ps-ink, #f4f4ff) 5%, transparent),
        color-mix(in oklch, var(--ps-ink, #f4f4ff) 2%, transparent));
      border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent);
      border-radius: var(--ps-radius-xl, 22px);
      overflow: hidden;
      transition: transform 240ms ease, border-color 240ms ease;
    }
    .cl-story::before {
      content: '';
      position: absolute; top: 0; left: 0; height: 2px; width: 100%;
      background: linear-gradient(90deg,
        color-mix(in oklch, var(--ps-accent, #00e5ff) 90%, transparent),
        transparent 70%);
      opacity: 0.55;
    }
    .cl-story:hover {
      transform: translateY(-3px);
      border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent);
    }
    .cl-story-eyebrow {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase;
      color: color-mix(in oklch, var(--ps-accent, #00e5ff) 75%, var(--ps-ink, #f4f4ff) 25%);
    }
    .cl-story-h {
      margin: 10px 0 14px;
      font-size: clamp(1.3rem, 2.2vw, 1.7rem);
      font-weight: 600;
      letter-spacing: -0.015em;
      text-wrap: balance;
    }
    .cl-story-stat {
      display: flex; align-items: baseline; gap: 10px;
      margin: 0 0 12px;
      font-size: clamp(2.3rem, 5vw, 3.1rem);
      font-weight: 700;
      color: oklch(from var(--ps-accent, #00e5ff) max(l, 0.78) max(c, 0.22) h);
      line-height: 1;
    }
    .cl-story-unit {
      font-size: 0.86rem; font-weight: 400;
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
      letter-spacing: 0;
    }
    .cl-story-body {
      margin: 0;
      font-size: 0.95rem;
      line-height: 1.55;
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 78%, transparent);
      text-wrap: pretty;
    }

    /* ── BEFORE/AFTER ─────────────────────────────────── */
    .cl-compare {
      margin: clamp(40px, 8vh, 88px) 0;
    }
    .cl-compare-head {
      display: flex; flex-direction: column; gap: 8px;
      align-items: center; text-align: center;
      margin-bottom: clamp(20px, 3vh, 36px);
    }
    .cl-compare-h {
      margin: 0;
      font-size: clamp(1.6rem, 3.5vw, 2.4rem);
      font-weight: 600; letter-spacing: -0.02em;
      text-wrap: balance;
    }
    .cl-compare-frame {
      border-radius: var(--ps-radius-xl, 22px);
      overflow: hidden;
      border: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent);
      box-shadow: 0 24px 64px rgba(0,0,0,0.5);
    }

    /* ── FOOTER ───────────────────────────────────────── */
    .cl-foot {
      margin-top: clamp(40px, 8vh, 96px);
      padding: 28px 0 8px;
      border-top: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 8%, transparent);
      display: flex; flex-direction: column; gap: 12px;
      align-items: center; text-align: center;
    }
    .cl-foot-line {
      margin: 0;
      font-size: clamp(1.05rem, 1.6vw, 1.25rem);
      font-weight: 500;
      letter-spacing: -0.01em;
      color: var(--ps-ink, #f4f4ff);
    }
    .cl-foot-meta {
      margin: 0;
      display: inline-flex; flex-wrap: wrap; justify-content: center;
      gap: 10px;
      font-size: 0.84rem;
      color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent);
    }
    .cl-foot-link {
      color: color-mix(in oklch, var(--ps-accent, #00e5ff) 70%, var(--ps-ink, #f4f4ff) 30%);
      text-decoration: none;
    }
    .cl-foot-link:hover { text-decoration: underline; }
    .cl-foot-sep { opacity: 0.4; }
    .cl-foot-egg {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.78rem;
      letter-spacing: 0.04em;
      opacity: 0.7;
    }

    /* ── BREAKPOINTS ──────────────────────────────────── */
    @media (max-width: 640px) {
      .cl-pill { padding: 4px 4px 4px 12px; }
      .cl-pill-go span { display: none; }
      .cl-pill-go { padding: 0 12px; }
      .cl-foot-meta { flex-direction: column; gap: 6px; }
      .cl-foot-sep { display: none; }
    }
  `],
})
export class CinematicLandingComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly telemetry = inject(TelemetryService);
  private readonly auth = inject(AuthService);

  @ViewChild('pill') pillRef?: ElementRef<HTMLInputElement>;

  /** Bound to the AI pill input. */
  draft = '';

  /** Typewriter state. */
  readonly typed = signal('');
  readonly caretBlink = signal(true);
  readonly subPrefix = signal('');

  /** Placeholder cycles through persona-aligned examples. */
  readonly placeholder = signal('build me a website for…');

  /** Five persona-voice sub-headlines that cycle in the hero. */
  private readonly cycles: { prefix: string; text: string }[] = [
    { prefix: 'We', text: 'ship the truth.' },
    { prefix: 'You', text: 'describe it. We build it.' },
    { prefix: 'Live', text: 'in four minutes. SSL included.' },
    { prefix: 'Edit', text: 'in your browser. Push the PR.' },
    { prefix: 'Ten', text: 'self-hostable apps. One click each.' },
  ];

  private cycleIdx = 0;
  private typeFrame: ReturnType<typeof setTimeout> | null = null;

  private readonly placeholderCycles = [
    'build me a website for a Newark soup kitchen',
    'rebuild stripe.com but better',
    'launch a salon site for Lake Hiawatha',
    'spin up a portfolio for a Brooklyn photographer',
  ];
  private placeholderIdx = 0;
  private placeholderFrame: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      // SSR-safe — render the first cycle statically.
      this.typed.set(this.cycles[0].text);
      this.subPrefix.set(this.cycles[0].prefix);
      this.caretBlink.set(false);
      return;
    }
    this.telemetry.track('landing.cinematic.viewed', { variant: 'cinematic' });

    // Honor reduced-motion: skip the typewriter entirely.
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduce) {
      this.typed.set(this.cycles[0].text);
      this.subPrefix.set(this.cycles[0].prefix);
      this.caretBlink.set(false);
    } else {
      this.runTypewriter();
      this.runPlaceholderCycle();
    }
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    // Focus delegated — don't steal focus, but make the input first-tab.
    // (Skipping auto-focus on purpose: marketing page, not modal.)
  }

  ngOnDestroy(): void {
    if (this.typeFrame) clearTimeout(this.typeFrame);
    if (this.placeholderFrame) clearTimeout(this.placeholderFrame);
  }

  /**
   * Type out current cycle, hold, erase, advance. Pure setTimeout — no rxjs.
   */
  private runTypewriter(): void {
    const target = this.cycles[this.cycleIdx];
    this.subPrefix.set(target.prefix);
    this.caretBlink.set(false);

    let i = 0;
    const tick = (): void => {
      i += 1;
      this.typed.set(target.text.slice(0, i));
      if (i < target.text.length) {
        this.typeFrame = setTimeout(tick, 38);
      } else {
        this.caretBlink.set(true);
        this.typeFrame = setTimeout(() => this.eraseAndAdvance(), 2400);
      }
    };
    tick();
  }

  private eraseAndAdvance(): void {
    const current = this.typed();
    let i = current.length;
    this.caretBlink.set(false);
    const tick = (): void => {
      i -= 1;
      this.typed.set(current.slice(0, Math.max(0, i)));
      if (i > 0) {
        this.typeFrame = setTimeout(tick, 22);
      } else {
        this.cycleIdx = (this.cycleIdx + 1) % this.cycles.length;
        this.typeFrame = setTimeout(() => this.runTypewriter(), 250);
      }
    };
    tick();
  }

  /** Cycle the input placeholder every ~5s so it reads as alive. */
  private runPlaceholderCycle(): void {
    this.placeholderFrame = setTimeout(() => {
      this.placeholderIdx = (this.placeholderIdx + 1) % this.placeholderCycles.length;
      this.placeholder.set(this.placeholderCycles[this.placeholderIdx]);
      this.runPlaceholderCycle();
    }, 5200);
  }

  /**
   * Pill submit handler. Routes to `/create?name=<draft>` with the AI
   * autofill pre-seeded. Logged in users skip the signin gate.
   */
  onSubmit(event: Event): void {
    event.preventDefault();
    const name = this.draft.trim();
    if (!name) return;
    this.telemetry.track('landing.cinematic.pill_submit', { length: name.length });

    // Stash the prompt for /create to read on mount.
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem(
          'ps_create_draft',
          JSON.stringify({ prompt: name, source: 'cinematic-landing', ts: Date.now() }),
        );
      } catch {
        // Private mode / quota — fine, the query param is the fallback.
      }
    }

    const dest = this.auth.isLoggedIn() ? '/create' : '/signin';
    this.router.navigate([dest], { queryParams: { name, source: 'cinematic' } });
  }
}
