/**
 * @module routes/copilot
 * @description Multimodal AI Site Copilot — feature-flag `multimodal_copilot`.
 *
 * All routes return 404 when the flag is off.
 *
 * Endpoints:
 *   POST /api/sites/:slug/copilot/intent    — multipart: text + audio + image → intent + fields
 *   GET  /api/sites/:siteId/copilot/sessions — admin: recent sessions list + intent distribution
 *   GET  /api/sites/:siteId/copilot/config  — admin: copilot enable toggle + settings
 *   PUT  /api/sites/:siteId/copilot/config  — admin: update enable toggle
 *
 * Per-site widget is served as a static JS file at /sites/:slug/copilot.js
 * which is generated from public/copilot/widget.js with the slug injected.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { assertSiteOwned } from '../services/site_ownership.js';
import { processMultimodalIntent, saveCopilotSession } from '../services/multimodal_intent.js';

const copilotRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

async function guardFlag(env: Env, orgId?: string, siteId?: string): Promise<boolean> {
  return isFlagOn(env, 'multimodal_copilot', { orgId, siteId });
}

/**
 * Admin-route guard for `/api/sites/:siteId/copilot/*`. Uses the AUTHENTICATED
 * org from the session (`c.get('orgId')`) — NEVER a client-supplied `x-org-id`
 * header (that was a tenant-spoofing bypass) — then verifies the caller's org
 * owns `siteId` and the flag is on. Returns a 401/404 Response when blocked, or
 * `null` to proceed.
 */
async function adminGuard(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  siteId: string,
): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'unauthorized' }, 401);
  const orgId = c.get('orgId');
  if (!(await assertSiteOwned(c.env, orgId, siteId))) return c.json({ error: 'not_found' }, 404);
  if (!(await guardFlag(c.env, orgId ?? '', siteId))) return c.json({ error: 'not_found' }, 404);
  return null;
}

// ── POST /api/sites/:slug/copilot/intent ──────────────────────────────────────
// Public endpoint: visitor-facing multipart intent extraction.
// Rate-limited to 10 req/min per IP (applied in index.ts).
copilotRoutes.post('/api/sites/:slug/copilot/intent', async (c) => {
  const slug = c.req.param('slug');

  // Resolve org + site from slug
  const site = await c.env.DB.prepare(
    `SELECT id, org_id FROM sites WHERE slug = ? AND deleted_at IS NULL LIMIT 1`,
  )
    .bind(slug)
    .first<{ id: string; org_id: string }>()
    .catch(() => null);

  if (!site) return c.json({ error: 'not_found' }, 404);
  if (!(await guardFlag(c.env, site.org_id, site.id))) return c.json({ error: 'not_found' }, 404);

  // Parse multipart form data
  let textInput: string | null = null;
  let audioBuffer: ArrayBuffer | null = null;
  let imageBuffer: ArrayBuffer | null = null;

  try {
    const formData = await c.req.formData();
    const text = formData.get('text');
    if (text && typeof text === 'string') textInput = text.slice(0, 2000); // cap

    const audio = formData.get('audio');
    if (audio && typeof audio === 'object' && 'arrayBuffer' in audio) {
      audioBuffer = await (audio as Blob).arrayBuffer();
    }

    const image = formData.get('image');
    if (image && typeof image === 'object' && 'arrayBuffer' in image) {
      const blob = image as Blob;
      if (blob.size > 5 * 1024 * 1024) return c.json({ error: 'image_too_large' }, 413);
      imageBuffer = await blob.arrayBuffer();
    }
  } catch {
    // Try JSON body fallback (text-only)
    const json = await c.req.json<{ text?: string }>().catch(() => null);
    if (json?.text) textInput = json.text.slice(0, 2000);
  }

  if (!textInput && !audioBuffer && !imageBuffer) {
    return c.json({ error: 'at least one of text|audio|image is required' }, 400);
  }

  const anonId = c.req.header('cf-ray') ?? c.req.header('x-anon-id') ?? undefined;
  const visitorId = c.req.header('x-visitor-id') ?? undefined;

  const result = await processMultimodalIntent(c.env, {
    text: textInput,
    audio: audioBuffer,
    image: imageBuffer,
    siteSlug: slug,
    orgId: site.org_id,
    siteId: site.id,
    visitorId: visitorId ?? null,
    anonId: anonId ?? null,
  });

  // Persist session (fire-and-forget)
  void saveCopilotSession(c.env, {
    orgId: site.org_id,
    siteId: site.id,
    siteSlug: slug,
    input: {
      text: textInput,
      audio: audioBuffer,
      image: imageBuffer,
      siteSlug: slug,
      orgId: site.org_id,
      siteId: site.id,
      visitorId: visitorId ?? null,
      anonId: anonId ?? null,
    },
    result,
  });

  return c.json({
    intent: result.intent,
    extracted_fields: result.extracted_fields,
    suggested_route: result.suggested_route,
    transcript: result.transcript,
    latency_ms: result.latency.total_ms,
  });
});

