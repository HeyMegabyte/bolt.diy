import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { PricingComponent } from './pricing.component';

/**
 * The pricing page is conversion-critical marketing prose. A raw template
 * placeholder like `{slug}` leaking into the copy reads as a broken/unrendered
 * variable to a prospective customer — "looks broken = is broken". This spec
 * locks the copy to a concrete illustrative subdomain instead.
 */
describe('PricingComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PricingComponent],
      providers: [
        provideRouter([]),
        // The i18n pass (iter 170) added TranslateModule to the standalone
        // page; the translate pipe needs the service — stub it pass-through.
        {
          provide: TranslateService,
          useValue: {
            currentLang: 'en',
            get: (key: string) => of(key),
            // The translate pipe subscribes to all three change streams on
            // first transform (TranslatePipe.transform/_dispose).
            onLangChange: new Subject(),
            onTranslationChange: new Subject(),
            onFallbackLangChange: new Subject(),
          },
        },
      ],
    }).compileComponents();
  });

  it('never leaks a literal {slug} placeholder in the pricing copy', () => {
    const fixture = TestBed.createComponent(PricingComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('{slug}');
    // The template renders i18n KEYS under the pass-through stub — proves the
    // copy flows through the translate pipe rather than hardcoded literals.
    expect(text).toContain('pricingPage.title');
  });

  // The customer-facing copy lives in the i18n JSON now (iter 170) — the
  // illustrative-subdomain guarantee moved there with it. Guard the FILE.
  it('the pricing i18n copy carries the illustrative subdomain, never a {slug} leak', async () => {
    const res = await fetch('assets/i18n/en.json');
    expect(res.ok).withContext('en.json must be served by Karma').toBe(true);
    const en = (await res.json()) as Record<string, unknown>;
    const pricing = JSON.stringify(en['pricingPage'] ?? {});
    expect(pricing).toContain('yoursite.projectsites.dev');
    expect(pricing).not.toContain('{slug}');
  });
});
