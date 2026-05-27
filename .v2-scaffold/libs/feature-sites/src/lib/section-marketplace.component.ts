/**
 * `SectionMarketplaceComponent` — browse + install section blueprints
 * (backlog #34).
 *
 * @remarks
 *  Scaffold UI for the marketplace. Grid of cards (preview image, name,
 *  downloads, rating); each card has an Install button that copies the
 *  section blob into the bound `siteId`. Search + sort are debounced and
 *  routed through `MarketplaceService.setFilters` so the list re-fetches
 *  declaratively.
 */
import { CommonModule, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  inject,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  of,
  startWith,
  take,
  takeUntil,
  tap,
} from 'rxjs';
import { Subject } from 'rxjs';
import {
  MarketplaceService,
  type MarketplaceSection,
} from '@org/data-access';

interface SortOption {
  readonly label: string;
  readonly value: 'downloads' | 'rating' | 'recent';
}

const SORT_OPTIONS: ReadonlyArray<SortOption> = [
  { label: 'Most installed', value: 'downloads' },
  { label: 'Highest rated', value: 'rating' },
  { label: 'Recent', value: 'recent' },
];

@Component({
  selector: 'lib-section-marketplace',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    CardModule,
    TagModule,
    SelectButtonModule,
    ToastModule,
    DecimalPipe,
  ],
  providers: [MessageService],
  template: `
    <section class="marketplace" data-testid="section-marketplace">
      <header class="hdr">
        <div>
          <h2>Section library</h2>
          <small>Drop ready-made sections into your site.</small>
        </div>
        <div class="controls">
          <input
            type="search"
            [formControl]="searchCtrl"
            placeholder="Search sections…"
            data-testid="marketplace-search"
            aria-label="Search section library"
          />
          <p-selectButton
            [options]="sortOptions"
            optionLabel="label"
            optionValue="value"
            [(ngModel)]="sort"
            (ngModelChange)="onSortChange($event)"
            data-testid="marketplace-sort"
          />
        </div>
      </header>

      @if (sections().length === 0) {
        <p class="empty" data-testid="marketplace-empty">
          No sections match. Authors can submit via the dashboard.
        </p>
      } @else {
        <div class="grid" data-testid="marketplace-grid">
          @for (section of sections(); track section.id) {
            <p-card class="card" [attr.data-testid]="'marketplace-card-' + section.id">
              @if (section.preview_image_url) {
                <img
                  class="preview"
                  [src]="section.preview_image_url"
                  [alt]="section.name + ' preview'"
                  loading="lazy"
                />
              }
              <div class="meta">
                <h3>{{ section.name }}</h3>
                @if (section.category) {
                  <p-tag severity="secondary" [value]="section.category" />
                }
              </div>
              <p class="desc">{{ section.description }}</p>
              <footer>
                <small>
                  {{ section.downloads | number }} installs
                  @if (section.rating !== null) {
                    · ★ {{ section.rating | number: '1.1-1' }}
                  }
                </small>
                <button
                  pButton
                  size="small"
                  icon="pi pi-download"
                  [label]="installing() === section.id ? 'Installing…' : 'Install'"
                  [disabled]="!siteId || installing() === section.id"
                  (click)="install(section)"
                  [attr.data-testid]="'marketplace-install-' + section.id"
                ></button>
              </footer>
            </p-card>
          }
        </div>
      }
    </section>

    <p-toast position="top-right" />
  `,
  styles: [
    `
      .marketplace { display: flex; flex-direction: column; gap: 1rem; padding: 1rem; }
      .hdr { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
      .hdr h2 { margin: 0 0 .25rem; font-size: 1.25rem; }
      .hdr small { color: var(--text-color-secondary, #8a8a98); }
      .controls { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
      .controls input { padding: .5rem .75rem; border-radius: .5rem; border: 1px solid var(--surface-border, #2a2a36); background: var(--surface-card, #15151f); color: var(--text-color, #f5f5f7); min-width: 220px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; }
      .card .preview { width: 100%; height: 140px; object-fit: cover; border-radius: .5rem; margin-bottom: .5rem; }
      .meta { display: flex; align-items: center; justify-content: space-between; margin: .25rem 0; }
      .meta h3 { margin: 0; font-size: 1rem; }
      .desc { font-size: .85rem; color: var(--text-color-secondary, #8a8a98); margin: .25rem 0 .75rem; min-height: 2.4em; }
      footer { display: flex; align-items: center; justify-content: space-between; }
      footer small { color: var(--text-color-secondary, #8a8a98); }
      .empty { color: var(--text-color-secondary, #8a8a98); padding: 2rem; text-align: center; border: 1px dashed var(--surface-border, #2a2a36); border-radius: .5rem; }
    `,
  ],
})
export class SectionMarketplaceComponent {
  @Input({ required: true }) siteId = '';

  private readonly marketplace = inject(MarketplaceService);
  private readonly toast = inject(MessageService);
  private readonly destroy$ = new Subject<void>();

  readonly sortOptions = SORT_OPTIONS;
  readonly searchCtrl = new FormControl<string>('', { nonNullable: true });
  sort: 'downloads' | 'rating' | 'recent' = 'downloads';

  readonly sections = toSignal(this.marketplace.sections$, {
    initialValue: [] as ReadonlyArray<MarketplaceSection>,
  });

  readonly installing = signal<string | null>(null);

  constructor() {
    this.searchCtrl.valueChanges
      .pipe(
        startWith(this.searchCtrl.value),
        debounceTime(220),
        distinctUntilChanged(),
        takeUntil(this.destroy$),
      )
      .subscribe((q) => this.marketplace.setFilters({ q: q || undefined }));
  }

  onSortChange(value: 'downloads' | 'rating' | 'recent'): void {
    this.marketplace.setFilters({ sort: value });
  }

  install(section: MarketplaceSection): void {
    if (!this.siteId) return;
    if (this.installing() === section.id) return;
    this.installing.set(section.id);
    this.marketplace
      .install$(section.id, this.siteId)
      .pipe(
        take(1),
        tap(() => {
          this.installing.set(null);
          this.toast.add({
            severity: 'success',
            summary: 'Section installed',
            detail: `${section.name} added to the site.`,
            life: 4_000,
          });
        }),
        catchError((err: { message?: string }) => {
          this.installing.set(null);
          this.toast.add({
            severity: 'error',
            summary: 'Install failed',
            detail: err?.message ?? 'Unable to install the section.',
            life: 6_000,
          });
          return of(null);
        }),
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