// ── GET /api/sites/:siteId/copilot/sessions (admin) ───────────────────────────
copilotRoutes.get('/api/sites/:siteId/copilot/sessions', async (c) => {
  const siteId = c.req.param('siteId');
  const blocked = await adminGuard(c, siteId);
  if (blocked) return blocked;

  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);

  const sessions = await c.env.DB.prepare(
    `SELECT id, intent, has_text, has_audio, has_image, total_ms, status, created_at
       FROM copilot_sessions
      WHERE site_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
  )
    .bind(siteId, limit)
    .all<Record<string, unknown>>()
    .then((r) => r.results ?? [])
    .catch(() => []);

  // Intent distribution
  const distribution = await c.env.DB.prepare(
    `SELECT intent, COUNT(*) as count
       FROM copilot_sessions
      WHERE site_id = ? AND intent IS NOT NULL
      GROUP BY intent`,
  )
    .bind(siteId)
    .all<{ intent: string; count: number }>()
    .then((r) => r.results ?? [])
    .catch(() => []);

  return c.json({ sessions, distribution, total: sessions.length });
});

// ── GET /api/sites/:siteId/copilot/config (admin) ─────────────────────────────
copilotRoutes.get('/api/sites/:siteId/copilot/config', async (c) => {
  const siteId = c.req.param('siteId');
  const blocked = await adminGuard(c, siteId);
  if (blocked) return blocked;

  const row = await c.env.DB.prepare(
    `SELECT value_json FROM flag_overrides
      WHERE scope = 'tenant' AND scope_id = ? AND flag_key = 'multimodal_copilot'
        AND deleted_at IS NULL LIMIT 1`,
  )
    .bind(siteId)
    .first<{ value_json: string }>()
    .catch(() => null);

  const enabled = row ? (JSON.parse(row.value_json) as { enabled?: boolean }).enabled ?? false : false;

  return c.json({ site_id: siteId, enabled });
});

// ── PUT /api/sites/:siteId/copilot/config (admin) ─────────────────────────────

const CopilotConfigBodySchema = z.object({
  enabled: z.boolean({ required_error: 'enabled (boolean) required' }),
});

copilotRoutes.put('/api/sites/:siteId/copilot/config', zValidator('json', CopilotConfigBodySchema), async (c) => {
  const siteId = c.req.param('siteId');
  const blocked = await adminGuard(c, siteId);
  if (blocked) return blocked;
  const userId = c.get('userId');

  const body = c.req.valid('json');

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO flag_overrides (id, scope, scope_id, flag_key, value_json, set_by, set_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(scope, scope_id, flag_key) WHERE deleted_at IS NULL
     DO UPDATE SET value_json = excluded.value_json, set_by = excluded.set_by,
                   set_at = excluded.set_at, updated_at = excluded.updated_at`,
  )
    .bind(id, 'tenant', siteId, 'multimodal_copilot', JSON.stringify({ enabled: body.enabled }),
      userId ?? null, now, now, now)
    .run()
    .catch(() => null);

  return c.json({ ok: true, site_id: siteId, enabled: body.enabled });
});

