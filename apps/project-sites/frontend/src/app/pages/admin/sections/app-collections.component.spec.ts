import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  AppCollectionsComponent,
  resolveCollections,
} from './app-collections.component';
import { APPS_CATALOG } from './apps-catalog.data';

describe('resolveCollections', () => {
  const cols = resolveCollections();

  it('produces non-empty collections of real catalog apps only', () => {
    expect(cols.length).toBeGreaterThan(0);
    const ids = new Set(APPS_CATALOG.map((a) => a.id));
    for (const col of cols) {
      expect(col.apps.length).toBeGreaterThan(0);
      expect(col.apps.every((a) => ids.has(a.id))).toBeTrue();
    }
  });

  it('every curated id resolved to a real catalog app (no typos in the map)', () => {
    // Each collection should keep ALL its curated apps — a dropped id means a typo.
    const privacy = cols.find((c) => c.slug === 'privacy-analytics');
    expect(privacy?.apps.map((a) => a.id)).toEqual(['plausible', 'umami', 'matomo']);
  });
});

describe('AppCollectionsComponent', () => {
  function make() {
    TestBed.configureTestingModule({
      imports: [AppCollectionsComponent],
      providers: [provideRouter([])],
    });
    const f = TestBed.createComponent(AppCollectionsComponent);
    f.detectChanges();
    return f;
  }

  it('renders a section per collection with cards linking to app detail', () => {
    const f = make();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="app-collections"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="collection-privacy-analytics"]')).toBeTruthy();
    const card = el.querySelector(
      '[data-testid="collection-card-plausible"]',
    ) as HTMLAnchorElement | null;
    expect(card).toBeTruthy();
    expect(card?.getAttribute('href')).toContain('/admin/apps/plausible');
  });
});
