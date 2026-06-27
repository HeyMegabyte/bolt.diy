/**
 * @module auth/better-auth
 *
 * @description
 * EMBEDDED Better Auth instance for the main worker (Phase 1 of the full Better Auth
 * cutover — ADR-0006 rev). Better Auth runs IN this worker on the MAIN D1 (`env.DB`)
 * via the Kysely D1 dialect and OWNS sessions directly. Its tables are singular
 * (`user`/`session`/`account`/`verification` + plugin tables), distinct from the
 * legacy custom-auth `users`/`sessions` (plural), so they coexist during migration.
 *
 * Methods (Brian directive 2026-06-27): email+password, magic link, Google social,
 * passkeys (WebAuthn), and TOTP two-factor. SSO/SAML (to replace WorkOS) lands in a
 * later phase. Mounted DARK behind the `better_auth` flag until cutover — see
 * `index.ts` (`/api/auth/*` falls through to the legacy auth while the flag is off).
 *
 * @see middleware/feature-evaluation.ts (the `better_auth` flag gate)
 * @see services/auth.ts (the legacy magic-link/Google/D1-session path being replaced)
 */
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { magicLink, twoFactor } from 'better-auth/plugins';
// NOTE: passkey (WebAuthn) lands in its own slice — the plugin is a separate install
// in better-auth 1.6.x and the WebAuthn ceremony needs dedicated frontend work.
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import type { Env } from '../types/env.js';
import { getEmailProvider } from '../platform/email-router.js';

const APP_ORIGIN = 'https://projectsites.dev';

type Auth = ReturnType<typeof betterAuth>;

/** Build (and per-isolate cache) the embedded Better Auth instance for this env. */
let cached: Auth | undefined;

export function makeAuth(env: Env): Auth {
  if (cached) return cached;
  const db = new Kysely({ dialect: new D1Dialect({ database: env.DB }) });

  const sendMail = async (to: string, subject: string, html: string): Promise<void> => {
    try {
      await getEmailProvider(env).sendTransactional({ to, subject, html, kind: 'security' });
    } catch (err) {
      console.warn(
        JSON.stringify({ level: 'warn', msg: 'better-auth email send failed', err: String(err) }),
      );
    }
  };

  const options: BetterAuthOptions = {
    appName: 'ProjectSites',
    baseURL: APP_ORIGIN,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET ?? 'dev-insecure-secret-set-BETTER_AUTH_SECRET',
    database: { db, type: 'sqlite' },
    trustedOrigins: [APP_ORIGIN, 'https://editor.projectsites.dev'],
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        await sendMail(
          user.email,
          'Reset your ProjectSites password',
          `<p>Reset your password:</p><p><a href="${url}">${url}</a></p>`,
        );
      },
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : undefined,
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendMail(
            email,
            'Your ProjectSites sign-in link',
            `<p>Sign in to ProjectSites:</p><p><a href="${url}">${url}</a></p><p>This link expires in 5 minutes.</p>`,
          );
        },
      }),
      twoFactor({ issuer: 'ProjectSites' }),
    ],
  };

  cached = betterAuth(options);
  return cached;
}

let migrated = false;

/**
 * Apply Better Auth's schema to the main D1 once per isolate (idempotent CREATE
 * TABLE — singular `user`/`session`/`account`/`verification` + plugin tables, no
 * collision with the legacy plural tables). Runs only on the flag-gated BA path,
 * so it never touches the hot path while Better Auth ships dark. Fail-soft.
 */
export async function ensureBetterAuthSchema(env: Env): Promise<void> {
  if (migrated) return;
  try {
    const { getMigrations } = await import('better-auth/db/migration');
    const { runMigrations } = await getMigrations(makeAuth(env).options);
    await runMigrations();
    migrated = true;
  } catch (err) {
    console.warn(
      JSON.stringify({ level: 'warn', msg: 'better-auth migrate skipped', err: String(err) }),
    );
    migrated = true;
  }
}

/** Reset the per-isolate caches (tests only). */
export function _resetAuthCache(): void {
  cached = undefined;
  migrated = false;
}
