import {
  parseUserAgent,
  parseUtm,
  deriveChannel,
  enrichVisitor,
} from '../enrich.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/604.1';
const WIN_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const MAC_EDGE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';

describe('parseUserAgent', () => {
  it('classifies an iPhone as mobile / Safari / iOS', () => {
    expect(parseUserAgent(IPHONE)).toEqual({ device: 'mobile', browser: 'Safari', os: 'iOS' });
  });
  it('classifies an Android phone as mobile / Chrome / Android', () => {
    expect(parseUserAgent(ANDROID_PHONE)).toEqual({
      device: 'mobile',
      browser: 'Chrome',
      os: 'Android',
    });
  });
  it('classifies an iPad as tablet', () => {
    expect(parseUserAgent(IPAD).device).toBe('tablet');
  });
  it('classifies desktop Windows Chrome', () => {
    expect(parseUserAgent(WIN_CHROME)).toEqual({
      device: 'desktop',
      browser: 'Chrome',
      os: 'Windows',
    });
  });
  it('detects Edge BEFORE Chrome (Edge UA contains "Chrome")', () => {
    expect(parseUserAgent(MAC_EDGE)).toEqual({ device: 'desktop', browser: 'Edge', os: 'macOS' });
  });
  it('detects Firefox on Linux', () => {
    expect(parseUserAgent(FIREFOX_LINUX)).toEqual({
      device: 'desktop',
      browser: 'Firefox',
      os: 'Linux',
    });
  });
  it('tolerates an empty UA', () => {
    expect(parseUserAgent('')).toEqual({ device: 'desktop', browser: 'unknown', os: 'unknown' });
  });
});

describe('parseUtm', () => {
  it('extracts + lowercases utm params from a full URL', () => {
    expect(parseUtm('https://x.com/landing?utm_source=Instagram&utm_medium=CPC&utm_campaign=Spring')).toEqual(
      { utmSource: 'instagram', utmMedium: 'cpc', utmCampaign: 'spring' },
    );
  });
  it('returns empty when no query / no utm', () => {
    expect(parseUtm('/about')).toEqual({});
    expect(parseUtm('')).toEqual({});
    expect(parseUtm('/x?ref=foo')).toEqual({});
  });
});

describe('deriveChannel', () => {
  it('UTM medium wins: cpc → paid, social → social, newsletter → email', () => {
    expect(deriveChannel('', 'cpc')).toBe('paid');
    expect(deriveChannel('https://anything.com/', 'social')).toBe('social');
    expect(deriveChannel('', 'newsletter')).toBe('email');
  });
  it('no referrer + no utm → direct', () => {
    expect(deriveChannel(undefined)).toBe('direct');
    expect(deriveChannel('')).toBe('direct');
  });
  it('search referrer → organic; social referrer → social; other → referral', () => {
    expect(deriveChannel('https://www.google.com/search?q=pizza')).toBe('organic');
    expect(deriveChannel('https://instagram.com/p/abc')).toBe('social');
    expect(deriveChannel('https://t.co/xyz')).toBe('social');
    expect(deriveChannel('https://someblog.example/post')).toBe('referral');
  });
  it('a malformed referrer degrades to referral, never throws', () => {
    expect(deriveChannel('not a url')).toBe('referral');
  });
});

describe('enrichVisitor', () => {
  it('combines UA + referrer + UTM into one enrichment', () => {
    expect(enrichVisitor(IPHONE, 'https://instagram.com/', '/lp?utm_medium=social&utm_source=ig')).toEqual({
      device: 'mobile',
      browser: 'Safari',
      os: 'iOS',
      channel: 'social',
      utmMedium: 'social',
      utmSource: 'ig',
    });
  });
  it('direct desktop visit with no referrer/utm', () => {
    const e = enrichVisitor(WIN_CHROME);
    expect(e.channel).toBe('direct');
    expect(e.device).toBe('desktop');
    expect(e.utmSource).toBeUndefined();
  });
});
