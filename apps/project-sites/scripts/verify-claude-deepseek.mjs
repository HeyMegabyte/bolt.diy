#!/usr/bin/env node
/**
 * verify-claude-deepseek.mjs — prove the Claude Code → DeepSeek setup is correct and
 * SECRET-SAFE, with NO live API call required (CI-runnable). Emits a durable evidence
 * artifact `verification-claude-deepseek.json` next to this script (the side-effect that
 * implies success, per the doctrine: every feature proves itself via observable side effects).
 *
 * Checks: snippet exists · base_url → DeepSeek · auth via $DEEPSEEK_API_KEY (not a literal) ·
 * V4 Pro primary · V4 Flash subagents · NO literal secret in the snippet or .env.example.
 *
 * Exit 0 = all pass, 1 = a check failed.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const snippet = process.env.PROJECTSITES_CONFIG_DIR
  ? join(process.env.PROJECTSITES_CONFIG_DIR, 'claude-deepseek.env.sh')
  : join(homedir(), '.config', 'projectsites', 'claude-deepseek.env.sh');

const SECRET_RE = /sk-[A-Za-z0-9]{20,}/; // a real DeepSeek/OpenAI-style key
const checks = [];
const add = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail });

const exists = existsSync(snippet);
add('snippet_exists', exists, snippet);
const body = exists ? readFileSync(snippet, 'utf8') : '';

add('base_url_points_at_deepseek', body.includes('https://api.deepseek.com/anthropic'));
add('auth_token_via_env_var', /ANTHROPIC_AUTH_TOKEN="\$DEEPSEEK_API_KEY"/.test(body));
add('primary_model_is_v4_pro', /ANTHROPIC_MODEL="deepseek-v4-pro/.test(body));
add('subagent_model_is_v4_flash', /CLAUDE_CODE_SUBAGENT_MODEL="deepseek-v4-flash/.test(body));
add('effort_level_max', /CLAUDE_CODE_EFFORT_LEVEL="max"/.test(body));
add('no_literal_secret_in_snippet', !SECRET_RE.test(body), SECRET_RE.test(body) ? 'a literal sk- key is present — REMOVE it' : 'only $DEEPSEEK_API_KEY reference');

// .env.example (repo root) must never hold a real key either.
const envExample = join(here, '..', '..', '..', '.env.example');
if (existsSync(envExample)) {
  const ee = readFileSync(envExample, 'utf8');
  add('env_example_no_literal_secret', !/DEEPSEEK_API_KEY=sk-[A-Za-z0-9]{20,}/.test(ee));
}

const ok = checks.every((c) => c.pass);
const result = { ok, snippet, checks, generated_at: new Date().toISOString() };
const out = join(here, 'verification-claude-deepseek.json');
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');

for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
console.log(`\n${ok ? '✅ DeepSeek Claude Code setup verified' : '❌ verification FAILED'} → ${out}`);
if (!exists) console.log('   (run scripts/setup-claude-deepseek.sh first)');
process.exit(ok ? 0 : 1);
