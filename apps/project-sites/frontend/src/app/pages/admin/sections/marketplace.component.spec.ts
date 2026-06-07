import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminMarketplaceComponent } from './marketplace.component';
import { FocusTrapDirective } from '../../../directives/focus-trap.directive';
import { ToastService } from '../../../services/toast.service';

/** Collect CSS from injected <style> tags AND adopted/constructable stylesheets —
 *  Angular injects component CSS into document.head/adopted sheets, not the host. */
function collectAllCss(): string {
  let out = Array.from(document.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');
  for (const sheet of Array.from(document.adoptedStyleSheets ?? [])) {
    try {
      out += '\n' + Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
    } catch {
      /* inaccessible sheet — skip */
    }
  }
  return out;
}

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
  const css = (): string => collectAllCss();

  it('rolls both header stats through <app-rolling-counter>', () => {
    expect(all('.mkt-header__stats app-rolling-counter').length).toBe(2);
  });

  // A definitive "0 sections · 0 industries" must NOT show over the "Couldn't
  // load" error card (or a loading skeleton) — 0 is wrong there, the count is
  // unknown. The header stats appear only once the catalog genuinely resolves.
  it('hides the header stats during loadError (no false "0 sections" over the error card)', () => {
    fixture.componentInstance.loadError.set(true);
    fixture.detectChanges();
    expect(q('.mkt-header__stats')).withContext('stats hidden on error').toBeNull();
    fixture.componentInstance.loadError.set(false);
    fixture.detectChanges();
    expect(q('.mkt-header__stats')).withContext('stats return once resolved').not.toBeNull();
  });

  // The industry tabs + slot filter must NOT render over the error card — they
  // filter a catalog that failed to load (dead controls).
  it('hides the industry tabs + slot filter on loadError; shows them once resolved', () => {
    fixture.componentInstance.loadError.set(true);
    fixture.detectChanges();
    expect(q('.mkt-industry-tabs')).withContext('industry tabs hidden on error').toBeNull();
    expect(q('.mkt-slot-filter')).withContext('slot filter hidden on error').toBeNull();
    fixture.componentInstance.loadError.set(false);
    fixture.detectChanges();
    expect(q('.mkt-industry-tabs')).withContext('filters return once resolved').not.toBeNull();
    expect(q('.mkt-slot-filter')).not.toBeNull();
  });

  it('hides the header stats while loading (no premature "0 sections" over the skeleton)', () => {
    fixture.componentInstance.loading.set(true);
    fixture.detectChanges();
    expect(q('.mkt-header__stats')).withContext('stats hidden while loading').toBeNull();
    fixture.componentInstance.loading.set(false);
    fixture.detectChanges();
  });

  it('announces the loading state to assistive tech (WCAG 4.1.3 — role=status + aria-live)', () => {
    // A bare <div aria-label="Loading sections"> is NOT a live region — an SR
    // user never hears it appear. The loading block must be a polite status.
    fixture.componentInstance.loading.set(true);
    fixture.detectChanges();
    const loading = q('.mkt-loading');
    expect(loading).withContext('loading block renders when loading()').not.toBeNull();
    expect(loading!.getAttribute('role')).toBe('status');
    expect(loading!.getAttribute('aria-live')).toBe('polite');
    fixture.componentInstance.loading.set(false);
    fixture.detectChanges();
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
    // focusTrap is bound as [focusTrap]="true" (a property, not a DOM attribute, and
    // ng-reflect-* is dev-only) — assert the directive instance via By.directive.
    const trapEl = fixture.debugElement.query(By.directive(FocusTrapDirective));
    expect(trapEl).withContext('the overlay applies FocusTrapDirective').not.toBeNull();
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
    // Emulated encapsulation injects [_ngcontent-xxx] between the class and the
    // pseudo-element, and CSSOM may serialize the colon as `:after`/`::after`.
    expect(sheet).toMatch(/\.mkt-slot-chip[^{]*:{1,2}after/);
    expect(sheet).toMatch(/\.mkt-slot-chip--active[^{]*:{1,2}after/);
  });

  // ── Fork reliability: success marks forked, failure must NOT lie ──────────
  it('fork marks the card "Forked" + bumps the count only on a successful POST', () => {
    const btn = q('.mkt-card__fork-btn') as HTMLButtonElement; // first card = s1
    btn.click();
    httpMock.expectOne('/api/section-marketplace/sections/s1/fork').flush({ id: 's1', fork_count: 13 });
    fixture.detectChanges();
    expect(fixture.componentInstance.forkedIds().has('s1')).toBeTrue();
    expect((q('.mkt-card__fork-btn') as HTMLElement).textContent).toContain('Forked');
  });

  it('does NOT mark forked + surfaces an error toast when the fork POST fails (no lying UI)', () => {
    const toast = TestBed.inject(ToastService);
    const errSpy = spyOn(toast, 'error');
    const btn = q('.mkt-card__fork-btn') as HTMLButtonElement; // first card = s1
    btn.click();
    httpMock
      .expectOne('/api/section-marketplace/sections/s1/fork')
      .flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(fixture.componentInstance.forkedIds().has('s1')).toBeFalse();
    expect((q('.mkt-card__fork-btn') as HTMLElement).textContent).not.toContain('Forked');
    expect(errSpy).toHaveBeenCalled();
  });

  it('resultAnnouncement(): announces the filtered section count + active industry for screen readers', () => {
    const c = fixture.componentInstance;
    expect(c.resultAnnouncement()).withContext('all industries, 2 seeded sections').toBe('Showing 2 sections');
    c.setIndustry('nonprofit'); // matches s1 only
    fixture.detectChanges();
    expect(c.resultAnnouncement()).withContext('singular noun + active industry').toBe('1 section · nonprofit');
  });

  it('a no-match filter combo shows the "Clear filters" empty-state CTA; resetFilters restores the catalog', () => {
    const c = fixture.componentInstance;
    expect(c.hasActiveFilter()).withContext('no filter at rest').toBeFalse();
    // nonprofit + cta matches neither seeded section (s1=nonprofit/hero, s2=restaurant/cta)
    c.setIndustry('nonprofit');
    c.setSlot('cta');
    fixture.detectChanges();
    expect(c.filteredSections().length).withContext('no section matches the combo').toBe(0);
    expect(c.hasActiveFilter()).toBeTrue();
    const empty = host.querySelector('[data-testid="marketplace-empty"]');
    expect(empty?.querySelector('button')?.textContent).withContext('offers Clear filters').toContain('Clear filters');

    c.resetFilters();
    fixture.detectChanges();
    expect(c.hasActiveFilter()).toBeFalse();
    expect(c.filteredSections().length).withContext('catalog restored').toBe(2);
  });
});

/**
 * Error-state correlation id: when the catalog feed fails, the error card must
 * surface the worker's request_id (envelope `{ error: { request_id } }`) so the
 * operator can copy a real reference for support — the error-card hint promises
 * "copy the reference below" only when a reference is actually present.
 */
describe('AdminMarketplaceComponent (error-state correlation id)', () => {
  let fixture: ComponentFixture<AdminMarketplaceComponent>;
  let host: HTMLElement;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminMarketplaceComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(AdminMarketplaceComponent);
    host = fixture.nativeElement as HTMLElement;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });
  afterEach(() => { httpMock.verify(); TestBed.resetTestingModule(); });
  const q = (sel: string): HTMLElement | null => host.querySelector(sel);

  it('captures request_id from a failed catalog feed + renders it as the support reference', () => {
    httpMock.expectOne('/api/section-marketplace').flush(
      { error: { code: 'INTERNAL_ERROR', message: 'boom', request_id: 'req_mkt_42' } },
      { status: 500, statusText: 'Server Error' },
    );
    httpMock.expectOne('/api/section-marketplace/sections?limit=200').flush(
      { error: { code: 'INTERNAL_ERROR', message: 'boom', request_id: 'req_mkt_42' } },
      { status: 500, statusText: 'Server Error' },
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.loadError()).toBeTrue();
    expect(fixture.componentInstance.loadErrorRef()).toBe('req_mkt_42');
    expect(q('[data-testid="error-card"]')).withContext('error card shown').not.toBeNull();
    expect(q('[data-testid="error-correlation"]')?.textContent?.trim()).toBe('req_mkt_42');
  });

  it('reload() clears the prior correlation id before retrying', () => {
    httpMock.expectOne('/api/section-marketplace').flush(
      { error: { request_id: 'req_old' } }, { status: 500, statusText: 'err' });
    httpMock.expectOne('/api/section-marketplace/sections?limit=200').flush(
      { error: { request_id: 'req_old' } }, { status: 500, statusText: 'err' });
    fixture.detectChanges();
    expect(fixture.componentInstance.loadErrorRef()).toBe('req_old');

    fixture.componentInstance.reload();
    expect(fixture.componentInstance.loadErrorRef()).withContext('stale ref cleared on retry').toBe('');
    // satisfy the retry's two outstanding requests so httpMock.verify() passes
    httpMock.expectOne('/api/section-marketplace').flush({ catalog: [] });
    httpMock.expectOne('/api/section-marketplace/sections?limit=200').flush({ sections: [] });
  });
});

