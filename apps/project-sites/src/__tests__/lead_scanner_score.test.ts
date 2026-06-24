import { detectNoWebsite, isPriorityRegion, scoreLead } from '../services/lead_scanner_score';

describe('detectNoWebsite', () => {
  it('returns true when website is undefined', () => {
    expect(detectNoWebsite({})).toBe(true);
  });

  it('returns true when website is null', () => {
    expect(detectNoWebsite({ website: null })).toBe(true);
  });

  it('returns true when website is empty string', () => {
    expect(detectNoWebsite({ website: '' })).toBe(true);
  });

  it('returns false when website is a non-empty string', () => {
    expect(detectNoWebsite({ website: 'https://example.com' })).toBe(false);
  });
});

describe('isPriorityRegion', () => {
  it('returns true for US (uppercase)', () => {
    expect(isPriorityRegion('US')).toBe(true);
  });

  it('returns true for US (lowercase)', () => {
    expect(isPriorityRegion('us')).toBe(true);
  });

  it('returns true for CA (Canada)', () => {
    expect(isPriorityRegion('CA')).toBe(true);
  });

  it('returns true for GB', () => {
    expect(isPriorityRegion('GB')).toBe(true);
  });

  it('returns true for AU', () => {
    expect(isPriorityRegion('AU')).toBe(true);
  });

  it('returns true for western-europe DE', () => {
    expect(isPriorityRegion('DE')).toBe(true);
  });

  it('returns true for western-europe FR', () => {
    expect(isPriorityRegion('FR')).toBe(true);
  });

  it('returns false for BR (Brazil)', () => {
    expect(isPriorityRegion('BR')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isPriorityRegion(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isPriorityRegion(null)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isPriorityRegion('')).toBe(false);
  });
});

describe('scoreLead', () => {
  it('scores a fully-qualifying lead at exactly 100 (no website + phone + reviews + US + service type)', () => {
    const result = scoreLead({
      website: undefined,
      phone: '+12015551234',
      userRatingsTotal: 42,
      countryCode: 'US',
      types: ['plumber', 'home_goods_store'],
    });
    expect(result.hasWebsite).toBe(false);
    expect(result.priority).toBe(true);
    // Pin the documented additive contract exactly: +45 (no website) + 15 (phone)
    // + 15 (reviews) + 15 (priority region) + 10 (service type) = 100. A loose
    // `>= 80` would let a future scoring-dimension change pass silently.
    expect(result.leadScore).toBe(100);
  });

  it('returns hasWebsite true and lower score when website is present', () => {
    const result = scoreLead({
      website: 'https://example.com',
      phone: '+12015551234',
      userRatingsTotal: 10,
      countryCode: 'US',
      types: ['plumber'],
    });
    expect(result.hasWebsite).toBe(true);
    // No +45, so max = 15+15+15+10 = 55
    expect(result.leadScore).toBeLessThan(80);
  });

  it('clamps score to 100 even when all bonuses stack', () => {
    const result = scoreLead({
      website: undefined,
      phone: '+1',
      userRatingsTotal: 5,
      countryCode: 'US',
      types: ['restaurant'],
    });
    expect(result.leadScore).toBeLessThanOrEqual(100);
  });

  it('scores only the no-website bonus when all other signals are absent', () => {
    // An empty record has no website, so it gets +45.  No phone, no reviews,
    // no region, no service type → leadScore should be exactly 45.
    const result = scoreLead({});
    expect(result.leadScore).toBe(45);
    expect(result.hasWebsite).toBe(false);
    expect(result.priority).toBe(false);
  });

  it('returns 0 when website is present and all other signals are absent', () => {
    const result = scoreLead({ website: 'https://example.com' });
    expect(result.leadScore).toBe(0);
    expect(result.hasWebsite).toBe(true);
    expect(result.priority).toBe(false);
  });

  it('awards service-type bonus when types contains a matching keyword', () => {
    const withType = scoreLead({ types: ['dentist'] });
    const withoutType = scoreLead({ types: ['bank'] });
    expect(withType.leadScore).toBeGreaterThan(withoutType.leadScore);
  });

  it('does NOT award reviews bonus when userRatingsTotal is 0', () => {
    const result = scoreLead({ userRatingsTotal: 0 });
    // no website +45, no other bonuses
    expect(result.leadScore).toBe(45);
  });

  it('priority reflects isPriorityRegion correctly', () => {
    expect(scoreLead({ countryCode: 'NZ' }).priority).toBe(true);
    expect(scoreLead({ countryCode: 'JP' }).priority).toBe(false);
  });
});
