/**
 * @module __tests__/changelog_public
 * @description Unit tests for changelog parser + RSS serializer (feature #35).
 */

import { parseEntries, renderMarkdown, entriesToRss, entriesToHtml } from '../routes/changelog_public.js';

describe('changelog_public', () => {
  describe('parseEntries', () => {
    it('parses Keep-A-Changelog style headers', () => {
      const md = `# Changelog

## [1.2.0] - 2026-05-28

### Added
- pSEO v2 matrix builder
- Integration Directory

## [1.1.0] - 2026-05-20

### Fixed
- Bug X
`;
      const entries = parseEntries(md);
      expect(entries).toHaveLength(2);
      expect(entries[0].version).toBe('1.2.0');
      expect(entries[0].date).toBe('2026-05-28');
      expect(entries[0].html).toContain('pSEO');
      expect(entries[1].version).toBe('1.1.0');
    });

    it('handles entries without bracketed version', () => {
      const md = `# Changelog

## v0.9.0 - 2026-05-01

### Added
- Beta
`;
      const entries = parseEntries(md);
      expect(entries).toHaveLength(1);
      expect(entries[0].version).toBe('v0.9.0');
    });
  });

  describe('renderMarkdown', () => {
    it('escapes HTML and renders headings, lists, code, links', () => {
      const out = renderMarkdown('# Title\n\n- item one\n- item two with `code`\n\n[link](https://example.com)');
      expect(out).toContain('<h1>Title</h1>');
      expect(out).toContain('<li>item one</li>');
      expect(out).toContain('<code>code</code>');
      expect(out).toContain('<a href="https://example.com">link</a>');
    });

    it('escapes raw HTML safely', () => {
      const out = renderMarkdown('Hello <script>alert(1)</script> world');
      expect(out).not.toContain('<script>');
      expect(out).toContain('&lt;script&gt;');
    });
  });

  describe('entriesToRss', () => {
    it('produces well-formed RSS', () => {
      const xml = entriesToRss([
        { version: '1.0', date: '2026-05-28', raw: 'body', html: '<p>body</p>' },
      ]);
      expect(xml).toContain('<?xml version="1.0"');
      expect(xml).toContain('<rss version="2.0">');
      expect(xml).toContain('<title>1.0</title>');
      expect(xml).toContain('<link>https://projectsites.dev/changelog#1.0</link>');
    });
  });

  describe('entriesToHtml', () => {
    it('builds a complete HTML shell with RSS alternate link', () => {
      const html = entriesToHtml([
        { version: '1.0', date: '2026-05-28', raw: 'body', html: '<p>body</p>' },
      ]);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('rel="alternate" type="application/rss+xml"');
      expect(html).toContain('Changelog | projectsites.dev');
      expect(html).toContain('<article id="1.0">');
    });
  });
});
