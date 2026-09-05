import {
  SOCIAL_NETWORKS,
  SOCIAL_NETWORK_KEYS,
  detectNetworkFromUrl,
  normalizeSocialValue,
  extractSocialsFromOsmTags,
  extractSocialsFromHtml,
  extractContactFromHtml,
  mergeContactBundles,
} from '../services/social_links.js';

/**
 * Pure SSOT for the Lead Scanner's contact/social enrichment (#9). Every
 * function is a deterministic string/tag transform — no mocks needed.
 */

describe('SOCIAL_NETWORKS', () => {
  it('exposes the canonical 8 networks in render order', () => {
    expect(SOCIAL_NETWORK_KEYS).toEqual([
      'facebook',
      'instagram',
      'x',
      'linkedin',
      'youtube',
      'tiktok',
      'yelp',
      'google',
    ]);
    expect(SOCIAL_NETWORKS).toHaveLength(8);
  });
});

describe('detectNetworkFromUrl', () => {
  it('matches by hostname (incl. subdomains + www) for each network', () => {
    expect(detectNetworkFromUrl('https://www.facebook.com/vitos')).toBe('facebook');
    expect(detectNetworkFromUrl('https://twitter.com/vitos')).toBe('x');
    expect(detectNetworkFromUrl('https://x.com/vitos')).toBe('x');
    expect(detectNetworkFromUrl('https://www.yelp.com/biz/vitos')).toBe('yelp');
    expect(detectNetworkFromUrl('https://youtu.be/abc')).toBe('youtube');
  });
  it('returns null for a business website (not a social network)', () => {
    expect(detectNetworkFromUrl('https://vitos-salon.com')).toBeNull();
    expect(detectNetworkFromUrl('not a url')).toBeNull();
  });
});

describe('normalizeSocialValue', () => {
  const fb = SOCIAL_NETWORKS[0];
  const x = SOCIAL_NETWORKS[2];
  it('passes a full URL through unchanged', () => {
    expect(normalizeSocialValue(fb, 'https://facebook.com/x')).toBe('https://facebook.com/x');
  });
  it('adds https to a bare host', () => {
    expect(normalizeSocialValue(fb, 'facebook.com/x')).toBe('https://facebook.com/x');
  });
  it('expands a bare @handle against the network base', () => {
    expect(normalizeSocialValue(x, '@vitos')).toBe('https://x.com/vitos');
    expect(normalizeSocialValue(x, 'vitos')).toBe('https://x.com/vitos');
  });
  it('returns undefined for an empty value', () => {
    expect(normalizeSocialValue(fb, '   ')).toBeUndefined();
  });
});

describe('extractSocialsFromOsmTags', () => {
  it('reads every contact:* network + normalizes handles', () => {
    expect(
      extractSocialsFromOsmTags({
        'contact:facebook': 'vitos',
        'contact:instagram': 'https://instagram.com/vitos',
        'contact:twitter': '@vitos',
        'contact:youtube': 'https://youtube.com/@vitos',
        'contact:yelp': 'https://yelp.com/biz/vitos',
      }),
    ).toEqual({
      facebook: 'https://facebook.com/vitos',
      instagram: 'https://instagram.com/vitos',
      x: 'https://x.com/vitos',
      youtube: 'https://youtube.com/@vitos',
      yelp: 'https://yelp.com/biz/vitos',
    });
  });
  it('returns {} for undefined / no social tags', () => {
    expect(extractSocialsFromOsmTags(undefined)).toEqual({});
    expect(extractSocialsFromOsmTags({ name: 'Vitos', phone: '555' })).toEqual({});
  });
});

describe('extractSocialsFromHtml', () => {
  it('collects the first URL per network from href-like text', () => {
    const html =
      '<a href="https://facebook.com/x">fb</a> <a href="https://instagram.com/x">ig</a> <a href="https://x.com/x">x</a>';
    expect(extractSocialsFromHtml(html)).toEqual({
      facebook: 'https://facebook.com/x',
      instagram: 'https://instagram.com/x',
      x: 'https://x.com/x',
    });
  });
  it('trims trailing punctuation captured by the URL regex', () => {
    expect(extractSocialsFromHtml('see https://facebook.com/x).')).toEqual({
      facebook: 'https://facebook.com/x',
    });
  });
  it('returns {} for empty / social-free HTML', () => {
    expect(extractSocialsFromHtml('')).toEqual({});
    expect(extractSocialsFromHtml('<p>no links</p>')).toEqual({});
  });
});

describe('extractContactFromHtml', () => {
  it('prefers a mailto: email + reads a tel: phone', () => {
    expect(
      extractContactFromHtml('<a href="mailto:hi@vitos.com">e</a><a href="tel:+19735550100">c</a>'),
    ).toEqual({ email: 'hi@vitos.com', phone: '+19735550100' });
  });
  it('falls back to a bare email when no mailto:', () => {
    expect(extractContactFromHtml('Contact us at owner@vitos.com today')).toEqual({
      email: 'owner@vitos.com',
    });
  });
  it('returns {} when neither is present', () => {
    expect(extractContactFromHtml('<p>no contact</p>')).toEqual({});
  });
});

describe('mergeContactBundles', () => {
  it('first-non-empty wins per scalar field, socials union across all', () => {
    expect(
      mergeContactBundles(
        { phone: '111', socials: { facebook: 'a' } },
        { phone: '222', email: 'e@x.com', website: 'https://x.com', socials: { instagram: 'b' } },
        undefined,
      ),
    ).toEqual({
      phone: '111',
      email: 'e@x.com',
      website: 'https://x.com',
      socials: { facebook: 'a', instagram: 'b' },
    });
  });
  it('omits socials entirely when none present', () => {
    expect(mergeContactBundles({ phone: '111' }, { email: 'e@x.com' })).toEqual({
      phone: '111',
      email: 'e@x.com',
    });
  });
});
