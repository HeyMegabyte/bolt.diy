import {
  conversionKindLabel,
  sectionLabel,
  buildFirstLeadEmail,
  type FirstLeadInput,
} from '../services/first_lead.js';

const base: FirstLeadInput = {
  businessName: "Vito's Mens Salon",
  conversionKind: 'call',
  section: 'hero',
  ownerName: 'Vito',
  dashboardUrl: 'https://projectsites.dev/admin/analytics',
};

describe('conversionKindLabel (#64 first_lead_celebration)', () => {
  it('maps each known kind to a human label', () => {
    expect(conversionKindLabel('call')).toBe('phone call');
    expect(conversionKindLabel('email')).toBe('email');
    expect(conversionKindLabel('directions')).toBe('directions request');
    expect(conversionKindLabel('form')).toBe('contact-form submission');
  });

  it('falls back to "website lead" for unknown kinds', () => {
    expect(conversionKindLabel('whatever')).toBe('website lead');
  });
});

describe('sectionLabel (#64)', () => {
  it('humanizes a slug', () => {
    expect(sectionLabel('contact_form')).toBe('Contact Form');
    expect(sectionLabel('hero')).toBe('Hero');
  });

  it('returns null for empty/whitespace', () => {
    expect(sectionLabel('')).toBeNull();
    expect(sectionLabel('   ')).toBeNull();
    expect(sectionLabel(null)).toBeNull();
    expect(sectionLabel(undefined)).toBeNull();
  });
});

describe('buildFirstLeadEmail (#64)', () => {
  it('composes a celebration subject + section-attributed body', () => {
    const e = buildFirstLeadEmail(base);
    expect(e.subject).toBe('🎉 You just got your first lead from your website!');
    expect(e.text).toContain('Hi Vito,');
    expect(e.text).toContain('phone call');
    expect(e.text).toContain('from your Hero section');
    expect(e.text).toContain("Vito's Mens Salon");
    expect(e.text).toContain('https://projectsites.dev/admin/analytics');
    expect(e.html).toContain('View your analytics');
  });

  it('uses a neutral greeting when no owner name', () => {
    const e = buildFirstLeadEmail({ ...base, ownerName: undefined });
    expect(e.text.startsWith('Hi,')).toBe(true);
  });

  it('omits the section clause when section is absent', () => {
    const e = buildFirstLeadEmail({ ...base, section: null });
    expect(e.text).not.toContain('section');
    expect(e.html).not.toContain('section');
  });

  it('omits the dashboard link when URL is empty', () => {
    const e = buildFirstLeadEmail({ ...base, dashboardUrl: '' });
    expect(e.text).not.toContain('See the details');
    expect(e.html).not.toContain('View your analytics');
  });

  it('escapes HTML-significant chars in the business name', () => {
    const e = buildFirstLeadEmail({ ...base, businessName: 'Tom & Jerry <Co>' });
    expect(e.html).toContain('Tom &amp; Jerry &lt;Co&gt;');
    expect(e.html).not.toContain('<Co>');
  });

  it('contains no marketing slop words', () => {
    const e = buildFirstLeadEmail(base);
    const all = `${e.subject} ${e.text} ${e.html}`.toLowerCase();
    for (const slop of [
      'revolutionize',
      'cutting-edge',
      'world-class',
      'limitless',
      'leverage',
      'game-changer',
    ]) {
      expect(all).not.toContain(slop);
    }
  });

  it('never throws on a sparse input', () => {
    const e = buildFirstLeadEmail({
      businessName: '',
      conversionKind: '' as unknown as string,
      dashboardUrl: '',
    });
    expect(e.text).toContain('your business');
    expect(e.text).toContain('website lead');
  });
});
