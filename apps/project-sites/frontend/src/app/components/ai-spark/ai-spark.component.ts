import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * @module components/ai-spark
 *
 * @description
 * Monochrome "sparkles" glyph marking an AI-powered affordance (Improve with AI,
 * Use AI, AI savings tip, …). Replaces the colourful `✨` emoji that read
 * off-brand on the dark cyan/black cockpit and added screen-reader noise.
 *
 * `stroke=currentColor` + em-sizing → it inherits whatever colour + font-size
 * its host sets (cyan on most buttons, violet inside the billing cost-insight
 * card). Decorative (`aria-hidden`) — the adjacent text label carries meaning.
 *
 * @example
 * ```html
 * <button class="btn-ghost"><app-ai-spark /> Improve with AI</button>
 * ```
 *
 * @packageDocumentation
 */
@Component({
  selector: 'app-ai-spark',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="ai-spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" />
      <path d="M20 3v4" /><path d="M22 5h-4" /><path d="M4 17v2" /><path d="M5 18H3" />
    </svg>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; }
    .ai-spark { width: 1em; height: 1em; }
  `],
})
export class AiSparkComponent {}
