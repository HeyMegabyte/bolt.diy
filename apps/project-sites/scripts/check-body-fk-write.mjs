#!/usr/bin/env node
/**
 * check-body-fk-write.mjs — body-supplied FK-write TRIAGE tripwire (the 4th IDOR guard).
 *
 * The 3 existing IDOR detectors miss the class where a create/update handler stores a
 * BODY-supplied `*_id` FK (`X_id: body.X_id`) WITHOUT verifying the caller owns the
 * referenced parent — the cross-owner FK injection fixed in the calendar EVENTS create
 * (iter-162) and its BOOKINGS sibling (iter-177):
 *
 *   `POST /api/calendar/bookings` stored `calendar_id: body.calendar_id` with no check →
 *   an authed user could attach a booking-link to ANOTHER user's calendar. The path-param
 *   IDOR detector is blind (the id is a BODY field, not a `:param`); the body-slug-write
 *   detector is blind (it's a D1 relational write, not an R2 site-file write).
 *
 * Precise via an ALLOWLIST-as-triage-registry (per validator-precision-discipline — prefer
 * FALSE-NEGATIVES): every body-`*_id` field CURRENTLY stored has been triaged (gated with an
 * ownership SELECT, or safe because the row is org-scoped / the id is a grouping-label /
 * session-key / a suggestion re-validated at its consumer). A NEW un-triaged body-`*_id`
 * store → FLAGGED: the author must EITHER add an ownership `SELECT … WHERE id=? AND
 * user_id/org_id=?` (a real cross-tenant FK) OR add it to {@link ALLOWLIST} with a one-line
 * reason (a safe label). Allowlisted fields never fire; the current tree is clean.
 *
 * A gated handler does NOT trip: the events/bookings creates read `body.calendar_id` into a
 * local (`let calendarId = body.calendar_id`) or gate BEFORE the insert, and the pattern
 * matched here is the direct `X_id: body.X_id` store — so allowlisting `calendar_id` is
 * belt-and-suspenders, documenting that it IS gated.
 *
 * Exit 0 by default (report). Pass `--ci` to exit 1 on any un-triaged finding.
 * Usage: node scripts/check-body-fk-write.mjs [--ci] [--json]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

/**
 * Triage registry: every body-supplied `*_id` field name currently stored via
 * `X_id: body.X_id`, with the reason it is NOT a cross-owner IDOR. Adding a field here is
 * an explicit assertion that a foreign value is harmless (or that the handler gates it).
 * @type {Record<string, string>}
 */
export const ALLOWLIST = {
  calendar_id:
    'GATED — the events (iter-162) + bookings (iter-177) creates SELECT calendar_calendars WHERE id=? AND user_id=? → 404 when unowned.',
  thread_id:
    'grouping label on the org-scoped pulse_posts row (org_id=ctx.orgId); every read is org-scoped, so a foreign value labels only the caller-owned row.',
  site_id:
    'metadata on org-scoped rows; consumers org-scope and never use it to reach site-scoped data cross-tenant (social.ts:374 echoes it in an org-scoped read).',
  suggestion_id:
    'benign per-search analytics reference (domain_purchase); grants no cross-tenant access.',
  preselected_template_id:
    'a suggestion only — re-validated at INSTALL by templates.ts (visibility IN (public,unlisted) AND status=live) OR author_org_id=?; a foreign private id is rejected at use.',
  chat_id:
    'opaque editor session key in the bolt_chat_state (slug,chat_id) composite PK; gated by isBoltCallerAllowed + the path-param slug, not a cross-tenant FK.',
  commit_id:
    'GATED — /api/sites/:siteId/snapshots/revert requireOwnedSite(siteId) THEN revertToSnapshot(site.slug, commit_id) resolves the commit WITHIN the owned site’s own R2 git store; a foreign commit isn’t in that repo.',
  component_id:
    'a UI-component label on the org-scoped site_dna feedback row (recordDnaFeedback scopes by orgId); a foreign value labels only the caller-owned row.',
  channel_id:
    'external platform (Telegram/Discord) channel id supplied during social connect — the user’s OWN channel, stored as connection metadata, not an internal FK.',
  stripe_charge_id:
    'super-admin route (superAdmin.use(/api/super-admin/*, requireSuperAdmin)) — operates cross-tenant by design.',
  target_user_id:
    'super-admin route (requireSuperAdmin) — acting on any user is the intended cross-tenant behaviour.',
  voice_voice_id:
    'external TTS provider voice id (ElevenLabs/OpenAI), not an internal FK; the handler requireSiteMembership-gates the siteId it writes to.',
};

