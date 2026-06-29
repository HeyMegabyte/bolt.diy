import { buildArchiveHtml, buildSignupEmbed } from '../services/archive_signup.js';

const sampleEntry = {
  title: 'June 2026 Newsletter',
  sentAt: '2026-06-15T12:00:00Z',
  url: '/archive/june-2026',
  snippet:
    'Summer is here! This month we cover garden tips, new recipes, and volunteer stories from the neighborhood.',
};

const sampleEntry2 = {
  title: 'May 2026 Newsletter',
  sentAt: '2026-05-15T12:00:00Z',
  url: '/archive/may-2026',
  snippet: 'Spring cleaning checklist and community event calendar for May.',
};

describe('buildArchiveHtml', () => {
  it('renders a section with entries when provided', () => {
    const html = buildArchiveHtml([sampleEntry, sampleEntry2]);
    expect(html).toContain('<section class="newsletter-archive">');
    expect(html).toContain('<h2>Newsletter Archive</h2>');
    expect(html).toContain('June 2026 Newsletter');
    expect(html).toContain('May 2026 Newsletter');
    expect(html).toContain('archive-link');
    expect(html).toContain('archive-snippet');
  });

  it('renders "No past issues yet." for empty entries', () => {
    const html = buildArchiveHtml([]);
    expect(html).toContain('No past issues yet.');
    expect(html).not.toContain('archive-list');
  });

  it('renders "No past issues yet." for null/undefined', () => {
    const html1 = buildArchiveHtml(null as unknown as readonly []);
    expect(html1).toContain('No past issues yet.');

    const html2 = buildArchiveHtml(undefined as unknown as readonly []);
    expect(html2).toContain('No past issues yet.');
  });

  it('prepends baseUrl to entry URLs', () => {
    const html = buildArchiveHtml([sampleEntry], 'https://example.com/news');
    expect(html).toContain('href="https://example.com/news/archive/june-2026"');
  });

  it('handles baseUrl with trailing slash correctly', () => {
    const html = buildArchiveHtml([sampleEntry], 'https://example.com/news/');
    expect(html).toContain('href="https://example.com/news/archive/june-2026"');
  });

  it('escapes HTML in title', () => {
    const entry = { ...sampleEntry, title: 'News & <Updates>' };
    const html = buildArchiveHtml([entry]);
    expect(html).toContain('News &amp; &lt;Updates&gt;');
    expect(html).not.toContain('<Updates>');
  });

  it('escapes HTML in snippet', () => {
    const entry = { ...sampleEntry, snippet: 'Tips &amp; tricks <em>inside</em>' };
    const html = buildArchiveHtml([entry]);
    expect(html).toContain('Tips &amp;amp; tricks &lt;em&gt;inside&lt;/em&gt;');
  });

  it('escapes HTML in URL', () => {
    const entry = { ...sampleEntry, url: '/archive/foo"bar' };
    const html = buildArchiveHtml([entry]);
    expect(html).toContain('foo&quot;bar');
  });

  it('formats the sentAt date into a human-readable string', () => {
    const html = buildArchiveHtml([sampleEntry]);
    expect(html).toContain('Jun 15, 2026');
  });

  it('handles an invalid date gracefully (returns raw string)', () => {
    const entry = { ...sampleEntry, sentAt: 'not-a-date' };
    const html = buildArchiveHtml([entry]);
    expect(html).toContain('not-a-date');
  });

  it('renders a time element with datetime attribute', () => {
    const html = buildArchiveHtml([sampleEntry]);
    expect(html).toContain('datetime="2026-06-15T12:00:00Z"');
  });
});

describe('buildSignupEmbed', () => {
  it('returns a form with default labels', () => {
    const html = buildSignupEmbed();
    expect(html).toContain('<form class="newsletter-signup"');
    expect(html).toContain('placeholder="Your email"');
    expect(html).toContain('Subscribe');
  });

  it('includes a honeypot field', () => {
    const html = buildSignupEmbed();
    expect(html).toContain('website_url');
    expect(html).toContain('position:absolute;left:-9999px');
    expect(html).toContain('tabindex="-1"');
  });

  it('includes inline script for AJAX submit', () => {
    const html = buildSignupEmbed();
    expect(html).toContain('<script>');
    expect(html).toContain('/api/newsletter/subscribe');
    expect(html).toContain("Content-Type':'application/json");
  });

  it('uses a custom placeholder', () => {
    const html = buildSignupEmbed({ placeholder: 'Enter your email address' });
    expect(html).toContain('placeholder="Enter your email address"');
  });

  it('uses a custom button label', () => {
    const html = buildSignupEmbed({ buttonLabel: 'Join Now' });
    expect(html).toContain('Join Now');
  });

  it('uses a custom thank-you message', () => {
    const html = buildSignupEmbed({ thankYouMessage: 'You are subscribed!' });
    expect(html).toContain('You are subscribed!');
  });

  it('includes listmonkListId in the script payload when provided', () => {
    const html = buildSignupEmbed({ listmonkListId: '42' });
    expect(html).toContain("listId: '42'");
  });

  it('escapes HTML in placeholder', () => {
    const html = buildSignupEmbed({ placeholder: 'Your <email>' });
    expect(html).toContain('Your &lt;email&gt;');
  });

  it('escapes HTML in button label', () => {
    const html = buildSignupEmbed({ buttonLabel: 'Sign & Go' });
    expect(html).toContain('Sign &amp; Go');
  });

  it('escapes HTML in thank-you message', () => {
    const html = buildSignupEmbed({ thankYouMessage: 'Thanks! <b>Check email</b>' });
    expect(html).toContain('Thanks! &lt;b&gt;Check email&lt;/b&gt;');
  });

  it('never throws on undefined/null config', () => {
    expect(() => buildSignupEmbed(undefined)).not.toThrow();
    expect(() => buildSignupEmbed(null as unknown as undefined)).not.toThrow();
  });
});
