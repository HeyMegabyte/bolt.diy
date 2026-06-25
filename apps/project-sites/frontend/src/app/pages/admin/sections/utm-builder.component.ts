/**
 * AN11 — one-click UTM builder. Lets a small-business owner tag a link for
 * "the Instagram ad" without knowing what a UTM is: pick a preset (or type a
 * source), paste the destination, get a ready-to-share tracking URL + copy it.
 * The tags round-trip through the AN1 ingest enrichment → the Your-Visitors
 * "Traffic by channel" widget, closing the loop from link → measurement.
 *
 * Pure frontend, no backend. Last destination persists to localStorage.
 */
import { Component, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface Preset {
  label: string;
  source: string;
  medium: string;
}

const PRESETS: ReadonlyArray<Preset> = [
  { label: 'Instagram', source: 'instagram', medium: 'social' },
  { label: 'Facebook', source: 'facebook', medium: 'social' },
  { label: 'Facebook ad', source: 'facebook', medium: 'paid' },
  { label: 'Google ad', source: 'google', medium: 'paid' },
  { label: 'Email', source: 'newsletter', medium: 'email' },
  { label: 'QR / print', source: 'flyer', medium: 'offline' },
];

const URL_KEY = 'ps_utm_dest_v1';

/** Slugify a free-typed source/campaign into a clean utm value (lowercase, dashed). */
export function utmSlug(raw: string): string {
  return (raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

/**
 * Build a tracking URL. Returns '' when the destination isn't a valid http(s)
 * URL or no source is set (the two required inputs).
 */
export function buildUtmUrl(dest: string, source: string, medium: string, campaign: string): string {
  const src = utmSlug(source);
  if (!src) return '';
  let u: URL;
  try {
    u = new URL(dest.trim());
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  u.searchParams.set('utm_source', src);
  const med = utmSlug(medium);
  if (med) u.searchParams.set('utm_medium', med);
  const camp = utmSlug(campaign);
  if (camp) u.searchParams.set('utm_campaign', camp);
  return u.toString();
}

@Component({
  selector: 'app-utm-builder',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="utm" data-testid="utm-builder">
      <h2 class="text-[0.95rem] font-bold text-white mb-1">Build a tracking link</h2>
      <p class="text-[0.76rem] text-text-secondary mb-3">
        Tag a link so "Traffic by channel" can tell you where visitors came from.
      </p>

      <div class="utm-presets" role="group" aria-label="Quick presets">
        @for (p of presets; track p.label) {
          <button
            type="button"
            class="utm-chip"
            [class.utm-chip--on]="source() === p.source && medium() === p.medium"
            [attr.data-testid]="'utm-preset-' + p.source"
            (click)="applyPreset(p)">
            {{ p.label }}
          </button>
        }
      </div>

      <label class="utm-field">
        <span>Destination link</span>
        <input
          type="url"
          [ngModel]="dest()"
          (ngModelChange)="setDest($event)"
          placeholder="https://yoursite.com/menu"
          data-testid="utm-dest"
          autocomplete="off"
          spellcheck="false" />
      </label>

      <div class="utm-row">
        <label class="utm-field">
          <span>Source</span>
          <input [ngModel]="source()" (ngModelChange)="source.set($event)" placeholder="instagram" data-testid="utm-source" />
        </label>
        <label class="utm-field">
          <span>Medium</span>
          <input [ngModel]="medium()" (ngModelChange)="medium.set($event)" placeholder="social" data-testid="utm-medium" />
        </label>
        <label class="utm-field">
          <span>Campaign <em>(optional)</em></span>
          <input [ngModel]="campaign()" (ngModelChange)="campaign.set($event)" placeholder="spring-menu" data-testid="utm-campaign" />
        </label>
      </div>

      @if (built()) {
        <div class="utm-out" data-testid="utm-output">
          <code class="utm-url">{{ built() }}</code>
          <button type="button" class="utm-copy" (click)="copy()" data-testid="utm-copy">
            {{ copied() ? 'Copied ✓' : 'Copy' }}
          </button>
        </div>
      } @else {
        <p class="utm-hint" data-testid="utm-hint">Add a destination link and a source to get your tracking URL.</p>
      }
    </section>
  `,
  styles: [
    `
      .utm {
        margin-top: 1.5rem;
        padding: 1rem 1.1rem;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(255, 255, 255, 0.02);
      }
      .utm-presets {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin-bottom: 0.85rem;
      }
      .utm-chip {
        padding: 0.3rem 0.7rem;
        border-radius: 999px;
        font-size: 0.74rem;
        font-weight: 600;
        cursor: pointer;
        color: #d7d7ea;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: transparent;
        transition: all 0.15s;
      }
      .utm-chip--on,
      .utm-chip:hover {
        color: var(--ps-accent, #00e5ff);
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 45%, transparent);
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 10%, transparent);
      }
      .utm-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 0.6rem;
      }
      .utm-field {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        margin-bottom: 0.6rem;
      }
      .utm-field span {
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-secondary, #9aa);
        font-weight: 700;
      }
      .utm-field em {
        text-transform: none;
        letter-spacing: 0;
        opacity: 0.6;
        font-style: normal;
      }
      .utm-field input {
        background: rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 0.45rem 0.6rem;
        color: #fff;
        font-size: 0.84rem;
      }
      .utm-field input:focus-visible {
        outline: 2px solid var(--ps-accent, #00e5ff);
        outline-offset: 1px;
      }
      .utm-out {
        display: flex;
        gap: 0.5rem;
        align-items: stretch;
        margin-top: 0.4rem;
      }
      .utm-url {
        flex: 1;
        min-width: 0;
        overflow-x: auto;
        white-space: nowrap;
        padding: 0.5rem 0.7rem;
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.35);
        color: var(--ps-accent, #00e5ff);
        font-size: 0.78rem;
      }
      .utm-copy {
        padding: 0 0.9rem;
        border-radius: 8px;
        font-size: 0.78rem;
        font-weight: 700;
        cursor: pointer;
        color: #03070a;
        background: var(--ps-accent, #00e5ff);
        border: none;
        white-space: nowrap;
      }
      .utm-hint {
        font-size: 0.76rem;
        color: var(--text-secondary, #9aa);
        margin-top: 0.2rem;
      }
    `,
  ],
})
export class UtmBuilderComponent {
  readonly presets = PRESETS;
  readonly dest = signal(this.restoreDest());
  readonly source = signal('');
  readonly medium = signal('');
  readonly campaign = signal('');
  readonly copied = signal(false);

  readonly built = computed(() =>
    buildUtmUrl(this.dest(), this.source(), this.medium(), this.campaign()),
  );

  setDest(v: string): void {
    this.dest.set(v);
    try {
      localStorage.setItem(URL_KEY, v);
    } catch {
      /* private mode / quota — ignore */
    }
  }

  applyPreset(p: Preset): void {
    this.source.set(p.source);
    this.medium.set(p.medium);
  }

  copy(): void {
    const url = this.built();
    if (!url) return;
    void navigator.clipboard?.writeText(url);
    this.copied.set(true);
  }

  private restoreDest(): string {
    try {
      return localStorage.getItem(URL_KEY) ?? '';
    } catch {
      return '';
    }
  }
}
