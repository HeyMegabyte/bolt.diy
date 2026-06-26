import { Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';

export interface BestPost {
  post_id: string;
  publish_id: string;
  platform: string;
  external_url: string | null;
  content_preview: string;
  impressions: number;
  engagement: number;
}

/**
 * Social "top posts" widget — renders the `best_posts` series the social
 * analytics endpoint already returns (it had zero UI). Surfaces the best-
 * performing posts (preview + platform + impressions/engagement + link) so
 * owners can see what's resonating and double down.
 *
 * @example
 * <app-best-posts [posts]="data()!.best_posts" />
 */
@Component({
  selector: 'app-best-posts',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    @if (topPosts().length) {
      <section
        class="card mt-6 rounded-xl border border-[#00E5FF]/12 bg-[rgba(8,8,32,0.55)] p-5"
        data-testid="best-posts">
        <h2 class="text-[1.1rem] font-bold text-white m-0 mb-3" style="font-family:'Sora',system-ui,sans-serif">
          Top posts
        </h2>
        <ul class="m-0 p-0 list-none grid gap-2">
          @for (p of topPosts(); track p.post_id) {
            <li
              class="flex items-start justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2.5"
              data-testid="best-post-card">
              <div class="min-w-0">
                <span class="block text-[0.7rem] uppercase tracking-wide text-[#00E5FF]/80 capitalize">{{ p.platform }}</span>
                <span class="block text-[0.88rem] text-white truncate max-w-[42ch]" [attr.title]="p.content_preview">
                  {{ p.content_preview }}
                </span>
                <span class="block text-[0.74rem] text-text-secondary mt-0.5 tabular-nums">
                  {{ p.impressions | number }} impressions · {{ p.engagement | number }} engagements
                </span>
              </div>
              @if (p.external_url) {
                <a
                  [href]="p.external_url"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="best-post-link"
                  class="shrink-0 text-[0.78rem] font-semibold text-[#00E5FF] hover:underline">
                  View →
                </a>
              }
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class BestPostsComponent {
  readonly posts = input<BestPost[]>([]);

  /** Top 5 by engagement, then impressions. */
  readonly topPosts = computed(() =>
    [...(this.posts() ?? [])]
      .sort((a, b) => b.engagement - a.engagement || b.impressions - a.impressions)
      .slice(0, 5),
  );
}
