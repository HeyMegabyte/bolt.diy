/**
 * Email/campaign template validation for Project Sites.
 *
 * @remarks
 * Validates email and campaign templates before sending. Checks subject line
 * length (10–100 chars), body HTML structure (DOCTYPE + html tags), unsubscribe
 * link presence, {{variable}} references matching required vars, and brand CSS
 * color validity. All functions are pure — no I/O, no env access.
 *
 * @example
 * const result = validateTemplate({
 *   subject: 'Your Weekly Newsletter — June 29',
 *   bodyHtml: '<!DOCTYPE html><html><head></head><body><a href="https://projectsites.dev/unsub">Unsubscribe</a></body></html>',
 *   bodyText: 'Your Weekly Newsletter — June 29',
 *   requiredVars: ['FIRST_NAME', 'CAMPAIGN_NAME'],
 * });
 * // → { valid: true, errors: [], warnings: [] }
 */

/** Result of a full template validation. */
export interface TemplateValidation {
  /** Whether the template passes all validation rules. */
  valid: boolean;
  /** Blocking issues that prevent sending (non-empty → valid is false). */
  errors: string[];
  /** Non-blocking concerns that should be reviewed. */
  warnings: string[];
}

/** Subject line length check result. */
export interface SubjectLengthResult {
  /** Whether the subject meets the 10–100 character requirement. */
  valid: boolean;
  /** The actual subject length. */
  length: number;
  /** The maximum allowed length (100). */
  maxLength: number;
  /** The minimum allowed length (10). */
  minLength: number;
}

/** HTML structure check result. */
export interface HtmlStructureResult {
  /** Whether the HTML has valid DOCTYPE + html tags. */
  valid: boolean;
  /** Describes what is missing when valid is false. */
  detail: string;
}

/** Brand CSS check result for a single property. */
export interface BrandCssResult {
  /** Whether the property value is syntactically valid CSS. */
  valid: boolean;
  /** The property name checked. */
  property: string;
  /** The value that was checked. */
  value: string;
  /** Error detail when valid is false. */
  error: string;
}

/**
 * Validates an email/campaign template against all rules.
 *
 * @param opts - Template options including subject, body HTML/text, required
 *   variables, and brand colors.
 * @param opts.subject - Email subject line (checked for 10–100 chars).
 * @param opts.bodyHtml - HTML body (checked for DOCTYPE + html + unsubscribe).
 * @param opts.bodyText - Plain-text body (checked for unsubscribe).
 * @param opts.requiredVars - Variable names that must appear in the template.
 * @param opts.brandColors - Map of CSS property → value to validate.
 * @returns A {@link TemplateValidation} with errors and warnings.
 *
 * @example
 * const result = validateTemplate({
 *   subject: 'Hello {{FIRST_NAME}}',
 *   bodyHtml: '<!DOCTYPE html><html><body><a href="https://example.com/unsub">Unsubscribe</a></body></html>',
 *   bodyText: 'Hello {{FIRST_NAME}}\n\nUnsubscribe: https://example.com/unsub',
 *   requiredVars: ['FIRST_NAME'],
 *   brandColors: { '--color-primary': '#00e5ff', '--color-bg': '#060610' },
 * });
 * expect(result.valid).toBe(true);
 */
