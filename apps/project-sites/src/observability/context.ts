/**
 * Shared log context interface and secret-redaction helper for the
 * Project Sites observability layer.
 *
 * @module observability/context
 */

/** Immutable per-request / per-job context carried through every log event. */
export interface AppLogContext {
  readonly service: string;
  readonly environment: string;
  readonly tenant_id?: string;
  readonly site_id?: string;
  readonly org_id?: string;
  readonly user_id?: string;
  readonly request_id?: string;
  readonly trace_id?: string;
  readonly job_id?: string;
  readonly workflow_id?: string;
}

const SECRET_KEY_RE = /token|secret|key|password|authorization|cookie|bearer/i;

/**
 * Masks any field whose key suggests it may contain a secret value.
 *
 * Values longer than 4 characters are truncated to their first 4 characters
 * followed by an ellipsis (`…`). Values of 4 characters or fewer are left
 * unchanged. Non-string values pass through unmodified.
 *
 * @param v - Arbitrary record to redact.
 * @returns A new record with sensitive values truncated.
 *
 * @example
 * ```ts
 * redactSecrets({ api_key: 'sk-1234abcd', name: 'Alice' });
 * // → { api_key: 'sk-1…', name: 'Alice' }
 * ```
 */
export function redactSecrets(v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (SECRET_KEY_RE.test(k) && typeof val === 'string' && val.length > 4) {
      out[k] = `${val.slice(0, 4)}…`;
    } else {
      out[k] = val;
    }
  }
  return out;
}
