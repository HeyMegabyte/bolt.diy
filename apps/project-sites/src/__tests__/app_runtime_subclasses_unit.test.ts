import { SUPPORTED_APP_SLUGS, isSupportedSlug } from '../durable_objects/app_runtime_subclasses.js';

describe('app_runtime_subclasses — supported-slug guard', () => {
  it('exposes a non-empty, unique slug list', () => {
    expect(SUPPORTED_APP_SLUGS.length).toBeGreaterThan(0);
    expect(new Set(SUPPORTED_APP_SLUGS).size).toBe(SUPPORTED_APP_SLUGS.length);
  });
  it('isSupportedSlug is true for every listed slug', () => {
    for (const slug of SUPPORTED_APP_SLUGS) {
      expect(isSupportedSlug(slug)).toBe(true);
    }
  });
  it('isSupportedSlug is false for unknown / empty / arbitrary input', () => {
    expect(isSupportedSlug('___definitely-not-an-app___')).toBe(false);
    expect(isSupportedSlug('')).toBe(false);
    expect(isSupportedSlug('UMAMI')).toBe(false); // case-sensitive — no accidental matches
  });
});
