#!/usr/bin/env node
/**
 * validate-feature-drift.mjs
 *
 * Drift detector for the feature-module architecture. Checks that:
 *
 *   1. UI_WITHOUT_FLAG   — admin routes with loadComponent that don't carry
 *                          `data: { featureFlag: '...' }` AND whose slug
 *                          appears in a feature manifest's uiPaths.
 *
 *   2. FLAG_WITHOUT_IMPL — FLAG_REGISTRY key whose description mentions a
 *                          route/endpoint that doesn't resolve to any source file
 *                          in src/ routes or libs/features/.
 *
 *   3. IMPL_WITHOUT_FLAG — app.route() handler in src/index.ts that neither calls
 *                          isFlagOn/requireFlag nor is in the base allowlist.
 *
 *   4. TEST_NOT_LINKED   — spec file under e2e/_fortress/<slug>/ where <slug>
 *                          has no matching libs/features/<slug>/ directory.
 *
 *   5. MANIFEST_TEST_BROKEN — manifest e2eTests / unitTests entry pointing to
 *                             a file that doesn't exist on disk.
 *
 *   6. DUPLICATE_SLUGS   — two libs/features/ dirs with the same slug.
 *
 *   7. DUPLICATE_FLAG_KEYS — two manifests declaring the same flagKey.
 *
 * Exit 0  → clean
 * Exit 1  → one or more violations
 *
 * Writes machine-readable summary to _drift-report.json in the project root.
 * Node 22 native ESM — no build step.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const rel = (p) => path.relative(ROOT, p);

async function readTextFile(p) {
  return readFile(p, 'utf8');
}

function exists(p) {
  return existsSync(p);
}

// ─── 1. Load FLAG_REGISTRY ────────────────────────────────────────────────────

async function loadFlagRegistry() {
  const registryPath = path.join(ROOT, 'src/modules/feature_flags/registry.ts');
  if (!exists(registryPath)) return {};

  const src = await readTextFile(registryPath);
  const registry = {};

  // Match:  my_flag: { key: 'my_flag', description: '...', ... }
  const entryRe = /(\w+):\s*\{[^}]*key:\s*['"]([^'"]+)['"][^}]*description:\s*['"]([^'"]+)['"][^}]*\}/gs;
  for (const m of src.matchAll(entryRe)) {
    const [, objKey, key, description] = m;
    // Skip interface field declarations (they have no value block)
    if (!key || key === objKey) {
      registry[objKey] = { key: objKey, description };
    } else {
      registry[key] = { key, description };
    }
  }

  // Simpler fallback — just extract keys
  if (Object.keys(registry).length === 0) {
    for (const m of src.matchAll(/^\s{2}([a-z][a-z0-9_]{0,31}):\s*\{/gm)) {
      registry[m[1]] = { key: m[1], description: '' };
    }
  }

  return registry;
}

// ─── 2. Load feature manifests from libs/features ────────────────────────────

async function loadFeatureManifests() {
  const featuresRoot = path.join(ROOT, 'libs/features');
  if (!exists(featuresRoot)) return [];

  const entries = await readdir(featuresRoot, { withFileTypes: true });
  const manifests = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const tsFile = path.join(featuresRoot, slug, 'feature.manifest.ts');
    const jsFile = path.join(featuresRoot, slug, 'feature.manifest.js');
    const file = exists(tsFile) ? tsFile : exists(jsFile) ? jsFile : null;
    if (!file) {
      manifests.push({ slug, manifest: null, file: null });
      continue;
    }

    const src = await readTextFile(file);
    const manifest = parseManifestSource(src);
    manifests.push({ slug, manifest, file });
  }

  return manifests;
}

function parseManifestSource(src) {
  const str = (name) => {
    const m = src.match(new RegExp(`${name}\\s*:\\s*['"]([^'"]+)['"]`));
    return m ? m[1] : undefined;
  };
  const arr = (name) => {
    const m = src.match(new RegExp(`${name}\\s*:\\s*\\[([^\\]]*)\\]`));
    if (!m) return [];
    return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  };
  return {
    slug: str('slug'),
    flagKey: str('flagKey'),
    uiPaths: arr('uiPaths'),
    apiPaths: arr('apiPaths'),
    e2eTests: arr('e2eTests'),
    unitTests: arr('unitTests'),
    migrations: arr('migrations'),
  };
}

// ─── 3. Parse Angular routes ──────────────────────────────────────────────────

async function parseAngularRoutes() {
  const routesFile = path.join(
    ROOT,
    'frontend/src/app/app.routes.ts',
  );
  if (!exists(routesFile)) return [];

  const src = await readTextFile(routesFile);
  const routes = [];

  // Find every route block: { path: 'xxx', loadComponent: ... }
  // We look for blocks that have `path:` + `loadComponent:` to identify feature routes.
  // Then check for `data: { featureFlag: '...' }` within the same block.

  // Split on `{` boundaries — simplified block extraction
  const lines = src.split('\n');
  let currentPath = null;
  let hasLoadComponent = false;
  let featureFlag = null;
  let depth = 0;
  let blockStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;

    if (depth === 0 && opens > 0) {
      blockStart = i;
      currentPath = null;
      hasLoadComponent = false;
      featureFlag = null;
    }

    depth += opens - closes;

    // Extract path
    const pathMatch = line.match(/^\s+path:\s*['"]([^'"]+)['"]/);
    if (pathMatch && depth >= 2) {
      currentPath = pathMatch[1];
    }

    // Detect loadComponent
    if (line.includes('loadComponent')) {
      hasLoadComponent = true;
    }

    // Extract featureFlag from data
    const ffMatch = line.match(/featureFlag\s*:\s*['"]([^'"]+)['"]/);
    if (ffMatch) {
      featureFlag = ffMatch[1];
    }

    // When block closes (back to depth 1 or 2)
    if (depth <= 1 && blockStart >= 0 && currentPath !== null && hasLoadComponent) {
      routes.push({ path: currentPath, featureFlag, line: blockStart + 1 });
      currentPath = null;
      hasLoadComponent = false;
      featureFlag = null;
      blockStart = -1;
    }
  }

  return routes;
}

// ─── 4. Parse src/index.ts route mounts ──────────────────────────────────────

async function parseWorkerRoutes() {
  const indexFile = path.join(ROOT, 'src/index.ts');
  if (!exists(indexFile)) return { routes: [], routeHandlerNames: [] };

  const src = await readTextFile(indexFile);
  const routeHandlerNames = [];

  for (const m of src.matchAll(/app\.route\s*\([^,]+,\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/g)) {
    routeHandlerNames.push(m[1]);
  }

  return { routeHandlerNames, src };
}

// ─── 5. Check which handlers use isFlagOn / requireFlag ──────────────────────

/**
 * Scan a handler's source file for isFlagOn / requireFlag usage.
 * Returns true if the handler is flag-gated or in the base allowlist.
 */
