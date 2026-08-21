/**
 * @module services/config_template
 * @description Config template builder — generates environment config files in
 * json, toml, yaml, or env format from typed field definitions. Pure functions,
 * zero I/O, never throws.
 * @packageDocumentation
 */

export type ConfigFormat = 'json' | 'toml' | 'yaml' | 'env';

export interface ConfigField {
  readonly key: string;
  readonly value: string;
  readonly description: string;
  readonly required: boolean;
  readonly sensitive: boolean;
}

export interface ConfigTemplate {
  readonly name: string;
  readonly format: ConfigFormat;
  readonly fields: readonly ConfigField[];
}

// ── helpers ────────────────────────────────────────────────────────────────

function escapeToml(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeJson(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeYaml(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function lineForFormat(key: string, value: string, format: ConfigFormat): string {
  switch (format) {
    case 'env':
      return `${key}=${value}`;
    case 'json':
      return `"${escapeJson(key)}": "${escapeJson(value)}"`;
    case 'toml':
      return `${key} = "${escapeToml(value)}"`;
    case 'yaml':
      return `${key}: "${escapeYaml(value)}"`;
  }
}

// ── public API ─────────────────────────────────────────────────────────────

/**
 * Build a typed {@link ConfigTemplate} from name, format, and field definitions.
 *
 * @param name - Human-readable template name (e.g. `"Plane"`).
 * @param format - Output format key.
 * @param fields - Ordered field definitions.
 * @returns A frozen {@link ConfigTemplate}.
 *
 * @example
 * const tpl = buildTemplate('MyApp', 'env', [
 *   { key: 'PORT', value: '8080', description: 'HTTP port', required: true, sensitive: false },
 * ]);
 * tpl.name // => 'MyApp'
 */
export function buildTemplate(
  name: string,
  format: ConfigFormat,
  fields: readonly ConfigField[],
): ConfigTemplate {
  return Object.freeze({ fields: Object.freeze([...fields]), format, name });
}

/**
 * Render a config template as a multi-line string in its declared format.
 *
 * @param template - The template to render.
 * @returns Rendered config string.
 *
 * @example
 * const tpl = APP_TEMPLATES.plane;
 * const out = renderTemplate(tpl);
 * // => 'PLANE_HOST=https://plane.projectsites.dev\n...'
 */
export function renderTemplate(template: ConfigTemplate): string {
  const lines: string[] = [];
  let first = true;

  if (template.format === 'json') {
    if (template.fields.length === 0) return '{}\n';
    lines.push('{');
    for (const f of template.fields) {
      if (!first) lines.push(',');
      lines.push(`  ${lineForFormat(f.key, f.value, 'json')}`);
      first = false;
    }
    lines.push('\n}');
    return lines.join('');
  }

  if (template.format === 'yaml') {
    for (const f of template.fields) {
      lines.push(lineForFormat(f.key, f.value, 'yaml'));
    }
    return lines.join('\n') + '\n';
  }

  for (const f of template.fields) {
    lines.push(lineForFormat(f.key, f.value, template.format));
  }
  return lines.join('\n') + '\n';
}

/**
 * Extract the keys of all sensitive fields.
 *
 * @param fields - Field definitions to scan.
 * @returns Array of `key` strings where `sensitive === true`.
 *
 * @example
 * extractSecrets(APP_TEMPLATES.plane.fields)
 * // => ['PLANE_DB_URL', 'PLANE_SECRET_KEY', 'PLANE_ENCRYPTION_KEY', ...]
 */
export function extractSecrets(fields: readonly ConfigField[]): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (f.sensitive) out.push(f.key);
  }
  return out;
}

// ── APP_TEMPLATES ──────────────────────────────────────────────────────────

/**
 * Pre-defined config templates for self-hosted services deployed in
 * the projectsites.dev / megabyte.space ecosystem.
 *
 * Each entry carries the canonical env vars for that service, typed as
 * {@link ConfigField} with required/sensitive flags.
 */
export const APP_TEMPLATES: Record<string, ConfigTemplate> = {
  listmonk: buildTemplate('Listmonk', 'env', [
    {
      description: 'Postgres connection string (Neon)',
      key: 'LISTMONK_DB_URL',
      required: true,
      sensitive: true,
      value: 'postgresql://listmonk:pass@neon:5432/projectsites_listmonk',
    },
    {
      description: 'Session/cookie encryption secret',
      key: 'LISTMONK_SECRET',
      required: true,
      sensitive: true,
      value: '48-char-listmonk-secret',
    },
    {
      description: 'SMTP host (SES)',
      key: 'LISTMONK_SMTP_HOST',
      required: true,
      sensitive: false,
      value: 'email-smtp.us-east-1.amazonaws.com',
    },
    {
      description: 'SMTP port',
      key: 'LISTMONK_SMTP_PORT',
      required: true,
      sensitive: false,
      value: '587',
    },
    {
      description: 'SMTP username (SES IAM)',
      key: 'LISTMONK_SMTP_USER',
      required: false,
      sensitive: true,
      value: 'AKIA...',
    },
    {
      description: 'SMTP password (SES derived)',
      key: 'LISTMONK_SMTP_PASS',
      required: true,
      sensitive: true,
      value: 'ses-smtp-password',
    },
    {
      description: 'From address for outbound mail',
      key: 'LISTMONK_SMTP_FROM_EMAIL',
      required: true,
      sensitive: false,
      value: 'mail@projectsites.dev',
    },
    {
      description: 'Initial admin console username',
      key: 'LISTMONK_APP_ADMIN_USERNAME',
      required: true,
      sensitive: false,
      value: 'admin',
    },
    {
      description: 'Initial admin console password',
      key: 'LISTMONK_APP_ADMIN_PASSWORD',
      required: true,
      sensitive: true,
      value: '48-char-admin-password',
    },
  ]),

  twenty: buildTemplate('Twenty CRM', 'env', [
    {
      description: 'Public-facing site URL',
      key: 'TWENTY_SITE_URL',
      required: true,
      sensitive: false,
      value: 'https://crm.projectsites.dev',
    },
    {
      description: 'Frontend base URL for CORS/redirects',
      key: 'TWENTY_FRONT_BASE_URL',
      required: true,
      sensitive: false,
      value: 'https://crm.projectsites.dev',
    },
    {
      description: 'Postgres connection string (Neon)',
      key: 'TWENTY_DB_URL',
      required: true,
      sensitive: true,
      value: 'postgresql://user:pass@neon:5432/twenty',
    },
    {
      description: 'Redis connection string (Upstash)',
      key: 'TWENTY_REDIS_URL',
      required: true,
      sensitive: true,
      value: 'rediss://default:pass@eu1-keen-puff-12345.upstash.io:6379',
    },
    {
      description: 'App secret key for JWT signing',
      key: 'TWENTY_SECRET_KEY',
      required: true,
      sensitive: true,
      value: '60-char-secret-key',
    },
    {
      description: 'Internal app secret for worker auth',
      key: 'TWENTY_APP_SECRET',
      required: true,
      sensitive: true,
      value: '32-char-app-secret',
    },
    {
      description: 'Sentry DSN for error tracking',
      key: 'TWENTY_SENTRY_DSN',
      required: false,
      sensitive: true,
      value: 'https://key@sentry.io/twenty-project',
    },
    {
      description: 'File storage backend (local/s3)',
      key: 'TWENTY_STORAGE_TYPE',
      required: true,
      sensitive: false,
      value: 's3',
    },
    {
      description: 'From address for emails',
      key: 'TWENTY_SES_SENDER_EMAIL',
      required: false,
      sensitive: false,
      value: 'noreply@projectsites.dev',
    },
    {
      description: 'Google OAuth client ID',
      key: 'TWENTY_GOOGLE_CLIENT_ID',
      required: false,
      sensitive: false,
      value: '123456.apps.googleusercontent.com',
    },
    {
      description: 'Google OAuth client secret',
      key: 'TWENTY_GOOGLE_CLIENT_SECRET',
      required: false,
      sensitive: true,
      value: 'google-oauth-secret',
    },
    {
      description: 'Microsoft OAuth client ID',
      key: 'TWENTY_MICROSOFT_CLIENT_ID',
      required: false,
      sensitive: false,
      value: 'microsoft-client-uuid',
    },
    {
      description: 'Microsoft OAuth client secret',
      key: 'TWENTY_MICROSOFT_CLIENT_SECRET',
      required: false,
      sensitive: true,
      value: 'ms-oauth-secret',
    },
  ]),
};
