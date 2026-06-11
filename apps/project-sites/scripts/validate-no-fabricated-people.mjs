#!/usr/bin/env node
// Fabricated-people detector — deterministic enforcement of the "Blank > faked"
// rule (rules/copy-writing.md § Fabricated-people build gate). Invented
// testimonials ship silently — they look plausible and pass every other
// validator. This gate flags a person-like `name:` LITERAL paired in the same
// object window with a TESTIMONIAL signal, UNLESS the name is allow-listed in
// `_confirmations.json` `confirmed_voices`.
//
// Scans projectsites' OWN hand-authored people-bearing surfaces (public/,
// marketing/, frontend/src). Generated site OUTPUT is a different shape
// (rendered <cite>, not `name:` object keys) so it is NOT matched here — that
// surface is a separate (design-bearing) concern for build_validators.
//
// Precise by design: staff directories (name + role, NO quote), citation
// authors, and blog posts (no name+role+body trio) are NOT flagged. Dynamic
// `name: t.name` (no string literal) is NOT matched — only hard-coded personas.
//
// Usage:  node scripts/validate-no-fabricated-people.mjs        (exit 1 on any hit)
//         node scripts/validate-no-fabricated-people.mjs --json
//
// Exported helpers (`scanForFabricatedPeople`, `walk`) are unit-tested in
// scripts/__tests__/validate_no_fabricated_people.test.mjs.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// A person-like literal: optional honorific + "First Last" OR "First L."
const PERSON =
  /^(?:(?:Rev|Dr|Fr|Mr|Mrs|Ms|Pastor|Sr|Sister|Br|Prof)\.? )?[A-Z][a-z]+(?: [A-Z][a-z]+| [A-Z]\.)$/;
// An organisation endorser token.
const ORG = /\b(?:Bank|Corp|Inc|LLC|Foundation|Company|University|Reserve|Group|Partners)\b/;
// `name: '<literal>'` / `name: "<literal>"` (NOT `name: t.name` — literal only).
const NAME_LITERAL = /\bname\s*:\s*(['"])([^'"]{2,60})\1/g;

const isPersona = (value) => PERSON.test(value) || ORG.test(value);

/**
 * Return an array of { name, signal } for every fabricated-persona object in
 * `content`, honouring the `confirmedVoices` allow-list. A hit is a person-like
 * `name:` literal whose surrounding object window also carries a testimonial
 * signal (`quote:`/`reviewBody:`/`testimonial:`, OR `body:` alongside
 * `role:`/`years:`).
 */
export function scanForFabricatedPeople(content, confirmedVoices = []) {
  const confirmed = new Set(confirmedVoices);
  const findings = [];
  NAME_LITERAL.lastIndex = 0;
  let m;
  while ((m = NAME_LITERAL.exec(content)) !== null) {
    const value = m[2];
    if (!isPersona(value) || confirmed.has(value)) continue;
    // Approximate "the same object window" by a bounded slice around the name —
    // small enough that a staff entry's sibling object doesn't bleed a quote in.
    const window = content.slice(Math.max(0, m.index - 200), m.index + 250);
    const quoteKey = window.match(/\b(quote|reviewBody|testimonial)\s*:/);
    let signal = null;
    if (quoteKey) {
      signal = quoteKey[1];
    } else if (/\bbody\s*:/.test(window) && /\b(role|years)\s*:/.test(window)) {
      signal = 'body+role/years';
    }
    if (signal) findings.push({ name: value, signal });
  }
  return findings;
}

export function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist')
        continue;
      yield* walk(full);
    } else if (
      entry.isFile() &&
      /\.(html|ts|tsx)$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      yield full;
    }
  }
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..');
  let confirmed = [];
  const confPath = join(root, '_confirmations.json');
  if (existsSync(confPath)) {
    try {
      confirmed = JSON.parse(readFileSync(confPath, 'utf8')).confirmed_voices ?? [];
    } catch {
      confirmed = [];
    }
  }
  const findings = [];
  for (const surface of ['public', 'marketing', join('frontend', 'src')]) {
    for (const file of walk(join(root, surface))) {
      for (const hit of scanForFabricatedPeople(readFileSync(file, 'utf8'), confirmed)) {
        findings.push({ file: file.replace(`${root}/`, ''), ...hit });
      }
    }
  }

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ ok: findings.length === 0, findings }, null, 2) + '\n');
  } else if (findings.length === 0) {
    process.stdout.write('✓ validate-no-fabricated-people: no unconfirmed testimonial personas\n');
  } else {
    process.stderr.write(
      `✗ validate-no-fabricated-people: ${findings.length} unconfirmed persona(s) with a testimonial signal:\n`,
    );
    for (const f of findings) process.stderr.write(`  ${f.file}  "${f.name}" (${f.signal})\n`);
    process.stderr.write(
      '\nBlank > faked. Remove the persona, or add the name to _confirmations.json `confirmed_voices` ONLY when the testimonial is collected with permission AND verified.\n',
    );
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
