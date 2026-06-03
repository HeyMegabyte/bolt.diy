/**
 * app_env_resolver — env-var map resolution for installed-app instances.
 *
 * Covers every branch of `resolveAppEnv`: user-override precedence, the four
 * `auto:` markers (postgres/redis/s3/secret/public_url) with their key-name
 * sub-picks, static defaults, missing-infra skips, the always-injected
 * PUBLIC_URL/PORT fallbacks, and the `required && !value` rejection path
 * (MissingEnvError). Uses real Node 22 WebCrypto for the `secret` branch
 * (`crypto.getRandomValues`) — no mocks. CatalogApp/ProvisionedInfra are
 * built as minimal fixtures cast to the imported types.
 *
 * Convergence round 9 — additive only.
 */
import { resolveAppEnv, MissingEnvError } from '../services/app_env_resolver.js';
import type { CatalogApp } from '../data/apps-catalog.js';
import type { ProvisionedInfra } from '../services/app_provisioner.js';

type EnvDecl = CatalogApp['env'][number];

/** Build a minimal CatalogApp with only the fields resolveAppEnv reads. */
function makeApp(env: EnvDecl[], opts: { id?: string; port?: number } = {}): CatalogApp {
  return {
    id: opts.id ?? 'test-app',
    port: opts.port ?? 3000,
    env,
  } as unknown as CatalogApp;
}

const FULL_INFRA: ProvisionedInfra = {
  needsVolume: false,
  postgres: {
    connectionString: 'postgres://u:p@db.host:5432/appdb',
    host: 'db.host',
    user: 'pguser',
    password: 'pgpass',
    database: 'appdb',
  },
  redis: {
    restUrl: 'https://redis.rest',
    restToken: 'rest-token-xyz',
    redisUrl: 'rediss://:pw@redis.host:6379',
  },
  s3: {
    bucketName: 'my-bucket',
    accountId: 'acct-1',
    endpointUrl: 'https://s3.endpoint',
    accessKeyId: 'AKIA123',
    secretAccessKey: 's3-secret-key',
  },
} as unknown as ProvisionedInfra;

const EMPTY_INFRA: ProvisionedInfra = { needsVolume: false } as unknown as ProvisionedInfra;

const SUB = 'acme';
const PUBLIC_URL = `https://${SUB}.app.projectsites.dev`;

const decl = (over: Partial<EnvDecl> & { key: string }): EnvDecl =>
  ({ description: 'd', required: false, ...over }) as EnvDecl;

describe('resolveAppEnv — user override precedence', () => {
  it('uses a non-empty user override over the auto-resolved value', () => {
    const app = makeApp([decl({ key: 'DATABASE_URL', auto: 'postgres_url', required: true })]);
    const out = resolveAppEnv(app, FULL_INFRA, SUB, { DATABASE_URL: 'postgres://override' });
    expect(out.DATABASE_URL).toBe('postgres://override');
  });

  it('ignores an empty-string override and falls through to auto resolution', () => {
    const app = makeApp([decl({ key: 'DATABASE_URL', auto: 'postgres_url', required: true })]);
    const out = resolveAppEnv(app, FULL_INFRA, SUB, { DATABASE_URL: '' });
    expect(out.DATABASE_URL).toBe('postgres://u:p@db.host:5432/appdb');
  });

  it('ignores a non-string override (e.g. undefined entry) and falls through', () => {
    const app = makeApp([decl({ key: 'PORT_OVERRIDE', default: 'def-val' })]);
    // userOverrides typed Record<string,string>; cast to exercise the typeof guard
    const out = resolveAppEnv(app, FULL_INFRA, SUB, {
      PORT_OVERRIDE: undefined as unknown as string,
    });
    expect(out.PORT_OVERRIDE).toBe('def-val');
  });
});

describe('resolveAppEnv — postgres_url key-name sub-picks', () => {
  const cases: Array<[string, string]> = [
    ['DATABASE_URL', 'postgres://u:p@db.host:5432/appdb'],
    ['POSTGRES_URI', 'postgres://u:p@db.host:5432/appdb'],
    ['DATABASE_DSN', 'postgres://u:p@db.host:5432/appdb'],
    ['DB_HOST', 'db.host'],
    ['DB_PORT', '5432'],
    ['DB_USERNAME', 'pguser'],
    ['DB_USER', 'pguser'],
    ['DB_PASSWORD', 'pgpass'],
    ['DB_PASS', 'pgpass'],
    ['DB_NAME', 'appdb'],
    ['POSTGRES_DB', 'appdb'],
    ['SOME_DBNAME', 'appdb'],
    ['UNMATCHED_PG', 'postgres://u:p@db.host:5432/appdb'], // default branch → connectionString
  ];
  it.each(cases)('%s resolves to %s', (key, expected) => {
    const app = makeApp([decl({ key, auto: 'postgres_url' })]);
    const out = resolveAppEnv(app, FULL_INFRA, SUB, {});
    expect(out[key]).toBe(expected);
  });

  it('skips a postgres_url field when no postgres infra was provisioned', () => {
    const app = makeApp([decl({ key: 'DATABASE_URL', auto: 'postgres_url' })]);
    const out = resolveAppEnv(app, EMPTY_INFRA, SUB, {});
    expect(out.DATABASE_URL).toBeUndefined();
  });
});

