/**
 * @module durable_objects/documenso_container
 *
 * @description
 * `DocumensoContainer` — Durable Object wrapping a Cloudflare Containers (CFC)
 * instance that runs **self-hosted Documenso** (e-signatures) for
 * `sign.projectsites.dev`. Mirrors `InngestContainer`:
 * a single platform-owned warm instance at a fixed subdomain.
 *
 * - Image: `containers/documenso/Dockerfile` (`FROM documenso/documenso` —
 *   local Dockerfile path, bypasses `IMAGE_REGISTRY_NOT_CONFIGURED`).
 * - Data plane: Postgres → Neon project `Documenso` (`shiny-wind-41827027`).
 *   Documenso is Postgres-only (NO Redis).
 * - Crypto/auth: `DOCUMENSO_NEXTAUTH_SECRET` + `DOCUMENSO_ENCRYPTION_KEY` +
 *   `DOCUMENSO_ENCRYPTION_SECONDARY_KEY` (each `openssl rand -base64 32`, >=32
 *   chars), self-generated, stored as `wrangler secret`, never in git.
 * - Signing: a self-signed P12 rides as base64 in `DOCUMENSO_SIGNING_CERT_B64`
 *   (+ `DOCUMENSO_SIGNING_PASSPHRASE`). The cert is OPTIONAL for boot — Documenso
 *   serves its login page without it; only document SIGNING needs it.
 *
 * ## CFC env-injection
 * Worker `DOCUMENSO_*` secrets are mapped to Documenso's expected env names
 * (`NEXT_PRIVATE_DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXT_PRIVATE_ENCRYPTION_KEY`,
 * `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY`,
 * `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS`, `NEXT_PRIVATE_SIGNING_PASSPHRASE`)
 * + the public/internal URLs, and ride in the 3rd `startAndWaitForPorts` arg.
 *
 * @packageDocumentation
 */

import { Container } from '@cloudflare/containers';
import type { Env } from '../types/env.js';

/** Documenso Next.js server port. */
const DOCUMENSO_PORT = 3000;

/** Public origin Documenso runs under. */
const DOCUMENSO_ORIGIN = 'https://sign.projectsites.dev';

/**
 * Build the env map injected into the Documenso container. Empty/missing values
 * are filtered so a missing required secret surfaces as a boot failure rather
 * than a silent half-config (Documenso validates env at boot).
 */
