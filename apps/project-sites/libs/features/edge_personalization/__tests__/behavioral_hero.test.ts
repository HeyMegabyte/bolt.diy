/**
 * @module libs/features/edge_personalization/__tests__/behavioral_hero.test
 *
 * Unit tests for behavioral hero — pure signal detection + content mapping.
 */
import { detectVisitorContext, resolveHeroVariant, resolveHero } from '../behavioral_hero.js';
import type { PersonalizationSignals } from '../schemas.js';

const signals = (overrides: Partial<PersonalizationSignals> = {}): PersonalizationSignals => ({
  device: 'desktop',
  hour: 12,
  ...overrides,
});

const business = {
  name: "Tony's Pizza",
  tagline: 'Authentic Neapolitan Pizza',
  city: 'Brooklyn',
  reviewCount: 1200,
  rating: 4.8,
};

describe('detectVisitorContext', () => {
  test('google referrer → search', () => {
    expect(detectVisitorContext(signals({ referrer: 'https://www.google.com/search?q=pizza' }))).toBe('search');
  });

  test('facebook referrer → social', () => {
    expect(detectVisitorContext(signals({ referrer: 'https://www.facebook.com/tonyspizza' }))).toBe('social');
  });

  test('instagram referrer → social', () => {
    expect(detectVisitorContext(signals({ referrer: 'https://www.instagram.com/tonyspizza' }))).toBe('social');
  });

  test('returning visitor → returning', () => {
    expect(detectVisitorContext(signals({ isReturn: true }))).toBe('returning');
  });

  test('has geo → local', () => {
    expect(detectVisitorContext(signals({ geo: 'US-NY' }))).toBe('local');
  });

  test('no signals → first_visit', () => {
    expect(detectVisitorContext(signals())).toBe('first_visit');
  });

  test('unknown referrer → direct', () => {
    expect(detectVisitorContext(signals({ referrer: 'https://someblog.com/article' }))).toBe('direct');
  });

  test('search beats social (priority)', () => {
    // If referrer contains google AND facebook, google wins
    expect(detectVisitorContext(signals({ referrer: 'https://www.google.com/search?q=tonys+pizza+facebook' }))).toBe('search');
  });
});

describe('resolveHeroVariant', () => {
  test('search variant reinforces intent with service CTA', () => {
    const hero = resolveHeroVariant('search', business);
    expect(hero.headline).toContain(business.name);
    expect(hero.cta).toBe('See Our Services');
    expect(hero.trustBadge).toContain('4.8');
  });

  test('social variant emphasizes reviews', () => {
    const hero = resolveHeroVariant('social', business);
    expect(hero.headline).toContain('Thousands');
    expect(hero.cta).toBe('Read Our Reviews');
  });

  test('returning variant shows freshness', () => {
    const hero = resolveHeroVariant('returning', business);
    expect(hero.headline).toContain('Welcome Back');
    expect(hero.cta).toBe("What's New");
  });

  test('local variant names the city', () => {
    const hero = resolveHeroVariant('local', business);
    expect(hero.subheadline).toContain('Brooklyn');
    expect(hero.trustBadge).toContain('📍 Brooklyn');
  });

  test('first_visit variant introduces the business', () => {
    const hero = resolveHeroVariant('first_visit', business);
    expect(hero.headline).toContain(business.name);
    expect(hero.cta).toBe('Learn More');
  });

  test('each variant has all required fields', () => {
    const contexts = ['first_visit', 'returning', 'search', 'social', 'local', 'direct'] as const;
    for (const ctx of contexts) {
      const hero = resolveHeroVariant(ctx, business);
      expect(hero.headline).toBeTruthy();
      expect(hero.subheadline).toBeTruthy();
      expect(hero.cta).toBeTruthy();
      expect(hero.ctaUrl).toBeTruthy();
      expect(hero.imageHint).toBeTruthy();
    }
  });

  test('handles minimal business info gracefully', () => {
    const hero = resolveHeroVariant('first_visit', { name: 'Shop', tagline: 'We sell things' });
    expect(hero.headline).toContain('Shop');
    expect(hero.trustBadge).toBe('Established & Trusted');
  });
});

describe('resolveHero', () => {
  test('full resolution — detect + map', () => {
    const result = resolveHero(
      signals({ referrer: 'https://www.google.com/search?q=pizza' }),
      business,
    );
    expect(result.context).toBe('search');
    expect(result.variant.cta).toBe('See Our Services');
  });
});
