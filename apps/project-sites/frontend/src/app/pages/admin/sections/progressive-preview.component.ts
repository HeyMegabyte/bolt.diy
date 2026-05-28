/**
 * Progressive Preview component (#6) — <app-progressive-preview>
 *
 * Subscribes to the swarm SSE channel and progressively swaps skeleton
 * shimmer blocks for real components as they arrive. Uses View Transitions
 * API for smooth swap-in animations.
 *
 * Per [[cinematic-ui-patterns]]:
 *  - @starting-style on component swap-in
 *  - View Transitions for skeleton → real component
 *  - prefers-reduced-motion gated
 *  - appReveal on containing section
 *
 * Flag: live_stream_preview.
 */

import {
  Component, Input, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ComponentStreamEvent {
  type: 'skeleton_live' | 'component_ready' | 'all_components_ready' | 'connected';
  component?: string;
  components?: string[];
  index?: number;
  total?: number;
  progress_pct?: number;
  ts?: string;
}

const SKELETON_SLOTS = ['nav', 'hero', 'features', 'social-proof', 'pricing', 'testimonials', 'faq', 'cta', 'footer'];

@Component({
  selector: 'app-progressive-preview',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pp-shell" [class.pp-shell--active]="sseConnected()" appReveal>
  <div class="pp-header">
    <span class="pp-header__label">Live Component Stream</span>
    <div class="pp-header__badge" [class.pp-header__badge--live]="sseConnected()">
      {{ sseConnected() ? '● LIVE' : '○ Offline' }}
    </div>
  </div>

  <div class="pp-progress" role="progressbar"
       [attr.aria-valuenow]="progressPct()" aria-valuemin="0" aria-valuemax="100"
       [attr.aria-label]="'Page assembly ' + progressPct() + '% complete'">
    <div class="pp-progress__fill" [style.width.%]="progressPct()"></div>
  </div>

  <div class="pp-slots" aria-live="polite" aria-label="Component assembly status">
    @for (slot of slots; track slot) {
      <div class="pp-slot"
           [class.pp-slot--done]="isDone(slot)"
           [class.pp-slot--active]="isActive(slot)"
           [class.pp-slot--skeleton]="!isDone(slot) && !isActive(slot)"
           [id]="'pp-slot-' + slot">
        <span class="pp-slot__name">{{ slot }}</span>
        @if (isDone(slot)) {
          <span class="pp-slot__tick" aria-label="ready">✓</span>
        } @else if (isActive(slot)) {
          <span class="pp-slot__spinner" aria-label="streaming">⟳</span>
        }
      </div>
    }
  </div>

  @if (!sseConnected() && !autoConnect) {
    <button class="pp-connect" (click)="connect()" type="button">
      Connect stream →
    </button>
  }

  @if (allReady()) {
    <p class="pp-complete">
      ✓ All {{ slots.length }} components ready
    </p>
  }
</div>
  `,
  styles: [`
    :host { display: block; }
    .pp-shell { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-radius: 8px; padding: 0.625rem; }
    .pp-shell--active { border-color: rgba(0,229,255,.3); }
    .pp-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
    .pp-header__label { font-size: 0.7rem; font-weight: 600; opacity: 0.8; }
    .pp-header__badge { font-size: 0.6rem; font-family: 'JetBrains Mono', monospace; padding: 0.1rem 0.4rem; border-radius: 9999px; background: rgba(255,255,255,.08); }
    .pp-header__badge--live { background: rgba(0,229,255,.15); color: #00e5ff; animation: live-pulse 1.5s ease-in-out infinite; }
    @keyframes live-pulse { 0%,100%{opacity:1} 50%{opacity:.6} }
    .pp-progress { background: rgba(255,255,255,.08); border-radius: 9999px; height: 3px; margin-bottom: 0.625rem; overflow: hidden; }
    .pp-progress__fill { background: var(--ps-accent, #00e5ff); height: 100%; border-radius: 9999px; transition: width 0.5s ease; }
    .pp-slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 0.25rem; }
    .pp-slot { display: flex; align-items: center; justify-content: space-between; padding: 0.25rem 0.375rem; border-radius: 4px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06); font-size: 0.6rem; min-height: 24px; transition: all 0.3s; }
    .pp-slot--done { border-color: #10b981; background: rgba(16,185,129,.05); }
    .pp-slot--active { border-color: var(--ps-accent, #00e5ff); }
    .pp-slot--skeleton .pp-slot__name { opacity: 0.4; }
    .pp-slot__tick { color: #10b981; }
    .pp-slot__spinner { color: var(--ps-accent, #00e5ff); animation: spin 1s linear infinite; display: inline-block; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .pp-connect { margin-top: 0.5rem; background: rgba(0,229,255,.1); border: 1px solid rgba(0,229,255,.3); color: var(--ps-accent, #00e5ff); padding: 0.25rem 0.625rem; border-radius: 9999px; font-size: 0.7rem; cursor: pointer; width: 100%; }
    .pp-complete { font-size: 0.7rem; color: #10b981; margin: 0.5rem 0 0; text-align: center; }
    @media (prefers-reduced-motion: reduce) {
      .pp-slot, .pp-progress__fill { transition: none; }
      .pp-slot__spinner, .pp-header__badge--live { animation: none; }
    }
  `],
})
export class ProgressivePreviewComponent implements OnInit, OnDestroy {
  /** Site ID whose swarm stream to subscribe. */
  @Input() siteId = '';
  /** When true, connects automatically on mount. */
  @Input() autoConnect = false;

  private cdr = inject(ChangeDetectorRef);

  readonly slots = SKELETON_SLOTS;
  readonly sseConnected = signal(false);
  readonly componentsReady = signal<string[]>([]);
  readonly activeComponent = signal<string | null>(null);
  readonly progressPct = signal(0);

  readonly allReady = () => this.componentsReady().length >= this.slots.length;

  private sseSource: EventSource | null = null;

  ngOnInit() {
    if (this.autoConnect && this.siteId) this.connect();
  }

  ngOnDestroy() { this.disconnect(); }

  connect() {
    if (this.sseConnected() || !this.siteId) return;
    const url = `/api/swarm/${this.siteId}/stream?mode=progressive`;
    this.sseSource = new EventSource(url);
    this.sseConnected.set(true);

    this.sseSource.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data) as ComponentStreamEvent;
        if (data.type === 'component_ready' && data.component) {
          const comp = data.component;
          this.componentsReady.update((prev) => [...prev, comp]);
          this.activeComponent.set(comp);
          this.progressPct.set(data.progress_pct ?? Math.round((this.componentsReady().length / this.slots.length) * 100));
          this.swapInComponent(comp);
        }
        if (data.type === 'all_components_ready') {
          this.progressPct.set(100);
          this.activeComponent.set(null);
          this.disconnect();
        }
        this.cdr.markForCheck();
      } catch { /* ignore */ }
    };

    this.sseSource.onerror = () => {
      this.sseConnected.set(false);
      this.cdr.markForCheck();
    };
  }

  disconnect() {
    this.sseSource?.close();
    this.sseSource = null;
    this.sseConnected.set(false);
  }

  isDone(slot: string) { return this.componentsReady().includes(slot); }
  isActive(slot: string) { return this.activeComponent() === slot; }

  private swapInComponent(comp: string) {
    const el = document.getElementById(`pp-slot-${comp}`);
    if (!el) return;
    // View Transitions swap-in when available + reduced motion check
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if ((document as { startViewTransition?: (cb: () => void) => void }).startViewTransition && !prefersReduced) {
      (document as { startViewTransition: (cb: () => void) => void }).startViewTransition(() => {
        el.classList.add('pp-slot--done');
        el.classList.remove('pp-slot--active', 'pp-slot--skeleton');
      });
    } else {
      el.classList.add('pp-slot--done');
      el.classList.remove('pp-slot--active', 'pp-slot--skeleton');
    }
  }
}
