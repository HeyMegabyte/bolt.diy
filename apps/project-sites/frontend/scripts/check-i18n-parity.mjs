#!/usr/bin/env node
/**
 * check-i18n-parity.mjs — fail the build when a USED en translation key has no es translation.
 *
 * The app is bilingual (en + es, `@ngx-translate`, `fallbackLang: 'en'`). A key
 * present in `en.json` but MISSING from `es.json` silently falls back to English on
 * the ES locale — a Spanish visitor sees an untranslated string. This is the
 * drift-detection "untranslated strings / UI string not run through i18n" class.
 *
 * The gate is scoped to LIVE impact: it flags only en keys that are ACTUALLY USED in
 * a component (the flattened key string appears in a `src/app` `.ts`/`.html` — via
 * `'key' | translate`, `translate.instant('key')`, `[attr.x]="'key' | translate"`,
 * etc.) yet are absent from es.json. An en-only key that NO component references is a
 * dead/built-ahead key (a different, non-user-facing class) — reported as an advisory
 * note, never a build failure. Per validator-precision-discipline this prefers
 * false-negatives: a dynamically-built key (`'admin.' + x`) isn't detected as used, so
 * it won't flag (catch those with the chaos-6 ES-toggle browser test).
 *
 * Run via `npm run check:i18n-parity` or as a pre-build gate (`build:prod`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SRC = join(ROOT, 'src', 'app');
const EN = join(ROOT, 'src', 'assets', 'i18n', 'en.json');
const ES = join(ROOT, 'src', 'assets', 'i18n', 'es.json');

/** Flatten a nested translation object into dotted leaf keys. Pure. */
export function flattenKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flattenKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

/**
 * Partition en keys missing from es into USED (live untranslated → violation) and
 * UNUSED (dead/built-ahead → advisory). Pure — no I/O — so it's unit-testable.
 * @param {string[]} enKeys - flattened en.json keys.
 * @param {Set<string>} esKeys - flattened es.json key set.
 * @param {(key: string) => boolean} isUsed - true when the key string appears in src.
 * @returns {{ usedMissing: string[], unusedMissing: string[] }}
 */
export function classifyMissing(enKeys, esKeys, isUsed) {
  const usedMissing = [];
  const unusedMissing = [];
  for (const key of enKeys) {
    if (esKeys.has(key)) continue;
    (isUsed(key) ? usedMissing : unusedMissing).push(key);
  }
  return { usedMissing, unusedMissing };
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.angular') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (/\.(ts|html)$/.test(entry) && !/\.spec\.ts$/.test(entry)) yield full;
  }
}

function main() {
  const enKeys = flattenKeys(JSON.parse(readFileSync(EN, 'utf8')));
  const esKeys = new Set(flattenKeys(JSON.parse(readFileSync(ES, 'utf8'))));
  let blob = '';
  for (const file of walk(SRC)) blob += readFileSync(file, 'utf8');
  const { usedMissing, unusedMissing } = classifyMissing(enKeys, esKeys, (k) => blob.includes(k));

  if (unusedMissing.length) {
    process.stdout.write(
      `i18n-parity note — ${unusedMissing.length} en-only key(s) are UNUSED (dead/built-ahead, not a build failure): ${unusedMissing.slice(0, 6).join(', ')}${unusedMissing.length > 6 ? ', …' : ''}\n`,
    );
  }
  if (usedMissing.length) {
    process.stderr.write(
      `\ni18n-parity check FAILED — ${usedMissing.length} USED en key(s) have NO es translation (untranslated on ES → English fallback):\n`,
    );
    for (const k of usedMissing) process.stderr.write(`  ${k}\n`);
    process.stderr.write("  Fix: add the Spanish translation to src/assets/i18n/es.json.\n");
    process.exit(1);
  }
  process.stdout.write(
    'i18n-parity check PASSED — every USED en translation key has an es translation.\n',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
