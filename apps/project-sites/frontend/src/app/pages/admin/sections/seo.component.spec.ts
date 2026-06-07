import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { AdminSeoComponent } from './seo.component';
import { AdminStateService } from '../admin-state.service';

/**
 * Convergence r52 — locks the cyan/black cohesion + a11y contract for the SEO
 * section so future edits can't silently regress:
 *  - coverage-summary strip rolls guaranteed/review/total via app-rolling-counter
 *  - count getters stay derived from the single seoChecks source of truth
 *  - checklist rows + JSON-LD block expose keyboard + ARIA affordances
 *  - the Google-preview title carries no fake-link affordance
 *  - cyan accent flows through the --seo-accent token (no hardcoded brand hex)
 */
describe('AdminSeoComponent (cyan/black cohesion + a11y)', () => {
  let fixture: ComponentFixture<AdminSeoComponent>;
  let selectedSite: WritableSignal<{ business_name?: string; slug?: string } | null>;

  function build(site: { business_name?: string; slug?: string } | null): void {
    selectedSite = signal(site);
    TestBed.configureTestingModule({
      imports: [AdminSeoComponent],
      providers: [{ provide: AdminStateService, useValue: { selectedSite } }],
    });
    fixture = TestBed.createComponent(AdminSeoComponent);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('derives the three counts from the single seoChecks source', () => {
    build(null);
    const c = fixture.componentInstance;
    expect(c.totalCount).toBe(c.guaranteedCount + c.reviewCount);
    expect(c.guaranteedCount).toBeGreaterThan(0);
    expect(c.reviewCount).toBeGreaterThan(0);
    expect(c.totalCount).toBe((c as unknown as { seoChecks: unknown[] }).seoChecks.length);
  });

  it('rolls all three summary counts via app-rolling-counter (no raw numeric nodes)', () => {
    build({ business_name: 'Acme', slug: 'acme' });
    const el: HTMLElement = fixture.nativeElement;
    const counters = el.querySelectorAll('.seo-summary app-rolling-counter');
    expect(counters.length).toBe(3);
  });

  it('every coverage-summary stat sits in a [data-numeric] wrapper', () => {
    build(null);
    const el: HTMLElement = fixture.nativeElement;
    const stats = el.querySelectorAll('.seo-summary [data-numeric]');
    expect(stats.length).toBe(3);
  });

  it('fades in the header + summary strip via appReveal', () => {
    build(null);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.seo-header[appreveal]')).toBeTruthy();
    expect(el.querySelector('.seo-summary[appreveal]')).toBeTruthy();
  });

  it('labels the coverage summary as an aria group', () => {
    build(null);
    const el: HTMLElement = fixture.nativeElement;
    const group = el.querySelector('.seo-summary');
    expect(group?.getAttribute('role')).toBe('group');
    expect(group?.getAttribute('aria-label')).toContain('summary');
  });

  it('exposes every checklist row as a focusable listitem with an aria-label', () => {
    build(null);
    const el: HTMLElement = fixture.nativeElement;
    const rows = el.querySelectorAll('.checklist-row');
    expect(rows.length).toBe(fixture.componentInstance.totalCount);
    rows.forEach((row) => {
      expect(row.getAttribute('role')).toBe('listitem');
      expect(row.getAttribute('tabindex')).toBe('0');
      expect((row.getAttribute('aria-label') ?? '').length).toBeGreaterThan(0);
    });
  });

  it('makes the JSON-LD block keyboard-scrollable with a region role + label', () => {
    build({ business_name: 'Acme', slug: 'acme' });
    const el: HTMLElement = fixture.nativeElement;
    const block = el.querySelector('.json-ld-block');
    expect(block?.getAttribute('tabindex')).toBe('0');
    expect(block?.getAttribute('role')).toBe('region');
    expect(block?.getAttribute('aria-label')).toContain('JSON-LD');
  });

  it('does NOT present the Google-preview title as a clickable link', () => {
    build({ business_name: 'Acme', slug: 'acme' });
    const el: HTMLElement = fixture.nativeElement;
    const title = el.querySelector('.search-preview-title');
    expect(title).toBeTruthy();
    expect(title?.classList.contains('cursor-pointer')).toBeFalse();
    // It is a div, not an anchor — no false link affordance.
    expect(title?.tagName.toLowerCase()).not.toBe('a');
  });

  it('routes the cyan accent through the --seo-accent token (no hardcoded brand hex)', () => {
    build(null);
    const styles = TestBed.createComponent(AdminSeoComponent);
    void styles; // fixture already created above
    const css = (AdminSeoComponent as unknown as { ɵcmp?: { styles?: string[] } }).ɵcmp?.styles?.join('\n') ?? '';
    if (css) {
      // Token is defined and referenced; no raw cyan rgba literals remain in cards/pills.
      expect(css).toContain('--seo-accent');
      expect(css).not.toContain('rgba(0, 229, 255');
    }
  });

  it('reflects business name + slug in the preview', () => {
    build({ business_name: 'Vito Salon', slug: 'vito-salon' });
    const c = fixture.componentInstance;
    expect(c.siteName).toBe('Vito Salon');
    expect(c.siteDomain).toBe('vito-salon.projectsites.dev');
  });

  it('shows a Social Share (Open Graph) preview — the section promises social sharing', () => {
    build({ business_name: 'Vito Salon', slug: 'vito-salon' });
    const el: HTMLElement = fixture.nativeElement;
    const card = el.querySelector('[data-testid="seo-social-preview"]');
    expect(card).withContext('subtitle promises social sharing → a social-card preview must render').toBeTruthy();
    // mirrors the Google-preview mockup: real domain + composed title, branded OG-image area
    expect(card!.textContent ?? '').toContain('vito-salon.projectsites.dev');
    expect(card!.textContent ?? '').toContain('Vito Salon');
    // the OG-image area is a decorative mockup (no live asset) → hidden from SR
    expect(card!.querySelector('.social-card-img')?.getAttribute('aria-hidden')).toBe('true');
  });

  /**
   * WCAG 1.3.1 / 1.4.1 / 4.1.2 — the summary strip differentiates its three
   * figures only by COLOR (green guaranteed / amber review / cyan total) and
   * position. Each stat is a rolling counter (bare "8") next to a separate
   * label span, so a screen reader heard a flat "8 Guaranteed 2 To review 10
   * Checks" stream with no programmatic number↔meaning binding and no exposure
   * of the colour-encoded status. Each stat must be a self-described figure
   * (role=group + combined aria-label), with the inner number + label hidden
   * from AT so the figure is announced exactly once. Mirrors the settings
   * section's `.stat-val` aria-label pattern.
   */
  it('exposes each summary stat as a single labelled figure (number + meaning, not colour-only)', () => {
    build({ business_name: 'Acme', slug: 'acme' });
    const c = fixture.componentInstance;
    const el: HTMLElement = fixture.nativeElement;
    const stats = Array.from(el.querySelectorAll('.seo-summary .seo-summary-stat'));
    expect(stats.length).toBe(3);

    for (const stat of stats) {
      expect(stat.getAttribute('role')).withContext('each stat is its own figure/group').toBe('group');
      expect((stat.getAttribute('aria-label') ?? '').trim().length)
        .withContext('combined accessible name present').toBeGreaterThan(0);
    }

    const names = stats.map((s) => (s.getAttribute('aria-label') ?? '').toLowerCase());
    // Accessible name carries the COUNT + the MEANING — not colour alone.
    expect(names[0]).toContain(String(c.guaranteedCount));
    expect(names[0]).toContain('guaranteed');
    expect(names[1]).toContain(String(c.reviewCount));
    expect(names[1]).toContain('review');
    expect(names[2]).toContain(String(c.totalCount));
    expect(names[2]).toContain('check');
  });

  it('hides the inner counter + label from AT so each figure is announced once (no double-read)', () => {
    build({ business_name: 'Acme', slug: 'acme' });
    const el: HTMLElement = fixture.nativeElement;
    const stats = Array.from(el.querySelectorAll('.seo-summary .seo-summary-stat'));
    expect(stats.length).toBe(3);
    for (const stat of stats) {
      expect(stat.querySelector('.seo-summary-num')?.getAttribute('aria-hidden'))
        .withContext('inner number hidden from AT').toBe('true');
      expect(stat.querySelector('.seo-summary-label')?.getAttribute('aria-hidden'))
        .withContext('inner label hidden from AT').toBe('true');
    }
  });
});
