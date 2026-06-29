/**
 * Pure utility module for building and validating standard HTTP security headers.
 *
 * @remarks
 * This module provides two pure functions — `buildHeaders` to produce a complete
 * set of security headers with sensible defaults, and `validateHeaders` to verify
 * that a headers object is well-formed. No I/O, no side effects.
 *
 * The default Content-Security-Policy is intentionally permissive to accommodate
 * inline scripts, blob URLs, third-party SDKs, and AI-generated HTML that the
 * platform serves. Production deployments should tighten per-route.
 *
 * @example
 * ```ts
 * const headers = buildHeaders();
 * res.set(headers);
 * ```
 *
 * @example
 * ```ts
 * const check = validateHeaders(headers);
 * if (!check.valid) { console.warn('security header drift:', check.issues); }
 * ```
 */

/**
 * Complete set of HTTP response security headers.
 */
export interface SecurityHeaders {
  'strict-transport-security': string;
  'content-security-policy': string;
  'x-frame-options': string;
  'x-content-type-options': string;
  'referrer-policy': string;
  'permissions-policy': string;
}

/**
 * Default Content-Security-Policy string.
 *
 * Permissive baseline that allows inline scripts/styles, blob: and data: URIs,
 * HTTPS image sources, and framing only by projectsites.dev origins.  The
 * platform must accommodate inline `<script>` tags, user-uploaded images from
 * arbitrary CDNs, and third-party SDKs (Stripe, PostHog, etc.).
 */
export const DEFAULT_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.projectsites.dev; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/**
 * Default Permissions-Policy string.
 *
 * Blocks all powerful features by default (microphone, camera, geolocation,
 * etc.).  Routes that need a specific permission must explicitly widen.
 */
const DEFAULT_PERMISSIONS_POLICY =
  'accelerometer=(), ambient-light-sensor=(), autoplay=(), camera=(), display-capture=(), document-domain=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), sync-xhr=(), usb=(), web-share=(), xr-spatial-tracking=()';

/**
 * Build a complete set of HTTP security response headers.
 *
 * Every header is set to a safe default unless overridden via `opts`.
 *
 * @param opts - Optional overrides
 * @param opts.csp - Full Content-Security-Policy string (defaults to `DEFAULT_CSP`)
 * @param opts.hsts - Strict-Transport-Security value (defaults to 2-year `includeSubDomains; preload`)
 * @param opts.frameAncestors - Override the `frame-ancestors` directive without replacing the entire CSP (defaults to `'none'`)
 * @returns A `SecurityHeaders` object ready to be set on an HTTP response
 *
 * @example
 * ```ts
 * const h = buildHeaders({ frameAncestors: "'self' https://app.example.com" });
 * console.log(h['content-security-policy']);
 * // "default-src 'self'; …; frame-ancestors 'self' https://app.example.com; …"
 * ```
 */
export function buildHeaders(opts?: {
  csp?: string;
  hsts?: string;
  frameAncestors?: string;
}): SecurityHeaders {
  let csp = opts?.csp ?? DEFAULT_CSP;

  if (opts?.frameAncestors !== undefined) {
    csp = csp.replace(/frame-ancestors\s+[^;]+/, `frame-ancestors ${opts.frameAncestors}`);
  }

  return {
    'content-security-policy': csp,
    'permissions-policy': DEFAULT_PERMISSIONS_POLICY,
    'referrer-policy': 'strict-origin-when-cross-origin',
    'strict-transport-security': opts?.hsts ?? 'max-age=63072000; includeSubDomains; preload',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'SAMEORIGIN',
  };
}

/**
 * Validate a `SecurityHeaders` object for well-formedness.
 *
 * Checks that:
 * - Every known header is present and non-empty
 * - `strict-transport-security` includes `max-age=`
 * - `content-security-policy` includes `frame-ancestors` and `default-src`
 * - `x-frame-options` is either `DENY` or `SAMEORIGIN`
 * - `x-content-type-options` is `nosniff`
 *
 * @param headers - The `SecurityHeaders` object to validate
 * @returns An object with a `valid` boolean and an `issues` array of human-readable messages
 *
 * @example
 * ```ts
 * const check = validateHeaders(buildHeaders());
 * console.log(check.valid); // true
 * ```
 *
 * @example
 * ```ts
 * const bad = validateHeaders({} as SecurityHeaders);
 * console.log(bad.valid);  // false
 * console.log(bad.issues); // [
 * //   "missing header: strict-transport-security",
 * //   "missing header: content-security-policy",
 * //   ...
 * // ]
 * ```
 */
export function validateHeaders(headers: SecurityHeaders): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const required: (keyof SecurityHeaders)[] = [
    'strict-transport-security',
    'content-security-policy',
    'x-frame-options',
    'x-content-type-options',
    'referrer-policy',
    'permissions-policy',
  ];

  for (const key of required) {
    const val = headers[key];
    if (!val || val.trim().length === 0) {
      issues.push(`missing header: ${key}`);
    }
  }

  if (headers['strict-transport-security']) {
    const hsts = headers['strict-transport-security'];
    if (!hsts.includes('max-age=')) {
      issues.push('strict-transport-security: missing max-age directive');
    }
  }

  if (headers['content-security-policy']) {
    const csp = headers['content-security-policy'];
    if (!csp.includes('frame-ancestors')) {
      issues.push('content-security-policy: missing frame-ancestors directive');
    }
    if (!csp.includes('default-src')) {
      issues.push('content-security-policy: missing default-src directive');
    }
  }

  if (headers['x-frame-options']) {
    const xfo = headers['x-frame-options'];
    if (xfo !== 'DENY' && xfo !== 'SAMEORIGIN') {
      issues.push('x-frame-options: expected DENY or SAMEORIGIN, got ' + xfo);
    }
  }

  if (headers['x-content-type-options']) {
    if (headers['x-content-type-options'] !== 'nosniff') {
      issues.push(
        `x-content-type-options: expected nosniff, got ${headers['x-content-type-options']}`,
      );
    }
  }

  return { issues, valid: issues.length === 0 };
}
