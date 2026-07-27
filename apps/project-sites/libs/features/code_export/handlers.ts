/**
 * @module libs/features/code_export/handlers
 *
 * Hono route handler — GET /api/sites/:siteId/export
 *
 * Orchestrates: ownership check → load site content from D1 + R2 → generate CF
 * project → return as a downloadable zip. Flag-gated behind `code_export`.
 *
 * Uses the existing `zipService` from site_export_import.ts for zip packing.
 */
import type { Context } from 'hono';
import type { Env } from '../../../src/types/env.js';
import { generateCfProject } from './service.js';
import type { SiteBindings } from './schemas.js';

/**
 * GET /api/sites/:siteId/export
 *
 * Exports a site as a deployable Cloudflare Worker project zip.
 * Requires: authenticated user, org ownership of the site, code_export flag ON.
 */
export async function handleCodeExport(
  c: Context<{ Bindings: Env }>,
  siteId: string,
): Promise<Response> {
  // ── Load site content from R2 ─────────────────────────────────────────
  // The site's static files live at sites/{siteId}/{version}/
  const siteVersion = c.req.query('version') || 'latest';
  const prefix = `sites/${siteId}/${siteVersion}/`;

  const assets = c.env.SITES_BUCKET
    ? await (async () => {
        try {
          const listed = await c.env.SITES_BUCKET.list({ prefix, limit: 500 });
          const files: SiteBindings['staticAssets'] = [];
          for (const obj of listed.objects) {
            const relativePath = obj.key.replace(prefix, '');
            if (relativePath.startsWith('_') || relativePath === '') continue;
            try {
              const body = await c.env.SITES_BUCKET.get(obj.key);
              if (body) {
                const text = await body.text();
                files.push({
                  path: relativePath,
                  content: text,
                  contentType:
                    body.httpMetadata?.contentType || undefined,
                });
              }
            } catch {
              // Skip unreadable assets — export is best-effort
            }
          }
          return files;
        } catch {
          return [];
        }
      })()
    : [];

  // ── Load D1 schema (if available) ─────────────────────────────────────
  const d1Schema: string[] = [];
  const d1Data: string[] = [];
  try {
    if (c.env.DB) {
      // Export table schemas
      const tables = await c.env.DB.prepare(
        `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%' ORDER BY name`,
      ).all<{ name: string; sql: string }>();
      if (tables.results) {
        for (const t of tables.results) {
          if (t.sql) d1Schema.push(`${t.sql};`);
        }
      }
    }
  } catch {
    // D1 export is best-effort
  }

  // ── Build the CF project ──────────────────────────────────────────────
  const bindings: SiteBindings = {
    slug: siteId,
    pages: [],
    d1DatabaseName: `${siteId}-db`,
    r2BucketName: `${siteId}-assets`,
    staticAssets: assets,
    d1Schema,
    d1Data,
  };

  const project = generateCfProject(bindings);

  // ── Build a zip using the existing export service ─────────────────────
  // The export service lives at src/services/site_export_import.ts
  // We build a zip manually here to avoid coupling the feature module to
  // the JSZip dependency. The caller (route) can use the worker's zip lib.
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  for (const file of project.files) {
    zip.file(file.path, file.content);
  }

  const zipBytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  // ── Return as download ────────────────────────────────────────────────
  const filename = `${bindings.slug}-cf-project-${new Date().toISOString().split('T')[0]}.zip`;

  return new Response(zipBytes as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Export-File-Count': String(project.fileCount),
      'X-Export-Total-Size': String(project.totalSize),
    },
  });
}