export function validateTemplate(opts: {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  requiredVars?: string[];
  brandColors?: Record<string, string>;
}): TemplateValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Subject length check
  const subj = checkSubjectLength(opts.subject);
  if (!subj.valid) {
    errors.push(
      `Subject must be ${subj.minLength}–${subj.maxLength} characters (got ${subj.length})`,
    );
  }

  // HTML structure check
  const html = checkHtmlStructure(opts.bodyHtml);
  if (!html.valid) {
    errors.push(html.detail);
  }

  // Unsubscribe link in HTML
  if (!checkUnsubscribeLink(opts.bodyHtml)) {
    errors.push('HTML body must contain an unsubscribe link');
  }

  // Unsubscribe link in plain text
  if (!checkUnsubscribeLink(opts.bodyText)) {
    warnings.push('Plain-text body should contain an unsubscribe link');
  }

  // Required variable presence
  if (opts.requiredVars && opts.requiredVars.length > 0) {
    const missing = findMissingVars(opts.bodyHtml + '\n' + opts.bodyText, opts.requiredVars);
    for (const v of missing) {
      warnings.push(`Required variable {{${v}}} is not used in the template`);
    }
  }

  // Brand CSS validation
  if (opts.brandColors) {
    for (const [property, value] of Object.entries(opts.brandColors)) {
      const cssResult = checkBrandCss(property, value);
      if (!cssResult.valid) {
        errors.push(cssResult.error);
      }
    }
  }

  return {
    errors,
    valid: errors.length === 0,
    warnings,
  };
}

/**
 * Checks whether HTML or plain-text content contains an unsubscribe link.
 *
 * Matches `<a>` tags with `href` containing `unsubscribe`, `unsub`,
 * `opt-out`, or `optout`. Also matches URLs containing `unsub` or
 * `opt-out`/`optout` for plain-text templates.
 *
 * Does NOT match the bare word "unsubscribe" in running text — only actual
 * links or link-like URLs are counted.
 *
 * @param content - HTML or plain-text content to search.
 * @returns true when at least one unsubscribe link is found.
 *
 * @example
 * checkUnsubscribeLink('<a href="https://example.com/unsubscribe">Unsubscribe</a>');
 * // → true
 *
 * checkUnsubscribeLink('<p>No unsubscribe link here</p>');
 * // → false
 *
 * checkUnsubscribeLink('Unsubscribe: https://example.com/unsub');
 * // → true
 */
