/**
 * CrewFeedComponent — pending-offer feed with accept/decline + auto-decline
 * timer. Each offer is a card; a per-offer countdown (seconds until
 * `expires_at`) reads from a single `interval(1000)` shared across all
 * rendered offers.
 */
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { combineLatest, interval, map, startWith, take } from 'rxjs';
import { CrewService, type JobOffer } from '@org/data-access';

@Component({
  selector: 'lib-crew-feed',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ButtonModule, CardModule, CurrencyPipe],
  template: `
    <div class="feed" data-testid="crew-feed">
      <ng-container *ngIf="(offers$ | async) as ctx">
        <p *ngIf="ctx.offers.length === 0" class="empty" data-testid="crew-feed-empty">
          No offers right now — stay online and we'll page you.
        </p>
        <article
          *ngFor="let offer of ctx.offers; trackBy: trackById"
          class="offer-card"
          [attr.data-testid]="'offer-' + offer.job_id"
        >
          <header>
            <span class="fare">{{ offer.fare_cents / 100 | currency }}</span>
            <span class="distance">{{ (offer.distance_m / 1609.34).toFixed(1) }} mi away</span>
          </header>
          <div class="meta">
            <span class="timer" [class.urgent]="secondsLeft(offer, ctx.now) < 10">
              {{ secondsLeft(offer, ctx.now) }}s
            </span>
          </div>
          <footer>
            <button
              pButton
              severity="success"
              icon="pi pi-check"
              label="Accept"
              (click)="accept(offer)"
              [attr.data-testid]="'offer-accept-' + offer.job_id"
            ></button>
            <button
              pButton
              severity="secondary"
              icon="pi pi-times"
              label="Decline"
              (click)="decline(offer)"
              [attr.data-testid]="'offer-decline-' + offer.job_id"
            ></button>
          </footer>
        </article>
      </ng-container>
    </div>
  `,
  styles: [
    `
      .feed { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
      .empty { color: var(--text-color-secondary, #999); font-style: italic; padding: 1rem; }
      .offer-card { border: 1px solid var(--border, #2a2a3a); border-radius: 0.5rem; padding: 1rem; background: var(--surface-card, #15151f); }
      .offer-card header { display: flex; justify-content: space-between; align-items: baseline; }
      .fare { font-size: 1.5rem; font-weight: 700; }
      .distance { color: var(--text-color-secondary, #999); font-size: 0.875rem; }
      .timer { font-variant-numeric: tabular-nums; color: var(--text-color-secondary, #999); }
      .timer.urgent { color: var(--red-500, #ef4444); font-weight: 600; }
      footer { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
    `,
  ],
})
export class CrewFeedComponent {
  private readonly crew = inject(CrewService);

  protected readonly offers$ = combineLatest([
    this.crew.offers$,
    interval(1000).pipe(
      startWith(0),
      map(() => Date.now()),
    ),
  ]).pipe(map(([offers, now]) => ({ offers, now })));

  protected trackById(_index: number, offer: JobOffer): string {
    return offer.job_id;
  }

  protected secondsLeft(offer: JobOffer, now: number): number {
    const diff = Math.floor((new Date(offer.expires_at).getTime() - now) / 1000);
    return Math.max(0, diff);
  }

  protected accept(offer: JobOffer): void {
    this.crew.acceptOffer$(offer.job_id).pipe(take(1)).subscribe();
  }

  protected decline(offer: JobOffer): void {
    this.crew.declineOffer$(offer.job_id).pipe(take(1)).subscribe();
  }
}
