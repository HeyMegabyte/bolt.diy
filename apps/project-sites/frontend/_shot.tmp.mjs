import { chromium } from '@playwright/test';
const KEY = process.env.E2E_KEY;
const routes = [
  ['trust','/admin/trust'], ['logs','/admin/logs'], ['ai-endpoints','/admin/ai-endpoints'],
  ['bulk-ops','/admin/bulk-ops'], ['stripe-app','/admin/stripe-app-status'],
];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript((k) => {
  localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'brian@megabyte.space', createdAt: Date.now() }));
  localStorage.setItem('ps_feedback_dismissed', 'true');
}, KEY);
const pg = await ctx.newPage();
for (const [name, path] of routes) {
  try {
    await pg.goto('https://projectsites.dev' + path, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await pg.waitForTimeout(2500);
    await pg.screenshot({ path: `/tmp/r-${name}.png` });
    console.log('shot', name);
  } catch (e) { console.log('ERR', name, e.message.slice(0,60)); }
}
await b.close();
