#!/usr/bin/env node
/**
 * tools/a11y-fixer.mjs — build-time accessibility SOURCE fixer (BACKLOG_50 #48).
 *
 *  THE OPPOSITE OF AN OVERLAY.
 *
 * AccessiBe-style runtime overlays were fined $1M by the FTC in April 2025 for
 * deceptive accessibility claims. This tool does the opposite: it runs at build
 * time, collects axe-core violations from the built `dist/`, asks Workers AI
 * Llama 3.3 70B to propose a unified-diff patch against the SOURCE FILES, and
 * writes the patch to `a11y-fixes.patch` for human review.
 *
 *   - NEVER auto-applies patches
 *   - NEVER injects scripts at runtime
 *   - NEVER touches production HTML
 *   - ALWAYS routes through a human-reviewed Pull Request
 *
 * USAGE
 *   node tools/a11y-fixer.mjs --dist dist/apps/web/browser --out a11y-fixes.patch
 *   node tools/a11y-fixer.mjs --pr      # additionally opens a GitHub PR via `gh`
 *
 * ENV
 *   CLOUDFLARE_ACCOUNT_ID        required for Workers AI calls
 *   CLOUDFLARE_API_TOKEN         scoped token with `Workers AI: Edit`
 *   A11Y_FIXER_MODEL             defaults to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
 *   A11Y_FIXER_DRY_RUN           set to `1` to skip Workers AI calls (CI smoke)
 *
 * @see https://www.ftc.gov/news-events/news/press-releases/2025/04 (AccessiBe settlement)
 * @see https://github.com/dequelabs/axe-core
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKERS_AI_MODEL =
  process.env.A11Y_FIXER_MODEL ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const SYSTEM_PROMPT = [
  'You patch HTML/Angular templates to fix accessibility violations.',
  'You are NEVER allowed to inject runtime scripts, overlays, widgets, or third-party',
  'accessibility tools (AccessiBe / UserWay / EqualWeb pattern). Always edit the SOURCE.',
  '',
  'Given:',
  ' 1. A short axe-core violation summary',
  ' 2. The exact HTML / template snippet that triggered it',
  '',
  'Output ONLY a unified diff (RFC 2440-ish, `--- a/<path>` / `+++ b/<path>` headers)',
  'that fixes the violation while preserving semantics + brand tone. Keep the patch',
  'minimal — never reflow unrelated lines. If the fix requires a design decision',
  '(e.g., choosing a label), reply exactly with `SKIP: <reason>` instead.',
].join('\n');

function parseArgs(argv) {
  const args = {
    dist: 'dist/apps/web/browser',
    out: 'a11y-fixes.patch',
    pr: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dist') args.dist = argv[++i] ?? args.dist;
    else if (a === '--out') args.out = argv[++i] ?? args.out;
    else if (a === '--pr') args.pr = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`a11y-fixer.mjs — build-time SOURCE patcher (NEVER a runtime overlay)

Options
  --dist <path>   built static dir to scan (default: dist/apps/web/browser)
  --out <path>    output unified-diff path  (default: a11y-fixes.patch)
  --pr            after writing patch, open a GitHub PR via 'gh'
  --help          show this message
`);
}

/** Run axe via @axe-core/cli against the built dist and return parsed JSON. */
function runAxe(distPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'npx',
      ['--yes', '@axe-core/cli', distPath, '--save', 'axe-report.json', '--exit'],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let out = '';
    proc.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', async () => {
      try {
        const raw = await readFile('axe-report.json', 'utf8');
        resolve(JSON.parse(raw));
      } catch (err) {
        // axe-core/cli sometimes prints JSON to stdout instead of writing the file.
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(err);
        }
      }
    });
  });
}

/**
 * Extract `{ rule, node, html, sourcePath }` violation records from an axe
 * report. axe gives us CSS selectors; the SOURCE patch we generate is a
 * best-effort — when the source path is unknown the model still gets the HTML
 * snippet and can propose a generic patch.
 */
function flattenViolations(report) {
  if (!Array.isArray(report)) return [];
  const flat = [];
  for (const page of report) {
    const url = page.url ?? null;
    for (const v of page.violations ?? []) {
      for (const node of v.nodes ?? []) {
        flat.push({
          rule: v.id,
          help: v.help,
          helpUrl: v.helpUrl,
          impact: v.impact ?? 'minor',
          target: Array.isArray(node.target) ? node.target.join(' ') : String(node.target ?? ''),
          html: node.html ?? '',
          url,
        });
      }
    }
  }
  return flat;
}

