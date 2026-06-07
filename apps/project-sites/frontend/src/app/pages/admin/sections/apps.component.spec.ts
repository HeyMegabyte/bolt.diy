import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { AppsComponent } from './apps.component';
import { APPS_CATALOG, APP_CATEGORIES, isAppSupported } from './apps-catalog.data';

/**
 * First spec for the Apps catalog section (convergence r24).
 * Covers the pure filter/lifecycle/search logic + the new a11y live-region
 * announcement. The template imports (RouterLink, Spartan tooltip) are stripped
 * so the constructor runs without a router/animation harness; ActivatedRoute is
 * stubbed with an empty queryParamMap so ngOnInit's subscribe is inert.
 */
function make(category?: string): AppsComponent {
  const queryParamMap = of(convertToParamMap(category ? { category } : {}));
  TestBed.configureTestingModule({
    imports: [AppsComponent],
    providers: [{ provide: ActivatedRoute, useValue: { queryParamMap } }],
  });
  TestBed.overrideComponent(AppsComponent, { set: { template: '<div></div>', imports: [] } });
  const fixture = TestBed.createComponent(AppsComponent);
  fixture.detectChanges();
  return fixture.componentInstance;
}

describe('AppsComponent (catalog filter + a11y)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts with the full catalog and no active filters', () => {
    const c = make();
    expect(c.filteredApps().length).toBe(APPS_CATALOG.length);
    expect(c.activeCategory()).toBeNull();
    expect(c.lifecycle()).toBe('all');
  });

  it('live + soon counts partition the catalog exactly', () => {
    const c = make();
    expect(c.liveCount + c.soonCount).toBe(c.totalCount);
  });

  it('lifecycle="live" keeps only supported apps', () => {
    const c = make();
    c.setLifecycle('live');
    const filtered = c.filteredApps();
    expect(filtered.length).toBe(c.liveCount);
    expect(filtered.every((a) => isAppSupported(a.id))).toBe(true);
  });

  it('lifecycle="soon" keeps only unsupported apps', () => {
    const c = make();
    c.setLifecycle('soon');
    expect(c.filteredApps().every((a) => !isAppSupported(a.id))).toBe(true);
  });

  it('category filter narrows to that category only', () => {
    const c = make();
    const cat = APP_CATEGORIES[0].id;
    c.setCategory(cat);
    const filtered = c.filteredApps();
    expect(filtered.length).toBe(c.countByCategory(cat));
    expect(filtered.every((a) => a.category === cat)).toBe(true);
  });

  it('search matches by name / tagline / id / tag', () => {
    const c = make();
    const sample = APPS_CATALOG[0];
    c.onSearchChange(sample.name.slice(0, 4));
    expect(c.filteredApps().some((a) => a.id === sample.id)).toBe(true);
  });

  it('a no-match search yields an empty grid + quoted empty title', () => {
    const c = make();
    c.onSearchChange('zzz-no-such-app-zzz');
    expect(c.filteredApps().length).toBe(0);
    expect(c.emptyTitle()).toContain('zzz-no-such-app-zzz');
  });

  it('resultAnnouncement reflects count + query for the live region (a11y)', () => {
    const c = make();
    expect(c.resultAnnouncement()).toBe(`Showing ${APPS_CATALOG.length} apps`);
    c.onSearchChange('zzz-no-such-app-zzz');
    expect(c.resultAnnouncement()).toBe('0 apps match "zzz-no-such-app-zzz"');
  });

  it('clearSearch + resetFilters restore the full catalog', () => {
    const c = make();
    c.setCategory(APP_CATEGORIES[0].id);
    c.onSearchChange('x');
    c.resetFilters();
    expect(c.activeCategory()).toBeNull();
    expect(c.searchQuery()).toBe('');
    expect(c.filteredApps().length).toBe(APPS_CATALOG.length);
  });

  it('honours a ?category= deep link from the route', () => {
    const validCat = APP_CATEGORIES[0].id;
    const c = make(validCat);
    expect(c.activeCategory()).toBe(validCat);
  });

  it('ignores an unknown ?category= deep link', () => {
    const c = make('not-a-real-category');
    expect(c.activeCategory()).toBeNull();
  });
});

import { provideRouter } from '@angular/router';

/**
 * Cyan/black cohesion: the decorative category-chip + infra-pill glyphs must be
 * monochrome stroke SVGs (inherit the chip/pill colour), never the colourful
 * ✨ (U+2728) / ⚡ (U+26A1) emoji — both emoji-presentation by default.
 */
describe('AppsComponent (decorative glyphs are SVGs, not colourful emoji)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the All-chip glyph as an SVG + leaks no ✨/⚡ emoji into the catalog', () => {
    TestBed.configureTestingModule({
      imports: [AppsComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
      ],
    });
    const fx = TestBed.createComponent(AppsComponent);
    fx.detectChanges();
    const host = fx.nativeElement as HTMLElement;

    // Scope to the two DECORATIVE chrome glyphs only — the per-app/per-service
    // catalog glyphs (🐘/⚡/… on individual apps) are a separate deliberate icon
    // set (a big refactor with semantic loss), out of scope here.
    const chipGlyph = host.querySelector('.chip-glyph');
    expect(chipGlyph).withContext('All-chip glyph present').not.toBeNull();
    expect(chipGlyph?.querySelector('svg')).withContext('chip glyph is an SVG').not.toBeNull();
    expect(chipGlyph?.textContent ?? '').withContext('no ✨ emoji in the chip glyph').not.toContain('✨');
    host.querySelectorAll('.infra-pill--bare .infra-glyph').forEach((g) => {
      expect(g.querySelector('svg')).withContext('Stateless glyph is an SVG').not.toBeNull();
      expect(g.textContent ?? '').withContext('no ⚡ emoji in the Stateless glyph').not.toContain('⚡');
    });
  });
});

/**
 * a11y: the catalog grid is the primary content — a screen-reader user needs a
 * "list of N items" cue + per-card "item X of N" position. CSS `display:grid`
 * strips the implicit list role, so the grid carries an explicit `role="list"`
 * and every card carries `role="listitem"`. Without it, the grid reads as an
 * undifferentiated wall of links with no count/position affordance.
 */
describe('AppsComponent (catalog grid has semantic list markup)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(): HTMLElement {
    TestBed.configureTestingModule({
      imports: [AppsComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
      ],
    });
    const fx = TestBed.createComponent(AppsComponent);
    fx.detectChanges();
    return fx.nativeElement as HTMLElement;
  }

  it('exposes the apps grid as a list', () => {
    const host = render();
    const grid = host.querySelector('.apps-grid');
    expect(grid).withContext('apps grid present').not.toBeNull();
    expect(grid?.getAttribute('role')).withContext('grid is role=list').toBe('list');
  });

  it('exposes every catalog card as a listitem matching the visible card count', () => {
    const host = render();
    const cards = Array.from(host.querySelectorAll('.app-card'));
    expect(cards.length).withContext('at least one card rendered').toBeGreaterThan(0);
    cards.forEach((card) =>
      expect(card.getAttribute('role')).withContext('card is role=listitem').toBe('listitem'),
    );
    expect(host.querySelectorAll('.apps-grid [role="listitem"]').length).toBe(cards.length);
  });
});
