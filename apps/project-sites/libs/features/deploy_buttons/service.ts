/**
 * @module libs/features/deploy_buttons/service
 * @description Business logic for the deploy-buttons feature. Generates
 * one-click Deploy button snippets and "hosted on" badge embeds for GitHub
 * READMEs and site footers. Pure string-builder — no I/O, fully testable.
 */

import type { DeployButtonsQuery, DeployButtonsResponse } from './schemas.js';

/** Feature flag key that gates this feature. */
export const FLAG_KEY = 'deploy_buttons';

/** Base URL for projectsites.dev (used in badge hrefs). */
const PS_BASE = 'https://projectsites.dev';

/** Shields.io-compatible badge base URL. */
const SHIELDS_BASE = 'https://img.shields.io/badge';

/** Encoded label for the hosted-on badge. */
const DEFAULT_LABEL = 'hosted%20on';

/**
 * Encodes a string for use in a shields.io badge URL segment.
 * Replaces dashes with `--` (shields.io escape) and spaces with `_`.
 *
 * @example
 * shieldsEncode('my site') // => 'my_site'
 */
function shieldsEncode(s: string): string {
  return s.replace(/-/g, '--').replace(/\s+/g, '_');
}

/**
 * Generates badge + deploy-button snippets for a given site.
 *
 * @param site - Minimal site record from D1 (id, slug, business_name).
 * @param query - Validated query params (style, optional label override).
 * @returns Typed {@link DeployButtonsResponse} with markdown and HTML variants.
 *
 * @example
 * const snippets = generateDeploySnippets(
 *   { id: 'site-001', slug: 'acme', business_name: 'Acme Corp', url: 'https://acme.projectsites.dev' },
 *   { style: 'flat' }
 * );
 */
export function generateDeploySnippets(
  site: { id: string; slug: string; business_name: string; url: string },
  query: DeployButtonsQuery,
): DeployButtonsResponse {
  const label = shieldsEncode(query.label ?? DEFAULT_LABEL);
  const message = shieldsEncode('projectsites.dev');
  const color = '00E5FF';
  const style = query.style;

  const badgeSvgUrl = `${SHIELDS_BASE}/${label}-${message}-${color}?style=${style}&logo=cloudflare&logoColor=white`;
  const siteUrl = site.url;
  const deployUrl = `${PS_BASE}/?utm_source=badge&utm_medium=readme&utm_campaign=${site.slug}`;

  const markdownBadge = `[![Hosted on projectsites.dev](${badgeSvgUrl})](${siteUrl})`;

  const htmlBadge =
    `<a href="${siteUrl}" target="_blank" rel="noopener noreferrer">` +
    `<img src="${badgeSvgUrl}" alt="Hosted on projectsites.dev" loading="lazy" />` +
    `</a>`;

  const deployBadgeSvgUrl = `${SHIELDS_BASE}/deploy-to%20projectsites.dev-00E5FF?style=${style}&logo=cloudflare&logoColor=white`;

  const markdownDeployButton =
    `[![Deploy to projectsites.dev](${deployBadgeSvgUrl})](${deployUrl})`;

  const htmlDeployButton =
    `<a href="${deployUrl}" target="_blank" rel="noopener noreferrer">` +
    `<img src="${deployBadgeSvgUrl}" alt="Deploy to projectsites.dev" loading="lazy" />` +
    `</a>`;

  return {
    site_id: site.id,
    slug: site.slug,
    url: siteUrl,
    markdown_badge: markdownBadge,
    html_badge: htmlBadge,
    markdown_deploy_button: markdownDeployButton,
    html_deploy_button: htmlDeployButton,
  };
}
