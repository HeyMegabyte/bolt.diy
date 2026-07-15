/**
 * Site Tags — feature module manifest.
 *
 * @remarks
 * Per-site labels as colored pills (D1-backed, filterable). Each tag has a
 * name, color, and optional emoji. Tags are org-scoped and reusable across
 * sites. The site list gains a filter-by-tag picker and density options.
 */
export const manifest = {
  slug: 'site_tags',
  name: 'Site Tags & Labels',
  description:
    'Per-site colored label pills with custom names, colors, and emoji icons. Filterable in the site list. Tags are org-scoped and reusable across sites.',
  flagKey: 'site_tags',
  owner: 'brian@megabyte.space',
  stage: 'experimental' as const,
  createdAt: '2026-07-15',
};
