#!/usr/bin/env node
// One-off removal companion to strip-child-site-feature.mjs (Brian 2026-08-13).
// Handles what that codemod does NOT: index.ts (imports + app.route mounts + inline
// handler blocks) and libs/features/<slug>/ + e2e/ directory deletes.
// The brace-counted registry.ts/docs.ts/CATALOG.md entries are stripped by the
// sibling codemod. Run BOTH, then `tsc --noEmit` catches any residual reference.
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const slugs = readFileSync('/tmp/rmslugs.txt', 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
const SET = new Set(slugs);
const ALT = slugs.slice().sort((a, b) => b.length - a.length).join('|');

// ── index.ts surgery ──────────────────────────────────────────────
const idxPath = join(ROOT, 'src/index.ts');
const lines = readFileSync(idxPath, 'utf8').split('\n');
const out = [];
const importRe = new RegExp(`libs/features/(${ALT})/`);
const flagRe = /\(flag: ([a-z0-9_]+)/;
let imp = 0, mnt = 0, blk = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // 1. service/handler import lines
  if (/^import\b/.test(line) && importRe.test(line)) { imp++; continue; }
  // 2. app.route mount lines carrying a (flag: <slug>) marker
  if (/^app\.route\(/.test(line)) {
    const m = flagRe.exec(line);
    if (m && SET.has(m[1])) { mnt++; continue; }
  }
  // 3. inline handler block: standalone `// ...(flag: <slug>)` then app.<method>(...) … `});`
  if (/^\/\//.test(line)) {
    const m = flagRe.exec(line);
    if (m && SET.has(m[1]) && /^app\.(get|post|put|delete|patch|on)\b/.test(lines[i + 1] ?? '')) {
      let j = i + 1;
      while (j < lines.length && lines[j] !== '});' && j - i < 80) j++;
      if (lines[j] === '});') {           // only skip if we found the closer (safety)
        blk++;
        i = j;
        if (lines[i + 1] === '') i++;      // swallow one trailing blank line
        continue;
      }
    }
  }
  out.push(line);
}
writeFileSync(idxPath, out.join('\n'));
console.log(`index.ts: -${imp} imports, -${mnt} mounts, -${blk} inline blocks`);

// ── directory deletes ─────────────────────────────────────────────
let dirs = 0;
for (const s of slugs) {
  for (const d of [`libs/features/${s}`, `e2e/apps/${s}`, `e2e/${s}`, `frontend/e2e/${s}`, `src/__tests__/${s}`]) {
    const p = join(ROOT, d);
    if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); console.log(`rm -rf ${d}`); dirs++; }
  }
}
console.log(`removed ${dirs} dirs`);
