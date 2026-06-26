import { Component, computed, input } from '@angular/core';

interface BestTimeSlot {
  day: number; // 0 = Sunday … 6 = Saturday
  hour: number; // 0–23
  confidence: number; // 0–1
}
interface BestTimes {
  platform: string;
  slots: BestTimeSlot[];
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Social "best time to post" widget — renders the `best_times` series the social
 * analytics endpoint already returns (it had zero UI). Turns raw day/hour/
 * confidence into human guidance ("Tuesday · 2 PM · High confidence") so owners
 * know when to schedule.
 *
 * @example
 * <app-best-time-to-post [bestTimes]="data()!.best_times" />
 */
@Component({
  selector: 'app-best-time-to-post',
  standalone: true,
  template: `
    @if (slots().length) {
      <section
        class="card mt-6 rounded-xl border border-[#00E5FF]/12 bg-[rgba(8,8,32,0.55)] p-5"
        data-testid="best-time-to-post">
        <h2 class="text-[1.1rem] font-bold text-white m-0 mb-1" style="font-family:'Sora',system-ui,sans-serif">
          Best time to post
        </h2>
        <p class="text-[0.85rem] text-text-secondary mt-0 mb-3 capitalize">
          When your {{ bestTimes()!.platform }} audience is most active
        </p>
        <ul class="m-0 p-0 list-none grid gap-2 sm:grid-cols-2">
          @for (s of slots(); track s.day + '-' + s.hour) {
            <li
              class="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2"
              data-testid="btp-slot">
              <span class="text-[0.88rem] text-white font-medium">{{ dayName(s.day) }} · {{ hourLabel(s.hour) }}</span>
              <span
                class="text-[0.72rem] font-semibold px-2 py-0.5 rounded-full"
                [class.text-emerald-300]="s.confidence >= 0.66"
                [class.text-amber-300]="s.confidence >= 0.33 && s.confidence < 0.66"
                [class.text-text-secondary]="s.confidence < 0.33">
                {{ confidenceLabel(s.confidence) }}
              </span>
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class BestTimeToPostComponent {
  readonly bestTimes = input<BestTimes | null>(null);

  /** Up to 6 slots, highest confidence first. */
  readonly slots = computed(() =>
    [...(this.bestTimes()?.slots ?? [])].sort((a, b) => b.confidence - a.confidence).slice(0, 6),
  );

  dayName(day: number): string {
    return DAYS[day] ?? `Day ${day}`;
  }

  /** 24h → 12h clock label. */
  hourLabel(hour: number): string {
    const h = ((hour % 24) + 24) % 24;
    const period = h < 12 ? 'AM' : 'PM';
    const twelve = h % 12 === 0 ? 12 : h % 12;
    return `${twelve} ${period}`;
  }

  confidenceLabel(confidence: number): string {
    return confidence >= 0.66 ? 'High' : confidence >= 0.33 ? 'Medium' : 'Low';
  }
}
