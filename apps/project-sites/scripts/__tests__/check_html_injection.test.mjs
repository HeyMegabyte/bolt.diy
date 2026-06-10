// Unit tests for the HTML-injection detector heuristic (scanLine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanLine } from '../check-html-injection.mjs';

test('flags a raw user-property interpolation in HTML context', () => {
  assert.deepEqual(scanLine('html: `<p>${opts.message}</p>`'), ['${opts.message}']);
  assert.deepEqual(scanLine('return `<h1>${data.sub}</h1>`'), ['${data.sub}']);
  assert.deepEqual(scanLine('`<td>${submission.email}</td>`'), ['${submission.email}']);
});

test('clean when the interpolation is escaped', () => {
  assert.deepEqual(scanLine('html: `<p>${escapeHtml(opts.message)}</p>`'), []);
  assert.deepEqual(scanLine('`<h1>${sanitizeHtml(data.body)}</h1>`'), []);
  assert.deepEqual(scanLine('`<p>${safeMessage}</p>`'), []);
  assert.deepEqual(scanLine('`<title>${escapeXml(e.title)}</title>`'), []);
});

test('clean for slug (invariant-validated [a-z0-9-], no HTML chars)', () => {
  assert.deepEqual(scanLine('`<title>${site.slug}</title>`'), []);
  assert.deepEqual(scanLine('`<p>${row.slug}.projectsites.dev</p>`'), []);
});

test('clean when there is no HTML context on the line', () => {
  assert.deepEqual(scanLine('const x = `${opts.message}`;'), []);
  assert.deepEqual(scanLine('logger.warn(`failed: ${data.err}`)'), []);
  assert.deepEqual(scanLine('await db.prepare(`SELECT ${row.name}`)'), []);
});

test('ignores bare local identifiers (not property access)', () => {
  // `title`/`suggestion` constants are not `obj.field` — not flagged.
  assert.deepEqual(scanLine('`<h1>${title}</h1>`'), []);
  assert.deepEqual(scanLine('`<p>${suggestion}</p>`'), []);
});

test('catches multiple hits on one line', () => {
  const out = scanLine('`<p>${data.name} (${data.email})</p>`');
  assert.equal(out.length, 2);
});