/**
 * Flag-gate (404) vs transient-error (5xx) distinction. /api/section-marketplace
 * returns 404 when the `section_marketplace` flag is OFF — that must surface a
 * CALM "enable in Feature Flags" notice, NOT the alarming "Couldn't load · Retry"
 * card (retrying can't enable a flag; "check your connection" is wrong). This was
 * a real bug — the section showed the transient error card for a disabled feature.
 */
describe('AdminMarketplaceComponent — flag-gate (404) vs transient error', () => {
  let fixture: ComponentFixture<AdminMarketplaceComponent>;
  let host: HTMLElement;
  let httpMock: HttpTestingController;

  function loadWith(status: number): void {
    TestBed.configureTestingModule({
      imports: [AdminMarketplaceComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(AdminMarketplaceComponent);
    host = fixture.nativeElement as HTMLElement;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges(); // ngOnInit → loadCatalog + loadSections
    const body = status === 404 ? { error: { code: 'NOT_FOUND' } } : 'boom';
    httpMock.expectOne('/api/section-marketplace').flush(body, { status, statusText: 'x' });
    httpMock.expectOne('/api/section-marketplace/sections?limit=200').flush(body, { status, statusText: 'x' });
    fixture.detectChanges();
  }

  afterEach(() => { httpMock.verify(); TestBed.resetTestingModule(); });

  it('a 404 (flag off) → calm Feature-Flags notice, NOT the transient error card', () => {
    loadWith(404);
    expect(fixture.componentInstance.flagDisabled()).withContext('404 = flag-gate').toBeTrue();
    expect(fixture.componentInstance.loadError()).withContext('not a transient error').toBeFalse();
    expect(host.querySelector('[data-testid="marketplace-flag-gate"]')).withContext('calm gate notice shown').not.toBeNull();
    expect(host.querySelector('app-error-card')).withContext('NO alarming error card on a flag-gate').toBeNull();
    // Filters + stats are dead controls over a disabled section → must be hidden.
    expect(host.querySelector('.mkt-industry-tabs')).withContext('industry tabs hidden when flag-gated').toBeNull();
    expect(host.querySelector('.mkt-slot-filter')).withContext('slot filter hidden when flag-gated').toBeNull();
    expect(host.querySelector('.mkt-header__stats')).withContext('header stats hidden when flag-gated').toBeNull();
    const link = host.querySelector('[data-testid="marketplace-flag-gate"] a');
    expect(link?.getAttribute('href')).withContext('SPA link to the platform-flags section').toBe('/admin/feature-flags');
    // The section was renamed "System Admin" (2026-06-07) — the inline label must
    // match the nav, never the stale "Feature Flags".
    expect(link?.textContent?.replace(/\s+/g, ' ').trim()).withContext('label matches the renamed System Admin section').toBe('System Admin');
  });

  it('a non-404 (500) → the transient error card with Retry, NOT the flag-gate notice', () => {
    loadWith(500);
    expect(fixture.componentInstance.loadError()).withContext('5xx = transient').toBeTrue();
    expect(fixture.componentInstance.flagDisabled()).withContext('not a flag-gate').toBeFalse();
    expect(host.querySelector('app-error-card')).withContext('transient error card on a 500').not.toBeNull();
    expect(host.querySelector('[data-testid="marketplace-flag-gate"]')).withContext('NO flag-gate notice on a transient error').toBeNull();
  });
});

/**
 * Stale-route fake-empty guard (canonical: site-features / inbox / logs-explorer).
 * A STALE worker route returns 200 + SPA/marketing HTML (NOT a 4xx) — the body
 * parses to a shapeless object with no `catalog`/`sections` array. The old
 * `res.catalog ?? []` only caught null/undefined, so a 200-HTML route faked an
 * empty catalog (masking a broken route) OR — worse — a non-array `catalog`
 * (e.g. `{ catalog: '<html>' }`) flowed straight into `catalog().length` and the
 * `@for`. The fix: `!res || !Array.isArray(res.catalog)` → the honest retryable
 * error card, never fake-empty.
 */
describe('AdminMarketplaceComponent — stale-route fake-empty guard', () => {
  let fixture: ComponentFixture<AdminMarketplaceComponent>;
  let host: HTMLElement;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminMarketplaceComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(AdminMarketplaceComponent);
    host = fixture.nativeElement as HTMLElement;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges(); // ngOnInit → loadCatalog + loadSections
  });
  afterEach(() => { httpMock.verify(); TestBed.resetTestingModule(); });
  const q = (sel: string): HTMLElement | null => host.querySelector(sel);

  it('a 200 with NO catalog array (stale-route HTML) → error card, NOT a fake-empty catalog', () => {
    // Stale worker route: 200 status, but the body is a shapeless object (the SPA
    // HTML parsed as JSON-ish) with no `catalog`/`sections` array.
    httpMock.expectOne('/api/section-marketplace').flush({} as never);
    httpMock.expectOne('/api/section-marketplace/sections?limit=200').flush({} as never);
    fixture.detectChanges();

    expect(fixture.componentInstance.loadError()).withContext('honest error on a stale 200-HTML route').toBeTrue();
    expect(fixture.componentInstance.flagDisabled()).withContext('not a flag-gate — 200, not 404').toBeFalse();
    expect(q('[data-testid="error-card"]')).withContext('retryable error card, not a fake-empty list').not.toBeNull();
    // The catalog/sections signals must stay empty arrays (never a non-array poison value).
    expect(fixture.componentInstance.catalog()).toEqual([]);
    expect(fixture.componentInstance.sections()).toEqual([]);
  });

  it('a 200 with a non-array catalog (poison value) → error card, never a crashing non-array set', () => {
    // The nastier case: a non-array catalog flowing into catalog().length + the @for.
    httpMock.expectOne('/api/section-marketplace').flush({ catalog: '<html>' } as never);
    httpMock.expectOne('/api/section-marketplace/sections?limit=200').flush({ sections: '<html>' } as never);
    fixture.detectChanges();

    expect(fixture.componentInstance.loadError()).withContext('honest error, not a poisoned signal').toBeTrue();
    // The guard MUST NOT set the non-array string — the signal stays a clean array.
    expect(Array.isArray(fixture.componentInstance.catalog())).withContext('catalog stays an array').toBeTrue();
    expect(Array.isArray(fixture.componentInstance.sections())).withContext('sections stays an array').toBeTrue();
  });
});

/**
 * Fork double-submit guard. The fork POST early-returns only AFTER success
 * (forkedIds().has(id)). While the POST is in flight, repeated clicks fire
 * duplicate POSTs. A `forking` set tracks the in-flight id so a second click is a
 * no-op until the first request resolves (canonical: [[double-submit-mutation-guards]]).
 */
describe('AdminMarketplaceComponent — fork double-submit guard', () => {
  let fixture: ComponentFixture<AdminMarketplaceComponent>;
  let host: HTMLElement;
  let httpMock: HttpTestingController;

  const CATALOG = { catalog: [{ industry: 'nonprofit', section_count: 1, slots: ['hero'] }] };
  const SECTIONS = {
    sections: [{
      id: 's1', industry: 'nonprofit', name: 'Warm Donor Hero', slot: 'hero',
      quality_score: 9.2, author: 'team', fork_count: 12, data_schema_fields: [],
    }],
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
  afterEach(() => { httpMock.verify(); TestBed.resetTestingModule(); });
  const q = (sel: string): HTMLElement | null => host.querySelector(sel);

  it('a second fork click while the first POST is in flight does NOT fire a duplicate request', () => {
    const btn = q('.mkt-card__fork-btn') as HTMLButtonElement;
    btn.click(); // first click — fires the POST
    fixture.detectChanges();
    btn.click(); // second click while in flight — must be a no-op
    fixture.detectChanges();

    // Exactly ONE outstanding fork POST (httpMock.expectOne throws on a duplicate).
    const req = httpMock.expectOne('/api/section-marketplace/sections/s1/fork');
    req.flush({ id: 's1', fork_count: 13 });
    fixture.detectChanges();
    expect(fixture.componentInstance.forkedIds().has('s1')).toBeTrue();
  });

  it('the fork button is aria-busy + disabled while the POST is in flight', () => {
    const btn = q('.mkt-card__fork-btn') as HTMLButtonElement;
    btn.click();
    fixture.detectChanges();
    expect(btn.getAttribute('aria-busy')).withContext('busy while forking').toBe('true');
    expect(btn.disabled).withContext('disabled while forking').toBeTrue();

    httpMock.expectOne('/api/section-marketplace/sections/s1/fork').flush({ id: 's1', fork_count: 13 });
    fixture.detectChanges();
    expect(btn.getAttribute('aria-busy')).withContext('no longer busy after resolve').not.toBe('true');
  });
});
