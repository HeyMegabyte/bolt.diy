/**
 * _browserbase-creds.mjs — resolve the three real-browser-session creds the Browserbase-gated
 * admin probes need (BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, E2E_TEST_PASSWORD).
 *
 * WHY: reconcile-surfaces / contract-sweep / verify-forms-causal / verify-billing /
 * verify-editor-datatab each read these straight from `process.env` and SKIP when any is unset.
 * In local /loop cron fires the env doesn't export them, so the DEEPEST checks (display==store
 * reconcile across every surface, per-section contract sweep, forms submit→read-back) never ran
 * — a standing coverage gap. But `get-secret` HAS all three on Brian's machine. This resolver
 * reads env first, then falls back to `get-secret <KEY>` so the deep probes AUTO-RUN every fire.
 *
 * FAIL-OPEN BY CONSTRUCTION: in CI / forks there is no `get-secret` on PATH → the shell-out
 * throws → that cred stays undefined → each probe's own `if (!BB||!PROJ||!PW) skip` keeps the
 * suite green (secret-less CI still SKIPS, never fails). Mirrors the deploy-r2.mjs cred bootstrap.
 * Never throws; never logs a secret value.
 */
import { execSync } from 'node:child_process';

const GET_SECRET_BINS = ['get-secret', `${process.env.HOME || ''}/.local/bin/get-secret`];

/** Best-effort read of one key from the local secret store; undefined if unavailable. */
function fromSecretStore(key) {
  for (const bin of GET_SECRET_BINS) {
    if (!bin) continue;
    try {
      const v = execSync(`${bin} ${key}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10_000,
      }).trim();
      if (v && !/^the file|not found|no such|error/i.test(v)) return v;
    } catch {
      /* not on PATH / not found → try next candidate, else give up (fail-open) */
    }
  }
  return undefined;
}

/**
 * Resolve ONE secret by name: the env value when set, else `get-secret <key>`, else undefined.
 * The general primitive behind every admin-verify probe's creds (E2E_API_KEY, CLOUDFLARE_API_KEY,
 * E2E_TEST_PASSWORD, BROWSERBASE_*) so the WHOLE suite auto-runs in local fires + fail-open in CI.
 * @param {string} key
 * @returns {string|undefined}
 */
export function resolveSecret(key) {
  return process.env[key] || fromSecretStore(key);
}

/**
 * @returns {{ BB: string|undefined, PROJ: string|undefined, PW: string|undefined }}
 *   env value when set, else the get-secret value, else undefined (→ probe skips).
 */
export function resolveBrowserbaseCreds() {
  return {
    BB: resolveSecret('BROWSERBASE_API_KEY'),
    PROJ: resolveSecret('BROWSERBASE_PROJECT_ID'),
    PW: resolveSecret('E2E_TEST_PASSWORD'),
  };
}
