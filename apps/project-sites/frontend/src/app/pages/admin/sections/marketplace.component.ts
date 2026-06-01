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
  Component, OnInit, inject, signal, computed, ChangeDetectionStrategy, ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { HlmTablistDirective } from '../../../ui';
import { RevealDirective } from '../../../directives/reveal.directive';

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
  imports: [RevealDirective, CommonModule, RouterLink, RollingCounterComponent, HlmTablistDirective],
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
    <button class="mkt-tab" role="tab"
            [class.mkt-tab--active]="activeIndustry() === 'all'"
            [attr.aria-selected]="activeIndustry() === 'all'"
            (click)="setIndustry('all')">
      All
    </button>
    @for (cat of catalog(); track cat.industry) {
      <button class="mkt-tab" role="tab"
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
              [class.mkt-slot-chip--active]="activeSlot() === slot"
              [style.--slot-color]="slotColor(slot)"
              (click)="setSlot(slot)">
        {{ slot }}
      </button>
    }
  </div>

  <!-- ── Section Grid ─────────────────────────────────────────────────── -->
  @if (loading()) {
    <div class="mkt-loading" aria-label="Loading sections">
      <div class="mkt-loading__spinner"></div>
    </div>
  } @else if (filteredSections().length === 0) {
    <div class="mkt-empty" appReveal>
      <p>No sections for this filter.</p>
    </div>
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
                    [class.mkt-card__fork-btn--done]="forkedIds().has(section.id)"
                    (click)="fork(section.id)"
                    [attr.aria-label]="'Fork ' + section.name">
              {{ forkedIds().has(section.id) ? '✓ Forked' : 'Fork' }}
            </button>
            <button class="mkt-card__preview-btn"
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
         (click)="closePreview()">
      <div class="mkt-preview-modal" (click)="$event.stopPropagation()">
        <button class="mkt-preview-close" (click)="closePreview()" aria-label="Close preview">×</button>
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
    :host { display: block; color: var(--ps-ink, #f4f4ff); }
    .mkt-shell { padding: 0.75rem; max-width: 1200px; margin: 0 auto; }
    .mkt-header { margin-bottom: 1.25rem; }
    .mkt-header__meta { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; opacity: 0.6; margin-bottom: 0.75rem; }
    .mkt-header__back { color: var(--ps-accent, #00e5ff); text-decoration: none; }
    .mkt-header__title { font: 700 1.5rem/1.1 'Sora', sans-serif; margin: 0 0 0.25rem; }
    .mkt-header__sub { font-size: 0.8rem; opacity: 0.6; margin: 0 0 1rem; }
    .mkt-header__stats { display: flex; gap: 1.5rem; }
    .mkt-stat { display: flex; align-items: baseline; gap: 0.25rem; font-family: 'JetBrains Mono', monospace; }
    .mkt-stat__label { font-size: 0.7rem; opacity: 0.6; }
    /* Tabs */
    .mkt-industry-tabs { display: flex; gap: 0.375rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
    .mkt-tab { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); color: inherit; padding: 0.25rem 0.625rem; border-radius: 9999px; font-size: 0.7rem; cursor: pointer; display: flex; align-items: center; gap: 0.25rem; transition: background 0.2s; }
    .mkt-tab--active { background: rgba(0,229,255,.15); border-color: var(--ps-accent, #00e5ff); color: var(--ps-accent, #00e5ff); }
    .mkt-tab__count { background: rgba(255,255,255,.1); padding: 0.05rem 0.3rem; border-radius: 9999px; font-size: 0.6rem; font-family: 'JetBrains Mono', monospace; }
    /* Slot chips */
    .mkt-slot-filter { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .mkt-slot-chip { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); color: inherit; padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.65rem; cursor: pointer; transition: all 0.2s; }
    .mkt-slot-chip--active { background: color-mix(in oklch, var(--slot-color, var(--ps-accent, #00e5ff)) 15%, transparent); border-color: var(--slot-color, var(--ps-accent, #00e5ff)); color: var(--slot-color, var(--ps-accent, #00e5ff)); }
    /* Grid */
    .mkt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.625rem; }
    .mkt-card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 8px; padding: 0.625rem; display: flex; flex-direction: column; gap: 0.5rem; transition: border-color 0.2s; }
    .mkt-card:hover { border-color: rgba(0,229,255,.25); }
    .mkt-card--forked { border-color: rgba(16,185,129,.3); }
    .mkt-card__header { display: flex; align-items: center; gap: 0.375rem; }
    .mkt-card__industry-icon { font-size: 1rem; }
    .mkt-card__industry { font-size: 0.65rem; opacity: 0.6; text-transform: capitalize; }
    .mkt-card__slot { margin-left: auto; font-size: 0.6rem; padding: 0.1rem 0.375rem; border-radius: 9999px; background: color-mix(in oklch, var(--slot-color, var(--ps-accent, #00e5ff)) 12%, transparent); color: var(--slot-color, var(--ps-accent, #00e5ff)); border: 1px solid color-mix(in oklch, var(--slot-color, var(--ps-accent, #00e5ff)) 30%, transparent); }
    .mkt-card__name { font-size: 0.75rem; font-weight: 600; margin: 0; line-height: 1.3; }
    .mkt-card__meta { display: flex; align-items: center; justify-content: space-between; }
    .mkt-card__score { display: flex; align-items: baseline; gap: 0.2rem; }
    .mkt-card__score-label { font-size: 0.6rem; opacity: 0.5; }
    .mkt-card__forks { font-size: 0.65rem; font-family: 'JetBrains Mono', monospace; opacity: 0.6; }
    .mkt-card__fields { display: flex; flex-wrap: wrap; gap: 0.2rem; }
    .mkt-card__field { font: 0.55rem 'JetBrains Mono', monospace; background: rgba(255,255,255,.06); padding: 0.05rem 0.3rem; border-radius: 3px; opacity: 0.7; }
    .mkt-card__field--more { opacity: 0.4; }
    .mkt-card__actions { display: flex; gap: 0.375rem; margin-top: auto; }
    .mkt-card__fork-btn { flex: 1; background: rgba(0,229,255,.1); border: 1px solid rgba(0,229,255,.3); color: var(--ps-accent, #00e5ff); padding: 0.25rem; border-radius: 9999px; font-size: 0.65rem; cursor: pointer; transition: background 0.2s; }
    .mkt-card__fork-btn--done { background: rgba(16,185,129,.1); border-color: rgba(16,185,129,.3); color: #10b981; }
    .mkt-card__preview-btn { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); color: inherit; padding: 0.25rem 0.5rem; border-radius: 9999px; font-size: 0.65rem; cursor: pointer; }
    /* Loading */
    .mkt-loading { display: flex; justify-content: center; padding: 3rem; }
    .mkt-loading__spinner { width: 24px; height: 24px; border: 2px solid rgba(255,255,255,.1); border-top-color: var(--ps-accent, #00e5ff); border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    /* Empty */
    .mkt-empty { text-align: center; padding: 3rem; opacity: 0.5; }
    /* Preview overlay */
    .mkt-preview-overlay { position: fixed; inset: 0; background: rgba(6,6,16,.8); backdrop-filter: blur(8px); z-index: 9999; display: flex; align-items: center; justify-content: center; }
    .mkt-preview-modal { background: #0d0d20; border: 1px solid rgba(0,229,255,.2); border-radius: 12px; padding: 1.5rem; max-width: 480px; width: 90%; position: relative; }
    .mkt-preview-close { position: absolute; top: 0.75rem; right: 0.75rem; background: none; border: none; color: inherit; font-size: 1.25rem; cursor: pointer; opacity: 0.6; }
    .mkt-preview-meta { font-size: 0.75rem; opacity: 0.6; margin: 0.5rem 0; display: flex; align-items: center; gap: 0.375rem; }
    .mkt-preview-sep { opacity: 0.3; }
    .mkt-preview-fields { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 1rem; }
  `],
})
export class AdminMarketplaceComponent implements OnInit {
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

  readonly loading = signal(false);
  readonly catalog = signal<IndustryCatalog[]>([]);
  readonly sections = signal<SectionSummary[]>([]);
  readonly activeIndustry = signal<SectionIndustry>('all');
  readonly activeSlot = signal<SectionSlot>('all');
  readonly forkedIds = signal<Set<string>>(new Set());
  readonly forkCounts = signal<Map<string, number>>(new Map());
  readonly previewSection = signal<SectionSummary | null>(null);

  readonly totalSections = computed(() => this.sections().length);

  readonly filteredSections = computed(() => {
    const ind = this.activeIndustry();
    const slot = this.activeSlot();
    return this.sections().filter((s: SectionSummary) =>
      (ind === 'all' || s.industry === ind) &&
      (slot === 'all' || s.slot === slot),
    );
  });

  ngOnInit() {
    this.loadCatalog();
    this.loadSections();
  }

  loadCatalog() {
    this.http.get<{ catalog: IndustryCatalog[] }>('/api/section-marketplace')
      .pipe(catchError(() => of({ catalog: [] as IndustryCatalog[] })))
      .subscribe((res: { catalog: IndustryCatalog[] }) => {
        this.catalog.set(res.catalog ?? []);
        this.cdr.markForCheck();
      });
  }

  loadSections() {
    this.loading.set(true);
    this.http.get<{ sections: SectionSummary[] }>('/api/section-marketplace/sections?limit=200')
      .pipe(catchError(() => of({ sections: [] as SectionSummary[] })))
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
        this.forkedIds.update((prev: Set<string>) => new Set([...prev, id]));
        if (res) {
          this.forkCounts.update((prev: Map<string, number>) => new Map([...prev, [id, res.fork_count]]));
        }
        this.cdr.markForCheck();
      });
  }

  openPreview(section: SectionSummary) { this.previewSection.set(section); }
  closePreview() { this.previewSection.set(null); }

  getForkCount(id: string, original: number) {
    return this.forkCounts().get(id) ?? original;
  }

  industryIcon(ind: string) { return INDUSTRY_ICONS[ind] ?? '📦'; }
  slotColor(slot: string) { return SLOT_COLORS[slot] ?? 'var(--ps-accent, #00e5ff)'; }
}
