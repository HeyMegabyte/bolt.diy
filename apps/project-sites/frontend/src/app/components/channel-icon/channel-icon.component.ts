import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * @module components/channel-icon
 *
 * @description
 * Monochrome cyan Feather-style glyph for a conversation channel
 * (`form` / `chat` / `voice` / `sms` / `email`). Replaces the colourful emoji
 * (`📋 💬 📞 📱 ✉️`) that read off-brand on the dark cockpit and added
 * screen-reader noise. The glyph is decorative (`aria-hidden`) — the adjacent
 * channel label / row title carries the meaning.
 *
 * Sized in `em` so it inherits the parent font-size; coloured `currentColor`
 * (cyan accent by default) so it tints with its context.
 *
 * @example
 * ```html
 * <app-channel-icon [channel]="conv.channel" />
 * ```
 *
 * @remarks Reusable across the inbox rows + thread chip, the voice channel
 * pitch, and any future channel surface — one source of truth for channel glyphs.
 *
 * @packageDocumentation
 */
@Component({
  selector: 'app-channel-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="ci-glyph" aria-hidden="true" [attr.data-channel]="channel()">
      @switch (channel()) {
        @case ('form') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="3" width="16" height="18" rx="2" /><line x1="8" y1="8" x2="16" y2="8" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="8" y1="16" x2="12" y2="16" />
          </svg>
        }
        @case ('chat') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3a8.38 8.38 0 0 1 8.5 8.5z" />
          </svg>
        }
        @case ('voice') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
        }
        @case ('sms') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12" y2="18" />
          </svg>
        }
        @case ('email') {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m3 6 9 6 9-6" />
          </svg>
        }
        @default {
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12" y2="16" />
          </svg>
        }
      }
    </span>
  `,
  styles: [`
    :host { display: inline-flex; }
    .ci-glyph { display: inline-flex; align-items: center; justify-content: center; color: var(--ps-accent, #00e5ff); }
    .ci-glyph svg { width: 1em; height: 1em; }
  `],
})
export class ChannelIconComponent {
  /** Conversation channel key — `form` / `chat` / `voice` / `sms` / `email`. */
  readonly channel = input<string>('');
}