// ── GET /sites/:slug/copilot.js — per-site widget JS ─────────────────────────
// Serves the vanilla-JS copilot widget with the site slug baked in.
copilotRoutes.get('/sites/:slug/copilot.js', async (c) => {
  const slug = c.req.param('slug');

  // Verify site exists
  const site = await c.env.DB.prepare(
    `SELECT id FROM sites WHERE slug = ? AND deleted_at IS NULL LIMIT 1`,
  )
    .bind(slug)
    .first<{ id: string }>()
    .catch(() => null);

  if (!site) return c.text('/* site not found */', 404, { 'Content-Type': 'application/javascript' });

  // Inline a tiny IIFE that reads the widget template from R2
  const widgetObj = await c.env.SITES_BUCKET.get('copilot/widget.js').catch(() => null);
  const widgetBase = widgetObj ? await widgetObj.text() : DEFAULT_WIDGET_JS;
  const widgetJs = widgetBase.replace('__SITE_SLUG__', JSON.stringify(slug));

  return new Response(widgetJs, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
});

const DEFAULT_WIDGET_JS = `
/* ProjectSites Multimodal Copilot Widget — site: __SITE_SLUG__ */
(function(){
  var SLUG = __SITE_SLUG__;
  var BASE = 'https://projectsites.dev';
  var btn = document.createElement('button');
  btn.id = 'ps-copilot-btn';
  btn.setAttribute('aria-label', 'Get help');
  btn.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;width:52px;height:52px;border-radius:50%;background:#00e5ff;border:none;cursor:pointer;box-shadow:0 4px 14px rgba(0,229,255,0.4);display:flex;align-items:center;justify-content:center;';
  btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#060610" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  document.body.appendChild(btn);

  var panel = document.createElement('div');
  panel.id = 'ps-copilot-panel';
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-modal','true');
  panel.setAttribute('aria-label','AI assistant');
  panel.style.cssText = 'display:none;position:fixed;bottom:88px;right:24px;z-index:99999;width:320px;background:#0d0d20;border:1px solid rgba(0,229,255,0.2);border-radius:16px;padding:20px;color:#f4f4ff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
  panel.innerHTML = '<h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#00e5ff;">How can we help?</h3><textarea id="ps-copilot-text" rows="3" placeholder="Type your question…" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.05);border:1px solid rgba(0,229,255,0.15);border-radius:8px;padding:10px;color:#f4f4ff;font-size:14px;resize:none;outline:none;"></textarea><label for="ps-copilot-img" style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;color:#94a3b8;cursor:pointer;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>Attach a photo (optional)<input id="ps-copilot-img" type="file" accept="image/*" style="display:none;"></label><button id="ps-copilot-send" style="margin-top:12px;width:100%;background:#00e5ff;color:#060610;border:none;border-radius:8px;padding:10px;font-weight:600;cursor:pointer;font-size:14px;">Send</button><div id="ps-copilot-result" style="margin-top:12px;font-size:13px;min-height:0;"></div>';
  document.body.appendChild(panel);

  btn.addEventListener('click',function(){
    var open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    if(!open){ setTimeout(function(){ var ta = document.getElementById('ps-copilot-text'); if(ta) ta.focus(); },50); }
  });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape') panel.style.display='none'; });

  document.getElementById('ps-copilot-send').addEventListener('click',async function(){
    var ta = document.getElementById('ps-copilot-text');
    var imgInput = document.getElementById('ps-copilot-img');
    var result = document.getElementById('ps-copilot-result');
    var text = ta.value.trim();
    var file = imgInput.files[0];
    if(!text && !file){ result.textContent='Please enter a message or attach a photo.'; return; }
    result.innerHTML='<span style="color:#00e5ff;">Analyzing…</span>';
    var fd = new FormData();
    if(text) fd.append('text',text);
    if(file) fd.append('image',file);
    try{
      var res = await fetch(BASE+'/api/sites/'+SLUG+'/copilot/intent',{method:'POST',body:fd});
      var data = await res.json();
      if(!res.ok){ result.textContent='Something went wrong. Please try again.'; return; }
      var msg = '';
      if(data.suggested_route && data.suggested_route !== '/') {
        msg = 'It looks like you want to <strong>'+data.intent+'</strong>. <a href="'+data.suggested_route+'" style="color:#00e5ff;">Continue →</a>';
      } else {
        msg = 'Thanks! We received your request and will be in touch.';
      }
      result.innerHTML = '<span style="color:#22c55e;">✓ </span>' + msg;
      ta.value = '';
    }catch(err){ result.textContent='Something went wrong. Please try again.'; }
  });
})();
`.trim();

export { copilotRoutes as copilot };
