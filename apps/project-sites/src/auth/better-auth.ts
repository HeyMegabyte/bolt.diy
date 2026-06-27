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
 * username, email-OTP, Google One-Tap, multi-session, WebAuthn passkeys (#28),
 * enterprise SSO/SAML (#27), and org-scoped API keys (#22).
 *
 * Session-creation is observed across three best-effort sinks — D1 audit,
 * Analytics Engine, and PostHog (#42) — each carrying the session IP + user-agent
 * as the data foundation for new-device / impossible-travel detection (#44).
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
import { passkey } from '@better-auth/passkey'; // #28 WebAuthn passkeys
import { sso } from '@better-auth/sso'; // #27 enterprise SSO/SAML+OIDC
import { apiKey } from '@better-auth/api-key'; // #22 org-scoped API keys
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
    socialProviders: {
      // #30 — Google + GitHub social (added when creds present).
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {}),
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
        : {}),
    },

    // #10 — account-linking safety: link only same-email accounts (no different-email
    // takeover); social providers are trusted only for matching, verified emails.
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google', 'github'],
        allowDifferentEmails: false,
      },
    },

    // #12/#40/#42/#44 — observe every session creation across three sinks, all
    // best-effort (a telemetry failure must NEVER block sign-in):
    //   • D1 audit log (durable, queryable per-user trail)
    //   • Analytics Engine (high-volume sampling; cheap funnel counts)
    //   • PostHog (#42 — the auth funnel + session-replay correlation)
    // The session row carries `ipAddress` + `userAgent` (Better Auth defaults);
    // threading them through every sink is the data foundation for #44
    // impossible-travel / new-device detection (a downstream query compares a
    // user's session IP/UA history — no per-request geo lookup needed here).
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            const s = session as {
              userId?: string;
              ipAddress?: string;
              userAgent?: string;
            };
            const userId = s.userId ?? 'unknown';
            const ipAddress = s.ipAddress ?? '';
            const userAgent = s.userAgent ?? '';
            try {
              env.ANALYTICS?.writeDataPoint({
                blobs: ['auth.session.created', userId, ipAddress, userAgent],
                indexes: ['auth'],
                doubles: [1],
              });
            } catch {
              /* analytics is best-effort */
            }
            try {
              const { captureEvent } = await import('../services/analytics.js');
              await captureEvent(env, 'auth.session.created', userId, {
                $ip: ipAddress || undefined,
                ip_address: ipAddress || undefined,
                user_agent: userAgent || undefined,
                auth_provider: 'better_auth',
              });
            } catch {
              /* PostHog is best-effort (#42) */
            }
            try {
              const { writeAuditLog } = await import('../services/audit.js');
              await writeAuditLog(env.DB, {
                org_id: 'system',
                actor_id: userId,
                action: 'auth.session.created',
                message: `Better Auth session created${ipAddress ? ` from ${ipAddress}` : ''}`,
                target_type: 'user',
                target_id: userId,
              });
            } catch {
              /* audit is best-effort — never block sign-in */
            }
          },
        },
      },
    },

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
        // #19 — gate org creation: require a verified email (Stripe-entitlement check
        // layers on once BA users link to billing post-migration).
        allowUserToCreateOrganization: async (user) =>
          Boolean((user as { emailVerified?: boolean }).emailVerified),
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
      passkey({ rpID: 'projectsites.dev', rpName: 'ProjectSites', origin: APP_ORIGIN }), // #28
      sso(), // #27 — enterprise SSO/SAML (org-scoped IdP; replaces the deleted WorkOS)
      apiKey(), // #22 — org-scoped API keys for the MCP/public-API surface
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