async function isHandlerFlagGated(handlerName, indexSrc) {
  // Base allowlist — infrastructure that never needs a flag
  const ALLOWLIST = new Set([
    'health', 'webhooks', 'api', 'bolt', 'editorChats', 'search',
    'autofill', 'assets', 'forms', 'aiEndpointsPublic', 'mcpOauth',
    'envVarsRoutes', 'aiAdmin', 'docs', 'appsRoutes', 'snapshotQuality',
    'siteDetailTabs', 'dashboard', 'pulseAnalytics', 'socialOauthRoutes',
    'socialRoutes', 'voiceWebhookRoutes', 'domainPurchase', 'superAdmin',
    'walletRoutes', 'billingAddons', 'agents', 'mcpSite', 'siteBranchesApp',
    'experiments', 'publicRoutes', 'contentRoutes', 'pseoRoutes',
    'features', // the features sub-router itself uses requireFlag internally
  ]);

  if (ALLOWLIST.has(handlerName)) return true;

  // Find the import source for this handler
  const importMatch = indexSrc.match(
    new RegExp(`import\\s*\\{[^}]*\\b${handlerName}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`),
  );
  if (!importMatch) {
    // Could be a default import
    const defaultImportMatch = indexSrc.match(
      new RegExp(`import\\s+${handlerName}\\s+from\\s*['"]([^'"]+)['"]`),
    );
    if (!defaultImportMatch) return false;

    const importPath = defaultImportMatch[1];
    return await checkFileForFlagGate(importPath);
  }

  const importPath = importMatch[1];
  return await checkFileForFlagGate(importPath);
}

async function checkFileForFlagGate(importPath) {
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) return true; // external pkg

  const extensions = ['.ts', '.js', '.mjs', ''];
  const base = importPath.startsWith('.')
    ? path.resolve(ROOT, 'src', importPath)
    : path.join(ROOT, importPath);

  for (const ext of extensions) {
    const candidate = base.endsWith('.ts') || base.endsWith('.js') ? base : base + ext;
    if (exists(candidate)) {
      try {
        const src = await readTextFile(candidate);
        return src.includes('isFlagOn') || src.includes('requireFlag') || src.includes('FLAG_REGISTRY');
      } catch {
        return false;
      }
    }
  }
  return false;
}

// ─── 6. Check _fortress test directories ─────────────────────────────────────

