/**
 * Regression test: every `@cf/meta/llama-*` model name in the worker
 * source MUST be one that Cloudflare Workers AI still serves on our
 * account. The deprecated full-precision aliases return 400 at runtime
 * and caused the AI chat to silently return "service is unavailable"
 * 100% of the time (reported 2026-05-24).
 *
 * Lock the FP8 variants in by grepping the source tree. If anyone
 * reaches for a deprecated alias, this test fails.
 *
 * @see /Users/Apple/.claude/plugins/heymegabyte-claude-skills/rules/model-routing.md § Cloudflare Workers AI
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC_ROOT = join(__dirname, '..');

// Build the retired-alias list at runtime so the strings themselves never
// appear as literals in this file (otherwise the rebrand-everywhere
// regex would happily rewrite the very list this test is supposed to
// protect). Each entry is the deprecated alias the AI gateway no longer
// serves on our production account.
const PREFIX = '@cf/meta/llama-';
const RETIRED_ALIASES = [
  `${PREFIX}3.3-70b-instruct`,
  `${PREFIX}3.1-8b-instruct`,
  `${PREFIX}3.1-70b-instruct`,
] as const;

/** Recursively list every .ts source file (skip .test.ts, .bak, node_modules). */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.bak')) {
      out.push(full);
    }
  }
  return out;
}

describe('Workers AI model names', () => {
  const sourceFiles = listSourceFiles(SRC_ROOT);

  it.each(RETIRED_ALIASES)('no source file references the retired alias %s', (alias) => {
    // Negative-lookahead so the bare alias does NOT match the longer
    // FP8 variant suffix.
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escaped}(?![A-Za-z0-9_-])`);
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const contents = readFileSync(file, 'utf8');
      if (pattern.test(contents)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('every llama model name is on the FP8/FP8-fast/scout allowlist', () => {
    const ALLOWED = [
      `${PREFIX}3.3-70b-instruct-fp8-fast`,
      `${PREFIX}3.1-8b-instruct-fp8`,
      `${PREFIX}3.1-8b-instruct-awq`,
      `${PREFIX}3-8b-instruct`,
      `${PREFIX}3-8b-instruct-awq`,
      `${PREFIX}3.2-1b-instruct`,
      `${PREFIX}3.2-3b-instruct`,
      `${PREFIX}3.2-11b-vision-instruct`,
      `${PREFIX}4-scout-17b-16e-instruct`,
      `${PREFIX}guard-3-8b`,
      `${PREFIX}2-7b-chat-fp16`,
      `${PREFIX}2-7b-chat-int8`,
      '@cf/meta-llama/llama-2-7b-chat-hf-lora',
    ];
    const llamaRe = /@cf\/meta(?:-llama)?\/llama-[a-z0-9.-]+/g;
    const found = new Set<string>();
    for (const file of sourceFiles) {
      const contents = readFileSync(file, 'utf8');
      const matches = contents.match(llamaRe);
      if (matches) matches.forEach((m) => found.add(m));
    }
    const unknown = [...found].filter((m) => !ALLOWED.includes(m));
    expect(unknown).toEqual([]);
  });
});
