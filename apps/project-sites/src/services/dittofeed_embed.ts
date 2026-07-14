/**
 * Dittofeed embedded editors — iframe URL generation + config for admin dashboard.
 *
 * @remarks
 * Per the architecture decision: 1 automation = guided/simple setup in ProjectSites.
 * 2+ automations = embed Dittofeed editors in the ProjectSites dashboard.
 * Enterprise = detached workspace only for hard isolation.
 *
 * All editors are served by the Dittofeed instance at engage.projectsites.dev
 * and embedded via iframe in the Angular admin at /admin/engage/:siteId/:editor.
 */

import type { Env } from '../types/env.js';
import { buildDittofeedConfig } from './dittofeed_dispatch.js';

// ---------------------------------------------------------------------------
// Editor types
// ---------------------------------------------------------------------------

export type DittofeedEditor =
  | 'journeys'       // Journey Builder — visual drag-and-drop automation flows
  | 'journeys-table' // Journey Table — list/manage automations
  | 'broadcast'      // Broadcast Editor — one-off campaigns
  | 'templates'      // Template Editor — reusable email/SMS/webhook templates
  | 'segments'       // Segment Editor — audience rules
  | 'deliveries'     // Deliveries Table — message history and delivery status
  | 'analysis';      // Analysis Chart — performance reporting

export interface EmbeddedEditorConfig {
  /** The Dittofeed URL path for this editor. */
  url: string;
  /** Human-readable label shown in the admin nav. */
  label: string;
  /** Icon identifier for the admin sidebar. */
  icon: string;
  /** Short description for the editor card. */
  description: string;
}

/** Canonical editor registry — single source of truth for all embedded editors. */
export const DITTOFEED_EDITORS: Record<DittofeedEditor, EmbeddedEditorConfig> = {
  journeys: {
    url: '/dashboard/journeys',
    label: 'Journeys',
    icon: 'route',
    description: 'Visual drag-and-drop automation flows',
  },
  'journeys-table': {
    url: '/dashboard/journeys/table',
    label: 'All Journeys',
    icon: 'list',
    description: 'List and manage all automations',
  },
  broadcast: {
    url: '/dashboard/broadcasts',
    label: 'Broadcast',
    icon: 'megaphone',
    description: 'One-off email and SMS campaigns',
  },
  templates: {
    url: '/dashboard/templates',
    label: 'Templates',
    icon: 'file-code',
    description: 'Reusable email, SMS, and webhook templates',
  },
  segments: {
    url: '/dashboard/segments',
    label: 'Segments',
    icon: 'users',
    description: 'Audience rules and targeting',
  },
  deliveries: {
    url: '/dashboard/deliveries',
    label: 'Deliveries',
    icon: 'inbox',
    description: 'Message history and delivery status',
  },
  analysis: {
    url: '/dashboard/analysis',
    label: 'Analysis',
    icon: 'chart-bar',
    description: 'Performance reporting and analytics',
  },
};

/**
 * Build the full iframe URL for a Dittofeed embedded editor.
 *
 * @param env - Worker env (for Dittofeed base URL).
 * @param editor - The editor to embed.
 * @param siteId - The site to scope the editor to.
 * @returns The full HTTPS URL for iframe embedding, or undefined if not configured.
 */
export function buildEmbeddedEditorUrl(
  env: Env,
  editor: DittofeedEditor,
  siteId: string,
): string | undefined {
  const dcfg = buildDittofeedConfig(env);
  if (!dcfg) return undefined;

  const config = DITTOFEED_EDITORS[editor];
  return `${dcfg.baseUrl}${config.url}?siteId=${encodeURIComponent(siteId)}`;
}

/**
 * Build an iframe HTML snippet for embedding a Dittofeed editor.
 */
export function buildEditorIframe(
  env: Env,
  editor: DittofeedEditor,
  siteId: string,
): string | undefined {
  const url = buildEmbeddedEditorUrl(env, editor, siteId);
  if (!url) return undefined;

  return `<iframe
    src="${url}"
    style="width:100%;height:100%;border:none;min-height:80vh"
    allow="clipboard-write"
    title="${DITTOFEED_EDITORS[editor].label}"
  ></iframe>`;
}

/**
 * Determine which editors to show based on the site's automation count.
 *
 * @remarks
 * 0 automations → show "Get Started" card
 * 1 automation  → show the guided/simple setup + link to the Journeys Table
 * 2+ automations → show the full embedded editor suite
 */
export function editorsForAutomationCount(count: number): {
  mode: 'guided' | 'embedded';
  editors: DittofeedEditor[];
} {
  if (count === 0) {
    return { mode: 'guided', editors: [] };
  }
  if (count === 1) {
    return { mode: 'guided', editors: ['journeys-table'] };
  }
  return {
    mode: 'embedded',
    editors: ['journeys', 'journeys-table', 'segments', 'templates', 'broadcast', 'deliveries', 'analysis'],
  };
}