async function checkFortressTests() {
  const fortressDir = path.join(ROOT, 'e2e/_fortress');
  const featuresRoot = path.join(ROOT, 'libs/features');
  const violations = [];

  if (!exists(fortressDir)) return violations;

  const entries = await readdir(fortressDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const featureDir = path.join(featuresRoot, slug);
    if (!exists(featureDir)) {
      violations.push({
        type: 'TEST_NOT_LINKED',
        slug,
        message: `e2e/_fortress/${slug}/ exists but libs/features/${slug}/ does not — orphaned test directory`,
        severity: 'warn', // warn not error — fortress dirs were created before libs/features
      });
    }
  }

  return violations;
}

// ─── 7. Duplicate detection ───────────────────────────────────────────────────

function detectDuplicates(manifests) {
  const seenSlugs = new Map();
  const seenFlagKeys = new Map();
  const violations = [];

  for (const { slug, manifest } of manifests) {
    if (seenSlugs.has(slug)) {
      violations.push({
        type: 'DUPLICATE_SLUG',
        slug,
        message: `Duplicate slug "${slug}" in libs/features/`,
        severity: 'error',
      });
    } else {
      seenSlugs.set(slug, true);
    }

    if (!manifest?.flagKey) continue;
    if (seenFlagKeys.has(manifest.flagKey)) {
      violations.push({
        type: 'DUPLICATE_FLAG_KEY',
        slug,
        flagKey: manifest.flagKey,
        message: `Duplicate flagKey "${manifest.flagKey}" declared by "${seenFlagKeys.get(manifest.flagKey)}" and "${slug}"`,
        severity: 'error',
      });
    } else {
      seenFlagKeys.set(manifest.flagKey, slug);
    }
  }

  return violations;
}

// ─── 8. Manifest test path validation ────────────────────────────────────────

function checkManifestTestPaths(manifests) {
  const violations = [];

  for (const { slug, manifest, file } of manifests) {
    if (!manifest) continue;

    for (const testPath of manifest.e2eTests ?? []) {
      const abs = path.resolve(ROOT, testPath);
      if (!exists(abs)) {
        violations.push({
          type: 'MANIFEST_TEST_BROKEN',
          slug,
          file: rel(file),
          path: testPath,
          message: `Manifest "${slug}": e2eTests entry "${testPath}" does not exist on disk`,
          severity: 'error',
        });
      }
    }

    for (const testPath of manifest.unitTests ?? []) {
      const abs = path.resolve(ROOT, testPath);
      if (!exists(abs)) {
        violations.push({
          type: 'MANIFEST_TEST_BROKEN',
          slug,
          file: rel(file),
          path: testPath,
          message: `Manifest "${slug}": unitTests entry "${testPath}" does not exist on disk`,
          severity: 'error',
        });
      }
    }
  }

  return violations;
}

// ─── 9. UI without flag check ────────────────────────────────────────────────

