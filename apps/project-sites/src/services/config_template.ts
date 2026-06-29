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
  return Object.freeze({ name, format, fields: Object.freeze([...fields]) });
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
  plane: buildTemplate('Plane', 'env', [
    {
      key: 'PLANE_HOST',
      value: 'https://plane.projectsites.dev',
      description: 'Public-facing host URL',
      required: true,
      sensitive: false,
    },
    {
      key: 'PLANE_DB_URL',
      value: 'postgresql://user:pass@neon:5432/plane',
      description: 'Postgres connection string (Neon)',
      required: true,
      sensitive: true,
    },
    {
      key: 'PLANE_REDIS_URL',
      value: 'rediss://default:pass@eu1-keen-puff-12345.upstash.io:6379',
      description: 'Redis connection string (Upstash)',
      required: true,
      sensitive: true,
    },
    {
      key: 'PLANE_AMQP_URL',
      value:
        'amqps://user:pass@b-bee4bdf1-1234-5678-9abc-def012345678.mq.us-east-1.amazonaws.com:5671',
      description: 'AMQP connection string (CloudAMQP)',
      required: false,
      sensitive: true,
    },
    {
      key: 'PLANE_SECRET_KEY',
      value: '60-char-secret-key',
      description: 'Django secret key',
      required: true,
      sensitive: true,
    },
    {
      key: 'PLANE_ENCRYPTION_KEY',
      value: '32-char-aes-key-base64',
      description: 'AES encryption key for secrets at rest',
      required: true,
      sensitive: true,
    },
    {
      key: 'PLANE_MAGIC_LINK_SECRET',
      value: '32-char-magic-link-secret',
      description: 'HMAC secret for magic link tokens',
      required: true,
      sensitive: true,
    },
    {
      key: 'PLANE_EMAIL_HOST',
      value: 'email-smtp.us-east-1.amazonaws.com',
      description: 'SMTP host (SES)',
      required: true,
      sensitive: false,
    },
    {
      key: 'PLANE_EMAIL_PORT',
      value: '587',
      description: 'SMTP port',
      required: true,
      sensitive: false,
    },
    {
      key: 'PLANE_EMAIL_USER',
      value: 'AKIA...',
      description: 'SMTP username (SES IAM)',
      required: true,
      sensitive: true,
    },
    {
      key: 'PLANE_EMAIL_PASS',
      value: 'ses-smtp-password',
      description: 'SMTP password (SES derived)',
      required: true,
      sensitive: true,
    },
    {
      key: 'PLANE_SES_SENDER_EMAIL',
      value: 'noreply@projectsites.dev',
      description: 'From address for transactional email',
      required: false,
      sensitive: false,
    },
    {
      key: 'PLANE_GITHUB_CLIENT_ID',
      value: 'Ov23li...',
      description: 'GitHub OAuth app client ID',
      required: false,
      sensitive: false,
    },
    {
      key: 'PLANE_GITHUB_CLIENT_SECRET',
      value: 'github-oauth-secret',
      description: 'GitHub OAuth app client secret',
      required: false,
      sensitive: true,
    },
    {
      key: 'PLANE_GOOGLE_CLIENT_ID',
      value: '123456.apps.googleusercontent.com',
      description: 'Google OAuth client ID',
      required: false,
      sensitive: false,
    },
    {
      key: 'PLANE_GOOGLE_CLIENT_SECRET',
      value: 'google-oauth-secret',
      description: 'Google OAuth client secret',
      required: false,
      sensitive: true,
    },
    {
      key: 'PLANE_SENTRY_DSN',
      value: 'https://key@sentry.io/project-id',
      description: 'Sentry DSN for error tracking',
      required: false,
      sensitive: true,
    },
  ]),

  twenty: buildTemplate('Twenty CRM', 'env', [
    {
      key: 'TWENTY_SITE_URL',
      value: 'https://crm.projectsites.dev',
      description: 'Public-facing site URL',
      required: true,
      sensitive: false,
    },
    {
      key: 'TWENTY_FRONT_BASE_URL',
      value: 'https://crm.projectsites.dev',
      description: 'Frontend base URL for CORS/redirects',
      required: true,
      sensitive: false,
    },
    {
      key: 'TWENTY_DB_URL',
      value: 'postgresql://user:pass@neon:5432/twenty',
      description: 'Postgres connection string (Neon)',
      required: true,
      sensitive: true,
    },
    {
      key: 'TWENTY_REDIS_URL',
      value: 'rediss://default:pass@eu1-keen-puff-12345.upstash.io:6379',
      description: 'Redis connection string (Upstash)',
      required: true,
      sensitive: true,
    },
    {
      key: 'TWENTY_SECRET_KEY',
      value: '60-char-secret-key',
      description: 'App secret key for JWT signing',
      required: true,
      sensitive: true,
    },
    {
      key: 'TWENTY_APP_SECRET',
      value: '32-char-app-secret',
      description: 'Internal app secret for worker auth',
      required: true,
      sensitive: true,
    },
    {
      key: 'TWENTY_SENTRY_DSN',
      value: 'https://key@sentry.io/twenty-project',
      description: 'Sentry DSN for error tracking',
      required: false,
      sensitive: true,
    },
    {
      key: 'TWENTY_STORAGE_TYPE',
      value: 's3',
      description: 'File storage backend (local/s3)',
      required: true,
      sensitive: false,
    },
    {
      key: 'TWENTY_SES_SENDER_EMAIL',
      value: 'noreply@projectsites.dev',
      description: 'From address for emails',
      required: false,
      sensitive: false,
    },
    {
      key: 'TWENTY_GOOGLE_CLIENT_ID',
      value: '123456.apps.googleusercontent.com',
      description: 'Google OAuth client ID',
      required: false,
      sensitive: false,
    },
    {
      key: 'TWENTY_GOOGLE_CLIENT_SECRET',
      value: 'google-oauth-secret',
      description: 'Google OAuth client secret',
      required: false,
      sensitive: true,
    },
    {
      key: 'TWENTY_MICROSOFT_CLIENT_ID',
      value: 'microsoft-client-uuid',
      description: 'Microsoft OAuth client ID',
      required: false,
      sensitive: false,
    },
    {
      key: 'TWENTY_MICROSOFT_CLIENT_SECRET',
      value: 'ms-oauth-secret',
      description: 'Microsoft OAuth client secret',
      required: false,
      sensitive: true,
    },
  ]),

  listmonk: buildTemplate('Listmonk', 'env', [
    {
      key: 'LISTMONK_DB_URL',
      value: 'postgresql://listmonk:pass@neon:5432/projectsites_listmonk',
      description: 'Postgres connection string (Neon)',
      required: true,
      sensitive: true,
    },
    {
      key: 'LISTMONK_SECRET',
      value: '48-char-listmonk-secret',
      description: 'Session/cookie encryption secret',
      required: true,
      sensitive: true,
    },
    {
      key: 'LISTMONK_SMTP_HOST',
      value: 'email-smtp.us-east-1.amazonaws.com',
      description: 'SMTP host (SES)',
      required: true,
      sensitive: false,
    },
    {
      key: 'LISTMONK_SMTP_PORT',
      value: '587',
      description: 'SMTP port',
      required: true,
      sensitive: false,
    },
    {
      key: 'LISTMONK_SMTP_USER',
      value: 'AKIA...',
      description: 'SMTP username (SES IAM)',
      required: false,
      sensitive: true,
    },
    {
      key: 'LISTMONK_SMTP_PASS',
      value: 'ses-smtp-password',
      description: 'SMTP password (SES derived)',
      required: true,
      sensitive: true,
    },
    {
      key: 'LISTMONK_SMTP_FROM_EMAIL',
      value: 'mail@projectsites.dev',
      description: 'From address for outbound mail',
      required: true,
      sensitive: false,
    },
    {
      key: 'LISTMONK_APP_ADMIN_USERNAME',
      value: 'admin',
      description: 'Initial admin console username',
      required: true,
      sensitive: false,
    },
    {
      key: 'LISTMONK_APP_ADMIN_PASSWORD',
      value: '48-char-admin-password',
      description: 'Initial admin console password',
      required: true,
      sensitive: true,
    },
  ]),

  unkey: buildTemplate('Unkey', 'env', [
    {
      key: 'UNKEY_DB_URL',
      value: 'mysql://unkey:pass@tidb:4000/unkey',
      description: 'MySQL/TiDB connection string',
      required: true,
      sensitive: true,
    },
    {
      key: 'UNKEY_REDIS_URL',
      value: 'rediss://default:pass@eu1-keen-puff-12345.upstash.io:6379',
      description: 'Redis connection string (Upstash)',
      required: true,
      sensitive: true,
    },
    {
      key: 'UNKEY_SECRET',
      value: '32-char-unkey-root-key',
      description: 'Root API key for bootstrapping',
      required: true,
      sensitive: true,
    },
    {
      key: 'UNKEY_ENCRYPTION_KEY',
      value: '32-char-aes-key-base64',
      description: 'AES-GCM encryption key for API key storage',
      required: true,
      sensitive: true,
    },
    {
      key: 'UNKEY_APP_URL',
      value: 'https://api.projectsites.dev',
      description: 'Public-facing app URL',
      required: true,
      sensitive: false,
    },
    {
      key: 'UNKEY_LOGTAIL_TOKEN',
      value: 'logtail-token',
      description: 'Logtail/observability token',
      required: false,
      sensitive: true,
    },
  ]),

  inngest: buildTemplate('Inngest', 'env', [
    {
      key: 'INNGEST_SIGNING_KEY',
      value: 'signkey-prod-12345678',
      description: 'Event signing key for webhook verification',
      required: true,
      sensitive: true,
    },
    {
      key: 'INNGEST_EVENT_KEY',
      value: 'eventkey-prod-12345678',
      description: 'Event API key for sending events',
      required: true,
      sensitive: true,
    },
    {
      key: 'INNGEST_DB_URL',
      value: 'postgresql://inngest:pass@neon:5432/inngest',
      description: 'Postgres connection string (Neon)',
      required: false,
      sensitive: true,
    },
    {
      key: 'INNGEST_REDIS_URL',
      value: 'rediss://default:pass@eu1-keen-puff-12345.upstash.io:6379',
      description: 'Redis connection string (Upstash)',
      required: false,
      sensitive: true,
    },
  ]),
};
