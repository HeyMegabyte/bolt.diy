/**
 * CrewEarningsComponent — day / week / month / YTD totals + tips +
 * avg-per-hour. Polls every 60s via `CrewService.earnings$`.
 */
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { CardModule } from 'primeng/card';
import { CrewService } from '@org/data-access';

@Component({
  selector: 'lib-crew-earnings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, CardModule, CurrencyPipe],
  template: `
    <div class="earnings" data-testid="crew-earnings">
      <ng-container *ngIf="earnings$ | async as e">
        <p-card header="Today" subheader="Earnings">
          <strong class="big">{{ e.day_cents / 100 | currency }}</strong>
        </p-card>
        <p-card header="This Week">
          <strong class="big">{{ e.week_cents / 100 | currency }}</strong>
        </p-card>
        <p-card header="This Month">
          <strong class="big">{{ e.month_cents / 100 | currency }}</strong>
        </p-card>
        <p-card header="YTD">
          <strong class="big">{{ e.ytd_cents / 100 | currency }}</strong>
        </p-card>
        <p-card header="Tips" subheader="lifetime">
          <strong class="big">{{ e.tips_cents / 100 | currency }}</strong>
        </p-card>
        <p-card header="Avg / Hour">
          <strong class="big">{{ e.avg_per_hour_cents / 100 | currency }}</strong>
        </p-card>
      </ng-container>
    </div>
  `,
  styles: [
    `
      .earnings { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); padding: 1rem 0; }
      .big { font-size: 1.5rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    `,
  ],
})
export class CrewEarningsComponent {
  private readonly crew = inject(CrewService);
  protected readonly earnings$ = this.crew.earnings$();
}
