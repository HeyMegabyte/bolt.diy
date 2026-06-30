/**
 * Reference wrangler config for the Deepcrawl v0 API Worker.
 * The ACTUAL deploy runs from within the deepcrawl repo (see api-worker/deploy.sh).
 * This file documents the target configuration.
 *
 * Deploy command (from deepcrawl repo):
 *   cd /tmp/deepcrawl-build/apps/workers/v0
 *   wrangler deploy --env production --minify
 *
 * Before deploy, update these in wrangler.jsonc:
 *   - routes[0].pattern → "api.deepcrawl.projectsites.dev"
 *   - vars.NEXT_PUBLIC_APP_URL → "https://deepcrawl.projectsites.dev"
 *   - vars.BETTER_AUTH_URL → "https://deepcrawl.projectsites.dev"
 *   - vars.API_URL → "https://api.deepcrawl.projectsites.dev"
 *   - services[0].service → removed (no separate auth worker — dashboard serves auth)
 */

// Target wrangler.jsonc values (apply these diffs before deploying):
export const TARGET_CONFIG = {
  name: "deepcrawl-worker-v0",
  routes: [{ pattern: "api.deepcrawl.projectsites.dev", custom_domain: true }],
  vars: {
    NEXT_PUBLIC_APP_URL: "https://deepcrawl.projectsites.dev",
    BETTER_AUTH_URL: "https://deepcrawl.projectsites.dev",
    AUTH_MODE: "better-auth",
    API_URL: "https://api.deepcrawl.projectsites.dev",
    ENABLE_ACTIVITY_LOGS: true,
    WORKER_NODE_ENV: "production",
    ENABLE_API_RATE_LIMIT: true,
    JWT_ISSUER: "",
    JWT_AUDIENCE: "",
  },
  // Remove service binding to auth worker — dashboard serves auth routes
  // services: [], // ← delete the AUTH_WORKER service binding
};
