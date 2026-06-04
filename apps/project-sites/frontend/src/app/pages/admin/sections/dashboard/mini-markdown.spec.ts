import { miniMarkdown } from './widgets';

/**
 * miniMarkdown renders AI/tool-emitted markdown widget bodies (untrusted per
 * contract-first-ai) via [innerHTML]. It escapes HTML text, but its link mapping
 * must ALSO reject unsafe URL schemes — otherwise `[x](javascript:alert(1))`
 * renders a live javascript: anchor = XSS. (agent-message blocks this via
 * DOMPurify ALLOWED_URI_REGEXP; this tiny renderer needs its own guard.)
 */
describe('miniMarkdown link safety', () => {
  it('renders a normal http(s) link as a new-tab, rel-guarded anchor', () => {
    const out = miniMarkdown('see [docs](https://example.com)');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('does NOT emit a javascript: anchor (neutralized to plain text)', () => {
    const out = miniMarkdown('[click me](javascript:alert(1))');
    expect(out).not.toContain('href="javascript:');
    expect(out.toLowerCase()).not.toContain('<a ');
    expect(out).toContain('click me'); // text preserved
  });

  it('does NOT emit a data: or vbscript: anchor', () => {
    expect(miniMarkdown('[x](data:text/html,<script>1</script>)').toLowerCase()).not.toContain('<a ');
    expect(miniMarkdown('[x](vbscript:msgbox)').toLowerCase()).not.toContain('<a ');
  });

  it('still escapes raw HTML in the body (no script injection)', () => {
    const out = miniMarkdown('hi <script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('allows mailto + relative links', () => {
    expect(miniMarkdown('[m](mailto:a@b.com)')).toContain('href="mailto:a@b.com"');
    expect(miniMarkdown('[r](/admin/billing)')).toContain('href="/admin/billing"');
  });
});
