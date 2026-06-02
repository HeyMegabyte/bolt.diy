/**
 * @module __tests__/not_found_page
 *
 * Guards the accessible 404 body used by the worker's global `app.notFound()`.
 * The page must satisfy the axe rules that Hono's bare default 404 fails:
 * `document-title`, `html-has-lang`, and `link-in-text-block`.
 */
import { notFoundHtml } from '../lib/not_found_page.js';

describe('notFoundHtml', () => {
  const html = notFoundHtml();

  it('declares the document language (html-has-lang)', () => {
    expect(html).toContain('<html lang="en">');
  });

  it('has a non-empty <title> (document-title)', () => {
    const m = html.match(/<title>([^<]+)<\/title>/);
    expect(m).not.toBeNull();
    expect((m?.[1] ?? '').trim().length).toBeGreaterThan(0);
  });

  it('has exactly one <h1> and a <main> landmark', () => {
    expect((html.match(/<h1[ >]/g) ?? []).length).toBe(1);
    expect(html).toContain('<main>');
  });

  it('links are underlined, not colour-only (link-in-text-block)', () => {
    // The single anchor must be distinguishable by more than colour.
    expect(html).toMatch(/a\{[^}]*text-decoration:underline/);
    expect(html).not.toMatch(/a\{[^}]*text-decoration:none/);
  });

  it('is a complete HTML document', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.trim().endsWith('</html>')).toBe(true);
  });
});
