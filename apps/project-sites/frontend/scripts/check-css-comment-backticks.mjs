#!/usr/bin/env node
/**
 * check-css-comment-backticks.mjs — fail the build when a backtick appears
 * inside a block comment within an Angular `@Component` decorator's inline
 * `template:` / `styles: [` template literal.
 *
 * THE BUG THIS CATCHES (cost real debugging time more than once):
 *   styles: [`
 *     /* the `?` affordance *​/   ← the backtick CLOSES the styles template
 *     .foo { color: red; }          string early, so everything after it is
 *   `]                              parsed as JS → a cascade of syntax errors.
 *
 * `tsc` TOLERATES it (its parser recovers differently); the Angular/babel build
 * does NOT — you only find out at `ng build`, with a misleading line number far
 * from the real cause. This gate flags it at the source line, before the build.
 *
 * Scope: ONLY the inline `styles: [ … ]` literal (from `styles:` to the class
 * declaration). CSS comments are unambiguously `/* … *​/`, so a backtick inside
 * one is always the bug. The `template:` literal is deliberately NOT scanned —
 * template attribute data legitimately contains `/*` (e.g. accept="image/*",
 * a log filter "route:/api/sites/*"), which would false-positive as a comment
 * opener (validator-precision-discipline: prefer a false negative over a false
 * positive). Method/class JSDoc lives after the class decl and is never scanned.
 *
 * Fix when flagged: remove the backticks from the comment (write "question mark"
 * or omit the code-quoting) — comments don't need them.
 *
 * Run via `npm run check:css-comments` or as a pre-build gate (`build:prod`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SRC = join(ROOT, 'src', 'app');

/** Recursively yields every component .ts file (specs never ship a decorator). */
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
      continue;
    }
    if (full.endsWith('.spec.ts')) continue;
    if (full.endsWith('.component.ts')) yield full;
  }
}

/**
 * Find every comment containing a backtick inside the `@Component(...)` decorator:
 *   • CSS `/* … *​/` in the `styles: [ … ]` literal, and
 *   • HTML `<!-- … -->` in the `template: \` … \`` literal.
 * Either closes its enclosing template literal early (tsc tolerates, ng build does not).
 */
function findViolations(source) {
  const violations = [];
  const compIdx = source.indexOf('@Component(');
  if (compIdx === -1) return violations;

  // Decorator region ends at the class declaration (all decorator literals live before it).
  const classMatch = /\n\s*(?:export\s+)?(?:abstract\s+)?class\s/.exec(source.slice(compIdx));
  const decoratorEnd = classMatch ? compIdx + classMatch.index : source.length;

  const record = (absIdx) => {
    const line = source.slice(0, absIdx).split('\n').length;
    const snippet = (source.split('\n')[line - 1] ?? '').trim();
    violations.push({ line, snippet: snippet.length > 110 ? snippet.slice(0, 107) + '...' : snippet });
  };

  // 1. CSS block comments — SCOPED to the `styles: [` literal. `/*` collides with template
  //    attribute data (accept="image/*", route:/api/sites/*), so scanning it only inside
  //    styles avoids false positives (validator-precision).
  const stylesMatch = /styles\s*:\s*\[/.exec(source.slice(compIdx));
  if (stylesMatch) {
    const stylesIdx = compIdx + stylesMatch.index;
    const region = source.slice(stylesIdx, decoratorEnd);
    const rx = /\/\*[\s\S]*?\*\//g;
    let m;
    while ((m = rx.exec(region)) !== null) if (m[0].includes('`')) record(stylesIdx + m.index);
  }

  // 2. HTML comments — scanned across the whole decorator. `<!-- … -->` delimiters are
  //    unambiguous (they never appear as template attribute data), so this is false-positive
  //    safe. Catches the backtick-in-template-comment break (api-tokens quick-start, AL-084)
  //    that the styles-only scan missed.
  const htmlRx = /<!--[\s\S]*?-->/g;
  const decoratorRegion = source.slice(compIdx, decoratorEnd);
  let h;
  while ((h = htmlRx.exec(decoratorRegion)) !== null) if (h[0].includes('`')) record(compIdx + h.index);

  return violations;
}

function main() {
  let failures = 0;
  for (const file of walk(SRC)) {
    const violations = findViolations(readFileSync(file, 'utf8'));
    if (violations.length === 0) continue;
    failures += violations.length;
    const rel = relative(ROOT, file);
    for (const v of violations) {
      process.stderr.write(`${rel}:${v.line}  backtick inside a decorator comment (CSS /* */ or HTML <!-- -->) — it closes the template/styles literal — ${v.snippet}\n`);
    }
  }
  if (failures > 0) {
    process.stderr.write(
      `\ncss-comment-backticks check FAILED — ${failures} backtick(s) in @Component block comments. ` +
        `A backtick inside a template:/styles: comment closes the literal (tsc tolerates it, ng build does not). ` +
        `Remove the backticks from the comment.\n`,
    );
    process.exit(1);
  }
  process.stdout.write('css-comment-backticks check PASSED — no backticks in @Component block comments.\n');
}

main();
