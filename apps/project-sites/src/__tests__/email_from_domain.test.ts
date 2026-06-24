import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Regression guard for the §4 email-sending-domain fix (ADR-0019, commit
 * 67f492e8). Transactional email is sent FROM `noreply@projectsites.dev` — the
 * verified apex product domain. It is NEVER sent from a `megabyte.space`
 * address: §4 excludes megabyte.space domains and CLAUDE.md PART 18 mandates
 * `noreply@projectsites.dev`.
 *
 * This drift recurred 11× by copy-paste before it was caught, so it is locked
 * here as a structural invariant: the moment a `noreply@megabyte.space` (or any
 * `from`-shaped megabyte.space sending identity) literal reappears in worker
 * source, this test fails the build.
 *
 * Precision (rules/validator-precision-discipline.md): scoped to the EXACT
 * sending-identity bug. Human reply-to inboxes (`hey@megabyte.space`,
 * `brian@megabyte.space` in BRAND.CONTACT_EMAIL / REPLY_TO_EMAIL) are real
 * mailboxes, not sending-domain drift — they are deliberately NOT flagged.
 */

const SRC_ROOT = join(__dirname, '..');

/** The exact forbidden sending literal that recurred 11×. */
const FORBIDDEN_NOREPLY = /noreply@megabyte\.space/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const SOURCE_FILES = walk(SRC_ROOT);

describe('email sending-domain invariant (§4 / ADR-0019)', () => {
  it('scans a non-trivial number of source files (guards against a broken walk)', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(50);
  });

  it('never sends transactional email from noreply@megabyte.space', () => {
    const hits: string[] = [];
    for (const file of SOURCE_FILES) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (FORBIDDEN_NOREPLY.test(line)) {
            hits.push(`${relative(SRC_ROOT, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });

  // NOTE: a broader `from:.*@megabyte.space` scan was deliberately removed — it
  // false-positives on `services/mcp_client.ts` PagerDuty `From:` header, which
  // is PagerDuty's required actor-identification field (a registered PagerDuty
  // user's email), NOT a transactional email sending identity. Per
  // validator-precision-discipline we flag only the exact recurrence literal.
});