/**
 * Self-scope columns that are the CALLER's own identity, not a referenced parent FK. A
 * `org_id: body.org_id` / `user_id: body.user_id` store is the SEPARATE x-org-id class
 * (owned by the auth middleware — orgId must come from `c.get('orgId')`, never the body);
 * this detector intentionally does not double-report it.
 * @type {ReadonlySet<string>}
 */
const SELF_SCOPE = new Set([
  'org_id',
  'user_id',
  'tenant_id',
  'created_by',
  'owner_id',
  'author_org_id',
]);

/** `X_id: body.X_id` (also data/parsed/input) — a body-supplied FK stored into a record literal. */
const STORE_RE = /\b([a-z][a-z0-9_]*_id)\s*:\s*(?:body|data|parsed|input)\.\1\b/g;

/**
 * Enumerate body-`*_id` FK stores in a source text. Pure — no I/O — so it's unit-testable.
 * @param {string} text - source of a route/handlers file.
 * @returns {{ field: string, index: number }[]} one entry per `X_id: body.X_id` occurrence.
 */
export function scanText(text) {
  const out = [];
  let m;
  STORE_RE.lastIndex = 0;
  while ((m = STORE_RE.exec(text)) !== null) {
    if (SELF_SCOPE.has(m[1])) continue;
    out.push({ field: m[1], index: m.index });
  }
  return out;
}

/**
 * Which stored body-FK fields are NOT triaged (not in {@link ALLOWLIST}). Pure.
 * @param {string} text
 * @returns {{ field: string, index: number }[]}
 */
export function untriaged(text) {
  return scanText(text).filter((h) => !Object.prototype.hasOwnProperty.call(ALLOWLIST, h.field));
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === '__tests__' || ent.name === 'node_modules') continue;
      out.push(...walk(p));
    } else if (
      ent.name.endsWith('.ts') &&
      !ent.name.endsWith('.d.ts') &&
      !ent.name.endsWith('.test.ts')
    ) {
      out.push(p);
    }
  }
  return out;
}

function run() {
  const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
  const SCAN_DIRS = [join(APP_DIR, 'src', 'routes'), join(APP_DIR, 'libs')];
  const findings = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      const text = readFileSync(file, 'utf8');
      const rel = relative(APP_DIR, file);
      for (const h of untriaged(text)) {
        const line = text.slice(0, h.index).split('\n').length;
        findings.push({ file: rel, line, field: h.field });
      }
    }
  }

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ total: findings.length, findings }, null, 2) + '\n');
  } else if (findings.length === 0) {
    console.log(
      '✅ check-body-fk-write: clean — every body-supplied `*_id` FK stored in a create/update handler is triaged (gated or documented-safe).',
    );
  } else {
    console.log(
      `🔒 check-body-fk-write: ${findings.length} UN-TRIAGED body-supplied FK write(s) — each is either a cross-owner IDOR or a safe label:`,
    );
    for (const f of findings) console.log(`   ${f.field.padEnd(22)} (${f.file}:${f.line})`);
    console.log(
      '   Fix: add an ownership SELECT (… WHERE id=? AND user_id/org_id=? → 404 when unowned) for a real FK,\n' +
        '   OR add the field to ALLOWLIST in scripts/check-body-fk-write.mjs with a one-line reason it is safe.',
    );
  }
  process.exit(process.argv.includes('--ci') && findings.length > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
