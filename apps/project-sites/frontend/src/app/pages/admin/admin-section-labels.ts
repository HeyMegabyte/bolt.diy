/**
 * @module pages/admin/admin-section-labels
 *
 * Route-segment → human label map that drives the per-route document title
 * (`<label> · ProjectSites`) + meta description in {@link AdminComponent}.
 *
 * Every routed admin section MUST have an entry here — a missing entry falls
 * back to 'Dashboard' (the `/admin` home), leaving a stale/incorrect document
 * title (WCAG 2.4.2 Page Titled). Keep this in sync with the admin child routes
 * in `app.routes.ts`.
 */
export const ADMIN_SECTION_LABELS: Readonly<Record<string, string>> = {
  // `/admin` (path:'') now renders the AI Dashboard, NOT the editor — the editor
  // moved to `/admin/editor`. Label the index route 'Dashboard' so the breadcrumb
  // + document title match what's on screen (WCAG 2.4.2). editor* stay 'Editor'.
  '': 'Dashboard', admin: 'Dashboard', editor: 'Editor', 'editor-native': 'Editor',
  snapshots: 'Snapshots', analytics: 'Analytics',
  forms: 'Forms', traces: 'AI Traces', 'ai-logs': 'AI Traces',
  'ai-endpoints': 'AI Agents', domains: 'Domains', docs: 'Docs',
  user: 'User Settings', apps: 'Apps', instances: 'App Instances',
  billing: 'Billing', audit: 'Audit Log', settings: 'Settings',
  voice: 'Voice', media: 'Media',
  'feature-flags': 'Feature Flags', features: 'Features', social: 'Social',
  pseo: 'pSEO', 'content-freshness': 'Content Freshness', logs: 'Logs',
  mcp: 'MCP', seo: 'SEO', inbox: 'Inbox', marketplace: 'Marketplace',
  import: 'Import', sites: 'Sites', welcome: 'Welcome', email: 'Email',
  swarm: 'Swarm', copilot: 'Copilot', dna: 'Site DNA', branches: 'Branches',
  // Coverage gap closed: these routed sections fell back to 'Editor' → stale
  // document title (WCAG 2.4.2). Verified live the titles stayed "Editor".
  'bulk-ops': 'Bulk Ops', deliverability: 'Deliverability', webhooks: 'Webhooks',
  'review-links': 'Review Links', 'api-tokens': 'API Tokens', enterprise: 'Enterprise',
  recipes: 'Automations', trust: 'Trust Center', 'stripe-app-status': 'Stripe Status',
  'accept-invite': 'Accept Invite',
};

/**
 * Resolve the human label for a route's last path segment.
 * Falls back to 'Dashboard' (the `/admin` home) for unknown segments.
 */
export function adminSectionLabel(segment: string): string {
  return ADMIN_SECTION_LABELS[segment] ?? 'Dashboard';
}
