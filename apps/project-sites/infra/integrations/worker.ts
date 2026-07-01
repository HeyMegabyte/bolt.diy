/**
 * integrations.projectsites.dev → redirects to nango.projectsites.dev
 * Nango is the canonical OAuth dashboard. This domain is for discovery.
 */
import { Hono } from 'hono';

const app = new Hono();

app.get('/health', (c) => c.json({ status:'ok', redirect:'https://nango.projectsites.dev' }));
app.get('/healthcheck', (c) => c.json({ status:'healthy', nango:'https://nango.projectsites.dev', ts:Date.now() }));

// Redirect everything to nango
app.all('*', (c) => {
  const url = new URL(c.req.url);
  url.hostname = 'nango.projectsites.dev';
  return c.redirect(url.toString(), 302);
});

export default app;
