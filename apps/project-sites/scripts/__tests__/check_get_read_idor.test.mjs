// Unit tests for the GET-read cross-org IDOR detector (scanGetHandler).
// The positive is the class the detector guards (a GET-by-id tenant read with no
// org gate); the negatives are the real scoping idioms + public surfaces found
// during the tree-wide sweep (per validator-precision-discipline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanGetHandler } from '../check-get-read-idor.mjs';

// ── POSITIVE: a GET-by-id read with NO org-ownership gate ──
test('FLAGS a GET-by-id tenant read with no org-ownership gate', () => {
  const src = `
    const id = c.req.param('id');
    const row = await dbQueryOne(c.env.DB, 'SELECT * FROM widgets WHERE id = ? LIMIT 1', [id]);
    if (!row) throw notFound('not found');
    return c.json({ row });
  `;
  assert.equal(scanGetHandler('/api/widgets/:id', src).flagged, true);
});

// ── NEGATIVE: scoped by an `AND org_id = ?` bind ──
test('does NOT flag a read scoped by AND org_id = ?', () => {
  const src = `
    const id = c.req.param('id');
    const row = await dbQueryOne(c.env.DB,
      'SELECT * FROM widgets WHERE id = ? AND org_id = ? LIMIT 1', [id, orgId]);
    return c.json({ row });
  `;
  assert.equal(scanGetHandler('/api/widgets/:id', src).flagged, false);
});

// ── NEGATIVE: scoped via an ownership helper (loadInstance / adminGuard / resolveSnapshot) ──
test('does NOT flag a read gated by an ownership helper', () => {
  const src = `
    const siteId = c.req.param('siteId');
    const blocked = await adminGuard(c, siteId);
    if (blocked) return blocked;
    const rows = await c.env.DB.prepare('SELECT * FROM copilot_sessions WHERE site_id = ?').bind(siteId).all();
    return c.json({ rows });
  `;
  assert.equal(scanGetHandler('/api/sites/:siteId/copilot/sessions', src).flagged, false);
});

// ── NEGATIVE: intentionally-public surface (by-slug / catalog / templates marketplace) ──
test('does NOT flag an allowlisted public GET-by-id read', () => {
  const src = `
    const slug = c.req.param('slug');
    const tpl = await dbQueryOne(c.env.DB, 'SELECT * FROM templates WHERE slug = ? LIMIT 1', [slug]);
    return c.json({ tpl });
  `;
  assert.equal(scanGetHandler('/api/templates/:slug', src).flagged, false);
});

// ── NEGATIVE: no DB read (nothing tenant-scoped to leak) ──
test('does NOT flag a GET-by-id handler that performs no DB read', () => {
  const src = `
    const id = c.req.param('id');
    return c.json({ echo: id, ok: true });
  `;
  assert.equal(scanGetHandler('/api/echo/:id', src).flagged, false);
});

// ── NEGATIVE: no attacker-suppliable resource id in the path ──
test('does NOT flag a collection GET with no resource-id path param', () => {
  const src = `
    const rows = await dbQuery(c.env.DB, 'SELECT * FROM widgets WHERE org_id = ?', [orgId]);
    return c.json({ rows });
  `;
  assert.equal(scanGetHandler('/api/widgets', src).flagged, false);
});
