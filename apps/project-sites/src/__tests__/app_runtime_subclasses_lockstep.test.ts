/**
 * AppRuntime subclasses ↔ catalog-slug lockstep (dispatcher routing correctness).
 *
 * `app_runtime_subclasses.ts` declares one `AppRuntimeContainer` subclass per
 * installable app (each with a `static APP_SLUG`) AND a `SUPPORTED_APP_SLUGS`
 * array that drives the dispatcher's binding-lookup + `isSupportedSlug`. Its
 * header asks to "keep in lockstep with wrangler.toml" — a manual sync.
 *
 * The deterministic, always-meaningful half of that lockstep is INTERNAL: every
 * routable slug must have exactly one subclass and vice versa, or the dispatcher
 * either can't route a listed slug or carries a dead unreachable subclass. The
 * per-image `[[env.production.containers]]` blocks in wrangler.toml are
 * intentionally COMMENTED OUT (deferred per the 2026-05-24 deploy note), so this
 * guard locks the slug↔subclass invariant + asserts the one LIVE base container
 * (`AppRuntimeContainer`) is declared — not the deferred per-image blocks.
 *
 * Text-based (not import-based) so it needs no `cloudflare:workers` DO mock —
 * mirrors the trace_hub / app_runtime schema lockstep guards.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SUBCLASSES_SRC = readFileSync(
  join(__dirname, '../durable_objects/app_runtime_subclasses.ts'),
  'utf8',
);

/** All `static APP_SLUG = '...'` values declared by the subclasses, sorted. */
function declaredAppSlugs(src: string): string[] {
  return [...src.matchAll(/APP_SLUG\s*=\s*'([^']+)'/g)].map((m) => m[1]).sort();
}

/** The slug literals inside the `SUPPORTED_APP_SLUGS = [...] as const` array, sorted. */
function supportedSlugs(src: string): string[] {
  const block = src.match(/SUPPORTED_APP_SLUGS\s*=\s*\[([\s\S]*?)\]\s*as const;/);
  if (!block) throw new Error('SUPPORTED_APP_SLUGS array literal not found');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

describe('AppRuntime subclass ↔ catalog-slug lockstep (dispatcher routing)', () => {
  it('every SUPPORTED_APP_SLUG has exactly one subclass declaring it (and vice versa)', () => {
    // Mismatch ⇒ either a listed slug the dispatcher can't route to a class, or a
    // subclass with no catalog entry (dead/unreachable).
    expect(declaredAppSlugs(SUBCLASSES_SRC)).toEqual(supportedSlugs(SUBCLASSES_SRC));
  });

  it('the live AppRuntimeContainer base is declared in wrangler.toml [[env.production.containers]]', () => {
    const wrangler = readFileSync(join(__dirname, '../../wrangler.toml'), 'utf8');
    expect(wrangler).toMatch(/class_name\s*=\s*"AppRuntimeContainer"/);
  });
});
