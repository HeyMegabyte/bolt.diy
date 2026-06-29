import {
  checkBrandCss,
  checkHtmlStructure,
  checkSubjectLength,
  checkUnsubscribeLink,
  validateTemplate,
} from '../services/template_validator.js';

const VALID_HTML =
  '<!DOCTYPE html><html><head></head><body>' +
  '<a href="https://example.com/unsubscribe">Unsubscribe</a>' +
  '</body></html>';

const VALID_TEXT = 'Hello {{FIRST_NAME}}\n\n' + 'Unsubscribe: https://example.com/unsubscribe';

// ---------------------------------------------------------------------------
// validateTemplate
// ---------------------------------------------------------------------------
describe('validateTemplate', () => {
  it('passes a fully valid template', () => {
    const result = validateTemplate({
      subject: 'Hello {{FIRST_NAME}} — June Newsletter',
      bodyHtml: VALID_HTML,
      bodyText: VALID_TEXT,
      requiredVars: ['FIRST_NAME'],
      brandColors: { '--color-primary': '#00e5ff' },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('passes template without optional requiredVars and brandColors', () => {
    const result = validateTemplate({
      subject: 'Hello World — Newsletter',
      bodyHtml: VALID_HTML,
      bodyText: VALID_TEXT,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('fails when subject is too short', () => {
    const result = validateTemplate({
      subject: 'Short',
      bodyHtml: VALID_HTML,
      bodyText: VALID_TEXT,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/Subject must be 10–100/)]),
    );
  });

  it('fails when subject is too long', () => {
    const result = validateTemplate({
      subject: 'A'.repeat(101),
      bodyHtml: VALID_HTML,
      bodyText: VALID_TEXT,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/Subject must be 10–100/)]),
    );
  });

  it('fails when HTML is missing DOCTYPE', () => {
    const result = validateTemplate({
      subject: 'Valid subject line here',
      bodyHtml: '<html><body><p>No DOCTYPE</p></body></html>',
      bodyText: VALID_TEXT,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/DOCTYPE/)]));
  });

  it('fails when HTML is missing html tag', () => {
    const result = validateTemplate({
      subject: 'Valid subject line here',
      bodyHtml: '<!DOCTYPE html><body><p>No html</p></body>',
      bodyText: VALID_TEXT,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/<html>/)]));
  });

  it('fails when HTML is missing closing html tag', () => {
    const result = validateTemplate({
      subject: 'Valid subject line here',
      bodyHtml: '<!DOCTYPE html><html><body><p>No close</p></body>',
      bodyText: VALID_TEXT,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/<\/html>/)]));
  });

  it('fails when unsubscribe link is missing from HTML', () => {
    const result = validateTemplate({
      subject: 'Valid subject line here',
      bodyHtml: '<!DOCTYPE html><html><body><p>No unsubscribe</p></body></html>',
      bodyText: VALID_TEXT,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/unsubscribe link/i)]),
    );
  });

  it('warns when unsubscribe link is missing from plain text', () => {
    const result = validateTemplate({
      subject: 'Valid subject line here',
      bodyHtml: VALID_HTML,
      bodyText: 'Plain text without unsubscribe link',
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/should contain an unsubscribe link/i)]),
    );
  });

  it('warns when a required variable is unused', () => {
    const result = validateTemplate({
      subject: 'Hello there — Newsletter',
      bodyHtml: VALID_HTML,
      bodyText: 'No variables here at all',
      requiredVars: ['FIRST_NAME'],
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/FIRST_NAME/)]));
  });

  it('passes when all required variables are used', () => {
    const result = validateTemplate({
      subject: 'Hello {{FIRST_NAME}} — {{CAMPAIGN_NAME}}',
      bodyHtml: VALID_HTML,
      bodyText: `Hi {{FIRST_NAME}}, welcome to {{CAMPAIGN_NAME}}`,
      requiredVars: ['FIRST_NAME', 'CAMPAIGN_NAME'],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails on invalid brand CSS color', () => {
    const result = validateTemplate({
      subject: 'Valid subject line here',
      bodyHtml: VALID_HTML,
      bodyText: VALID_TEXT,
      brandColors: { '--color-wrong': 'notacolor' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/notacolor/)]));
  });

  it('passes valid brand CSS colors', () => {
    const result = validateTemplate({
      subject: 'Hello {{FIRST_NAME}} — Newsletter',
      bodyHtml: VALID_HTML,
      bodyText: VALID_TEXT,
      requiredVars: ['FIRST_NAME'],
      brandColors: {
        '--color-primary': '#00e5ff',
        '--color-bg': '#060610',
        '--color-accent': 'rgb(124, 58, 237)',
        '--color-highlight': 'oklch(0.85 0.2 180)',
      },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('collects multiple errors simultaneously', () => {
    const result = validateTemplate({
      subject: 'Hi',
      bodyHtml: '<p>No DOCTYPE, no html, no unsubscribe</p>',
      bodyText: 'No unsubscribe here either',
      brandColors: { '--x': 'badvalue' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('accepts empty requiredVars without error', () => {
    const result = validateTemplate({
      subject: 'Valid subject line here',
      bodyHtml: VALID_HTML,
      bodyText: VALID_TEXT,
      requiredVars: [],
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkSubjectLength
// ---------------------------------------------------------------------------
describe('checkSubjectLength', () => {
  it('returns valid for a subject within 10–100 chars', () => {
    const result = checkSubjectLength('1234567890');
    expect(result.valid).toBe(true);
    expect(result.length).toBe(10);
    expect(result.maxLength).toBe(100);
    expect(result.minLength).toBe(10);
  });

  it('returns valid for a subject at 100 chars', () => {
    const result = checkSubjectLength('A'.repeat(100));
    expect(result.valid).toBe(true);
    expect(result.length).toBe(100);
  });

  it('returns invalid for a subject under 10 chars', () => {
    const result = checkSubjectLength('Hi!');
    expect(result.valid).toBe(false);
    expect(result.length).toBe(3);
  });

  it('returns invalid for subject over 100 chars', () => {
    const result = checkSubjectLength('A'.repeat(101));
    expect(result.valid).toBe(false);
    expect(result.length).toBe(101);
  });

  it('returns invalid for an empty string', () => {
    const result = checkSubjectLength('');
    expect(result.valid).toBe(false);
    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkUnsubscribeLink
// ---------------------------------------------------------------------------
describe('checkUnsubscribeLink', () => {
  it('finds an unsubscribe link with href containing "unsubscribe"', () => {
    expect(checkUnsubscribeLink('<a href="https://example.com/unsubscribe">Unsubscribe</a>')).toBe(
      true,
    );
  });

  it('finds an unsubscribe link with href containing "unsub"', () => {
    expect(checkUnsubscribeLink('<a href="https://example.com/unsub">Unsub</a>')).toBe(true);
  });

  it('finds an unsubscribe link with href containing "opt-out"', () => {
    expect(checkUnsubscribeLink('<a href="https://example.com/opt-out">Opt Out</a>')).toBe(true);
  });

  it('finds an unsubscribe link with href containing "optout"', () => {
    expect(checkUnsubscribeLink('<a href="https://example.com/optout">Opt Out</a>')).toBe(true);
  });

  it('recognizes the word "unsubscribe" in plain text', () => {
    expect(
      checkUnsubscribeLink('If you wish to unsubscribe click here: https://example.com/unsub'),
    ).toBe(true);
  });

  it('returns false when no unsubscribe-related text exists', () => {
    expect(checkUnsubscribeLink('<p>Just a regular paragraph.</p>')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(checkUnsubscribeLink('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkHtmlStructure
// ---------------------------------------------------------------------------
describe('checkHtmlStructure', () => {
  it('passes valid HTML with DOCTYPE + html open/close', () => {
    const result = checkHtmlStructure('<!DOCTYPE html><html><body></body></html>');
    expect(result.valid).toBe(true);
    expect(result.detail).toBe('');
  });

  it('fails when DOCTYPE is missing', () => {
    const result = checkHtmlStructure('<html><body></body></html>');
    expect(result.valid).toBe(false);
    expect(result.detail).toMatch(/DOCTYPE/);
  });

  it('fails when html opening tag is missing', () => {
    const result = checkHtmlStructure('<!DOCTYPE html><body></body>');
    expect(result.valid).toBe(false);
    expect(result.detail).toMatch(/<html>/);
  });

  it('fails when html closing tag is missing', () => {
    const result = checkHtmlStructure('<!DOCTYPE html><html><body></body>');
    expect(result.valid).toBe(false);
    expect(result.detail).toMatch(/<\/html>/);
  });

  it('lists all missing elements when multiple are absent', () => {
    const result = checkHtmlStructure('<p>bare paragraph</p>');
    expect(result.valid).toBe(false);
    expect(result.detail).toMatch(/DOCTYPE/);
    expect(result.detail).toMatch(/<html>/);
    expect(result.detail).toMatch(/<\/html>/);
  });

  it('is case-insensitive for DOCTYPE', () => {
    const result = checkHtmlStructure('<!doctype html><html><body></body></html>');
    expect(result.valid).toBe(true);
  });

  it('passes with HTML attributes on the html tag', () => {
    const result = checkHtmlStructure('<!DOCTYPE html><html lang="en"><body></body></html>');
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkBrandCss
// ---------------------------------------------------------------------------
describe('checkBrandCss', () => {
  it('accepts 6-digit hex color', () => {
    const result = checkBrandCss('--color-primary', '#00e5ff');
    expect(result.valid).toBe(true);
  });

  it('accepts 3-digit hex color', () => {
    const result = checkBrandCss('--color-primary', '#0ef');
    expect(result.valid).toBe(true);
  });

  it('accepts 8-digit hex with alpha', () => {
    const result = checkBrandCss('--color-overlay', '#06061080');
    expect(result.valid).toBe(true);
  });

  it('accepts rgb() function', () => {
    const result = checkBrandCss('--color-accent', 'rgb(124, 58, 237)');
    expect(result.valid).toBe(true);
  });

  it('accepts rgba() function', () => {
    const result = checkBrandCss('--color-shadow', 'rgba(6, 6, 16, 0.5)');
    expect(result.valid).toBe(true);
  });

  it('accepts hsl() function', () => {
    const result = checkBrandCss('--color-primary', 'hsl(180, 100%, 50%)');
    expect(result.valid).toBe(true);
  });

  it('accepts oklch() function', () => {
    const result = checkBrandCss('--color-highlight', 'oklch(0.85 0.2 180)');
    expect(result.valid).toBe(true);
  });

  it('accepts named CSS colors', () => {
    const result = checkBrandCss('--color-bg', 'transparent');
    expect(result.valid).toBe(true);
  });

  it('rejects an invalid string', () => {
    const result = checkBrandCss('--color-wrong', 'not a color');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not a color/);
  });

  it('rejects incomplete hex', () => {
    const result = checkBrandCss('--x', '#gggggg');
    expect(result.valid).toBe(false);
  });

  it('returns property and value in the result object', () => {
    const result = checkBrandCss('--test', '#000');
    expect(result.property).toBe('--test');
    expect(result.value).toBe('#000');
  });
});
