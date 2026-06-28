/**
 * email_templates — branded transactional email HTML (#31).
 * Locks brand presence, CTA/code rendering, and HTML-escaping of untrusted input.
 */
import { brandedEmail } from '../auth/email-templates.js';

describe('brandedEmail', () => {
  it('renders the ProjectSites wordmark + brand accent + dark color-scheme', () => {
    const html = brandedEmail({ heading: 'Hi', body: 'Body.' });
    expect(html).toContain('Project');
    expect(html).toContain('#00E5FF'); // accent
    expect(html).toContain('#060610'); // dark bg
    expect(html).toContain('color-scheme');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it('renders a CTA button with the url in both the button and the paste-link', () => {
    const html = brandedEmail({
      heading: 'Sign in',
      body: 'Tap to sign in.',
      cta: { label: 'Sign in', url: 'https://projectsites.dev/api/auth/magic?t=abc' },
    });
    expect(html).toContain('Sign in');
    expect(html).toContain('https://projectsites.dev/api/auth/magic?t=abc');
    expect(html).toContain('Or paste this link');
  });

  it('renders an OTP code block when `code` is provided', () => {
    const html = brandedEmail({ heading: 'Code', body: 'Enter it.', code: '123456' });
    expect(html).toContain('123456');
    expect(html).not.toContain('Or paste this link'); // no CTA
  });

  it('HTML-escapes untrusted heading/body/url to prevent injection', () => {
    const html = brandedEmail({
      heading: '<script>x</script>',
      body: 'a & b < c',
      cta: { label: 'Go', url: 'https://x.test/?a=1&b="2"' },
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b &lt; c');
    expect(html).toContain('a=1&amp;b=&quot;2&quot;');
  });

  it('uses a custom footnote when supplied, else a default security line', () => {
    expect(brandedEmail({ heading: 'h', body: 'b', footnote: 'Expires in 5 minutes.' })).toContain(
      'Expires in 5 minutes.',
    );
    expect(brandedEmail({ heading: 'h', body: 'b' })).toContain('you can safely ignore');
  });
});
