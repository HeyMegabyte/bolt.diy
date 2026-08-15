/**
 * Regression test: no worker source file references a RETIRED Anthropic (Claude)
 * or OpenAI model alias. The external-LLM PREMIUM path (`external_llm.ts` /
 * `ai_gateway.ts` — architecture, research, retrospectives, vision) routes to
 * Claude + OpenAI; a retired model id 400s at runtime, silently breaking premium
 * AI — the exact same failure class as the 2026-05-24 Workers-AI incident that
 * {@link ./workers-ai-model-names.test.ts} guards for `@cf/meta/llama-*`.
 *
 * This is the companion guard for the EXTERNAL providers. It is a conservative
 * NEGATIVE check (block clearly-retired families) — per validator-precision-discipline
 * we prefer false negatives over false positives, so we only list families that are
 * NOT a prefix of any current model (e.g. we intentionally skip the ambiguous bare
 * `claude-sonnet-4`, a prefix of the current `claude-sonnet-4-6`).
 *
 * @see /Users/Apple/.claude/plugins/heymegabyte-claude-skills/rules/model-routing.md § Retired models
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC_ROOT = join(__dirname, '..');

// Build retired ids from parts so the strings never appear as literals here
// (otherwise a rebrand-everywhere sed would rewrite the very list this test
// protects). Each is a CURRENTLY-RETIRED model FAMILY prefix whose presence in
// code is a runtime 400. All are safe as plain substrings: none is a substring
// of a current model id (claude-opus-4-8 / claude-sonnet-4-6 / claude-haiku-4-5 /
// claude-fable-5 / gpt-4o*).
const C = 'claude-';
const G = 'gpt-';
const RETIRED_MODEL_FAMILIES = [
  `${C}3-opus`, // Claude 3 Opus (…-20240229)
  `${C}3-sonnet`, // Claude 3 Sonnet
  `${C}3-haiku`, // Claude 3 Haiku (…-20240307)
  `${C}3-5-sonnet`, // Claude 3.5 Sonnet (…-20240620 / -20241022)
  `${C}3-5-haiku`, // Claude 3.5 Haiku
  `${C}3-7-sonnet`, // Claude 3.7 Sonnet (…-20250219)
  `${G}3.5-turbo`, // OpenAI GPT-3.5 Turbo
  'text-davinci', // OpenAI legacy completions
] as const;

/** Recursively list every .ts source file (skip .test.ts, .bak, node_modules, __tests__). */
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

/**
 * Strip block + line comments so the guard checks CODE, not prose. Doc comments
 * legitimately mention retired ids (e.g. "the bare X is deprecated"); a model-name
 * guard must not cry wolf on documentation, or it gets ignored and stops catching
 * real code usages.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('External-LLM (Claude / OpenAI) model names', () => {
  const sourceFiles = listSourceFiles(SRC_ROOT);

  it.each(RETIRED_MODEL_FAMILIES)(
    'no source file references the retired model family %s',
    (family) => {
      const offenders: string[] = [];
      for (const file of sourceFiles) {
        const contents = stripComments(readFileSync(file, 'utf8'));
        if (contents.includes(family)) offenders.push(file);
      }
      expect(offenders).toEqual([]);
    },
  );
});
