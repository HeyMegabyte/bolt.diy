/**
 * #32 — Cloudflare Turnstile widget for the create flow. Lazy-loads the Turnstile
 * script once, renders the challenge, and emits the verified token via
 * `(verified)`. When no `siteKey` is configured it renders NOTHING and emits no
 * token — so the whole feature stays inert (dark) until a site key is provisioned
 * AND the worker `turnstile_build_gate` flag is flipped on. Self-contained, no deps.
 */
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  type AfterViewInit,
  type OnDestroy,
} from '@angular/core';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Minimal shape of the global `turnstile` object we use (explicit-render API). */
interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: { sitekey: string; callback: (token: string) => void; 'error-callback'?: () => void; theme?: string },
  ): string;
  remove(widgetId: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;
/** Load the Turnstile script exactly once across the app (idempotent). */
function loadTurnstileScript(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('turnstile script failed'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

@Component({
  selector: 'app-turnstile-widget',
  standalone: true,
  template: `
    @if (siteKey) {
      <div #host class="ts-host" data-testid="turnstile-widget"></div>
    }
  `,
  styles: [
    `
      .ts-host {
        min-height: 65px;
        display: flex;
        justify-content: center;
      }
    `,
  ],
})
export class TurnstileWidgetComponent implements AfterViewInit, OnDestroy {
  /** Cloudflare Turnstile SITE key (public). Empty → widget is inert (renders nothing). */
  @Input() siteKey = '';
  /** Emits the verified token; consumers attach it to the create payload. */
  @Output() verified = new EventEmitter<string>();

  @ViewChild('host') private host?: ElementRef<HTMLElement>;
  private widgetId: string | null = null;

  /** Test seam — overridable script loader. */
  protected load = loadTurnstileScript;

  async ngAfterViewInit(): Promise<void> {
    if (!this.siteKey || !this.host) return;
    try {
      await this.load();
    } catch {
      return; // script blocked / offline — stay inert, never break the form
    }
    if (!window.turnstile || !this.host) return;
    this.widgetId = window.turnstile.render(this.host.nativeElement, {
      sitekey: this.siteKey,
      theme: 'dark',
      callback: (token: string) => this.verified.emit(token),
    });
  }

  ngOnDestroy(): void {
    if (this.widgetId && window.turnstile) {
      try {
        window.turnstile.remove(this.widgetId);
      } catch {
        /* already gone */
      }
    }
  }
}
