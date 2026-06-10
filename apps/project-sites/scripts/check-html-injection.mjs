#!/usr/bin/env node
// HTML-injection detector — audit-arc "Detect + Surface" step.
//
// Flags interpolations of request/user-derived PROPERTY ACCESS (e.g. opts.message,
// data.sub, submission.email) into HTML-context template literals that are NOT
// run through an escaper. This is the class fixed across contact-form, inbox,
// ghost-route, the error page, and the app-shell (2026-06). A clean baseline (0
// hits) means every served/email HTML sink escapes its dynamic fields.
//
// Heuristic (deliberately conservative — property-access only, never bare locals):
//   - object:  opts|data|body|params|submission|req|input|row|user|visitor|site|f|e
//   - field :  message|details|name|email|phone|subject|body|content|title|path|
//              err|sub|value|text|comment|author|displayName|query
//              (NOT `slug` — slugs are invariant-validated to [a-z0-9-], no HTML chars)
//   - context: the line contains an HTML tag / html: / text/html / <!DOCTYPE
//   - safe   : the interpolation is wrapped in escapeHtml|sanitizeHtml|stripHtml|
//              escapeXml, or references a `safeX` variable
//
// Usage:  node scripts/check-html-injection.mjs        (exit 1 on any hit)
//         node scripts/check-html-injection.mjs --json
//
// Exported helpers (`scanLine`, `walk`) are unit-tested in
// scripts/__tests__/check_html_injection.test.mjs.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OBJ = '(?:opts|data|body|params|submission|req|input|row|user|visitor|site|f|e)';
const FIELD =
  '(?:message|details|name|email|phone|subject|body|content|title|path|err|sub|value|text|comment|author|displayName|query)';
const INTERP = /\$\{[^}]*\}/g;
const PROP = new RegExp(`\\b${OBJ}\\.${FIELD}\\b`);
const HTML_CONTEXT = /<[a-zA-Z][a-z0-9]*[ />]|html:|htmlBody|text\/html|<!DOCTYPE/;
const WRAPPED = /escapeHtml|sanitizeHtml|stripHtml|escapeXml|\bsafe[A-Z]/;

/**
 * Return an array of offending `${…}` expressions on a single line, or [] when
 * clean. A hit is a property-access of a user/request object, in HTML context,
 * not run through an escaper.
 */
export function scanLine(line) {
  if (!HTML_CONTEXT.test(line)) return [];
  // Escaper at LINE level — handles both the direct wrap `${escapeHtml(x)}` AND
  // nested-template wraps like `escapeXml(`${a} — ${b}`)` where a per-`${}`
  // regex would otherwise split out the inner interpolation as a false hit.
  if (WRAPPED.test(line)) return [];
  return (line.match(INTERP) ?? []).filter((m) => PROP.test(m));
}

export function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      yield* walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      yield full;
    }
  }
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcRoot = join(here, '..', 'src');
  const findings = [];
  for (const file of walk(srcRoot)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const expr of scanLine(line)) {
        findings.push({ file: file.replace(`${srcRoot}/`, 'src/'), line: i + 1, expr });
      }
    });
  }

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ ok: findings.length === 0, findings }, null, 2) + '\n');
  } else if (findings.length === 0) {
    process.stdout.write('✓ check-html-injection: no unescaped user-data interpolation in HTML sinks\n');
  } else {
    process.stderr.write(`✗ check-html-injection: ${findings.length} unescaped HTML-sink interpolation(s):\n`);
    for (const f of findings) process.stderr.write(`  ${f.file}:${f.line}  ${f.expr}\n`);
    process.stderr.write('\nWrap each in escapeHtml() (from @project-sites/shared) before interpolation.\n');
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
