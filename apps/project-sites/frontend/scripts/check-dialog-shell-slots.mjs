#!/usr/bin/env node
/**
 * check-dialog-shell-slots.mjs — build-time gate against wrong `<app-dialog-shell>`
 * slot attributes that SILENTLY drop content.
 *
 * DialogShellComponent projects its title + footer via named content slots:
 *   title  → `<ng-content select="[dialogTitle]">`  (inside the <h2 [id]=titleId>)
 *   footer → `<ng-content select="[dialogFooter]">` (the bordered footer bar)
 * It has NO `title` @Input. So a consumer that writes:
 *   <app-dialog-shell title="X">      → the attribute is a no-op → the <h2> is EMPTY
 *                                        → the dialog has NO visible title AND NO
 *                                          accessible name (aria-labelledby → empty
 *                                          element; WCAG 4.1.2). axe does NOT catch
 *                                          this (the referenced element exists).
 *   <div footer>…</div>               → `footer` ≠ `dialogFooter` → the action
 *                                        buttons fall into the default body slot
 *                                        (no footer bar / border / right-align).
 *
 * Reference incident (2026-08-29 surf): api-tokens.component used `title=` (×3) +
 * `<div footer>` (×3) — 3 title-less, mis-footered dialogs that shipped because
 * the misuse is silent. 16 other dialogs use the correct `[dialogTitle]` /
 * `dialogFooter` projection. This gate keeps it that way.
 *
 * HARD gate (exit 1): any `<app-dialog-shell … title=/[title]=`, or any bare
 * `<div footer>` slot marker in a file that renders `<app-dialog-shell>`.
 */
import { readFileSync, readdirSync } from 'node:fs';

const APP = new URL('../src/app', import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|html)$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const TITLE_ATTR = /<app-dialog-shell\b[^>]*\s\[?title\]?=/;
const BARE_FOOTER = /<div\s+footer[\s>]/;
const violations = [];

for (const file of walk(APP)) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('app-dialog-shell')) continue;
  const rel = file.replace(`${APP}/`, '');
  src.split('\n').forEach((line, i) => {
    if (TITLE_ATTR.test(line))
      violations.push(`${rel}:${i + 1}  <app-dialog-shell title=…>  — use <span dialogTitle>…</span> (no title @Input; empty <h2> → no accessible name)`);
    if (BARE_FOOTER.test(line))
      violations.push(`${rel}:${i + 1}  <div footer>  — use <div dialogFooter class="…"> (bare "footer" projects into the body, not the footer bar)`);
  });
}

if (violations.length) {
  console.error(`\n✗ check-dialog-shell-slots: ${violations.length} wrong slot attribute(s):\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error('\n  DialogShellComponent projects title via [dialogTitle] and footer via [dialogFooter].\n');
  process.exit(1);
}
console.warn('✓ check-dialog-shell-slots: all <app-dialog-shell> usages use the correct [dialogTitle]/[dialogFooter] slots');
