import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminMarketplaceComponent } from './marketplace.component';

/**
 * Convergence r8 — locks the Section Marketplace's cyan/black cohesion + a11y
 * contract:
 *  - stats roll through `<app-rolling-counter>` (sections + industries)
 *  - header, tabs, slot-filter, grid + each card reveal-animate (`appReveal`)
 *  - the preview dialog traps focus (`focusTrap`), reveal-animates, and Escape
 *    closes it (WCAG 2.1.2)
 *  - brand chrome flows through `--ps-*` tokens — no raw `rgba(0,229,255,…)`,
 *    `#0d0d20`, or `z-index: 9999` literals; the takeover z-index token is used
 *  - a visible cyan UX win: the active slot chip grows an animated underline
 */
describe('AdminMarketplaceComponent (cohesion r8)', () => {
  let fixture: ComponentFixture<AdminMarketplaceComponent>;
  let host: HTMLElement;
  let httpMock: HttpTestingController;

  const CATALOG = {
    catalog: [
      { industry: 'nonprofit', section_count: 4, slots: ['hero', 'cta'] },
      { industry: 'restaurant', section_count: 2, slots: ['hero'] },
    ],
  };
  const SECTIONS = {
    sections: [
      {
        id: 's1', industry: 'nonprofit', name: 'Warm Donor Hero', slot: 'hero',
        quality_score: 9.2, author: 'team', fork_count: 12,
        data_schema_fields: ['title', 'subtitle', 'cta_label'],
      },
      {
        id: 's2', industry: 'restaurant', name: 'Menu CTA', slot: 'cta',
        quality_score: 8.1, author: 'team', fork_count: 3, data_schema_fields: [],
      },
    ],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminMarketplaceComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(AdminMarketplaceComponent);
    host = fixture.nativeElement as HTMLElement;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    httpMock.expectOne('/api/section-marketplace').flush(CATALOG);
    httpMock.expectOne('/api/section-marketplace/sections?limit=200').flush(SECTIONS);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  const q = (sel: string): HTMLElement | null => host.querySelector(sel);
  const all = (sel: string): HTMLElement[] => Array.from(host.querySelectorAll(sel));
  const css = (): string =>
    Array.from(host.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');

  it('rolls both header stats through <app-rolling-counter>', () => {
    expect(all('.mkt-header__stats app-rolling-counter').length).toBe(2);
  });

  it('reveal-animates the header, filters, grid + every card (appReveal)', () => {
    expect(q('.mkt-header')?.hasAttribute('appReveal')).toBeTrue();
    expect(q('.mkt-industry-tabs')?.hasAttribute('appReveal')).toBeTrue();
    expect(q('.mkt-slot-filter')?.hasAttribute('appReveal')).toBeTrue();
    expect(q('.mkt-grid')?.hasAttribute('appReveal')).toBeTrue();
    expect(all('.mkt-card').every((c) => c.hasAttribute('appReveal'))).toBeTrue();
  });

  it('renders one card per section with a rolling fork + quality count', () => {
    expect(all('.mkt-card').length).toBe(2);
    expect(q('.mkt-card__score app-rolling-counter')).not.toBeNull();
    expect(q('.mkt-card__forks app-rolling-counter')).not.toBeNull();
  });

  it('traps focus + reveal-animates the preview dialog and Escape closes it', () => {
    expect(q('.mkt-preview-overlay')).withContext('closed by default').toBeNull();

    const previewBtn = q('.mkt-card__preview-btn') as HTMLButtonElement;
    previewBtn.click();
    fixture.detectChanges();

    const overlay = q('.mkt-preview-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute('role')).toBe('dialog');
    expect(overlay?.getAttribute('aria-modal')).toBe('true');
    // focusTrap is an attribute directive bound truthy on the overlay.
    expect(overlay?.hasAttribute('ng-reflect-focus-trap') || overlay?.hasAttribute('focusTrap')).toBeTrue();
    expect(q('.mkt-preview-modal')?.hasAttribute('appReveal')).toBeTrue();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(q('.mkt-preview-overlay')).withContext('Escape closes the dialog').toBeNull();
  });

  it('uses the brand-token chrome — no raw cyan/black literals or z-index 9999', () => {
    const sheet = css();
    // No hardcoded cyan rgba — must flow through --mkt-accent / --ps-accent.
    expect(sheet).not.toContain('rgba(0,229,255');
    // Modal must use the takeover z-index token, not a magic 9999.
    expect(sheet).toContain('var(--ps-z-overlay-takeover');
    expect(sheet).not.toContain('z-index: 9999;');
    // Accent alias is sourced from the brand token.
    expect(sheet).toContain('--mkt-accent: var(--ps-accent');
    // Modal background no longer a hardcoded #0d0d20.
    expect(sheet).not.toContain('#0d0d20');
  });

  it('ships a visible cyan focus ring and 24px-min targets for a11y', () => {
    const sheet = css();
    expect(sheet).toContain(':focus-visible');
    expect(sheet).toContain('outline: 2px solid var(--mkt-accent)');
    expect(sheet).toContain('min-height: 24px');
  });

  it('grows the animated underline UX win on the active slot chip', () => {
    const sheet = css();
    expect(sheet).toContain('.mkt-slot-chip::after');
    expect(sheet).toContain('.mkt-slot-chip--active::after');
  });
});