describe('resolveAppEnv — redis_url key-name sub-picks', () => {
  const cases: Array<[string, string]> = [
    ['REDIS_REST_URL', 'https://redis.rest'],
    ['UPSTASH_REST_API_URL', 'https://redis.rest'],
    ['REDIS_HTTP', 'https://redis.rest'],
    ['REDIS_REST_TOKEN', 'rest-token-xyz'],
    ['UPSTASH_TOKEN', 'rest-token-xyz'],
    ['REDIS_URL', 'rediss://:pw@redis.host:6379'], // default branch → redisUrl
  ];
  it.each(cases)('%s resolves to %s', (key, expected) => {
    const app = makeApp([decl({ key, auto: 'redis_url' })]);
    const out = resolveAppEnv(app, FULL_INFRA, SUB, {});
    expect(out[key]).toBe(expected);
  });

  it('skips a redis_url field when no redis infra was provisioned', () => {
    const app = makeApp([decl({ key: 'REDIS_URL', auto: 'redis_url' })]);
    const out = resolveAppEnv(app, EMPTY_INFRA, SUB, {});
    expect(out.REDIS_URL).toBeUndefined();
  });
});

describe('resolveAppEnv — s3_url key-name sub-picks', () => {
  const cases: Array<[string, string]> = [
    ['AWS_ACCESS_KEY_ID', 'AKIA123'],
    ['S3_ACCESS_KEY', 'AKIA123'],
    // quirk: ACCESS_KEY_ID check + endsWith('ACCESS_KEY') run BEFORE SECRET_KEY,
    // so AWS_SECRET_ACCESS_KEY (ends in ACCESS_KEY) resolves to the access key id
    ['AWS_SECRET_ACCESS_KEY', 'AKIA123'],
    ['S3_SECRET_KEY', 's3-secret-key'], // contains SECRET_KEY, not ending ACCESS_KEY
    ['BUCKET_NAME', 'my-bucket'],
    ['S3_ENDPOINT', 'https://s3.endpoint'],
    ['BUCKET_URL', 'https://s3.endpoint'], // contains URL → endpoint, not bucket
    ['AWS_REGION', 'auto'],
    ['UNMATCHED_S3', 'my-bucket'], // default branch → bucketName
  ];
  it.each(cases)('%s resolves to %s', (key, expected) => {
    const app = makeApp([decl({ key, auto: 's3_url' })]);
    const out = resolveAppEnv(app, FULL_INFRA, SUB, {});
    expect(out[key]).toBe(expected);
  });

  it('skips an s3_url field when no s3 infra was provisioned', () => {
    const app = makeApp([decl({ key: 'AWS_ACCESS_KEY_ID', auto: 's3_url' })]);
    const out = resolveAppEnv(app, EMPTY_INFRA, SUB, {});
    expect(out.AWS_ACCESS_KEY_ID).toBeUndefined();
  });
});

describe('resolveAppEnv — secret + public_url + default branches', () => {
  it('generates a 64-char hex secret for auto:secret', () => {
    const app = makeApp([decl({ key: 'APP_SECRET', auto: 'secret', required: true })]);
    const out = resolveAppEnv(app, FULL_INFRA, SUB, {});
    expect(out.APP_SECRET).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates a distinct secret per declaration', () => {
    const app = makeApp([
      decl({ key: 'SECRET_A', auto: 'secret' }),
      decl({ key: 'SECRET_B', auto: 'secret' }),
    ]);
    const out = resolveAppEnv(app, FULL_INFRA, SUB, {});
    expect(out.SECRET_A).not.toBe(out.SECRET_B);
  });

  it('resolves auto:public_url to the subdomain URL', () => {
    const app = makeApp([decl({ key: 'BASE_URL', auto: 'public_url' })]);
    const out = resolveAppEnv(app, FULL_INFRA, SUB, {});
    expect(out.BASE_URL).toBe(PUBLIC_URL);
  });

  it('uses a static default when no auto marker is present', () => {
    const app = makeApp([decl({ key: 'DB_TYPE', default: 'postgres' })]);
    const out = resolveAppEnv(app, FULL_INFRA, SUB, {});
    expect(out.DB_TYPE).toBe('postgres');
  });

  it('writes an empty-string default (default !== undefined still applies)', () => {
    const app = makeApp([decl({ key: 'OPTIONAL_FLAG', default: '' })]);
    const out = resolveAppEnv(app, FULL_INFRA, SUB, {});
    // '' !== undefined → the default branch assigns '', and required:false so no throw
    expect(out.OPTIONAL_FLAG).toBe('');
  });

  it('leaves an unresolvable optional field unset (no auto, no default)', () => {
    const app = makeApp([decl({ key: 'MYSTERY' })]);
    const out = resolveAppEnv(app, FULL_INFRA, SUB, {});
    expect(out.MYSTERY).toBeUndefined();
  });
});

