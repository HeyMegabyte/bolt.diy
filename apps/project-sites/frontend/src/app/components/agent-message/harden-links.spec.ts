import { hardenExternalLinks } from './harden-links';

/**
 * AI-output markdown links rendered in the agent-message body must open in a NEW
 * tab (so clicking a cited source doesn't navigate the user away from the admin /
 * lose their chat) AND carry rel="noopener noreferrer" (reverse-tabnabbing guard,
 * since target=_blank otherwise leaves window.opener exposed). The transform runs
 * on the already-DOMPurify-sanitized string; it only adds STATIC safe attributes.
 */
describe('hardenExternalLinks', () => {
  it('adds target=_blank + rel=noopener noreferrer to an external http(s) link', () => {
    const out = hardenExternalLinks('<a href="https://example.com">src</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('href="https://example.com"');
  });

  it('does not double-add when the anchor already has a target', () => {
    const html = '<a href="https://x.com" target="_self">x</a>';
    expect(hardenExternalLinks(html)).toBe(html);
  });

  it('leaves relative / non-http anchors untouched (no new tab for in-app/mailto)', () => {
    expect(hardenExternalLinks('<a href="/admin/billing">in</a>')).toBe('<a href="/admin/billing">in</a>');
    expect(hardenExternalLinks('<a href="mailto:a@b.com">m</a>')).toBe('<a href="mailto:a@b.com">m</a>');
  });

  it('handles multiple links + preserves other attributes', () => {
    const out = hardenExternalLinks('<a href="https://a.com" class="x">a</a> <a href="https://b.com">b</a>');
    expect((out.match(/target="_blank"/g) ?? []).length).toBe(2);
    expect(out).toContain('class="x"');
  });
});
