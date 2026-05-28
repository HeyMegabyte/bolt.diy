#!/usr/bin/env node
/**
 * Feature-module scaffolder.
 *
 * Usage:
 *   npm run gen:feature -- --slug my-feature --name "My Feature" \
 *     --description "Does amazing things for users." [--owner you@example.com]
 *
 * What it does:
 *   1. Validates the slug (kebab-case, unique vs libs/features/ and FLAG_REGISTRY).
 *   2. Copies tools/templates/feature-module/ → libs/features/<slug>/.
 *   3. Substitutes {{slug}}, {{Name}}, {{SLUG_UPPER}}, {{owner}} placeholders.
 *   4. Inserts a new flag entry into src/modules/feature_flags/registry.ts.
 *   5. Inserts a stub docs entry into src/modules/feature_flags/docs.ts.
 *   6. Prints a next-steps checklist.
 *
 * Idempotent: re-running with the same slug fails fast (exit 1) so CI is safe.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// ── Resolve paths ────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Root of apps/project-sites/ */
const ROOT = resolve(__dirname, '..');
const TEMPLATE_DIR = join(ROOT, 'tools', 'templates', 'feature-module');
const FEATURES_DIR = join(ROOT, 'libs', 'features');
const REGISTRY_FILE = join(ROOT, 'src', 'modules', 'feature_flags', 'registry.ts');
const DOCS_FILE = join(ROOT, 'src', 'modules', 'feature_flags', 'docs.ts');

// ── Parse arguments ───────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    slug:        { type: 'string' },
    name:        { type: 'string' },
    description: { type: 'string' },
    owner:       { type: 'string', default: 'brian@megabyte.space' },
  },
  strict: true,
  allowPositionals: false,
});

const slug        = values.slug;
const name        = values.name;
const description = values.description;
const owner       = values.owner ?? 'brian@megabyte.space';

// ── Validate inputs ───────────────────────────────────────────────────────────

const errors = [];

if (!slug) errors.push('--slug is required');
else if (!/^[a-z][a-z0-9-]*$/.test(slug)) errors.push('--slug must be lowercase kebab-case (e.g. my-feature)');
else if (slug.length > 40) errors.push('--slug must be ≤40 chars');

if (!name) errors.push('--name is required');
if (!description) errors.push('--description is required (30+ chars)');
else if (description.length < 30) errors.push('--description must be at least 30 characters');

if (errors.length > 0) {
  console.error('\n❌  gen-feature: invalid arguments\n');
  errors.forEach(e => console.error(`   • ${e}`));
  console.error('\nUsage:');
  console.error('  npm run gen:feature -- --slug my-feature --name "My Feature" --description "Does X for users."\n');
  process.exit(1);
}

// ── Derive tokens ─────────────────────────────────────────────────────────────

/** PascalCase name from slug: "my-feature" → "MyFeature" */
const pascal = slug
  .split('-')
  .map(part => part.charAt(0).toUpperCase() + part.slice(1))
  .join('');

/** snake_case flag key: "my-feature" → "my_feature" */
const flagKey = slug.replace(/-/g, '_');

const tokens = {
  '{{slug}}':       slug,
  '{{Name}}':       pascal,
  '{{SLUG_UPPER}}': flagKey,
  '{{owner}}':      owner,
};

// ── Idempotency guard ─────────────────────────────────────────────────────────

const destDir = join(FEATURES_DIR, slug);

if (existsSync(destDir)) {
  console.error(`\n❌  gen-feature: feature already exists at libs/features/${slug}/\n`);
  console.error('   Remove the directory first if you want to regenerate.\n');
  process.exit(1);
}

// Check FLAG_REGISTRY for duplicate key
if (existsSync(REGISTRY_FILE)) {
  const registrySource = readFileSync(REGISTRY_FILE, 'utf8');
  const keyPattern = new RegExp(`\\b${flagKey}\\s*:`);
  if (keyPattern.test(registrySource)) {
    console.error(`\n❌  gen-feature: flag key '${flagKey}' already exists in registry.ts\n`);
    console.error('   Choose a different --slug.\n');
    process.exit(1);
  }
}

// ── Copy + substitute template ────────────────────────────────────────────────

console.log(`\n🔧  gen-feature: creating libs/features/${slug}/\n`);

mkdirSync(destDir, { recursive: true });

/**
 * Recursively copy templateDir → destDir, substituting placeholder tokens
 * in every text file. Binary files and .gitkeep are copied verbatim.
 */
