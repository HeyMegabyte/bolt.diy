// Unit tests for the body-keyed write-IDOR detector (scanHandler).
// Positives are the PRE-FIX shapes of the two iter-159 cross-org site-takeover
// IDORs; negatives are the fix, the intentional-public path-param surfaces, and
// the false-positive classes caught during authoring (per validator-precision-discipline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanHandler } from '../check-body-slug-write-idor.mjs';

// ── POSITIVE: pre-fix /api/publish/bolt — body slug → R2 write, NO ownership ──
test('FLAGS a body-slug R2 site-write with no ownership gate (pre-fix publish/bolt)', () => {
  const src = `
    const { files, chat, slug: existingSlug } = body;
    let slug;
    if (existingSlug) { slug = existingSlug; }
    else { slug = await generateSlugFromChat(env, chat); }
    const uploads = files.map((f) =>
      c.env.SITES_BUCKET.put(\`sites/\${slug}/\${version}/\${f.path}\`, f.content));
    await c.env.SITES_BUCKET.put(\`sites/\${slug}/_manifest.json\`, JSON.stringify({ current_version: version }));
  `;
  assert.equal(scanHandler('/api/publish/bolt', src).flagged, true);
});

// ── NEGATIVE: the FIX — the same body-slug R2 write, now gated on ownership ──
test('does NOT flag once the body slug is ownership-gated (the fix)', () => {
  const src = `
    const { files, chat, slug: existingSlug } = body;
    let slug = existingSlug;
    const existing = await dbQueryOne(c.env.DB,
      'SELECT org_id FROM sites WHERE slug = ? AND deleted_at IS NULL LIMIT 1', [existingSlug]);
    if (existing) {
      const callerOrgId = c.get('orgId');
      if (!callerOrgId || existing.org_id !== callerOrgId) throw notFound('Site not found');
    }
    c.env.SITES_BUCKET.put(\`sites/\${slug}/\${version}/index.html\`, html);
  `;
  assert.equal(scanHandler('/api/publish/bolt', src).flagged, false);
});

// ── NEGATIVE: writes only to the verified-owned site.slug (the :id fix) ──
test('does NOT flag a write to the verified-owned site.slug (no body slug)', () => {
  const src = `
    const { files, chat } = body;
    const site = await dbQueryOne(c.env.DB, 'SELECT id, slug, org_id FROM sites WHERE id = ?', [siteId]);
    if (!site || site.org_id !== orgId) throw notFound('Site not found');
    const slug = site.slug;
    c.env.SITES_BUCKET.put(\`sites/\${slug}/\${version}/index.html\`, html);
  `;
  assert.equal(scanHandler('/api/sites/:id/publish-bolt', src).flagged, false);
});

// ── NEGATIVE: a PATH-param slug read (build-context/chat) — not body-derived ──
test('does NOT flag a path-param slug (c.req.param) — intentional-public read/write', () => {
  const src = `
    const slug = c.req.param('slug');
    c.env.SITES_BUCKET.put(\`sites/\${slug}/\${version}/index.html\`, html);
  `;
  assert.equal(scanHandler('/api/sites/by-slug/:slug/whatever', src).flagged, false);
});

// ── NEGATIVE: intentional-public write endpoint (contact-form) ──
test('does NOT flag an allowlisted public write endpoint', () => {
  const src = `
    const { slug: existingSlug } = body;
    c.env.SITES_BUCKET.put(\`sites/\${existingSlug}/x\`, data);
  `;
  assert.equal(scanHandler('/api/contact-form/:slug', src).flagged, false);
});

// ── NEGATIVE (FP class): a handler with a body slug but NO R2 site write ──
test('does NOT flag a body-slug handler that never writes site files to R2', () => {
  const src = `
    const { slug: providedSlug } = body;
    await dbUpdate(c.env.DB, 'sites', { title }, 'slug = ? AND org_id = ?', [providedSlug, orgId]);
  `;
  assert.equal(scanHandler('/api/sites/rename', src).flagged, false);
});
