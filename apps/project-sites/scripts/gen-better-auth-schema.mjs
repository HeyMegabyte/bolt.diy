#!/usr/bin/env node
/**
 * gen-better-auth-schema.mjs — generate the Better Auth D1 schema migration.
 *
 * Better Auth's runtime auto-migration fails on Cloudflare D1 (kysely-d1 has no
 * introspection), so the schema must be a STATIC migration. This generates it
 * OFFLINE against a local SQLite (where introspection works) via Better Auth's
 * own `getMigrations(...).compileMigrations()`, so the output exactly matches the
 * configured plugin set — no hand-authored drift.
 *
 * KEEP THE PLUGIN LIST BELOW IN SYNC WITH src/auth/better-auth.ts. If you add/
 * remove a schema-affecting plugin there, re-run this and ship a new migration.
 *
 *   npm i --no-save better-sqlite3 --legacy-peer-deps
 *   node scripts/gen-better-auth-schema.mjs > /tmp/ba-schema.sql
 */
import { betterAuth } from 'better-auth';
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
} from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { passkey } from '@better-auth/passkey';
import { sso } from '@better-auth/sso';
import { apiKey } from '@better-auth/api-key';
import { getMigrations } from 'better-auth/db/migration';
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';

// Access control — identical to src/auth/better-auth.ts.
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

const db = new Kysely({ dialect: new SqliteDialect({ database: new Database(':memory:') }) });

// Same schema-affecting config as makeAuth(). Runtime callbacks are stubbed —
// they do not affect the generated tables. captcha is omitted (no schema).
const auth = betterAuth({
  appName: 'ProjectSites',
  baseURL: 'https://projectsites.dev',
  basePath: '/api/auth',
  secret: 'x'.repeat(40),
  database: { db, type: 'sqlite' },
  emailAndPassword: { enabled: true, requireEmailVerification: true },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google', 'github'],
      allowDifferentEmails: false,
    },
  },
  plugins: [
    magicLink({ sendMagicLink: async () => {} }),
    emailOTP({ sendVerificationOTP: async () => {} }),
    twoFactor({ issuer: 'ProjectSites' }),
    organization({ ac, roles: { owner: ownerRole, admin: adminRole, member: memberRole } }),
    admin(),
    anonymous(),
    username(),
    multiSession(),
    oneTap(),
    haveIBeenPwned(),
    passkey({ rpID: 'projectsites.dev', rpName: 'ProjectSites', origin: 'https://projectsites.dev' }),
    sso(),
    apiKey(),
  ],
});

const { compileMigrations } = await getMigrations(auth.options);
if (typeof compileMigrations !== 'function') {
  console.error('compileMigrations not available — better-auth version mismatch');
  process.exit(1);
}
const sql = await compileMigrations();
process.stdout.write(sql.trim() + '\n');
