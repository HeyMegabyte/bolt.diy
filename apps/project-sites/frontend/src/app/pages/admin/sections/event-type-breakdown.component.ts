import { Component, input } from '@angular/core';

interface TypeCount {
  type: string;
  count: number;
}

const LABELS: Readonly<Record<string, string>> = {
  pageview: 'Page views',
  conversion: 'Conversions',
  click: 'Clicks',
  cta_click: 'CTA clicks',
  form_submit: 'Form submissions',
  custom: 'Custom events',
};

/**
 * Events-by-type breakdown — renders the `byType` series the owner-analytics
 * summary already returns (it had zero UI). Sibling to the channel/device/
 * country breakdowns; shows the event mix (views vs CTA clicks vs conversions)
 * with human labels instead of raw `event_type` slugs.
 *
 * @example
 * <app-event-type-breakdown [items]="s.traffic.byType" />
 */
@Component({
  selector: 'app-event-type-breakdown',
  standalone: true,
  template: `
    @if (items().length) {
      <h2 class="text-[0.95rem] font-bold text-white mt-6 mb-2">Events by type</h2>
      <ul class="oa-paths" data-testid="oa-event-types">
        @for (e of items(); track e.type) {
          <li class="oa-path" data-testid="oa-event-type-row">
            <span class="oa-path-name">{{ label(e.type) }}</span>
            <span class="oa-path-count">{{ e.count }}</span>
          </li>
        }
      </ul>
    }
  `,
})
export class EventTypeBreakdownComponent {
  readonly items = input<TypeCount[]>([]);

  /** Human label for a raw event_type, with a de-underscored title-case fallback. */
  label(type: string): string {
    if (LABELS[type]) return LABELS[type];
    const words = type.replace(/_/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
}
