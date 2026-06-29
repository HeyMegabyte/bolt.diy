import {
  brandCss,
  logoImg,
  buildTemplateVars,
  type BrandColors,
  type BrandTemplateVars,
} from '../services/template_branding.js';

describe('template_branding (LM22 — transactional email brand mapper)', () => {
  describe('brandCss', () => {
    it('emits all four custom properties', () => {
      const out = brandCss({
        primary: '#7C3AED',
        accent: '#00E5FF',
        background: '#0a0a1a',
        text: '#ffffff',
      });
      expect(out).toContain('--brand-primary:#7C3AED');
      expect(out).toContain('--brand-accent:#00E5FF');
      expect(out).toContain('--brand-bg:#0a0a1a');
      expect(out).toContain('--brand-text:#ffffff');
    });

    it('uses default accent when accent is omitted', () => {
      const out = brandCss({ primary: '#7C3AED' });
      expect(out).toContain('--brand-accent:#00E5FF');
    });

    it('uses default background when background is omitted', () => {
      const out = brandCss({ primary: '#7C3AED' });
      expect(out).toContain('--brand-bg:#0a0a1a');
    });

    it('uses default text when text is omitted', () => {
      const out = brandCss({ primary: '#7C3AED' });
      expect(out).toContain('--brand-text:#ffffff');
    });

    it('wraps in a <style> tag', () => {
      const out = brandCss({ primary: '#E53935' });
      expect(out).toMatch(/^  <style>.*<\/style>$/);
    });
  });

  describe('logoImg', () => {
    it('returns an <img> tag with the URL and alt text', () => {
      const out = logoImg('https://example.com/logo.png', 'Acme Inc');
      expect(out).toBe(
        '<img src="https://example.com/logo.png" alt="Acme Inc logo" style="max-height:40px">',
      );
    });

    it('returns empty string when logoUrl is null', () => {
      expect(logoImg(null, 'Acme Inc')).toBe('');
    });

    it('returns empty string when logoUrl is undefined', () => {
      expect(logoImg(undefined, 'Acme Inc')).toBe('');
    });

    it('sanitizes double-quotes in business name for alt text', () => {
      const out = logoImg('https://example.com/logo.png', 'A"cme" Inc');
      expect(out).not.toContain('"cme"');
      expect(out).toContain('alt="Acme Inc logo"');
    });
  });

  describe('buildTemplateVars', () => {
    it('returns full vars when all brand data is provided', () => {
      const vars = buildTemplateVars({
        businessName: 'Acme Inc',
        logoUrl: 'https://example.com/logo.png',
        colors: {
          primary: '#7C3AED',
          accent: '#00E5FF',
          background: '#0a0a1a',
          text: '#ffffff',
        },
      });

      expect(vars.businessName).toBe('Acme Inc');
      expect(vars.logoUrl).toBe('https://example.com/logo.png');
      expect(vars.primaryColor).toBe('#7C3AED');
      expect(vars.accentColor).toBe('#00E5FF');
      expect(vars.backgroundColor).toBe('#0a0a1a');
      expect(vars.textColor).toBe('#ffffff');
      expect(vars.cssVars).toContain('--brand-primary:#7C3AED');
      expect(vars.logoHtml).toContain('src="https://example.com/logo.png"');
      expect(vars.ctaStyle).toContain('background:#7C3AED');
      expect(vars.ctaStyle).toContain('color:#ffffff');
    });

    it('uses all default values when nothing is provided (except businessName)', () => {
      const vars = buildTemplateVars({ businessName: 'Default Co' });

      expect(vars.logoUrl).toBeNull();
      expect(vars.primaryColor).toBe('#7C3AED');
      expect(vars.accentColor).toBe('#00E5FF');
      expect(vars.backgroundColor).toBe('#0a0a1a');
      expect(vars.textColor).toBe('#ffffff');
      expect(vars.businessName).toBe('Default Co');
      expect(vars.logoHtml).toBe('');
    });

    it('merges partial colors with defaults', () => {
      const vars = buildTemplateVars({
        businessName: 'Partial Co',
        colors: { primary: '#E53935' },
      });

      expect(vars.primaryColor).toBe('#E53935');
      expect(vars.accentColor).toBe('#00E5FF'); // default
      expect(vars.backgroundColor).toBe('#0a0a1a'); // default
      expect(vars.textColor).toBe('#ffffff'); // default
    });

    it('handles null colors gracefully', () => {
      const vars = buildTemplateVars({
        businessName: 'Null Inc',
        colors: null,
      });

      expect(vars.primaryColor).toBe('#7C3AED');
      expect(vars.accentColor).toBe('#00E5FF');
      expect(vars.backgroundColor).toBe('#0a0a1a');
      expect(vars.textColor).toBe('#ffffff');
    });

    it('handles empty logoUrl', () => {
      const vars = buildTemplateVars({
        businessName: 'No Logo',
        logoUrl: '',
      });

      expect(vars.logoUrl).toBeNull();
      expect(vars.logoHtml).toBe('');
    });

    it('flips CTA text to dark when primary color is light (sum > 500)', () => {
      const vars = buildTemplateVars({
        businessName: 'Light Inc',
        colors: { primary: '#FFCC00' }, // R=255 G=204 B=0 → sum=459… wait let me calculate
      });

      // #FFCC00 → R=255 G=204 B=0 → sum=459, which is ≤ 500, so text stays white.
      // Use a truly light color: #FFEE88 → R=255 G=238 B=136 → sum=629 > 500
      const lightVars = buildTemplateVars({
        businessName: 'Light Inc',
        colors: { primary: '#FFEE88' },
      });

      expect(lightVars.ctaStyle).toContain('color:#0a0a1a');
      expect(lightVars.ctaStyle).toContain('background:#FFEE88');
    });

    it('keeps CTA text as default text color when primary is dark', () => {
      const vars = buildTemplateVars({
        businessName: 'Dark Inc',
        colors: { primary: '#1A1A2E' }, // R=26 G=26 B=46 → sum=98 ≤ 500
      });

      expect(vars.ctaStyle).toContain('color:#ffffff');
    });

    it('sets logoUrl to null when undefined', () => {
      const vars = buildTemplateVars({ businessName: 'Test' });
      expect(vars.logoUrl).toBeNull();
    });

    it('exports correct structural properties', () => {
      const vars = buildTemplateVars({
        businessName: 'Check',
        logoUrl: 'https://example.com/l.png',
        colors: { primary: '#7C3AED' },
      });

      // Verify all required keys are present with right types
      const keys: Array<keyof BrandTemplateVars> = [
        'logoUrl',
        'primaryColor',
        'accentColor',
        'backgroundColor',
        'textColor',
        'businessName',
        'cssVars',
        'ctaStyle',
        'logoHtml',
      ];

      for (const k of keys) {
        expect(vars).toHaveProperty(k);
      }
    });

    it('never throws regardless of input shape', () => {
      expect(() => buildTemplateVars({ businessName: '' })).not.toThrow();

      expect(() => buildTemplateVars({ businessName: 'x', colors: null })).not.toThrow();

      expect(() =>
        buildTemplateVars({
          businessName: 'x',
          colors: {} as BrandColors,
        }),
      ).not.toThrow();
    });
  });
});