function documensoEnvVars(env: Env): Record<string, string> {
  const pairs: Record<string, string | undefined> = {
    NEXT_PRIVATE_DATABASE_URL: env.DOCUMENSO_DATABASE_URL,
    // Documenso's prisma schema declares directUrl=env(NEXT_PRIVATE_DIRECT_DATABASE_URL).
    // Without it prisma fails to load (P1012) → every DB write (signup!) errors out.
    NEXT_PRIVATE_DIRECT_DATABASE_URL: env.DOCUMENSO_DATABASE_DIRECT_URL,
    NEXTAUTH_SECRET: env.DOCUMENSO_NEXTAUTH_SECRET,
    NEXT_PRIVATE_ENCRYPTION_KEY: env.DOCUMENSO_ENCRYPTION_KEY,
    NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY: env.DOCUMENSO_ENCRYPTION_SECONDARY_KEY,
    NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS: env.DOCUMENSO_SIGNING_CERT_B64,
    NEXT_PRIVATE_SIGNING_PASSPHRASE: env.DOCUMENSO_SIGNING_PASSPHRASE,
    NEXT_PUBLIC_WEBAPP_URL: DOCUMENSO_ORIGIN,
    NEXT_PRIVATE_INTERNAL_WEBAPP_URL: 'http://localhost:3000',
    // Documenso runs `prisma migrate deploy` on every boot; the advisory lock times
    // out against Neon (P1002 → container start AbortError). All migrations are
    // already applied, so skipping the lock is a safe no-op that lets the server boot.
    PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: 'true',
    // Email via the native SES transport (reuses the AWS keys directly via the AWS
    // SDK — no fragile HMAC-derived SMTP password). From fields are transport-agnostic.
    NEXT_PRIVATE_SMTP_TRANSPORT: 'ses',
    NEXT_PRIVATE_SES_ACCESS_KEY_ID: env.AWS_ACCESS_KEY_ID,
    NEXT_PRIVATE_SES_SECRET_ACCESS_KEY: env.AWS_SECRET_ACCESS_KEY,
    NEXT_PRIVATE_SES_REGION: env.AWS_DEFAULT_REGION ?? 'us-east-1',
    NEXT_PRIVATE_SMTP_FROM_NAME: 'ProjectSites Sign',
    NEXT_PRIVATE_SMTP_FROM_ADDRESS: env.SES_FROM_EMAIL ?? 'noreply@projectsites.dev',
    // Document/PDF storage → Cloudflare R2 (S3-compatible) instead of the default
    // `database` transport that stuffs file bytes into Neon Postgres. Bucket
    // `documenso-documents`; creds are a scoped R2 API token (S3 key id + sha256 secret).
    NEXT_PUBLIC_UPLOAD_TRANSPORT: 's3',
    NEXT_PRIVATE_UPLOAD_ENDPOINT:
      'https://84fa0d1b16ff8086dd958c468ce7fd59.r2.cloudflarestorage.com',
    NEXT_PRIVATE_UPLOAD_BUCKET: 'documenso-documents',
    NEXT_PRIVATE_UPLOAD_REGION: 'auto',
    NEXT_PRIVATE_UPLOAD_FORCE_PATH_STYLE: 'true',
    NEXT_PRIVATE_UPLOAD_ACCESS_KEY_ID: env.DOCUMENSO_R2_ACCESS_KEY_ID,
    NEXT_PRIVATE_UPLOAD_SECRET_ACCESS_KEY: env.DOCUMENSO_R2_SECRET_ACCESS_KEY,
    // Bot protection on signup/signin (CF-minted widget for sign.projectsites.dev).
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4AAAAAADsCKASACuOGsrMY',
    NEXT_PRIVATE_TURNSTILE_SECRET_KEY: env.DOCUMENSO_TURNSTILE_SECRET_KEY,
    // Privacy + UX polish.
    DOCUMENSO_DISABLE_TELEMETRY: 'true',
    NEXT_PUBLIC_SUPPORT_EMAIL: 'support@projectsites.dev',
    // Raise the in-app upload limit to match the worker's 100 MB ceiling for
    // sign.* (Documenso defaults to 50 MB).
    NEXT_PUBLIC_DOCUMENT_SIZE_UPLOAD_LIMIT: '100',
    // Explicit local signing transport (we ship a self-signed P12 cert above).
    NEXT_PRIVATE_SIGNING_TRANSPORT: 'local',
    // Contact info embedded in the signed-PDF signature metadata.
    NEXT_PUBLIC_SIGNING_CONTACT_INFO: 'support@projectsites.dev',
    // Recipient for Documenso's internal/admin notifications.
    DOCUMENSO_INTERNAL_EMAIL: 'support@projectsites.dev',
    // Single-operator instance: lock open self-signup. Document SIGNERS never need
    // an account (they sign via emailed links); org members come in by invite. Flip
    // to remove this var if you want public signups.
    NEXT_PUBLIC_DISABLE_SIGNUP: 'true',
    // Google sign-in — DEDICATED Documenso OAuth client (383658000977-…), NOT the
    // shared worker GOOGLE_CLIENT_ID (796940060066-…, used by the main site). The
    // redirect URI https://sign.projectsites.dev/api/auth/callback/google is registered
    // on this client. Kept separate so the main site's Google OAuth is untouched.
    NEXT_PRIVATE_GOOGLE_CLIENT_ID: env.DOCUMENSO_GOOGLE_CLIENT_ID,
    NEXT_PRIVATE_GOOGLE_CLIENT_SECRET: env.DOCUMENSO_GOOGLE_CLIENT_SECRET,
    // Office→PDF conversion via the self-hosted Gotenberg container
    // (convert.projectsites.dev, basic-auth-gated). Lets users upload
    // .docx/.xlsx/.pptx and have Documenso convert them to PDF for signing.
    NEXT_PUBLIC_DOCUMENT_CONVERSION_ENABLED: 'true',
    NEXT_PRIVATE_DOCUMENT_CONVERSION_URL: 'https://convert.projectsites.dev',
    NEXT_PRIVATE_DOCUMENT_CONVERSION_USERNAME: env.GOTENBERG_AUTH_USERNAME,
    NEXT_PRIVATE_DOCUMENT_CONVERSION_PASSWORD: env.GOTENBERG_AUTH_PASSWORD,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pairs)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}

/**
 * Self-hosted Documenso e-signature server, one warm instance for the platform.
 *
 * @remarks
 * Container-backed DO → migrates on the SQLite backend via `new_sqlite_classes`
 * (CF API error 10074 rejects `new_classes` for any container DO), mirroring
 * `SiteBuilderContainer` + `InngestContainer`.
 *
 * @example
 * const id = env.DOCUMENSO_CONTAINER.idFromName('documenso-singleton');
 * return env.DOCUMENSO_CONTAINER.get(id).fetch(request);
 */
export class DocumensoContainer extends Container<Env> {
  override defaultPort = DOCUMENSO_PORT;
  override enableInternet = true;
  override sleepAfter = '1h';

  override async fetch(request: Request): Promise<Response> {
    try {
      // 3-positional-arg form — the ONLY shape @cloudflare/containers 0.3.2 (this
      // worker's pinned version) supports. First boot runs Prisma migrations →
      // long port-ready window.
      await this.startAndWaitForPorts(
        [DOCUMENSO_PORT],
        { portReadyTimeoutMS: 180_000 },
        { envVars: documensoEnvVars(this.env), enableInternet: true },
      );
    } catch (err) {
      return new Response(JSON.stringify({ error: `Documenso container start failed: ${err}` }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return super.fetch(request);
  }

  override async onStart(): Promise<void> {}
}
