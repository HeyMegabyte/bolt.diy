/**
 * @module services/smoke_matrix
 * @description AP16 — post-deploy smoke matrix. Encodes the 10-endpoint
 * verification-loop runbook (homepage / health / API / 404 / headers / auth /
 * subdomain / CSP / JSON-LD / robots.txt) into a typed declarative spec that
 * every deploy runs against. Pure: `buildSmokeSpec(endpoints, baseDomain)`
 * produces the ordered checklist the runner executes; the runner itself is a
 * thin `fetch` loop outside this module. Never throws.
 *
 * @packageDocumentation
 */

/** One smoke-check endpoint definition. */
export interface SmokeEndpoint {
  /** Route path, e.g. `/health` or `/api/sites/search`. */
  readonly path: string;
  /** HTTP method; `GET` when omitted. */
  readonly method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE';
  /**
   * Subdomain or apex. Omit = apex (`projectsites.dev`). Pass `"*"` for the
   * wildcard — the runner picks a known-live slug.
   */
  readonly subdomain?: string;
  /** Expected HTTP status (default 200). */
  readonly expectStatus?: number;
  /** Assert the response body contains this string (case-insensitive). */
  readonly bodyContains?: string;
  /** Assert the response body does NOT contain this string. */
  readonly bodyNotContains?: string;
  /** Assert the response header `key` equals `value`. */
  readonly headerEquals?: { readonly key: string; readonly value: string };
  /** Assert the response header `key` is present (any value). */
  readonly headerPresent?: string;
  /** Human label for this check in the matrix output. */
  readonly label?: string;
}

/** One completed smoke result. */
export interface SmokeResult {
  readonly path: string;
  readonly url: string;
  readonly method: string;
  readonly status: number;
  readonly durationMs: number;
  readonly pass: boolean;
  readonly failures: readonly string[];
  readonly label: string;
}

export interface SmokeMatrix {
  readonly specs: readonly SmokeEndpoint[];
  readonly results: SmokeResult[];
  readonly passCount: number;
  readonly failCount: number;
  readonly total: number;
  readonly pass: boolean;
}

/**
 * Build the canonical ordered smoke specification from application endpoints.
 *
 * @param endpoints - Declared per-route smoke checks (homepage, API, auth, 404, …).
 * @param baseDomain - Apex domain, default `projectsites.dev`.
 * @returns Ordered list of {@link SmokeEndpoint} specs.
 *
 * @example
 * buildSmokeSpec([{ path: '/health', label: 'Health' }, { path: '/api/feature-flags', label: 'Flags' }])
 */
export function buildSmokeSpec(
  endpoints: readonly SmokeEndpoint[],
  baseDomain = 'projectsites.dev',
): SmokeEndpoint[] {
  const domain = (baseDomain ?? '').trim() || 'projectsites.dev';
  const list = Array.isArray(endpoints) ? endpoints : [];

  return list.map((ep) => {
    const path = (ep.path ?? '/').trim() || '/';
    const sub = ep.subdomain?.trim();
    const host =
      sub && sub !== '*' ? `${sub}.${domain}` : sub === '*' ? `{site}.${domain}` : domain;
    return {
      ...ep,
      path,
      method: ep.method ?? 'GET',
      label: ep.label ?? `${ep.method ?? 'GET'} ${host}${path}`,
    };
  });
}

/**
 * Validate a smoke result record from raw fetch output. Pure — the runner
 * passes the raw response attributes in.
 *
 * @param spec - The original {@link SmokeEndpoint} check definition.
 * @param status - Actual HTTP status from the fetch.
 * @param body - Response body string (lowercased).
 * @param durationMs - Wall-clock ms the fetch took.
 * @param headers - Actual response headers (key→lowercased value map).
 * @returns {@link SmokeResult}.
 */
export function validateSmokeResult(
  spec: SmokeEndpoint,
  status: number,
  body: string,
  durationMs: number,
  headers: Readonly<Record<string, string>> = {},
): SmokeResult {
  const failures: string[] = [];
  const url = (spec as { _url?: string })._url ?? spec.path;
  const method = spec.method ?? 'GET';
  const expectStatus = typeof spec.expectStatus === 'number' ? spec.expectStatus : 200;
  const lowerBody = (body ?? '').toLowerCase();

  if (status !== expectStatus) {
    failures.push(`expected status ${expectStatus}, got ${status}`);
  }
  if (spec.bodyContains && !lowerBody.includes(spec.bodyContains.toLowerCase())) {
    failures.push(`body should contain "${spec.bodyContains}"`);
  }
  if (spec.bodyNotContains && lowerBody.includes(spec.bodyNotContains.toLowerCase())) {
    failures.push(`body contains banned "${spec.bodyNotContains}"`);
  }
  if (spec.headerEquals) {
    const actual = (headers[spec.headerEquals.key.toLowerCase()] ?? '').toLowerCase();
    if (actual !== spec.headerEquals.value.toLowerCase()) {
      failures.push(
        `header "${spec.headerEquals.key}" expected "${spec.headerEquals.value}", got "${actual}"`,
      );
    }
  }
  if (spec.headerPresent) {
    const key = spec.headerPresent.toLowerCase();
    if (!(key in headers)) {
      failures.push(`required header "${spec.headerPresent}" missing`);
    }
  }

  return {
    path: spec.path,
    url,
    method,
    status,
    durationMs: Number.isFinite(durationMs) ? Math.round(durationMs) : 0,
    pass: failures.length === 0,
    failures,
    label: spec.label ?? `${method} ${url}`,
  };
}

/**
 * Roll up individual smoke results into a matrix summary.
 *
 * @param results - Completed {@link SmokeResult} array.
 * @returns {@link SmokeMatrix}.
 */
export function summarizeSmoke(results: readonly SmokeResult[]): SmokeMatrix {
  const list = Array.isArray(results) ? results : [];
  const passCount = list.filter((r) => r.pass).length;
  const failCount = list.length - passCount;
  return {
    specs: [],
    results: list,
    passCount,
    failCount,
    total: list.length,
    pass: failCount === 0 && list.length > 0,
  };
}