describe('resolveAppEnv — required rejection (MissingEnvError)', () => {
  it('throws MissingEnvError when a required postgres field cannot resolve', () => {
    const app = makeApp([decl({ key: 'DATABASE_URL', auto: 'postgres_url', required: true })], {
      id: 'pg-app',
    });
    expect(() => resolveAppEnv(app, EMPTY_INFRA, SUB, {})).toThrow(MissingEnvError);
  });

  it('carries the key + appId on the thrown MissingEnvError', () => {
    const app = makeApp([decl({ key: 'REDIS_URL', auto: 'redis_url', required: true })], {
      id: 'redis-app',
    });
    try {
      resolveAppEnv(app, EMPTY_INFRA, SUB, {});
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(MissingEnvError);
      const err = e as MissingEnvError;
      expect(err.code).toBe('missing_env');
      expect(err.key).toBe('REDIS_URL');
      expect(err.appId).toBe('redis-app');
      expect(err.message).toContain('REDIS_URL');
      expect(err.message).toContain('redis-app');
    }
  });

  it('does NOT throw when a required field IS satisfiable from infra', () => {
    const app = makeApp([decl({ key: 'DATABASE_URL', auto: 'postgres_url', required: true })]);
    expect(() => resolveAppEnv(app, FULL_INFRA, SUB, {})).not.toThrow();
  });

  it('throws for a required field with no auto and no default', () => {
    const app = makeApp([decl({ key: 'API_KEY', required: true })], { id: 'key-app' });
    expect(() => resolveAppEnv(app, FULL_INFRA, SUB, {})).toThrow(MissingEnvError);
  });

  it('does NOT throw for a required field satisfied by a user override', () => {
    const app = makeApp([decl({ key: 'API_KEY', required: true })]);
    expect(() => resolveAppEnv(app, FULL_INFRA, SUB, { API_KEY: 'user-provided' })).not.toThrow();
  });
});

describe('resolveAppEnv — always-injected PUBLIC_URL + PORT fallbacks', () => {
  it('injects PUBLIC_URL and PORT even when the catalog declares no env', () => {
    const app = makeApp([], { port: 8080 });
    const out = resolveAppEnv(app, FULL_INFRA, SUB, {});
    expect(out.PUBLIC_URL).toBe(PUBLIC_URL);
    expect(out.PORT).toBe('8080');
  });

  it('does not overwrite a PUBLIC_URL already set via a public_url declaration', () => {
    const app = makeApp([decl({ key: 'PUBLIC_URL', auto: 'public_url' })]);
    const out = resolveAppEnv(app, FULL_INFRA, SUB, {});
    expect(out.PUBLIC_URL).toBe(PUBLIC_URL);
  });

  it('does not overwrite a PORT already set via a user override', () => {
    const app = makeApp([decl({ key: 'PORT' })], { port: 3000 });
    const out = resolveAppEnv(app, FULL_INFRA, SUB, { PORT: '9999' });
    expect(out.PORT).toBe('9999');
  });

  it('stringifies the app port for the PORT fallback', () => {
    const app = makeApp([], { port: 5678 });
    const out = resolveAppEnv(app, FULL_INFRA, SUB, {});
    expect(typeof out.PORT).toBe('string');
    expect(out.PORT).toBe('5678');
  });
});

describe('resolveAppEnv — integration over a mixed declaration set', () => {
  it('resolves every marker type in one pass', () => {
    const app = makeApp(
      [
        decl({ key: 'DATABASE_URL', auto: 'postgres_url', required: true }),
        decl({ key: 'REDIS_URL', auto: 'redis_url', required: true }),
        decl({ key: 'AWS_ACCESS_KEY_ID', auto: 's3_url', required: true }),
        decl({ key: 'APP_SECRET', auto: 'secret', required: true }),
        decl({ key: 'BASE_URL', auto: 'public_url', required: true }),
        decl({ key: 'LOG_LEVEL', default: 'info' }),
        decl({ key: 'API_TOKEN', required: true }),
      ],
      { port: 4000 },
    );
    const out = resolveAppEnv(app, FULL_INFRA, SUB, { API_TOKEN: 'tok' });
    expect(out).toMatchObject({
      DATABASE_URL: 'postgres://u:p@db.host:5432/appdb',
      REDIS_URL: 'rediss://:pw@redis.host:6379',
      AWS_ACCESS_KEY_ID: 'AKIA123',
      BASE_URL: PUBLIC_URL,
      LOG_LEVEL: 'info',
      API_TOKEN: 'tok',
      PUBLIC_URL,
      PORT: '4000',
    });
    expect(out.APP_SECRET).toMatch(/^[0-9a-f]{64}$/);
  });
});
