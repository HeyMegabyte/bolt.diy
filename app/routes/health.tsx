/**
 * GET /health — bolt.diy health endpoint (item 50).
 *
 * Returns build identity + per-provider model availability so the admin
 * can poll it every 60s and surface an "AI service offline" banner when
 * any expected provider is down. Designed to be cheap: never makes an
 * outbound LLM call, only inspects env bindings + the WebContainer API
 * package version.
 *
 * Per project decision the only providers we surface here are:
 *   - Workers AI (Cloudflare-bound, no key required — checks for binding)
 *   - OpenAI
 *   - Anthropic
 *   - Ollama (local self-hosted)
 *
 * Shape:
 * ```json
 * {
 *   "ok": true,
 *   "build": "abc123",
 *   "webcontainerVersion": "1.6.1",
 *   "modelAvailability": {
 *     "workersAi": true,
 *     "openai": true,
 *     "anthropic": true,
 *     "ollama": false
 *   }
 * }
 * ```
 *
 * @module routes/health
 */

import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';

/*
 * @webcontainer/api doesn't expose `version` on its public surface, so
 * we read it from the package.json string baked in by Vite. Failing
 * resolution just degrades to `'unknown'` — the field is informational
 * (admin shows it in the diagnostics panel), not load-bearing.
 */
let webcontainerVersion = 'unknown';

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  webcontainerVersion = (require('@webcontainer/api/package.json') as { version: string }).version;
} catch {
  // Fall through with 'unknown'
}

const BUILD_SHA =
  (typeof process !== 'undefined' &&
    (process.env?.GITHUB_SHA || process.env?.CF_PAGES_COMMIT_SHA)) ||
  'dev';

function hasValidKey(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.trim().length > 10 &&
    !value.includes('your_') &&
    !value.includes('_here')
  );
}

function hasValidUrl(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.startsWith('http');
}

export const loader = async ({ context }: LoaderFunctionArgs) => {
  const env = ((context?.cloudflare?.env as unknown) ?? {}) as Record<string, unknown>;
  const proc = ((typeof process !== 'undefined' && process.env) || {}) as Record<string, unknown>;

  const openai = hasValidKey(env.OPENAI_API_KEY ?? proc.OPENAI_API_KEY);
  const anthropic = hasValidKey(env.ANTHROPIC_API_KEY ?? proc.ANTHROPIC_API_KEY);
  const ollama = hasValidUrl(env.OLLAMA_API_BASE_URL ?? proc.OLLAMA_API_BASE_URL);
  // Workers AI is a Cloudflare runtime binding (`env.AI`) — presence of
  // the binding is sufficient, no key check needed.
  const workersAi = !!env.AI || hasValidKey(env.CLOUDFLARE_API_TOKEN ?? proc.CLOUDFLARE_API_TOKEN);

  const modelAvailability = { workersAi, openai, anthropic, ollama };
  // `ok` flips false only when every provider we care about is unreachable —
  // a partial outage (e.g., OpenAI down, Anthropic up) is still "healthy".
  const ok = Object.values(modelAvailability).some(Boolean);

  return json(
    {
      ok,
      build: BUILD_SHA,
      webcontainerVersion,
      modelAvailability,
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        // Admin polls every 60s — let the CDN cache for 30s so spikes don't
        // hammer the origin while still keeping data fresh-ish.
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      },
    },
  );
};
