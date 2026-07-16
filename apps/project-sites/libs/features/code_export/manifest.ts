/**
 * Code Export — feature module manifest.
 *
 * @remarks
 * One-click export of any generated site as a deployable Cloudflare Worker
 * project. Produces a zip containing wrangler.toml, Worker source (Hono),
 * D1 migrations, R2 asset references, package.json, tsconfig.json, and a
 * README.md. Deploys with one command: `npx wrangler deploy`.
 *
 * The ultimate lock-in killer that paradoxically increases trust + conversion.
 * When a customer knows they can leave anytime, they're more likely to stay.
 */
export const manifest = {
  slug: 'code_export',
  name: 'Code Export to Self-Hosted CF',
  description:
    'One-click export of any generated site as a self-contained, deployable Cloudflare Worker project. Includes wrangler.toml, Worker source (Hono), D1 migrations, R2 assets, and deploy instructions.',
  flagKey: 'code_export',
  owner: 'brian@megabyte.space',
  stage: 'experimental' as const,
  createdAt: '2026-07-15',
};
