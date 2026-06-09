import { normalizeLocale, parseLocales, dirFor, buildHreflang } from '../routes/i18n';

describe('i18n helpers', () => {
  describe('normalizeLocale', () => {
    it('lowercases + strips region', () => {
      expect(normalizeLocale('es-419')).toBe('es');
      expect(normalizeLocale('EN')).toBe('en');
      expect(normalizeLocale('pt_BR')).toBe('pt');
    });
  });

  describe('parseLocales', () => {
    it('dedupes + validates, drops junk', () => {
      expect(parseLocales('es, fr, es-419, xx1, , FR')).toEqual(['es', 'fr']);
    });
    it('empty in → empty out', () => {
      expect(parseLocales('')).toEqual([]);
    });
  });

  describe('dirFor', () => {
    it('flags RTL languages', () => {
      expect(dirFor('ar')).toBe('rtl');
      expect(dirFor('he-IL')).toBe('rtl');
      expect(dirFor('en')).toBe('ltr');
    });
  });

  describe('buildHreflang', () => {
    it('emits x-default + one tag per locale, mirrors under /{locale}', () => {
      const tags = buildHreflang('https://x.dev/', '/pricing', ['es', 'fr']);
      expect(tags).toEqual([
        { hreflang: 'x-default', href: 'https://x.dev/pricing' },
        { hreflang: 'es', href: 'https://x.dev/es/pricing' },
        { hreflang: 'fr', href: 'https://x.dev/fr/pricing' },
      ]);
    });
    it('handles the root path without a trailing slash', () => {
      const tags = buildHreflang('https://x.dev', '/', ['es']);
      expect(tags[1]).toEqual({ hreflang: 'es', href: 'https://x.dev/es' });
    });
  });
});
