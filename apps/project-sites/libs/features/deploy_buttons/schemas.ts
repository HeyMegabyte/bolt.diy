/**
 * @module libs/features/deploy_buttons/schemas
 * @description Zod contracts for the deploy-buttons feature — the query-param
 * shape and the generated-snippet response.
 */
import { z } from 'zod';

/** Query parameters accepted by GET /api/deploy-buttons/:siteId */
export const DeployButtonsQuerySchema = z.object({
  /** Badge style forwarded to shields.io-compatible renderers. */
  style: z.enum(['flat', 'flat-square', 'plastic', 'for-the-badge', 'social']).default('flat'),
  /** Override the label text on the badge (default: "hosted on"). */
  label: z.string().max(32).optional(),
});
export type DeployButtonsQuery = z.infer<typeof DeployButtonsQuerySchema>;

/** The snippet bundle returned by the endpoint. */
export const DeployButtonsResponseSchema = z.object({
  site_id: z.string(),
  slug: z.string(),
  /** Live URL of the site. */
  url: z.string().url(),
  /** Markdown embed for GitHub READMEs. */
  markdown_badge: z.string(),
  /** Raw HTML embed for site footers / landing pages. */
  html_badge: z.string(),
  /** One-click "Deploy to projectsites.dev" Markdown button. */
  markdown_deploy_button: z.string(),
  /** One-click "Deploy to projectsites.dev" HTML button. */
  html_deploy_button: z.string(),
});
export type DeployButtonsResponse = z.infer<typeof DeployButtonsResponseSchema>;