function copyTemplate(src, dest) {
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath  = join(src, entry.name);
    const destName = substituteName(entry.name, tokens);
    const destPath = join(dest, destName);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyTemplate(srcPath, destPath);
    } else {
      const raw = readFileSync(srcPath);
      // Detect binary (null byte in first 8KB) — skip substitution
      const isBinary = raw.subarray(0, 8192).indexOf(0) !== -1;
      if (isBinary || entry.name === '.gitkeep') {
        writeFileSync(destPath, raw);
      } else {
        const text = substituteAll(raw.toString('utf8'), tokens);
        writeFileSync(destPath, text, 'utf8');
      }
      console.log(`   + ${destPath.replace(ROOT + '/', '')}`);
    }
  }
}

function substituteAll(text, tokenMap) {
  let result = text;
  for (const [placeholder, value] of Object.entries(tokenMap)) {
    // Global replace — escape the {{ }} for use in RegExp
    const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), value);
  }
  return result;
}

function substituteName(filename, tokenMap) {
  return substituteAll(filename, tokenMap);
}

copyTemplate(TEMPLATE_DIR, destDir);

// ── Patch registry.ts ─────────────────────────────────────────────────────────

const registrySource = readFileSync(REGISTRY_FILE, 'utf8');

const newFlagEntry = `  // ── Added by gen-feature ({{slug}})
  ${flagKey}: { key: '${flagKey}', description: '${description.replace(/'/g, "\\'")}', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', owner_email: '${owner}' },`.replace('{{slug}}', slug);

// Insert ABOVE the closing `};` of FLAG_REGISTRY
const REGISTRY_CLOSE_MARKER = '\n};';
const closingIdx = registrySource.lastIndexOf(REGISTRY_CLOSE_MARKER);
if (closingIdx === -1) {
  console.error('\n❌  gen-feature: could not find closing `};` in registry.ts — please insert the flag manually.\n');
  process.exit(1);
}

const patchedRegistry =
  registrySource.slice(0, closingIdx) +
  '\n' + newFlagEntry +
  registrySource.slice(closingIdx);

writeFileSync(REGISTRY_FILE, patchedRegistry, 'utf8');
console.log(`\n   ✎  Patched src/modules/feature_flags/registry.ts  (+${flagKey})`);

// ── Patch docs.ts ─────────────────────────────────────────────────────────────

const docsSource = readFileSync(DOCS_FILE, 'utf8');

const newDocsEntry = `  // ── Added by gen-feature (${slug})
  ${flagKey}: {
    explanation: 'TODO: 100–200 word explanation of the ${slug} feature, its mechanism, and why it matters.',
    smoke_test: [
      'GET /api/${slug} → returns { data: [], total: 0 }',
      'POST /api/${slug} with body { name: "Test" } → returns 201 with id',
      'Admin UI: /admin/feature-flags → ${slug} → toggle enabled → verify API responds',
    ],
    references: [],
  },`;

const DOCS_CLOSE_MARKER = '\n};';
const docsClosingIdx = docsSource.lastIndexOf(DOCS_CLOSE_MARKER);
if (docsClosingIdx === -1) {
  console.error('\n⚠️   gen-feature: could not find closing `};` in docs.ts — please insert the docs entry manually.\n');
} else {
  const patchedDocs =
    docsSource.slice(0, docsClosingIdx) +
    '\n' + newDocsEntry +
    docsSource.slice(docsClosingIdx);
  writeFileSync(DOCS_FILE, patchedDocs, 'utf8');
  console.log(`   ✎  Patched src/modules/feature_flags/docs.ts     (+${flagKey})`);
}

// ── Print checklist ───────────────────────────────────────────────────────────

console.log(`
✅  Feature module scaffolded: libs/features/${slug}/

Next steps:
  1. tsc --noEmit              → confirm zero type errors
  2. Fill in TODOs in:
       libs/features/${slug}/feature.manifest.ts   (description, apiPaths, uiPaths, migrations)
       libs/features/${slug}/feature.schemas.ts    (request / response fields)
       libs/features/${slug}/feature.routes.ts     (handler logic)
       libs/features/${slug}/feature.types.ts      (domain types)
       libs/features/${slug}/README.md             (description + enable/removal instructions)
  3. Write unit tests in libs/features/${slug}/tests/
  4. Write E2E spec   in e2e/${slug}/happy-path.spec.ts  (TDD — red first)
  5. Mount routes in src/index.ts:
       import { ${slug.replace(/-./g, m => m[1].toUpperCase())}Routes } from '../libs/features/${slug}/feature.routes.js';
       app.route('/api/${slug}', ${slug.replace(/-./g, m => m[1].toUpperCase())}Routes);
  6. Admin UI: /admin/feature-flags → '${slug}' → enable for your org to test
  7. Promote: experimental → beta (after green CI) → stable (after 1w at beta)

  Flag key  : ${flagKey}
  Owner     : ${owner}
`);
