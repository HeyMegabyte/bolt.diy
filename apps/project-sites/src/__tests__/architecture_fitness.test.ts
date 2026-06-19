/**
 * Architecture fitness functions (convergence spec §8 / §2 — the infra LAW).
 *
 * @remarks
 * Fails the build if a forbidden vendor enters the worker source tree. Scoped to
 * UNAMBIGUOUS forbidden references (per `validator-precision-discipline` — prefer
 * false negatives over false positives): Polar billing, Trigger.dev jobs, and a
 * Fly.io-hosted Hatchet config. None exist in the repo today, so these tests pass
 * now and guard against future drift toward the removed stack.
 *
 * Intentionally NOT enforced here (too false-positive-prone — handled by review):
 * `megabyte.space` (the doctrine ALLOWS internal `mcp.megabyte.space` /
 * `skyvern.megabyte.space` behind CF Access) and `posthog` (legitimate server-side
 * on product/admin surfaces; forbidden only on hosted CUSTOMER sites).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');

/** Recursively collect every .ts source file under src/, excluding tests. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Lines matching a forbidden pattern, with `file:line` context (migration-note lines excluded). */
function violations(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!pattern.test(line)) return;
      // Allow references inside an explicit migration/removal note.
      if (/migrat|removed|forbidden|do not use|deprecated|escape hatch/i.test(line)) return;
      hits.push(`${file.replace(SRC, 'src')}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  return hits;
}

describe('architecture fitness — forbidden vendors (convergence LAW §2)', () => {
  it('has no Polar billing references (Stripe-only billing)', () => {
    expect(violations(/@polar-sh|polar\.sh|from ['"]@polar/i)).toEqual([]);
  });

  it('has no Trigger.dev references (Cloudflare Workflows / Inngest / Hatchet only)', () => {
    expect(violations(/@trigger\.dev|trigger\.dev\/sdk|from ['"]@trigger/i)).toEqual([]);
  });

  it('has no Fly.io-hosted Hatchet config (Hatchet Cloud only)', () => {
    // A Hatchet host pointed at fly.dev/fly.io = the forbidden self-host.
    expect(violations(/hatchet[^\n]*fly\.(io|dev)|fly\.(io|dev)[^\n]*hatchet/i)).toEqual([]);
  });

  it('has no forbidden managed app-platform deploy targets (CF-first LAW)', () => {
    // Importing these vendor SDKs = drift off the Cloudflare + Neon/Upstash/Fly base.
    expect(violations(/from ['"]@vercel\/|from ['"]@supabase\/|from ['"]@aws-sdk\//)).toEqual([]);
  });
});
