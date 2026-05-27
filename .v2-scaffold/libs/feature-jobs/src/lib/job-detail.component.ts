/**
 * JobDetailComponent — `/dashboard/jobs/:id` hero with real-time map,
 * ETA countdown, embedded chat + safety button + tip + rating actions.
 *
 * Google Maps via the singleton `@org/util-maps` loader (doctrine §18 —
 * never inject the SDK twice).
 */
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { Subject, interval, map, startWith, switchMap, takeUntil } from 'rxjs';
import { MapsLoaderService } from '@org/util-maps';
import { LiveActivityService } from '@org/util-platform';
import { JobsService } from './services/jobs.service';
import { JobChatComponent } from './job-chat.component';
import { JobRatingComponent } from './job-rating.component';
import { JobTipDialogComponent } from './job-tip-dialog.component';
import { JobSafetyButtonComponent } from './job-safety-button.component';
import type { JobLocation } from '@org/domain';

@Component({
  selector: 'lib-job-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterLink,
    ButtonModule,
    CardModule,
    TagModule,
    JobChatComponent,
    JobRatingComponent,
    JobTipDialogComponent,
    JobSafetyButtonComponent,
    CurrencyPipe,
  ],
  template: `
    <section class="job-detail" data-testid="job-detail" *ngIf="jobId() as id">
      <header class="hdr">
        <a routerLink="/dashboard/jobs" class="back">← Jobs</a>
        <h1>Job {{ id.slice(0, 8) }}…</h1>
        <p-tag *ngIf="job() as j" [value]="j.status"></p-tag>
      </header>

      <div class="grid">
        <div #mapHost class="map" data-testid="job-map"></div>
        <aside class="side">
          <p-card header="ETA">
            <span class="eta">{{ etaText() }}</span>
          </p-card>
          <div class="actions">
            <button
              pButton
              icon="pi pi-phone"
              label="Call (masked)"
              (click)="call()"
              data-testid="job-call"
            ></button>
            <button
              pButton
              severity="info"
              icon="pi pi-dollar"
              label="Tip"
              (click)="tipOpen.set(true)"
              data-testid="job-tip"
            ></button>
            <lib-job-safety-button [jobId]="id"></lib-job-safety-button>
          </div>
          <lib-job-rating [jobId]="id"></lib-job-rating>
        </aside>
      </div>

      <lib-job-chat [jobId]="id"></lib-job-chat>

      <lib-job-tip-dialog
        [jobId]="id"
        [open]="tipOpen()"
        (closed)="tipOpen.set(false)"
      ></lib-job-tip-dialog>
    </section>
  `,
  styles: [
    `
      .job-detail { display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; }
      .hdr { display: flex; align-items: center; gap: 1rem; }
      .hdr h1 { font-size: 1.5rem; margin: 0; }
      .back { color: var(--text-color-secondary, #999); text-decoration: none; }
      .grid { display: grid; grid-template-columns: 2fr 1fr; gap: 1rem; min-height: 420px; }
      .map { width: 100%; height: 420px; background: var(--surface-card, #15151f); border-radius: 0.5rem; }
      .side { display: flex; flex-direction: column; gap: 1rem; }
      .actions { display: flex; flex-direction: column; gap: 0.5rem; }
      .eta { font-size: 2rem; font-weight: 700; font-variant-numeric: tabular-nums; }
      @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
    `,
  ],
})
export class JobDetailComponent implements AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(JobsService);
  private readonly maps = inject(MapsLoaderService);
  private readonly liveActivity = inject(LiveActivityService);

  private readonly destroy$ = new Subject<void>();
  private liveActivityStarted = false;
  protected readonly tipOpen = signal(false);
  private readonly location = signal<JobLocation | null>(null);

  protected readonly jobId = toSignal(
    this.route.paramMap.pipe(map((p) => p.get('id') ?? '')),
    { initialValue: '' },
  );

  protected readonly job = toSignal(
    this.route.paramMap.pipe(
      switchMap((p) => this.api.getJob$(p.get('id') ?? '')),
    ),
    { initialValue: null },
  );

  protected readonly etaText = computed(() => {
    const loc = this.location();
    if (!loc || loc.eta_seconds == null) return '—';
    const mins = Math.floor(loc.eta_seconds / 60);
    const secs = loc.eta_seconds % 60;
    return `${mins}m ${secs}s`;
  });

  @ViewChild('mapHost', { static: false }) mapHost?: ElementRef<HTMLDivElement>;
  private google: unknown = null;
  private map: { panTo: (p: { lat: number; lng: number }) => void } | null =
    null;
  private marker: { setPosition: (p: { lat: number; lng: number }) => void } | null =
    null;

  ngAfterViewInit(): void {
    const id = this.jobId();
    if (!id) return;

    this.api
      .locationStream$(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe((loc) => {
        this.location.set(loc);
        this.updateMarker(loc);
        this.syncLiveActivity(id, loc);
      });

    this.maps.load$().subscribe((g: unknown) => {
      if (!this.mapHost) return;
      this.google = g;
      const maps = (g as { maps: { Map: new (el: HTMLElement, opts: unknown) => unknown } }).maps;
      this.map = new maps.Map(this.mapHost.nativeElement, {
        center: { lat: 40.7357, lng: -74.1724 },
        zoom: 13,
        disableDefaultUI: true,
      }) as typeof this.map;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    const id = this.jobId();
    if (this.liveActivityStarted && id) {
      this.liveActivity.endJobActivity$(id).subscribe();
    }
  }

  private syncLiveActivity(id: string, loc: JobLocation): void {
    const j = this.job();
    const status: string = j?.status ?? 'enroute';
    const statusText: string =
      status === 'enroute'
        ? 'On the way'
        : status === 'on_site'
          ? 'Arrived'
          : status === 'completed'
            ? 'Completed'
            : status;
    const eta = loc.eta_seconds ?? 0;

    const terminal = status === 'on_site' || status === 'completed' || status === 'cancelled';
    if (terminal) {
      if (this.liveActivityStarted) {
        this.liveActivityStarted = false;
        this.liveActivity.endJobActivity$(id).subscribe();
      }
      return;
    }

    if (!this.liveActivityStarted) {
      this.liveActivityStarted = true;
      this.liveActivity.startJobActivity$({ jobId: id, eta, statusText }).subscribe();
      return;
    }

    this.liveActivity
      .updateJobActivity$({
        jobId: id,
        patch: { eta, statusText, lat: loc.lat, lng: loc.lng },
      })
      .subscribe();
  }

  private updateMarker(loc: JobLocation): void {
    if (!this.map || !this.google) return;
    const position = { lat: loc.lat, lng: loc.lng };
    const maps = (this.google as { maps: { Marker: new (opts: unknown) => unknown } }).maps;
    if (!this.marker) {
      this.marker = new maps.Marker({ map: this.map, position }) as typeof this.marker;
    } else {
      this.marker.setPosition(position);
    }
    this.map.panTo(position);
  }

  protected call(): void {
    const id = this.jobId();
    if (!id) return;
    this.api.requestCall$(id).subscribe();
  }
}
