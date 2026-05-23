/**
 * @module utils/validators/email
 *
 * @description
 * Single source of truth for email validation across the frontend. The backend
 * uses `emailSchema` from `@project-sites/shared/schemas/base` (Zod, RFC-style,
 * 254-char cap, lowercased) — this module mirrors that contract for the client
 * with a Zod-free implementation so it can be tree-shaken into hot paths
 * without pulling Zod into the marketing bundle.
 *
 * Migration: replace the three inline `validateEmail()` implementations in
 * signin.component.ts, contact.component.ts, and forms.component.ts with
 * imports from this module.
 *
 * @example
 * ```ts
 * import { emailError, isValidEmail } from '@app/utils/validators/email';
 *
 * if (!isValidEmail(input)) {
 *   this.formError.set(emailError(input)); // human-readable message
 * }
 * ```
 */

/** Hard cap from RFC 5321; matches the backend `emailSchema.max(254)`. */
const MAX_LENGTH = 254;

/**
 * Pragmatic RFC-style email pattern.
 *
 * Mirrors the regex Angular's `Validators.email` ships with — accepts the
 * realistic shape `local@domain.tld` while rejecting obvious junk (spaces,
 * missing `@`, missing `.`). NOT a strict RFC 5322 validator (that would
 * accept addresses no SMTP server will deliver to anyway).
 */
const EMAIL_PATTERN = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * True if `value` is a syntactically valid email. Trim before calling — empty
 * strings and whitespace return `false`.
 */
export function isValidEmail(value: string | null | undefined): boolean {
  if (value == null) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > MAX_LENGTH) return false;
  return EMAIL_PATTERN.test(trimmed);
}

/**
 * Human-friendly validation message — null when the input is valid. The copy
 * matches the brand voice ("Sharp. Punchy. No bullshit." per copy-writing).
 *
 * @example
 * emailError('')              // → 'Add your email so we can reach you.'
 * emailError('not-an-email')  // → 'Email looks off — try again (you@example.com).'
 * emailError('a@b.co')        // → null
 */
export function emailError(value: string | null | undefined): string | null {
  if (value == null || value.trim().length === 0) {
    return 'Add your email so we can reach you.';
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_LENGTH) {
    return 'That email is too long. Double-check it and try again.';
  }
  if (!EMAIL_PATTERN.test(trimmed)) {
    return 'Email looks off — try again (you@example.com).';
  }
  return null;
}

/** Lowercase + trim — matches the backend `emailSchema.toLowerCase()` rule. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