export function checkUnsubscribeLink(content: string): boolean {
  // Anchor tags with unsubscribe-related href
  const anchorPatterns = [
    /<a[^>]*href=["'][^"']*unsub[^"']*["'][^>]*>/i,
    /<a[^>]*href=["'][^"']*opt[-]?out[^"']*["'][^>]*>/i,
  ];

  // URLs containing unsubscribe-related path segments (works for plain text)
  const urlPatterns = [
    /https?:\/\/[^\s<>"']*unsub[^\s<>"']*/i,
    /https?:\/\/[^\s<>"']*opt[-]?out[^\s<>"']*/i,
  ];

  return anchorPatterns.some((p) => p.test(content)) || urlPatterns.some((p) => p.test(content));
}

/**
 * Checks whether a subject line meets the 10–100 character requirement.
 *
 * @param subject - The subject line to check.
 * @returns A {@link SubjectLengthResult} with validity, length, and bounds.
 *
 * @example
 * checkSubjectLength('Hello');
 * // → { valid: false, length: 5, maxLength: 100, minLength: 10 }
 *
 * checkSubjectLength('Your Weekly Newsletter — June 29, 2026');
 * // → { valid: true, length: 43, maxLength: 100, minLength: 10 }
 */
export function checkSubjectLength(subject: string): SubjectLengthResult {
  const minLength = 10;
  const maxLength = 100;
  const length = subject.length;
  return {
    length,
    maxLength,
    minLength,
    valid: length >= minLength && length <= maxLength,
  };
}

/**
 * Checks that HTML body contains DOCTYPE + html opening and closing tags.
 *
 * @param html - The HTML body string to check.
 * @returns An {@link HtmlStructureResult} with validity and detail message.
 *
 * @example
 * checkHtmlStructure('<!DOCTYPE html><html><body></body></html>');
 * // → { valid: true, detail: '' }
 *
 * checkHtmlStructure('<p>no doctype</p>');
 * // → { valid: false, detail: 'Missing DOCTYPE declaration' }
 */
export function checkHtmlStructure(html: string): HtmlStructureResult {
  const missing: string[] = [];

  if (!/<!DOCTYPE\s+html\s*>/i.test(html)) {
    missing.push('DOCTYPE declaration');
  }
  if (!/<html[\s>]/i.test(html)) {
    missing.push('<html> tag');
  }
  if (!/<\/html\s*>/i.test(html)) {
    missing.push('</html> closing tag');
  }

  return {
    detail: missing.length > 0 ? `HTML body must have: ${missing.join(', ')}` : '',
    valid: missing.length === 0,
  };
}

/**
 * Validates a single CSS property value for syntactic correctness.
 *
 * Checks hex colors (3/6/8-digit), rgb/rgba/hsl/hsla functions, oklch, and
 * named CSS colors. Does NOT check semantic validity — only syntax.
 *
 * @param property - CSS property name (e.g. `--color-primary`).
 * @param value - The CSS value to validate.
 * @returns A {@link BrandCssResult} with validation outcome.
 *
 * @example
 * checkBrandCss('--color-primary', '#00e5ff');
 * // → { valid: true, property: '--color-primary', value: '#00e5ff', error: '' }
 *
 * checkBrandCss('--color-bg', 'notacolor');
 * // → { valid: false, property: '--color-bg', value: 'notacolor', error: 'Invalid CSS value for --color-bg: notacolor' }
 */
export function checkBrandCss(property: string, value: string): BrandCssResult {
  const trimmed = value.trim();
  if (!isValidCssValue(trimmed)) {
    return {
      error: `Invalid CSS value for ${property}: ${value}`,
      property,
      valid: false,
      value,
    };
  }
  return { error: '', property, valid: true, value };
}

/**
 * Checks whether a value is a syntactically valid CSS color or length.
 *
 * @param value - Trimmed CSS value to check.
 * @returns true if the value matches a known CSS color or length pattern.
 */
function isValidCssValue(value: string): boolean {
  // Named CSS colors (common subset)
  const namedColors = new Set([
    'transparent',
    'currentcolor',
    'inherit',
    'initial',
    'unset',
    'black',
    'white',
    'red',
    'blue',
    'green',
    'gray',
    'grey',
    'cyan',
    'magenta',
    'yellow',
    'orange',
    'purple',
    'pink',
    'brown',
    'navy',
    'teal',
    'aqua',
    'fuchsia',
    'lime',
    'maroon',
    'olive',
    'silver',
  ]);

  if (namedColors.has(value.toLowerCase())) return true;

  // Hex colors: #rgb, #rrggbb, #rrggbbaa
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3}(?:[0-9a-f]{2})?)?$/i.test(value)) return true;

  // rgb() / rgba()
  if (/^(rgba?|hsla?)\([^)]+\)$/i.test(value)) {
    // Quick inner-value check for rgb/rgba
    if (/^rgb/i.test(value)) {
      return /^rgba?\(\s*\d{1,3}\s*(?:,\s*\d{1,3}\s*){2}(?:,\s*[\d.]+%?\s*)?\)$/i.test(value);
    }
    // hsl/hsla
    if (/^hsl/i.test(value)) {
      return /^hsla?\(\s*\d{1,3}(?:\.\d+)?(?:deg|rad|turn)?\s*(?:,\s*\d{1,3}%\s*){2}(?:,\s*[\d.]+%?\s*)?\)$/i.test(
        value,
      );
    }
    return true;
  }

  // oklch()
  if (/^oklch\([^)]+\)$/i.test(value)) {
    return /^oklch\(\s*[\d.]+%?\s+[\d.]+(?:\s+[\d.]+)?(?:\s*\/\s*[\d.]+%?)?\s*\)$/i.test(value);
  }

  return false;
}

/**
 * Finds required {{variable}} references that are missing from the content.
 *
 * @param content - The template body (HTML + text concatenated) to search.
 * @param requiredVars - List of variable names required in the template.
 * @returns Array of variable names not found in the content.
 */
function findMissingVars(content: string, requiredVars: string[]): string[] {
  return requiredVars.filter((v) => {
    // Match both {{VAR}} and {{ VAR }} patterns
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'i');
    return !pattern.test(content);
  });
}