/** Ask Workers AI for a unified-diff patch. Returns null when model said SKIP. */
async function proposePatch(violation) {
  if (process.env.A11Y_FIXER_DRY_RUN === '1') {
    return `--- a/placeholder.html\n+++ b/placeholder.html\n@@ -1 +1 @@\n-<!-- ${violation.rule} -->\n+<!-- ${violation.rule}: FIX_ME -->`;
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN required (or A11Y_FIXER_DRY_RUN=1)');
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${WORKERS_AI_MODEL}`;
  const userPrompt = [
    `Rule: ${violation.rule} (${violation.impact})`,
    `Help: ${violation.help}`,
    `Selector: ${violation.target}`,
    'Snippet:',
    violation.html,
    '',
    'Produce a unified diff fixing this violation IN SOURCE. No runtime injection.',
  ].join('\n');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 600,
    }),
  });
  if (!res.ok) {
    throw new Error(`Workers AI ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const text =
    json?.result?.response ?? json?.response ?? json?.result?.output ?? '';
  if (typeof text !== 'string' || text.length === 0) return null;
  if (text.trim().startsWith('SKIP:')) return null;
  return text.trim();
}

/** Assemble per-violation patches into one combined patch file. */
function assemblePatch(patches, violations) {
  const header = [
    '# a11y-fixes.patch — generated by tools/a11y-fixer.mjs',
    `# Date: ${new Date().toISOString()}`,
    `# Violations addressed: ${patches.length}/${violations.length}`,
    '#',
    '# HUMAN REVIEW REQUIRED. Apply with `git apply` after reading every hunk.',
    '# NEVER auto-apply in CI. NEVER inject at runtime (that is the AccessiBe',
    '# anti-pattern this tool exists to replace).',
    '',
  ].join('\n');
  const body = patches
    .map((p, i) => {
      const v = violations[i];
      return `# --- ${v?.rule ?? 'unknown'} @ ${v?.target ?? '?'} ---\n${p.trim()}\n`;
    })
    .join('\n');
  return `${header}\n${body}`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  console.warn(`[a11y-fixer] scanning ${args.dist} via @axe-core/cli…`);
  const report = await runAxe(args.dist);
  const violations = flattenViolations(report);
  console.warn(`[a11y-fixer] ${violations.length} violation node(s) found`);

  if (violations.length === 0) {
    await writeFile(args.out, '# No accessibility violations found.\n', 'utf8');
    console.warn('[a11y-fixer] clean — wrote empty patch and exiting');
    return;
  }

  const patches = [];
  const handled = [];
  for (const v of violations.slice(0, 50)) {
    try {
      const patch = await proposePatch(v);
      if (patch) {
        patches.push(patch);
        handled.push(v);
      }
    } catch (err) {
      console.warn(`[a11y-fixer] skipping ${v.rule}: ${(err instanceof Error ? err.message : String(err))}`);
    }
  }

  const combined = assemblePatch(patches, handled);
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, combined, 'utf8');
  console.warn(`[a11y-fixer] wrote ${patches.length} patch hunks to ${args.out}`);

  if (args.pr) {
    await openPr(args.out, patches.length);
  }
}

async function openPr(patchPath, count) {
  const branch = `a11y/auto-${Date.now()}`;
  await run('git', ['checkout', '-b', branch]);
  await run('git', ['add', patchPath]);
  await run('git', [
    'commit',
    '-m',
    `chore(a11y): proposed source patches (${count} hunks)`,
  ]);
  await run('git', ['push', '-u', 'origin', branch]);
  await run('gh', [
    'pr',
    'create',
    '--title',
    `chore(a11y): proposed source patches (${count} hunks)`,
    '--body',
    [
      'Generated by `tools/a11y-fixer.mjs` — build-time SOURCE patcher.',
      '',
      '**Human review required.** This is NOT a runtime overlay. Each hunk fixes an',
      'axe-core violation in source. Apply only the hunks that preserve intent.',
    ].join('\n'),
  ]);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
  });
}

// Allow `import` for unit-test introspection without running main().
export const __test = {
  SYSTEM_PROMPT,
  parseArgs,
  flattenViolations,
  assemblePatch,
};

// ESM entry guard — only run main() when invoked as a script.
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch((err) => {
    console.error('[a11y-fixer] fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
