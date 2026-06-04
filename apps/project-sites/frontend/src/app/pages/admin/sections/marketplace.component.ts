/**
 * Vertical Section Marketplace admin page — /admin/marketplace
 *
 * Displays curated bento section variants per industry.
 * Filter by industry × slot. Fork button increments fork_count.
 *
 * Per [[cinematic-ui-patterns]]:
 *  - <app-rolling-counter> for fork counts and quality scores
 *  - appReveal on every section and card
 *  - JetBrains Mono for numeric values
 *  - ≤36px rows, ≤12px card padding
 *  - routerLink for navigation (no href=)
 *  - View Transitions on industry filter switch
 *
 * Flag: section_marketplace.
 */

import {
  Component, OnInit, inject, signal, computed, ChangeDetectionStrategy, ChangeDetectorRef, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { HlmTablistDirective } from '../../../ui';
import { RevealDirective } from '../../../directives/reveal.directive';
import { FocusTrapDirective } from '../../../directives/focus-trap.directive';
import { EmptyStateComponent } from '../empty-state.component';
import { ErrorCardComponent } from '../../../components/states';
import { ToastService } from '../../../services/toast.service';

type SectionIndustry = 'nonprofit' | 'restaurant' | 'lawyer' | 'salon' | 'medical' | 'all';
type SectionSlot = 'hero' | 'services' | 'testimonials' | 'donor-wall' | 'faq' | 'cta' | 'all';

interface SectionSummary {
  id: string;
  industry: string;
  name: string;
  slot: string;
  quality_score: number;
  author: string;
  fork_count: number;
  data_schema_fields: string[];
}

interface IndustryCatalog {
  industry: string;
  section_count: number;
  slots: string[];
}

const INDUSTRY_ICONS: Record<string, string> = {
  nonprofit: '🤝', restaurant: '🍽️', lawyer: '⚖️', salon: '💇', medical: '🏥',
};

const SLOT_COLORS: Record<string, string> = {
  hero: '#7c3aed', services: '#00e5ff', testimonials: '#10b981',
  'donor-wall': '#f59e0b', faq: '#3b82f6', cta: '#ec4899',
};

@Component({
  selector: 'app-admin-marketplace',
  standalone: true,
  imports: [RevealDirective, CommonModule, RouterLink, RollingCounterComponent, HlmTablistDirective, EmptyStateComponent, ErrorCardComponent, FocusTrapDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="mkt-shell">
  <!-- ── Header ──────────────────────────────────────────────────────────── -->
  <header class="mkt-header" appReveal>
    <div class="mkt-header__meta">
      <a [routerLink]="['/admin']" class="mkt-header__back">← Admin</a>
      <span class="mkt-header__sep">/</span>
      <span>Marketplace</span>
    </div>
    <h1 class="mkt-header__title">Section Marketplace</h1>
    <p class="mkt-header__sub">Curated bento sections per industry — fork and customise</p>

    <div class="mkt-header__stats">
      <div class="mkt-stat">
        <app-rolling-counter [value]="totalSections()" />
        <span class="mkt-stat__label">sections</span>
      </div>
      <div class="mkt-stat">
        <app-rolling-counter [value]="catalog().length" />
        <span class="mkt-stat__label">industries</span>
      </div>
    </div>
  </header>

  <!-- ── Industry Filter Tabs ─────────────────────────────────────────── -->
  <div class="mkt-industry-tabs" role="tablist" hlmTablist aria-label="Filter by industry" appReveal>
    <button class="mkt-tab" type="button" role="tab"
            [class.mkt-tab--active]="activeIndustry() === 'all'"
            [attr.aria-selected]="activeIndustry() === 'all'"
            (click)="setIndustry('all')">
      All
    </button>
    @for (cat of catalog(); track cat.industry) {
      <button class="mkt-tab" type="button" role="tab"
              [class.mkt-tab--active]="activeIndustry() === cat.industry"
              [attr.aria-selected]="activeIndustry() === cat.industry"
              (click)="setIndustry(cat.industry)">
        <span aria-hidden="true">{{ industryIcon(cat.industry) }}</span>
        {{ cat.industry }}
        <span class="mkt-tab__count">{{ cat.section_count }}</span>
      </button>
    }
  </div>

  <!-- ── Slot Filter ───────────────────────────────────────────────────── -->
  <div class="mkt-slot-filter" appReveal>
    @for (slot of ['all', 'hero', 'services', 'testimonials', 'donor-wall', 'faq', 'cta']; track slot) {
      <button class="mkt-slot-chip"
              type="button"
              [class.mkt-slot-chip--active]="activeSlot() === slot"
              [style.--slot-color]="slotColor(slot)"
              [attr.aria-pressed]="activeSlot() === slot"
              [attr.aria-label]="'Filter by ' + slot + ' slot'"
              (click)="setSlot(slot)">
        {{ slot }}
      </button>
    }
  </div>
  <span class="sr-only" role="status" aria-live="polite" data-testid="marketplace-result-status">{{ resultAnnouncement() }}</span>

  <!-- ── Section Grid ─────────────────────────────────────────────────── -->
  @if (loading()) {
    <div class="mkt-loading" role="status" aria-live="polite" aria-label="Loading sections">
      <div class="mkt-loading__spinner" aria-hidden="true"></div>
    </div>
  } @else if (loadError()) {
    <app-error-card
      title="Couldn't load the marketplace"
      message="The section catalog failed to load."
      [correlationId]="loadErrorRef()"
      (retry)="reload()" />
  } @else if (filteredSections().length === 0) {
    <app-empty-state
      icon="▦"
      [title]="hasActiveFilter() ? 'No sections match these filters' : 'No sections available'"
      [body]="hasActiveFilter() ? 'Nothing in the catalog matches this industry + slot combination yet.' : 'Curated bento sections are added per industry — check back soon.'"
      [primary]="hasActiveFilter() ? 'Clear filters' : undefined"
      (primaryClick)="resetFilters()"
      data-testid="marketplace-empty" />
  } @else {
    <div class="mkt-grid" appReveal role="list">
      @for (section of filteredSections(); track section.id) {
        <article class="mkt-card" role="listitem" appReveal
                 [class.mkt-card--forked]="forkedIds().has(section.id)">
          <div class="mkt-card__header">
            <span class="mkt-card__industry-icon" aria-hidden="true">
              {{ industryIcon(section.industry) }}
            </span>
            <span class="mkt-card__industry">{{ section.industry }}</span>
            <span class="mkt-card__slot" [style.--slot-color]="slotColor(section.slot)">
              {{ section.slot }}
            </span>
          </div>

          <h3 class="mkt-card__name">{{ section.name }}</h3>

          <div class="mkt-card__meta">
            <div class="mkt-card__score" title="Quality score">
              <span class="mkt-card__score-label">Quality</span>
              <app-rolling-counter [value]="section.quality_score" [decimals]="1" suffix="/10" />
            </div>
            <div class="mkt-card__forks" title="Fork count">
              <app-rolling-counter [value]="getForkCount(section.id, section.fork_count)" suffix=" forks" />
            </div>
          </div>

          @if (section.data_schema_fields.length > 0) {
            <div class="mkt-card__fields">
              @for (field of section.data_schema_fields.slice(0, 4); track field) {
                <code class="mkt-card__field">{{ field }}</code>
              }
              @if (section.data_schema_fields.length > 4) {
                <code class="mkt-card__field mkt-card__field--more">+{{ section.data_schema_fields.length - 4 }}</code>
              }
            </div>
          }

          <div class="mkt-card__actions">
            <button class="mkt-card__fork-btn"
                    type="button"
                    [class.mkt-card__fork-btn--done]="forkedIds().has(section.id)"
                    (click)="fork(section.id)"
                    [attr.aria-label]="'Fork ' + section.name">
              {{ forkedIds().has(section.id) ? '✓ Forked' : 'Fork' }}
            </button>
            <button class="mkt-card__preview-btn"
                    type="button"
                    (click)="openPreview(section)"
                    [attr.aria-label]="'Preview ' + section.name">
              Preview
            </button>
          </div>
        </article>
      }
    </div>
  }

  <!-- ── Preview Modal ────────────────────────────────────────────────── -->
  @if (previewSection()) {
    <div class="mkt-preview-overlay" role="dialog" aria-modal="true"
         [attr.aria-label]="'Preview ' + previewSection()!.name"
         [focusTrap]="true"
         (click)="closePreview()">
      <div class="mkt-preview-modal" appReveal (click)="$event.stopPropagation()">
        <button class="mkt-preview-close" type="button" (click)="closePreview()" aria-label="Close preview">×</button>
        <h2>{{ previewSection()!.name }}</h2>
        <div class="mkt-preview-meta">
          <span>{{ previewSection()!.industry }}</span>
          <span class="mkt-preview-sep">·</span>
          <span>{{ previewSection()!.slot }}</span>
          <span class="mkt-preview-sep">·</span>
          <span>{{ previewSection()!.quality_score }}/10</span>
        </div>
        <div class="mkt-preview-fields">
          <strong>Required fields:</strong>
          @for (f of previewSection()!.data_schema_fields; track f) {
            <code class="mkt-card__field">{{ f }}</code>
          }
        </div>
      </div>
    </div>
  }
</div>
  `,
  styles: [`
    :host {
      display: block;
      color: var(--ps-ink, #f4f4ff);
      /* Cyan/black brand-chrome aliases — single source so no hardcoded rgba(0,229,255) drift */
      --mkt-accent: var(--ps-accent, #00e5ff);
      --mkt-line: color-mix(in oklch, var(--ps-ink, #f4f4ff) 12%, transparent);
      --mkt-line-soft: color-mix(in oklch, var(--ps-ink, #f4f4ff) 8%, transparent);
      --mkt-surface: color-mix(in oklch, var(--ps-ink, #f4f4ff) 4%, transparent);
      --mkt-accent-wash: color-mix(in oklch, var(--mkt-accent) 14%, transparent);
      --mkt-accent-line: color-mix(in oklch, var(--mkt-accent) 32%, transparent);
      --mkt-ok: #10b981;
    }
    .mkt-shell { padding: 0.75rem; max-width: 1200px; margin: 0 auto; }
    .mkt-header { margin-bottom: 1.25rem; }
    .mkt-header__meta { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; opacity: 0.6; margin-bottom: 0.75rem; }
    .mkt-header__back { color: var(--mkt-accent); text-decoration: none; border-radius: 4px; }
    .mkt-header__title { font: 700 1.5rem/1.1 'Sora', sans-serif; margin: 0 0 0.25rem; }
    .mkt-header__sub { font-size: 0.8rem; opacity: 0.6; margin: 0 0 1rem; }
    .mkt-header__stats { display: flex; gap: 1.5rem; }
    .mkt-stat { display: flex; align-items: baseline; gap: 0.25rem; font-family: 'JetBrains Mono', monospace; }
    .mkt-stat__label { font-size: 0.7rem; opacity: 0.6; }
    /* Tabs */
    .mkt-industry-tabs { display: flex; gap: 0.375rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
    .mkt-tab { min-height: 24px; background: var(--mkt-surface); border: 1px solid var(--mkt-line); color: inherit; padding: 0.25rem 0.625rem; border-radius: 9999px; font-size: 0.7rem; cursor: pointer; display: flex; align-items: center; gap: 0.25rem; transition: background 0.2s, border-color 0.2s; }
    .mkt-tab--active { background: var(--mkt-accent-wash); border-color: var(--mkt-accent); color: var(--mkt-accent); }
    .mkt-tab__count { background: var(--mkt-line); padding: 0.05rem 0.3rem; border-radius: 9999px; font-size: 0.6rem; font-family: 'JetBrains Mono', monospace; }
    /* Slot chips */
    .mkt-slot-filter { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .mkt-slot-chip { position: relative; min-height: 24px; background: var(--mkt-surface); border: 1px solid var(--mkt-line-soft); color: inherit; padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.65rem; cursor: pointer; transition: background 0.2s, border-color 0.2s, color 0.2s; }
    .mkt-slot-chip--active { background: color-mix(in oklch, var(--slot-color, var(--mkt-accent)) 15%, transparent); border-color: var(--slot-color, var(--mkt-accent)); color: var(--slot-color, var(--mkt-accent)); }
    /* Cyan UX win — animated underline sweep grows under the active slot chip */
    .mkt-slot-chip::after { content: ''; position: absolute; left: 50%; bottom: -2px; width: 0; height: 2px; border-radius: 2px; background: var(--slot-color, var(--mkt-accent)); transform: translateX(-50%); transition: width 0.28s cubic-bezier(.22,1,.36,1); }
    .mkt-slot-chip--active::after { width: 60%; }
    /* Grid */
    .mkt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.625rem; }
    .mkt-card { background: var(--mkt-surface); border: 1px solid var(--mkt-line-soft); border-radius: 8px; padding: 0.625rem; display: flex; flex-direction: column; gap: 0.5rem; transition: border-color 0.2s, box-shadow 0.2s; }
    .mkt-card:hover { border-color: var(--mkt-accent-line); }
    .mkt-card--forked { border-color: color-mix(in oklch, var(--mkt-ok) 36%, transparent); box-shadow: 0 0 0 1px color-mix(in oklch, var(--mkt-ok) 24%, transparent); }
    .mkt-card__header { display: flex; align-items: center; gap: 0.375rem; }
    .mkt-card__industry-icon { font-size: 1rem; }
    .mkt-card__industry { font-size: 0.65rem; opacity: 0.6; text-transform: capitalize; }
    .mkt-card__slot { margin-left: auto; font-size: 0.6rem; padding: 0.1rem 0.375rem; border-radius: 9999px; background: color-mix(in oklch, var(--slot-color, var(--mkt-accent)) 12%, transparent); color: var(--slot-color, var(--mkt-accent)); border: 1px solid color-mix(in oklch, var(--slot-color, var(--mkt-accent)) 30%, transparent); }
    .mkt-card__name { font-size: 0.75rem; font-weight: 600; margin: 0; line-height: 1.3; }
    .mkt-card__meta { display: flex; align-items: center; justify-content: space-between; }
    .mkt-card__score { display: flex; align-items: baseline; gap: 0.2rem; }
    .mkt-card__score-label { font-size: 0.6rem; opacity: 0.5; }
    .mkt-card__forks { font-size: 0.65rem; font-family: 'JetBrains Mono', monospace; opacity: 0.6; }
    .mkt-card__fields { display: flex; flex-wrap: wrap; gap: 0.2rem; }
    .mkt-card__field { font: 0.55rem 'JetBrains Mono', monospace; background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 6%, transparent); padding: 0.05rem 0.3rem; border-radius: 3px; opacity: 0.7; }
    .mkt-card__field--more { opacity: 0.4; }
    .mkt-card__actions { display: flex; gap: 0.375rem; margin-top: auto; }
    .mkt-card__fork-btn { flex: 1; min-height: 24px; background: var(--mkt-accent-wash); border: 1px solid var(--mkt-accent-line); color: var(--mkt-accent); padding: 0.25rem; border-radius: 9999px; font-size: 0.65rem; cursor: pointer; transition: background 0.2s; }
    .mkt-card__fork-btn--done { background: color-mix(in oklch, var(--mkt-ok) 12%, transparent); border-color: color-mix(in oklch, var(--mkt-ok) 30%, transparent); color: var(--mkt-ok); }
    .mkt-card__preview-btn { min-height: 24px; background: var(--mkt-surface); border: 1px solid var(--mkt-line); color: inherit; padding: 0.25rem 0.5rem; border-radius: 9999px; font-size: 0.65rem; cursor: pointer; }
    /* Loading */
    .mkt-loading { display: flex; justify-content: center; padding: 3rem; }
    .mkt-loading__spinner { width: 24px; height: 24px; border: 2px solid var(--mkt-line); border-top-color: var(--mkt-accent); border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .mkt-loading__spinner { animation: none; }
      .mkt-slot-chip::after { transition: none; }
    }
    /* Preview overlay */
    .mkt-preview-overlay { position: fixed; inset: 0; background: color-mix(in oklch, var(--ps-bg, #060610) 80%, transparent); backdrop-filter: blur(8px); z-index: var(--ps-z-overlay-takeover, 100000); display: flex; align-items: center; justify-content: center; }
    .mkt-preview-modal { background: color-mix(in oklch, var(--ps-bg, #060610) 92%, var(--ps-ink, #f4f4ff)); border: 1px solid var(--mkt-accent-line); border-radius: 12px; padding: 1.5rem; max-width: 480px; width: 90%; position: relative; box-shadow: var(--ps-shadow-modal, 0 24px 60px rgba(0,0,0,.6)); }
    .mkt-preview-close { position: absolute; top: 0.75rem; right: 0.75rem; min-width: 24px; min-height: 24px; background: none; border: none; color: inherit; font-size: 1.25rem; cursor: pointer; opacity: 0.6; border-radius: 6px; transition: opacity 0.2s; }
    .mkt-preview-close:hover { opacity: 1; }
    .mkt-preview-meta { font-size: 0.75rem; opacity: 0.6; margin: 0.5rem 0; display: flex; align-items: center; gap: 0.375rem; }
    .mkt-preview-sep { opacity: 0.3; }
    .mkt-preview-fields { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 1rem; }
    /* WCAG 2.2 — visible cyan focus ring ≥3:1 on every interactive element */
    .mkt-tab:focus-visible,
    .mkt-slot-chip:focus-visible,
    .mkt-card__fork-btn:focus-visible,
    .mkt-card__preview-btn:focus-visible,
    .mkt-preview-close:focus-visible,
    .mkt-header__back:focus-visible {
      outline: 2px solid var(--mkt-accent);
      outline-offset: 2px;
    }
  `],
})
export class AdminMarketplaceComponent implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  private toast = inject(ToastService);

  readonly loading = signal(false);
  readonly loadError = signal(false);
  /** Worker request_id from a failed feed → shown as the support reference on the error card. */
  readonly loadErrorRef = signal('');
  readonly catalog = signal<IndustryCatalog[]>([]);
  readonly sections = signal<SectionSummary[]>([]);
  readonly activeIndustry = signal<SectionIndustry>('all');
  readonly activeSlot = signal<SectionSlot>('all');
  readonly forkedIds = signal<Set<string>>(new Set());
  readonly forkCounts = signal<Map<string, number>>(new Map());
  readonly previewSection = signal<SectionSummary | null>(null);

  readonly totalSections = computed(() => this.sections().length);

  /**
   * SR-only announcement of the filtered section count + active industry — the
   * industry/slot filters re-render the grid with no count feedback otherwise
   * (the tabs have no count-in-label). Mirrors apps.resultAnnouncement.
   */
  readonly resultAnnouncement = computed<string>(() => {
    const n = this.filteredSections().length;
    const noun = n === 1 ? 'section' : 'sections';
    const ind = this.activeIndustry();
    return ind === 'all' ? `Showing ${n} ${noun}` : `${n} ${noun} · ${ind}`;
  });

  readonly filteredSections = computed(() => {
    const ind = this.activeIndustry();
    const slot = this.activeSlot();
    return this.sections().filter((s: SectionSummary) =>
      (ind === 'all' || s.industry === ind) &&
      (slot === 'all' || s.slot === slot),
    );
  });

  /** A filter is narrowing the catalog — so an empty result is "no match", not "no sections". */
  readonly hasActiveFilter = computed(() => this.activeIndustry() !== 'all' || this.activeSlot() !== 'all');

  /** Empty-state first action: drop both filters back to "all" so the catalog reappears. */
  resetFilters(): void {
    this.activeIndustry.set('all');
    this.activeSlot.set('all');
    this.cdr.markForCheck();
  }

  ngOnInit() {
    this.loadCatalog();
    this.loadSections();
  }

  /** Retry both feeds after a load failure. */
  reload() {
    this.loadError.set(false);
    this.loadErrorRef.set('');
    this.loadCatalog();
    this.loadSections();
  }

  /** Pull the worker request_id from a failed response ({ error: { request_id } }),
   *  falling back to the X-Request-ID response header. Empty when neither exists. */
  private refOf(err: unknown): string {
    const e = err as HttpErrorResponse;
    const fromBody = (e?.error as { error?: { request_id?: string } } | undefined)?.error?.request_id;
    return fromBody || e?.headers?.get?.('X-Request-ID') || '';
  }

  loadCatalog() {
    this.http.get<{ catalog: IndustryCatalog[] }>('/api/section-marketplace')
      .pipe(catchError((err: HttpErrorResponse) => {
        this.loadError.set(true);
        const ref = this.refOf(err);
        if (ref) this.loadErrorRef.set(ref);
        return of({ catalog: [] as IndustryCatalog[] });
      }))
      .subscribe((res: { catalog: IndustryCatalog[] }) => {
        this.catalog.set(res.catalog ?? []);
        this.cdr.markForCheck();
      });
  }

  loadSections() {
    this.loading.set(true);
    this.http.get<{ sections: SectionSummary[] }>('/api/section-marketplace/sections?limit=200')
      .pipe(catchError((err: HttpErrorResponse) => {
        this.loadError.set(true);
        const ref = this.refOf(err);
        if (ref) this.loadErrorRef.set(ref);
        return of({ sections: [] as SectionSummary[] });
      }))
      .subscribe((res: { sections: SectionSummary[] }) => {
        this.sections.set(res.sections ?? []);
        this.loading.set(false);
        this.cdr.markForCheck();
      });
  }

  setIndustry(ind: string) {
    this.activeIndustry.set(ind as SectionIndustry);
    // View Transitions for filter switch
    if ((document as { startViewTransition?: (cb: () => void) => void }).startViewTransition) {
      (document as { startViewTransition: (cb: () => void) => void }).startViewTransition(() => {
        this.cdr.markForCheck();
      });
    } else {
      this.cdr.markForCheck();
    }
  }

  setSlot(slot: string) {
    this.activeSlot.set(slot as SectionSlot);
    this.cdr.markForCheck();
  }

  fork(id: string) {
    if (this.forkedIds().has(id)) return;
    this.http.post<{ id: string; fork_count: number }>(`/api/section-marketplace/sections/${id}/fork`, {})
      .pipe(catchError(() => of(null as { id: string; fork_count: number } | null)))
      .subscribe((res: { id: string; fork_count: number } | null) => {
        if (res) {
          // Only mark "Forked" + bump the count when the POST actually succeeded —
          // otherwise the chip would lie (show ✓ Forked while nothing was forked).
          this.forkedIds.update((prev: Set<string>) => new Set([...prev, id]));
          this.forkCounts.update((prev: Map<string, number>) => new Map([...prev, [id, res.fork_count]]));
        } else {
          this.toast.error('Could not fork this section — please try again.');
        }
        this.cdr.markForCheck();
      });
  }

  openPreview(section: SectionSummary) { this.previewSection.set(section); }
  closePreview() { this.previewSection.set(null); }

  /** WCAG 2.1.2 — Escape closes the preview dialog (focus restored by focusTrap). */
  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.previewSection()) {
      this.closePreview();
      this.cdr.markForCheck();
    }
  }

  getForkCount(id: string, original: number) {
    return this.forkCounts().get(id) ?? original;
  }

  industryIcon(ind: string) { return INDUSTRY_ICONS[ind] ?? '📦'; }
  slotColor(slot: string) { return SLOT_COLORS[slot] ?? 'var(--ps-accent, #00e5ff)'; }
}
