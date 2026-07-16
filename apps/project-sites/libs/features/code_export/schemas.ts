/**
 * @module libs/features/code_export/schemas
 *
 * Zod schemas for the Code Export feature — typed contracts for the CF project
 * generator, admin download route, and E2E test assertions.
 *
 * @remarks
 * Each export produces a self-contained Cloudflare Worker project: wrangler.toml,
 * Worker source (Hono), D1 migrations, R2 asset references, and a README.md.
 * The project deploys with one command: `npx wrangler deploy`.
 */
import { z } from 'zod';

// ── Export request ──────────────────────────────────────────────────────────

export const CodeExportRequestSchema = z.object({
  /** Site ID to export. */
  siteId: z.string().min(1),
  /** Whether to include D1 data as SQL INSERT statements (default: true). */
  includeData: z.boolean().optional().default(true),
  /** Whether to include R2 assets as base64-encoded files (default: false — reference-only). */
  includeAssets: z.boolean().optional().default(false),
});

export type CodeExportRequest = z.infer<typeof CodeExportRequestSchema>;

// ── Project manifest (the generated project shape) ──────────────────────────

export const GeneratedFileSchema = z.object({
  /** Relative path within the project, e.g. `src/index.ts` or `wrangler.toml`. */
  path: z.string(),
  /** File content as a UTF-8 string. */
  content: z.string(),
  /** Byte size of content. */
  sizeBytes: z.number().int().nonnegative(),
});

export type GeneratedFile = z.infer<typeof GeneratedFileSchema>;

export const CfProjectManifestSchema = z.object({
  /** Site slug used as the project name. */
  projectName: z.string(),
  /** ISO 8601 timestamp of generation. */
  generatedAt: z.string(),
  /** Every file in the generated project. */
  files: z.array(GeneratedFileSchema),
  /** Total byte size across all files. */
  totalSize: z.number().int().nonnegative(),
  /** Number of files. */
  fileCount: z.number().int().nonnegative(),
  /** The D1 database name used in wrangler.toml. */
  d1Binding: z.string(),
  /** The R2 bucket name used in wrangler.toml. */
  r2Binding: z.string(),
});

export type CfProjectManifest = z.infer<typeof CfProjectManifestSchema>;

// ── Worker binding shapes (extracted from site config) ──────────────────────

export const SiteBindingsSchema = z.object({
  /** Site slug used for project naming. */
  slug: z.string().min(1),
  /** Primary custom hostname (if set). */
  primaryHostname: z.string().optional(),
  /** D1 database ID (CF resource ID). */
  d1DatabaseId: z.string().optional(),
  /** D1 database name for binding. */
  d1DatabaseName: z.string().optional(),
  /** R2 bucket name. */
  r2BucketName: z.string().optional(),
  /** KV namespace ID for caching. */
  kvNamespaceId: z.string().optional(),
  /** KV namespace name for binding. */
  kvNamespaceName: z.string().optional(),
  /** Site pages as { path, title, content } triples. */
  pages: z
    .array(
      z.object({
        path: z.string(),
        title: z.string().optional(),
        content: z.string(),
      }),
    )
    .optional()
    .default([]),
  /** Raw static assets from the site's R2 prefix. */
  staticAssets: z
    .array(
      z.object({
        path: z.string(),
        content: z.string(),
        contentType: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
  /** D1 table schemas (CREATE TABLE statements). */
  d1Schema: z.array(z.string()).optional().default([]),
  /** D1 data rows as INSERT statements. */
  d1Data: z.array(z.string()).optional().default([]),
});

export type SiteBindings = z.infer<typeof SiteBindingsSchema>;

// ── Download response metadata ──────────────────────────────────────────────

export const CodeExportResponseSchema = z.object({
  /** The generated project manifest. */
  manifest: CfProjectManifestSchema,
  /** Suggested filename for the download. */
  downloadFilename: z.string(),
  /** MIME type for the download. */
  contentType: z.string(),
});

export type CodeExportResponse = z.infer<typeof CodeExportResponseSchema>;
