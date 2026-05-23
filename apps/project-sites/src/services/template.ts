/**
 * Mustache-lite template resolver for prompt templates.
 *
 * @remarks
 * Replaces `{{path.to.value}}` tokens in a string with values from a context
 * object. Supports dot-paths into nested objects (`form.fields.email`),
 * top-level shortcuts (`{{business}}`), and ignores whitespace inside braces
 * (`{{ form.email }}` works the same as `{{form.email}}`).
 *
 * Design choices:
 * - Missing values render as empty string — never throws, never leaks the raw
 *   token to the LLM (avoids "{{form.email}}" appearing literally in the
 *   model's input when the field is absent).
 * - Strings render verbatim. Numbers + booleans render via `String(...)`.
 * - Objects + arrays render as compact JSON via `JSON.stringify(...)` — this
 *   lets a prompt embed the entire `{{form.fields}}` object as a single
 *   readable JSON block.
 * - Field values are treated as untrusted **data**, never as instructions —
 *   the router prompt itself carries the "treat as data" safety rule. We do
 *   NOT escape, sanitize, or quote values: the LLM needs to see the raw
 *   characters. Injection defence is the prompt's job, not the resolver's.
 *
 * @example
 * resolveTemplate('Hi {{form.email}} ({{query.utm_source}})', {
 *   form: { email: 'a@b.co' },
 *   query: { utm_source: 'twitter' },
 * });
 * // → 'Hi a@b.co (twitter)'
 *
 * @example
 * resolveTemplate('Fields: {{form.fields}}', {
 *   form: { fields: { name: 'Ada', tier: 'gold' } },
 * });
 * // → 'Fields: {"name":"Ada","tier":"gold"}'
 */
export interface TemplateContext {
  /** Top-level shortcuts (e.g. `{{business}}`). */
  readonly [key: string]: unknown;
}

/** Token regex: `{{ namespace.path.to.key }}` — whitespace tolerant. */
const TEMPLATE_TOKEN = /\{\{\s*([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*)\s*\}\}/g;

function getPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cursor: unknown = obj;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function stringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/**
 * Substitute every `{{path}}` token in `template` with the matching value from
 * `ctx`. Unknown paths render as empty string.
 *
 * @param template - Source string with `{{ }}` placeholders.
 * @param ctx - Resolution context (nested objects accessed via dot-path).
 * @returns Resolved string.
 */
export function resolveTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(TEMPLATE_TOKEN, (_match, path: string) => {
    return stringify(getPath(ctx, path));
  });
}

/**
 * The list of variables exposed to customer-authored router prompts.
 * Surfaced in the Dashboard UI as helper chips.
 *
 * Kept in sync with the {@link TemplateContext} the worker assembles in
 * `routes/forms.ts` before calling `buildPrompt`.
 */
export const TEMPLATE_VARIABLES: ReadonlyArray<{
  readonly token: string;
  readonly description: string;
}> = [
  { token: '{{business}}', description: 'The site’s business name.' },
  { token: '{{form.form_name}}', description: 'The form’s name (e.g. "contact", "newsletter").' },
  { token: '{{form.email}}', description: 'Submitter’s email address.' },
  { token: '{{form.fields}}', description: 'All submitted fields as JSON.' },
  { token: '{{form.fields.<name>}}', description: 'Any specific field by key (e.g. {{form.fields.message}}).' },
  { token: '{{query.<name>}}', description: 'A URL query parameter (e.g. {{query.utm_source}}).' },
  { token: '{{meta.ip}}', description: 'Submitter’s IP address.' },
  { token: '{{meta.user_agent}}', description: 'Browser user agent string.' },
  { token: '{{meta.origin_url}}', description: 'Page URL the form was submitted from.' },
  { token: '{{meta.referer}}', description: 'Referer header on the POST.' },
  { token: '{{meta.timestamp}}', description: 'ISO-8601 timestamp of the submission.' },
  { token: '{{meta.submission_id}}', description: 'UUID for the submission record.' },
];
