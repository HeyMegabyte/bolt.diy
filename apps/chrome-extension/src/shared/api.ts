/**
 * Shared types + helpers for talking to the ProjectSites Worker.
 */

export const PROJECTSITES_ORIGIN = 'https://projectsites.dev';
export const IMPORT_ENDPOINT = `${PROJECTSITES_ORIGIN}/api/sites/import-from-url`;
export const ADMIN_BUILD_ROUTE = (siteId: string): string =>
  `${PROJECTSITES_ORIGIN}/admin/sites/${siteId}?from=extension`;
export const WAITING_ROUTE = (siteId: string): string =>
  `${PROJECTSITES_ORIGIN}/waiting?siteId=${encodeURIComponent(siteId)}&from=extension`;

export interface ImportFromUrlRequest {
  url: string;
  source: 'chrome-extension';
  page_title?: string;
  referer?: string;
  user_intent?: 'clone' | 'inspire' | 'compare';
}

export interface ImportFromUrlResponse {
  site_id: string;
  slug: string;
  status: 'queued' | 'generating' | 'published' | 'error';
  preview_url?: string;
}

export async function postImport(
  payload: ImportFromUrlRequest,
): Promise<ImportFromUrlResponse> {
  const res = await fetch(IMPORT_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`import failed: ${res.status} ${text}`);
  }
  return (await res.json()) as ImportFromUrlResponse;
}