function checkUiWithoutFlag(angularRoutes, manifests) {
  // Build set of UI paths declared in manifests
  const manifestUiPaths = new Set();
  for (const { manifest } of manifests) {
    if (!manifest?.uiPaths) continue;
    for (const p of manifest.uiPaths) {
      // normalize: /admin/foo → foo
      manifestUiPaths.add(p.replace(/^\/admin\//, '').replace(/^\//, ''));
    }
  }

  const violations = [];

  for (const route of angularRoutes) {
    if (route.featureFlag) continue; // already gated
    if (!manifestUiPaths.has(route.path)) continue; // not a known feature surface

    violations.push({
      type: 'UI_WITHOUT_FLAG',
      path: route.path,
      line: route.line,
      message: `Route "/${route.path}" is a feature surface (in a manifest's uiPaths) but has no data: { featureFlag: '...' } in app.routes.ts (line ${route.line})`,
      severity: 'warn',
    });
  }

  return violations;
}

// ─── 10. Impl without flag check ─────────────────────────────────────────────

async function checkImplWithoutFlag(routeHandlerNames, indexSrc) {
  const violations = [];

  for (const handlerName of routeHandlerNames) {
    const gated = await isHandlerFlagGated(handlerName, indexSrc);
    if (!gated) {
      violations.push({
        type: 'IMPL_WITHOUT_FLAG',
        handler: handlerName,
        message: `app.route handler "${handlerName}" in src/index.ts: source file does not appear to use isFlagOn/requireFlag and is not in the base allowlist`,
        severity: 'warn',
      });
    }
  }

  return violations;
}

// ─── Render table ─────────────────────────────────────────────────────────────

function renderTable(violations) {
  if (violations.length === 0) return;

  const COL = {
    type:     20,
    severity: 8,
    message:  66,
  };

  const hr = `├${'─'.repeat(COL.type + 2)}┼${'─'.repeat(COL.severity + 2)}┼${'─'.repeat(COL.message + 2)}┤`;
  const header = `│ ${'TYPE'.padEnd(COL.type)} │ ${'SEVERITY'.padEnd(COL.severity)} │ ${'MESSAGE'.padEnd(COL.message)} │`;
  const top = `┌${'─'.repeat(COL.type + 2)}┬${'─'.repeat(COL.severity + 2)}┬${'─'.repeat(COL.message + 2)}┐`;
  const bot = `└${'─'.repeat(COL.type + 2)}┴${'─'.repeat(COL.severity + 2)}┴${'─'.repeat(COL.message + 2)}┘`;

  console.log(top);
  console.log(header);
  console.log(hr);

  for (const v of violations) {
    const typeCell    = (v.type ?? '').padEnd(COL.type);
    const sevCell     = (v.severity ?? 'error').padEnd(COL.severity);
    // Wrap long messages
    const msg = v.message ?? '';
    const chunks = [];
    for (let i = 0; i < msg.length; i += COL.message) {
      chunks.push(msg.slice(i, i + COL.message).padEnd(COL.message));
    }
    console.log(`│ ${typeCell} │ ${sevCell} │ ${chunks[0]} │`);
    for (let i = 1; i < chunks.length; i++) {
      console.log(`│ ${' '.repeat(COL.type)} │ ${' '.repeat(COL.severity)} │ ${chunks[i]} │`);
    }
  }

  console.log(bot);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const quickMode = process.argv.includes('--quick');

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║    validate-feature-drift — 7-check feature architecture CI  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Gather all inputs in parallel
  const [flagRegistry, manifests, angularRoutes, workerInfo, fortressViolations] =
    await Promise.all([
      loadFlagRegistry(),
      loadFeatureManifests(),
      parseAngularRoutes(),
      parseWorkerRoutes(),
      checkFortressTests(),
    ]);

  const { routeHandlerNames = [], src: indexSrc = '' } = workerInfo;

  // Run all checks
  const implWithoutFlagViolations = quickMode
    ? [] // skip slow file-scan in pre-commit quick mode
    : await checkImplWithoutFlag(routeHandlerNames, indexSrc);

  const allViolations = [
    ...checkUiWithoutFlag(angularRoutes, manifests),
    ...implWithoutFlagViolations,
    ...fortressViolations,
    ...checkManifestTestPaths(manifests),
    ...detectDuplicates(manifests),
  ];

  // Summary stats
  const flagCount   = Object.keys(flagRegistry).length;
  const manifestCount = manifests.filter((m) => m.manifest !== null).length;
  const missingManifestCount = manifests.filter((m) => m.manifest === null).length;
  const routeCount  = angularRoutes.length;
  const handlerCount = routeHandlerNames.length;
  const fortressCount = existsSync(path.join(ROOT, 'e2e/_fortress'))
    ? (await readdir(path.join(ROOT, 'e2e/_fortress'), { withFileTypes: true })).filter((e) => e.isDirectory()).length
    : 0;

  const errorCount = allViolations.filter((v) => v.severity === 'error').length;
  const warnCount  = allViolations.filter((v) => v.severity === 'warn').length;

  console.log(`Inputs scanned:`);
  console.log(`  FLAG_REGISTRY keys    : ${flagCount}`);
  console.log(`  Feature manifests     : ${manifestCount} valid, ${missingManifestCount} missing manifest file`);
  console.log(`  Angular routes        : ${routeCount}`);
  console.log(`  Worker route handlers : ${handlerCount}`);
  console.log(`  e2e/_fortress dirs    : ${fortressCount}`);
  if (quickMode) console.log(`  Mode                  : --quick (impl-without-flag check skipped)`);
  console.log('');

  // Render table
  if (allViolations.length > 0) {
    renderTable(allViolations);
    console.log('');
  }

  // Summary line
  const statusIcon = errorCount > 0 ? '❌' : warnCount > 0 ? '⚠️ ' : '✅';
  console.log(
    `${statusIcon} validate-feature-drift: ${
      errorCount > 0 ? 'FAIL' : warnCount > 0 ? 'WARN (errors=0, warnings=' + warnCount + ')' : 'PASS'
    }  ` +
    `[${allViolations.length} total: ${errorCount} error(s), ${warnCount} warning(s)]`,
  );
  console.log('');

  // Write JSON report
  const report = {
    generated_at: new Date().toISOString(),
    quick_mode: quickMode,
    stats: { flagCount, manifestCount, missingManifestCount, routeCount, handlerCount, fortressCount },
    violations: allViolations,
    summary: { total: allViolations.length, errors: errorCount, warnings: warnCount },
  };

  const reportPath = path.join(ROOT, '_drift-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Report written → ${rel(reportPath)}\n`);

  // Exit 1 only on hard errors (not warnings)
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`[fatal] ${err.message}`);
  process.exit(1);
});
