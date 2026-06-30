/**
 * integrations.projectsites.dev — Proxy to Nango on Fly.io.
 * Nango needs ~30s cold start; timeout is 45s with graceful fallback.
 */
import { Hono } from 'hono';

const app = new Hono();

app.all('*', async (c) => {
  try {
    const url = new URL(c.req.url);
    url.hostname = 'projectsites-nango.fly.dev';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    const body = c.req.method !== 'GET' && c.req.method !== 'HEAD'
      ? await c.req.arrayBuffer().catch(() => null) : null;
    const resp = await fetch(url.toString(), {
      method: c.req.method, headers: c.req.raw.headers, body, signal: ctrl.signal,
    });
    clearTimeout(timer);
    return resp;
  } catch {
    return new Response(
      `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="color-scheme" content="dark"><title>Integrations · ProjectSites</title>
<style>body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center}div{padding:40px}h1{font-size:2rem;margin-bottom:.5rem;background:linear-gradient(135deg,#fff,rgba(0,229,255,.85));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}p{color:#94a3b8}a{color:#00e5ff}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#f59e0b;margin-right:8px;animation:pulse 2s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}</style></head><body><div><p><span class="dot"></span>Nango is starting</p><h1>Integrations</h1><p>Nango OAuth gateway waking up. Dashboard loads automatically in ~30 seconds.</p><p style="font-size:.85rem;margin-top:12px"><a href="javascript:location.reload()">Refresh page</a></p></div></body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8' } },
    );
  }
});

export default app;
