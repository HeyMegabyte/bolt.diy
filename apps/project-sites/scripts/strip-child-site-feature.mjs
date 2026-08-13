#!/usr/bin/env node
// Reusable codemod for the child-site-feature-removal loop (Brian 2026-08-13).
// Strips a feature's brace-counted declarations that are fragile to hand-edit:
//   1. FLAG_REGISTRY entry in src/modules/feature_flags/registry.ts  (`  <key>: { ... },`)
//   2. SITE_FEATURE_CATALOG entry in src/routes/features.ts          (`{ key: '<key>', ... },`)
//   3. CATALOG.md feature section in libs/features/CATALOG.md        (`## <key>` … next feature section)
// Does NOT touch index.ts mounts, route files, libs/features dirs, or frontend — those are
// removed separately (simple line/dir deletes). Idempotent; reports what it removed.
//
// Usage: node scripts/strip-child-site-feature.mjs <key> [<key> ...]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const keys = process.argv.slice(2);
if (!keys.length) {
  console.error('usage: node scripts/strip-child-site-feature.mjs <key> [<key> ...]');
  process.exit(1);
}

/** Walk from the `{` at `open`, returning the index just past its matching `}`. Skips string/template literals. */
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++; // skip escaped char (handles \' inside '...')
        i++;
      }
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Remove a keyed object entry `  <key>: { ... },` (registry.ts shape). */
function removeKeyedEntry(src, key) {
  const re = new RegExp(`\\n( *)${key}: \\{`);
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index; // includes the leading \n
  const open = src.indexOf('{', m.index);
  let end = matchBrace(src, open);
  if (end < 0) return null;
  if (src[end] === ',') end++;
  return src.slice(0, start) + src.slice(end);
}

/** Remove an array-of-objects entry `{ key: '<key>', ... },` (features.ts SITE_FEATURE_CATALOG shape). */
function removeArrayEntry(src, key) {
  const km = new RegExp(`key: '${key}'`).exec(src);
  if (!km) return null;
  const open = src.lastIndexOf('{', km.index);
  let start = open;
  while (start > 0 && src[start - 1] === ' ') start--;
  if (src[start - 1] === '\n') start--; // drop one preceding newline so we don't leave a blank line
  let end = matchBrace(src, open);
  if (end < 0) return null;
  if (src[end] === ',') end++;
  return src.slice(0, start) + src.slice(end);
}

/** Remove a CATALOG.md feature section: `## <key>` up to (but not including) the next feature section. */
function removeCatalogSection(src, key) {
  const lines = src.split('\n');
  const isFeatureStart = (idx) => {
    const h = /^## ([a-z0-9_]+)\s*$/.exec(lines[idx] ?? '');
    if (!h) return null;
    let j = idx + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    // A feature section's `## key` is immediately followed by an H1 `# key` banner.
    return lines[j] === `# ${h[1]}` ? h[1] : null;
  };
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isFeatureStart(i) === key) { startLine = i; break; }
  }
  if (startLine < 0) return null;
  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    if (isFeatureStart(i)) { endLine = i; break; }
  }
  lines.splice(startLine, endLine - startLine);
  return lines.join('\n');
}

const targets = [
  { file: 'src/modules/feature_flags/registry.ts', fn: removeKeyedEntry, label: 'registry' },
  { file: 'src/modules/feature_flags/docs.ts', fn: removeKeyedEntry, label: 'docs' },
  { file: 'src/routes/features.ts', fn: removeArrayEntry, label: 'catalog' },
  { file: 'libs/features/CATALOG.md', fn: removeCatalogSection, label: 'CATALOG.md' },
];

let anyChange = false;
for (const { file, fn, label } of targets) {
  const path = join(ROOT, file);
  if (!existsSync(path)) { console.warn(`skip ${label}: ${file} absent`); continue; }
  let src = readFileSync(path, 'utf8');
  for (const key of keys) {
    const next = fn(src, key);
    if (next && next !== src) {
      src = next;
      anyChange = true;
      console.log(`removed ${label} entry: ${key}`);
    } else {
      console.log(`  (no ${label} entry for ${key})`);
    }
  }
  writeFileSync(path, src);
}

process.exit(anyChange ? 0 : 0);
