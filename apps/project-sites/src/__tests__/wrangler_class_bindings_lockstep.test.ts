/**
 * wrangler.toml `class_name` ↔ exported `src/` class lockstep (deploy safety).
 *
 * Every Workflow / Durable Object / Container binding in wrangler.toml names a
 * `class_name` that MUST resolve to an exported class in the worker source. A
 * typo, a rename that missed one side, or a deleted class leaves a dangling
 * binding that only fails at `wrangler deploy` (or at runtime on first DO/Workflow
 * activation) — nothing in jest/CI catches it today. This locks the two: a live
 * binding with no exported class fails here, before deploy.
 *
 * Scoped to LIVE (non-commented) class_name declarations — commented blocks are
 * deferred config (per the per-image container note) and can't break a deploy.
 * Text/AST-light (regex over source text) so it needs no `cloudflare:workers`
 * mock — mirrors the trace_hub / app_runtime / subclasses lockstep guards.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');
const WRANGLER = join(__dirname, '../../wrangler.toml');

/** Every `export class X` name declared anywhere under src/ (tests excluded). */
function exportedClasses(dir: string, acc: Set<string>): Set<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      exportedClasses(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      for (const m of readFileSync(full, 'utf8').matchAll(/export class (\w+)\b/g)) acc.add(m[1]);
    }
  }
  return acc;
}

/** Distinct class_name values from LIVE (non-`#`-commented) wrangler lines. */
function liveWranglerClassNames(): string[] {
  const live = readFileSync(WRANGLER, 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
  return [...new Set([...live.matchAll(/class_name\s*=\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]))];
}

describe('wrangler class_name ↔ exported src class lockstep (deploy safety)', () => {
  it('every live wrangler.toml class_name resolves to an exported class in src/', () => {
    const exported = exportedClasses(SRC, new Set());
    const missing = liveWranglerClassNames().filter((cn) => !exported.has(cn));
    expect(missing).toEqual([]);
  });

  it('scans a non-trivial set of bindings (guard is not vacuously passing)', () => {
    // Guards against a regex that silently matches nothing → the check above
    // passing on an empty list.
    //
    // Floor recount 2026-07-31: commit 655ccf2c ("feat(catalog): enable Deploy
    // for all 68 catalog apps", 2026-07-14) removed the live SiteBuilderContainer /
    // AppRuntimeContainer / TraceHub / ActivityHub / ConversationHub bindings
    // (containers now live as commented per-image deferred config). Live ground
    // truth is 6 distinct class_names — the 6 Workflows (SiteGeneration,
    // SocialPublish, PseoGeneration, DriveSync, ImageGeneration, SnapshotQuality).
    // Raise this floor again when container/DO bindings go live-uncommented.
    expect(liveWranglerClassNames().length).toBeGreaterThanOrEqual(6);
  });
});
