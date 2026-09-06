// check-count-noun-agreement.mjs — build gate for the count-noun agreement class.
//
// A DYNAMIC count interpolation followed by a HARDCODED plural noun renders "1 tokens" /
// "1 results" / "1 days" at count=1 — a grammar bug every single-item org sees. It has bitten
// 3× (api-tokens AL-082, logs-explorer + analytics AL-083). The fix is a signal ternary
// (`{{ n === 1 ? 'result' : 'results' }}`); this gate fails the build if the anti-pattern
// reappears in any admin section template.
//
// PRECISION (validator-precision-discipline — prefer false-negatives): flags ONLY a count that
// is genuinely DYNAMIC (`.length` in a `{{ }}` interpolation OR in a rolling-counter [value])
// immediately followed by a BARE plural noun from a countable allowlist. A STATIC number
// ("30 days" filter label) has no `.length` → never flagged. A pluralized count puts the noun
// INSIDE a `{{ … ? 'x' : 'xs' }}` (not bare) → never flagged. Exit 1 on any hit.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SECTIONS = resolve(HERE, '../src/app/pages/admin/sections');

// Nouns that take a count and would read wrong at 1. Kept specific to avoid false positives.
const NOUNS = 'results?|tokens?|days?|items?|sites?|events?|members?|invites?|endpoints?|snapshots?|assets?|connections?|submissions?|matches|leads?|posts?|calls?|records?|pages?|visits?|domains?|keys?|scopes?';
// A dynamic count: {{ …something.length… }}  OR  a rolling-counter whose [value] contains .length
const COUNT = String.raw`(?:\{\{[^}]*\.length[^}]*\}\}|<app-rolling-counter[^>]*\[value\]="[^"]*\.length[^"]*"[^>]*\/?>)`;
// …immediately followed (only whitespace / &nbsp; / a closing tag between) by a BARE plural noun
// (i.e. NOT opening another `{{`), where that noun is plural (ends in the plural form).
const RE = new RegExp(String.raw`${COUNT}\s*(?:&nbsp;|</[a-z-]+>|\s)*\b(${NOUNS})\b`, 'i');

const violations = [];
for (const f of readdirSync(SECTIONS)) {
  if (!f.endsWith('.component.ts')) continue; // templates live in the component .ts
  const src = readFileSync(resolve(SECTIONS, f), 'utf8');
  src.split('\n').forEach((line, i) => {
    const m = RE.exec(line);
    if (!m) return;
    const noun = m[1];
    // Only a PLURAL bare noun is a bug (a lone singular after a count is unusual but not this class).
    // The regex's NOUNS allows singular/plural; require the matched token to be plural (ends s / 'matches').
    const isPlural = /s$/i.test(noun) || /^matches$/i.test(noun);
    if (!isPlural) return;
    violations.push({ file: f, line: i + 1, text: line.trim().slice(0, 120), noun });
  });
}

if (violations.length) {
  console.error(`count-noun-agreement check FAILED — ${violations.length} dynamic count(s) with a hardcoded plural noun (reads "1 ${violations[0].noun}" at count=1):`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}  …${v.noun}  —  ${v.text}`);
  console.error(`Fix: pluralize with a ternary, e.g. {{ n }} {{ n === 1 ? 'result' : 'results' }}.`);
  process.exit(1);
}
console.log('count-noun-agreement check PASSED — no dynamic count paired with a hardcoded plural noun.');
