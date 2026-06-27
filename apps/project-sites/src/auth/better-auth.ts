/**
 * @module auth/better-auth
 *
 * @description
 * EMBEDDED Better Auth for the main worker (ADR-0006). Runs IN this worker on the
 * MAIN D1 (env.DB, Kysely D1 dialect) and OWNS sessions. CF-native: D1 = system of
 * record, KV (CACHE_KV) = session/rate-limit secondary storage, Turnstile = CAPTCHA.
 * Mounted DARK behind the `better_auth` flag (see index.ts).
 *
 * Hardening + plugins (CF-native improvement plan; memory better-auth-cf-gotchas):
 * cookieCache DISABLED (#4203), KV secondaryStorage with a >=60s TTL floor (#7124),
 * KV-backed rate limiting, email-verification (enumeration protection), HaveIBeenPwned
 * breach check, organizations + access-control, admin/impersonation, anonymous,
 * username, email-OTP, Google One-Tap, multi-session. Passkeys + SSO/SAML + org API
 * keys land in a follow-up slice (separate plugin installs).
 */
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import {
  magicLink,
  twoFactor,
  admin,
  anonymous,
  username,
  haveIBeenPwned,
  multiSession,
  oneTap,
  emailOTP,
  organization,
  captcha,
} from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import type { Env } from '../types/env.js';
import { getEmailProvider } from '../platform/email-router.js';

const APP_ORIGIN = 'https://projectsites.dev';

// Access control (#20) — granular, tenant-scoped permissions.
const ac = createAccessControl({
  site: ['create', 'publish', 'delete'],
  domain: ['manage'],
  billing: ['read', 'manage'],
  member: ['invite', 'remove'],
});
const ownerRole = ac.newRole({
  site: ['create', 'publish', 'delete'],
  domain: ['manage'],
  billing: ['read', 'manage'],
  member: ['invite', 'remove'],
});
const adminRole = ac.newRole({
  site: ['create', 'publish'],
  domain: ['manage'],
  billing: ['read'],
  member: ['invite', 'remove'],
});
const memberRole = ac.newRole({ site: ['create'] });

type Auth = ReturnType<typeof betterAuth>;
let cached: Auth | undefined;

export function makeAuth(env: Env): Auth {
  if (cached) return cached;
  const db = new Kysely({ dialect: new D1Dialect({ database: env.DB }) });
  const kv = env.CACHE_KV;

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

    secondaryStorage: {
      get: (key) => kv.get(`ba:${key}`),
      set: async (key, value, ttl) => {
        await kv.put(`ba:${key}`, value, { expirationTtl: Math.max(ttl ?? 60, 60) });
      },
      delete: async (key) => {
        await kv.delete(`ba:${key}`);
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },

    rateLimit: { enabled: true, window: 10, max: 100, storage: 'secondary-storage' },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await sendMail(
          user.email,
          'Reset your ProjectSites password',
          `<p>Reset your password:</p><p><a href="${url}">${url}</a></p>`,
        );
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendMail(
          user.email,
          'Verify your ProjectSites email',
          `<p>Confirm your email:</p><p><a href="${url}">${url}</a></p>`,
        );
      },
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : undefined,

    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendMail(
            email,
            'Your ProjectSites sign-in link',
            `<p>Sign in:</p><p><a href="${url}">${url}</a></p><p>Expires in 5 minutes.</p>`,
          );
        },
      }),
      emailOTP({
        sendVerificationOTP: async ({ email, otp }) => {
          await sendMail(email, 'Your ProjectSites code', `<p>Your code: <b>${otp}</b></p>`);
        },
      }),
      twoFactor({ issuer: 'ProjectSites' }),
      organization({
        ac,
        roles: { owner: ownerRole, admin: adminRole, member: memberRole },
        allowUserToCreateOrganization: async () => true,
      }),
      admin(),
      anonymous(),
      username(),
      multiSession(),
      oneTap(),
      haveIBeenPwned({
        customPasswordCompromisedMessage:
          'This password has appeared in a breach — choose another.',
      }),
      ...(env.TURNSTILE_SECRET_KEY
        ? [captcha({ provider: 'cloudflare-turnstile', secretKey: env.TURNSTILE_SECRET_KEY })]
        : []),
    ],
  };

  cached = betterAuth(options);
  return cached;
}

let migrated = false;

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

export function _resetAuthCache(): void {
  cached = undefined;
  migrated = false;
}
