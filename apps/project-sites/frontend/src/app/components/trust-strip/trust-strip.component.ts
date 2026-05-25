import { ChangeDetectionStrategy, Component } from '@angular/core';

interface TrustItem {
  name: string;
  /** Inline SVG markup — kept compact, single-color, currentColor stroked. */
  icon: string;
}

/**
 * "Built on" trust strip — five compact monochrome logos with hover-to-color.
 *
 * @remarks
 * Pure presentational. All colors flow from `var(--ps-*)` tokens so the
 * dark/light theme switch flips automatically.
 */
@Component({
  selector: 'app-trust-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ts-row">
      <span class="ts-eyebrow">Built on</span>
      <ul class="ts-list">
        @for (item of items; track item.name) {
          <li class="ts-item" [attr.aria-label]="item.name">
            <span class="ts-glyph" [innerHTML]="item.icon"></span>
            <span class="ts-name">{{ item.name }}</span>
          </li>
        }
      </ul>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        --ts-ink: var(--ps-ink, #f4f4ff);
        --ts-accent: var(--ps-accent, #00e5ff);
      }
      .ts-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 18px 28px;
        padding: 18px 16px;
      }
      .ts-eyebrow {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: color-mix(in oklch, var(--ts-ink) 55%, transparent);
      }
      .ts-list {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 14px 22px;
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .ts-item {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: color-mix(in oklch, var(--ts-ink) 70%, transparent);
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.02em;
        transition: color 220ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .ts-item:hover {
        color: var(--ts-accent);
      }
      .ts-glyph {
        display: inline-flex;
        width: 18px;
        height: 18px;
      }
      :host ::ng-deep svg {
        width: 18px;
        height: 18px;
      }

      @media (prefers-reduced-motion: reduce) {
        .ts-item {
          transition: none;
        }
      }
    `,
  ],
})
export class TrustStripComponent {
  readonly items: TrustItem[] = [
    {
      name: 'Cloudflare',
      icon: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.5 13.5c-.3-1-1.2-1.7-2.3-1.7H4.4c-.2 0-.4-.1-.4-.4 0-.2.1-.4.4-.4l9.9-.1c1.2 0 2.5-1 2.9-2.2l.5-1.3c0-.1 0-.2-.1-.2C16.7 4.2 13.8 2 10.4 2 7.2 2 4.6 4 3.6 6.9 3 6.5 2.2 6.3 1.4 6.4.6 6.5 0 7.1 0 7.9c0 .2 0 .4.1.6.2.4.5.7 1 .8 1.7.3 3.4 1.6 4.1 3.3l.6 1.3c0 .1.1.1.2.1H17c.1 0 .2-.1.2-.2l-.7-2.3zm3 0c-.1 0-.2.1-.2.2l-.4 1.4c0 .2.1.4.3.4h2.6c.2 0 .4-.1.4-.4 0-.2-.1-.4-.4-.4l-2.3-.2v-1z"/></svg>`,
    },
    {
      name: 'D1',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/></svg>`,
    },
    {
      name: 'R2',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4"/><path d="M3 17l9 4 9-4"/></svg>`,
    },
    {
      name: 'Workers AI',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z"/><path d="M5 17l.75 2.25L8 20l-2.25.75L5 23l-.75-2.25L2 20l2.25-.75L5 17z"/><path d="M19 14l.75 2.25L22 17l-2.25.75L19 20l-.75-2.25L16 17l2.25-.75L19 14z"/></svg>`,
    },
    {
      name: 'bolt.diy',
      icon: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L4.5 13.5h6L9 22l9.5-11.5h-6L13 2z"/></svg>`,
    },
  ];
}
