#!/usr/bin/env node
/**
 * check-fabricated-kit-defaults.mjs — anti-fabrication detector for site-kit primitives.
 *
 * The site-kit components (`frontend/src/app/site-kit/*.component.ts`) are generator
 * primitives: a generated business site renders `<sk-pricing-table>`, `<sk-faq-accordion>`,
 * `<sk-menu-board>`, `<sk-testimonials-grid>`, … and the AI build fills them with the
 * business's REAL data. If a kit component ships a *populated array literal* as an
 * `@Input()` DEFAULT, that fabricated demo content (fake prices, fake FAQ Q&A + fake
 * FAQPage JSON-LD, fake menu items, fake property listings, invented testimonials/stats)
 * renders VERBATIM on a real business's live site whenever the consumer forgets to pass
 * real data — a silent trust/anti-fabrication violation that passes every render gate.
 *
 * The rule this enforces: a kit primitive's array-typed `@Input()` default MUST be `[]`
 * (empty → the component self-hides via `*ngIf="arr.length"`), never a demo array. The
 * consumer/generator supplies real, permission-collected data. (companion to
 * validate-no-fabricated-people.mjs, which catches the person+quote sub-class; this
 * catches ALL populated array defaults — pricing/menu/listings/faq/features/…)
 *
 * Precise by design (per validator-precision-discipline — prefers false-negatives):
 *   - Flags ONLY `@Input() name … = [ <non-empty> ]`. An empty `= []` default passes.
 *   - Scalar string/number defaults (section headings, CTA labels) are NOT flagged —
 *     those are legit generic labels, not fabricated business facts.
 *   - `*.stories.ts` (Storybook demo data) + `*.spec.ts` + `__tests__` are excluded.
 *
 * Exit 0 by default (report-only / audit-arc "Surface" step). Pass `--ci` to exit 1 on
 * any finding once the surface is stable at zero (it is, as of the fire that added this).
 *
 * Usage: node scripts/check-fabricated-kit-defaults.mjs [--ci] [--json]
 *
 * Exported helpers (`scanForPopulatedArrayDefaults`, `walk`) are unit-tested in
 * scripts/__tests__/check_fabricated_kit_defaults.test.mjs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_KIT_DIR = join(APP_DIR, 'frontend', 'src', 'app', 'site-kit');

// `@Input() prop[: Type] = [` — capture the prop name and the position of the `[`.
// The optional type annotation `[^=;{}]*?` covers `Foo[]` / `string[]` / `Record<…>`
// (no `=`/`;`/`{`/`}` in a type) and is lazy so it stops at the initializer's `=`.
const INPUT_ARRAY_DEFAULT = /@Input\(\)\s+([\w$]+)\s*(?::[^=;{}]*?)?=\s*\[/g;

/**
 * Return `[{ prop, preview }]` for every `@Input()` whose DEFAULT is a NON-EMPTY array
 * literal in `content`. An empty `= []` (or `= [ ]` / `= [\n]`) default is skipped.
 */
export function scanForPopulatedArrayDefaults(content) {
  const findings = [];
  INPUT_ARRAY_DEFAULT.lastIndex = 0;
  let m;
  while ((m = INPUT_ARRAY_DEFAULT.exec(content)) !== null) {
    const prop = m[1];
    // First meaningful char after the opening `[` — `]` ⇒ empty (OK), else populated.
    let i = m.index + m[0].length;
    while (i < content.length && /\s/.test(content[i])) i++;
    if (content[i] === ']') continue;
    const line = content.slice(0, m.index).split('\n').length;
    const preview = content
      .slice(m.index + m[0].length, m.index + m[0].length + 64)
      .replace(/\s+/g, ' ')
      .trim();
    findings.push({ prop, line, preview });
  }
  return findings;
}

/** Recursively yield site-kit `*.component.ts` files (skip stories/specs/__tests__). */
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
      entry.name.endsWith('.component.ts') &&
      !/\.(spec|stories)\.ts$/.test(entry.name)
    ) {
      yield full;
    }
  }
}

function main() {
  const findings = [];
  for (const file of walk(SITE_KIT_DIR)) {
    for (const hit of scanForPopulatedArrayDefaults(readFileSync(file, 'utf8'))) {
      findings.push({ file: relative(APP_DIR, file), ...hit });
    }
  }

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ ok: findings.length === 0, findings }, null, 2) + '\n');
  } else if (findings.length === 0) {
    process.stdout.write('✓ check-fabricated-kit-defaults: no populated array @Input() defaults\n');
  } else {
    process.stderr.write(
      `✗ check-fabricated-kit-defaults: ${findings.length} kit component(s) ship a populated array @Input() default:\n`,
    );
    for (const f of findings) process.stderr.write(`  ${f.file}:${f.line}  @Input() ${f.prop} = [${f.preview}…\n`);
    process.stderr.write(
      '\nA kit primitive must default its array @Input()s to [] (empty → self-hide via *ngIf), never demo content — otherwise fabricated prices/menus/listings/FAQs/testimonials ship verbatim to a real business site. Move demo data to the Storybook story. (anti-fabrication mandate)\n',
    );
  }
  process.exit(process.argv.includes('--ci') && findings.length > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
