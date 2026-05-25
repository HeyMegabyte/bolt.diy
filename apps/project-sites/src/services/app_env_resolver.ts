/**
 * @module services/app_env_resolver
 *
 * @description
 * Translates a catalog entry's `env[]` declaration + the provisioned infra
 * into the concrete env-var map fed into the container at boot. Honours
 * `auto: 'postgres_url' | 'redis_url' | 's3_url' | 'secret' | 'public_url'`
 * markers, then layers user-supplied overrides on top.
 *
 * @packageDocumentation
 */
import type { CatalogApp } from '../data/apps-catalog.js';
import type { ProvisionedInfra } from './app_provisioner.js';

export class MissingEnvError extends Error {
  readonly code = 'missing_env';
  constructor(public readonly key: string, public readonly appId: string) {
    super(`Required env var ${key} for app ${appId} could not be resolved.`);
  }
}

const HEX_BYTES = 32; // → 64-char hex secret

function randomSecret(): string {
  const bytes = new Uint8Array(HEX_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * For an `auto: 'postgres_url'` field, return the most useful component of
 * the Postgres connection based on the key name. Apps that ask for
 * `DATABASE_URL`/`POSTGRES_URL` get the full URI; apps that ask for
 * sharded HOST/PORT/USER/PASS/NAME pieces get the parsed component.
 */
function pickPostgresPart(key: string, infra: ProvisionedInfra): string | undefined {
  const pg = infra.postgres;
  if (!pg) return undefined;
  const k = key.toUpperCase();
  if (k.includes('URL') || k.includes('URI') || k === 'DATABASE_DSN') return pg.connectionString;
  if (k.includes('HOST')) return pg.host;
  if (k.includes('PORT')) return '5432';
  if (k.includes('USERNAME') || k.includes('USER')) return pg.user;
  if (k.includes('PASSWORD') || k.includes('PASS')) return pg.password;
  if (k.includes('NAME') || k.includes('DBNAME') || k === 'POSTGRES_DB') return pg.database;
  return pg.connectionString;
}

function pickRedisPart(key: string, infra: ProvisionedInfra): string | undefined {
  const r = infra.redis;
  if (!r) return undefined;
  const k = key.toUpperCase();
  if (k.includes('REST_URL') || k.includes('REST_API_URL') || k.includes('HTTP')) return r.restUrl;
  if (k.includes('REST_TOKEN') || k.includes('TOKEN')) return r.restToken;
  return r.redisUrl;
}

function pickS3Part(key: string, infra: ProvisionedInfra): string | undefined {
  const s = infra.s3;
  if (!s) return undefined;
  const k = key.toUpperCase();
  if (k.includes('ACCESS_KEY_ID') || k.endsWith('ACCESS_KEY')) return s.accessKeyId;
  if (k.includes('SECRET_ACCESS_KEY') || k.includes('SECRET_KEY')) return s.secretAccessKey;
  if (k.includes('BUCKET') && !k.includes('URL')) return s.bucketName;
  if (k.includes('ENDPOINT') || k.includes('URL')) return s.endpointUrl;
  if (k.includes('REGION')) return 'auto';
  return s.bucketName;
}

/** Resolve the final env-var map for an instance. Throws on a missing-required violation. */
export function resolveAppEnv(
  app: CatalogApp,
  infra: ProvisionedInfra,
  subdomain: string,
  userOverrides: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const publicUrl = `https://${subdomain}.app.projectsites.dev`;

  for (const decl of app.env) {
    const override = userOverrides[decl.key];
    if (typeof override === 'string' && override.length > 0) {
      out[decl.key] = override;
      continue;
    }
    if (decl.auto === 'postgres_url') {
      const v = pickPostgresPart(decl.key, infra);
      if (v) out[decl.key] = v;
    } else if (decl.auto === 'redis_url') {
      const v = pickRedisPart(decl.key, infra);
      if (v) out[decl.key] = v;
    } else if (decl.auto === 's3_url') {
      const v = pickS3Part(decl.key, infra);
      if (v) out[decl.key] = v;
    } else if (decl.auto === 'secret') {
      out[decl.key] = randomSecret();
    } else if (decl.auto === 'public_url') {
      out[decl.key] = publicUrl;
    } else if (decl.default !== undefined) {
      out[decl.key] = decl.default;
    }

    if (decl.required && !out[decl.key]) {
      throw new MissingEnvError(decl.key, app.id);
    }
  }

  // Always inject the public URL even when the catalog didn't ask — many
  // apps read `APP_URL` / `PUBLIC_URL` regardless of declaration for redirects.
  if (!out['PUBLIC_URL']) out['PUBLIC_URL'] = publicUrl;
  if (!out['PORT']) out['PORT'] = String(app.port);

  return out;
}
