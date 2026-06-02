/**
 * sanitizeHtml — XSS regression suite.
 *
 * Guards the fix for a real bypass: the original event-handler regex required
 * quotes (`on\w+\s*=\s*["']…["']`), so UNQUOTED handlers (`<svg onload=alert(1)>`,
 * `<img src=x onerror=alert(1)>`) survived. `sanitizeHtml` is applied to
 * user-supplied `additional_context` in the worker (`routes/search.ts`), so the
 * gap was reachable. These cases assert the dangerous constructs are gone while
 * benign markup + benign `on…`-looking text is preserved.
 */
import { sanitizeHtml } from '../utils/sanitize.js';

describe('sanitizeHtml — XSS vectors', () => {
  const dangerous: Array<[string, string]> = [
    ['unquoted onload', '<svg onload=alert(1)>'],
    ['unquoted onclick', '<div onclick=alert(1)>hi</div>'],
    ['unquoted onerror img', '<img src=x onerror=alert(1)>'],
    ['unquoted onmouseover', '<a onmouseover=alert(1)>x</a>'],
    ['double-quoted handler', `<div onclick="steal()">Hi</div>`],
    ['single-quoted handler', `<div onclick='steal()'>Hi</div>`],
    ['mixed-case handler', '<svg OnLoad=alert(1)>'],
    ['script block', '<script>alert(1)</script>'],
    ['nested split script', '<scr<script>ipt>alert(1)</script>'],
    ['iframe', '<iframe src="evil"></iframe>'],
    ['object', '<object data="evil"></object>'],
    ['embed', '<embed src="evil">'],
    ['javascript uri', '<a href="javascript:alert(1)">x</a>'],
    ['vbscript uri', '<a href="vbscript:msgbox(1)">x</a>'],
    ['data uri', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
  ];

  for (const [name, payload] of dangerous) {
    it(`neutralizes: ${name}`, () => {
      const out = sanitizeHtml(payload);
      // No event handlers survive (quoted or unquoted).
      expect(out).not.toMatch(/\son\w+\s*=/i);
      // No executable script/embed shells survive.
      expect(out.toLowerCase()).not.toContain('<script');
      expect(out.toLowerCase()).not.toContain('<iframe');
      expect(out.toLowerCase()).not.toContain('<object');
      expect(out.toLowerCase()).not.toContain('<embed');
      // No dangerous URI schemes survive.
      expect(out.toLowerCase()).not.toContain('javascript:');
      expect(out.toLowerCase()).not.toContain('vbscript:');
      expect(out.toLowerCase()).not.toContain('data:');
    });
  }

  it('preserves benign markup', () => {
    expect(sanitizeHtml('<p>Hello <strong>world</strong></p>')).toBe(
      '<p>Hello <strong>world</strong></p>',
    );
    expect(sanitizeHtml('<a href="https://example.com">link</a>')).toBe(
      '<a href="https://example.com">link</a>',
    );
  });

  it('does not corrupt text that merely contains "on" or attribute-like words', () => {
    // No leading-space + on\w+= boundary, so these are untouched.
    expect(sanitizeHtml('<p>Once upon a time</p>')).toBe('<p>Once upon a time</p>');
    expect(sanitizeHtml('<button name="on">On</button>')).toBe('<button name="on">On</button>');
  });

  it('is idempotent (re-sanitizing changes nothing)', () => {
    const once = sanitizeHtml('<div onclick=alert(1)><scr<script>ipt>x</script>ok</div>');
    expect(sanitizeHtml(once)).toBe(once);
  });
});
