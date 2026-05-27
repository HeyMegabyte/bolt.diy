/**
 * CrewShellComponent — `/dashboard/crew` root. Online/offline toggle
 * pinned to the top, then tabs: Feed / Earnings / Schedule / Documents.
 * The toggle status is the same signal the top-bar role-switcher reads;
 * a `CrewService.setOnlineStatus$()` call broadcasts both directions.
 *
 * RxJS-first per [[rxjs-first-angular]] — `crew.myProfile$ | async` in
 * the template; `toSignal()` only at the template boundary when needed.
 */
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { TagModule } from 'primeng/tag';
import { take } from 'rxjs';
import { CrewService } from '@org/data-access';
import { CrewFeedComponent } from '../crew-feed/crew-feed.component';
import { CrewEarningsComponent } from '../crew-earnings/crew-earnings.component';
import { CrewScheduleComponent } from '../crew-schedule/crew-schedule.component';
import { CrewDocumentsComponent } from '../crew-documents/crew-documents.component';

@Component({
  selector: 'lib-crew-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    ButtonModule,
    ToggleButtonModule,
    TagModule,
    CrewFeedComponent,
    CrewEarningsComponent,
    CrewScheduleComponent,
    CrewDocumentsComponent,
  ],
  template: `
    <section class="crew" data-testid="crew-shell">
      <header class="hdr">
        <h1>Crew Dashboard</h1>
        <ng-container *ngIf="crew.myProfile$ | async as profile">
          <div class="status-row">
            <p-tag
              [value]="profile?.online_status ?? 'offline'"
              [severity]="profile?.online_status === 'available' ? 'success' : 'secondary'"
            />
            <button
              pButton
              type="button"
              [label]="toggleLabel(profile?.online_status)"
              [icon]="profile?.online_status === 'available' ? 'pi pi-power-off' : 'pi pi-bolt'"
              [severity]="profile?.online_status === 'available' ? 'danger' : 'success'"
              (click)="toggle(profile?.online_status)"
              data-testid="crew-online-toggle"
              [disabled]="busy()"
            ></button>
          </div>
        </ng-container>
      </header>

      <nav class="tab-bar" role="tablist">
        <button
          *ngFor="let t of tabs"
          role="tab"
          [class.active]="active() === t.id"
          [attr.aria-selected]="active() === t.id"
          [attr.data-testid]="'crew-tab-' + t.id"
          (click)="active.set(t.id)"
        >
          {{ t.label }}
        </button>
      </nav>

      <section class="tab-body" [attr.data-active]="active()">
        <lib-crew-feed *ngIf="active() === 'feed'"></lib-crew-feed>
        <lib-crew-earnings *ngIf="active() === 'earnings'"></lib-crew-earnings>
        <lib-crew-schedule *ngIf="active() === 'schedule'"></lib-crew-schedule>
        <lib-crew-documents *ngIf="active() === 'documents'"></lib-crew-documents>
      </section>
    </section>
  `,
  styles: [
    `
      .crew { display: flex; flex-direction: column; gap: 1.25rem; padding: 1.5rem; }
      .hdr { display: flex; justify-content: space-between; align-items: center; }
      .hdr h1 { font-size: 1.5rem; margin: 0; }
      .status-row { display: flex; align-items: center; gap: 0.75rem; }
      .tab-bar { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--border, #2a2a3a); margin-top: 0.5rem; }
      .tab-bar button { background: transparent; border: 0; padding: 0.6rem 1rem; color: var(--text-color-secondary, #999); cursor: pointer; border-bottom: 2px solid transparent; }
      .tab-bar button.active { color: var(--text-color, #fff); border-bottom-color: var(--primary-color, #6366f1); }
      .tab-body { padding-top: 1rem; }
    `,
  ],
})
export class CrewShellComponent {
  protected readonly crew = inject(CrewService);
  protected readonly busy = signal(false);
  protected readonly active = signal<'feed' | 'earnings' | 'schedule' | 'documents'>('feed');
  protected readonly tabs = [
    { id: 'feed' as const, label: 'Feed' },
    { id: 'earnings' as const, label: 'Earnings' },
    { id: 'schedule' as const, label: 'Schedule' },
    { id: 'documents' as const, label: 'Documents' },
  ];

  protected toggleLabel(status: string | null | undefined): string {
    return status === 'available' ? 'Go Offline' : 'Go Online';
  }

  protected toggle(status: string | null | undefined): void {
    if (this.busy()) return;
    this.busy.set(true);
    const next = status === 'available' ? 'offline' : 'available';
    this.crew
      .setOnlineStatus$(next as 'available' | 'offline')
      .pipe(take(1))
      .subscribe({
        next: () => this.busy.set(false),
        error: () => this.busy.set(false),
      });
  }
}
