/**
 * Pulse Inbox — full-page analytics drill-down at `/admin/inbox/analytics`.
 *
 * Wraps the InboxMetricsWidget with a window switcher and a per-intent
 * breakdown table. Reads from `/api/inbox/metrics?days=N`.
 */
import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../../services/api.service';
import { RevealDirective } from '../../../directives/reveal.directive';
import { WidgetRendererComponent } from './dashboard/widgets';

interface InboxMetricsResponse {
  window_days: number;
  generated_at: string;
  avg_first_response_seconds: number;
  avg_resolution_seconds: number;
  resolution_rate: number;
  csat_avg: number;
  conversations_per_day: { date: string; count: number }[];
  sentiment_breakdown: { positive: number; neutral: number; negative: number };
  intent_breakdown: Record<string, number>;
}

@Component({
  selector: 'app-inbox-analytics',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, RevealDirective, WidgetRendererComponent],
  template: `
    <section class="page" appReveal>
      <header class="page-hd">
        <div>
          <h1>Inbox analytics</h1>
          <p class="sub">Response time, CSAT, sentiment, intent — last {{ days() }} days.</p>
        </div>
        <nav class="windows" aria-label="Time window">
          @for (w of windows; track w) {
            <button
              type="button"
              [class.active]="days() === w"
              (click)="setDays(w)"
            >{{ w }}d</button>
          }
        </nav>
      </header>

      @if (loading()) {
        <div class="loading">Pulling the metrics.</div>
      } @else if (error()) {
        <div class="error">{{ error() }}</div>
      } @else if (data()) {
        <div class="widget">
          <app-widget-renderer name="inbox-metrics" [props]="widgetProps()" />
        </div>

        <section class="card">
          <h2>Resolution rate</h2>
          <p class="big">{{ ratePct() }}<span class="unit">%</span></p>
          <p class="muted">
            Resolved-to-opened ratio.
            <a routerLink="/admin/inbox">Open the inbox →</a>
          </p>
        </section>
      }
    </section>
  `,
  styles: [
    `
      :host { display: block; padding: 24px; color: var(--ps-ink, #f4f4ff); }
      .page-hd { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 24px; flex-wrap: wrap; gap: 16px; }
      h1 { font-family: 'Sora', system-ui, sans-serif; font-size: 1.6rem; margin: 0; }
      .sub { opacity: 0.7; margin: 4px 0 0; font-size: 0.92rem; }
      .windows { display: flex; gap: 4px; }
      .windows button {
        padding: 6px 12px;
        background: rgba(0, 229, 255, 0.06);
        border: 1px solid rgba(0, 229, 255, 0.12);
        color: var(--ps-ink, #f4f4ff);
        border-radius: 8px; cursor: pointer;
        font-family: 'JetBrains Mono', monospace; font-size: 0.8rem;
      }
      .windows button.active { background: rgba(0, 229, 255, 0.2); border-color: rgba(0, 229, 255, 0.5); }
      .loading, .error { padding: 40px; text-align: center; opacity: 0.7; }
      .error { color: #f87171; }
      .widget { margin-bottom: 24px; }
      .card {
        padding: 18px 20px; border-radius: 14px;
        background: rgba(8, 8, 32, 0.55);
        border: 1px solid rgba(0, 229, 255, 0.12);
      }
      h2 { font-family: 'Sora', system-ui, sans-serif; font-size: 1.1rem; margin: 0 0 8px; }
      .big {
        font-family: 'Sora', system-ui, sans-serif; font-size: 2.4rem;
        font-weight: 600; margin: 6px 0; color: var(--ps-accent, #00e5ff);
      }
      .unit { font-size: 1.2rem; opacity: 0.6; margin-left: 4px; }
      .muted { opacity: 0.65; font-size: 0.9rem; margin: 0; }
      .muted a { color: var(--ps-accent, #00e5ff); }
    `,
  ],
})
export class AdminInboxAnalyticsComponent implements OnInit {
  private api = inject(ApiService);
  readonly windows = [7, 30, 90] as const;

  days = signal<number>(30);
  loading = signal(true);
  error = signal('');
  data = signal<InboxMetricsResponse | null>(null);

  widgetProps = computed(() => {
    const d = this.data();
    return d ? (d as unknown as Record<string, unknown>) : {};
  });

  ratePct = computed(() => {
    const r = this.data()?.resolution_rate ?? 0;
    return Math.round(r * 100);
  });

  ngOnInit(): void {
    this.load();
  }

  setDays(d: number): void {
    if (this.days() === d) return;
    this.days.set(d);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.get<InboxMetricsResponse>(`/api/inbox/metrics?days=${this.days()}`).subscribe({
      next: (res) => {
        this.data.set(res);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Could not load metrics — try again.');
        this.loading.set(false);
      },
    });
  }
}
