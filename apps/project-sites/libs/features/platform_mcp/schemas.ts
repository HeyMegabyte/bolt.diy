/**
 * @module libs/features/platform_mcp/schemas
 * @description Zod contracts for the platform-level MCP server — the JSON-RPC 2.0
 * envelope plus every tool's input shape. One schema → runtime validation →
 * advertised `inputSchema` in `tools/list`. No hand-kept second copy.
 */
import { z } from 'zod';

/** JSON-RPC 2.0 request envelope accepted at POST /api/mcp. */
export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

/** `tools/call` params. */
export const ToolCallParamsSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.unknown()).default({}),
});

// ── Tool input schemas (also serialized into tools/list inputSchema) ──────────
export const ListSitesInput = z.object({
  limit: z.number().int().min(1).max(100).default(50),
});
export const GetSiteInput = z.object({
  site_id: z.string().min(1),
});
export const BuildStatusInput = z.object({
  site_id: z.string().min(1),
});

/**
 * `deploy_site` input. Hardened against R2 path traversal + resource exhaustion:
 * each `path` is relative, slash-normalized, and may not escape the site prefix
 * (no `..` segments, no leading `/`, no backslashes, no protocol). Bounds cap
 * file count + per-file + total size so a single token can't exhaust the Worker.
 */
export const DEPLOY_MAX_FILES = 500;
export const DEPLOY_MAX_FILE_BYTES = 2_000_000; // 2 MB per file
export const DEPLOY_MAX_TOTAL_BYTES = 20_000_000; // 20 MB per deploy

const safeRelPath = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.includes('\0') && !p.includes('\\'), 'Path may not contain backslashes or null bytes.')
  .refine((p) => !p.startsWith('/') && !/^[a-zA-Z]+:/.test(p), 'Path must be relative (no leading slash or scheme).')
  .refine(
    (p) => p.split('/').every((seg) => seg !== '..' && seg !== '.'),
    'Path may not contain "." or ".." segments.',
  )
  .refine((p) => p.split('/').every((seg) => seg.length > 0), 'Path may not contain empty segments.');

export const DeploySiteInput = z
  .object({
    site_id: z.string().min(1),
    files: z
      .array(
        z.object({
          path: safeRelPath,
          content: z.string().max(DEPLOY_MAX_FILE_BYTES, 'File content exceeds the per-file size limit.'),
        }),
      )
      .min(1, 'Provide at least one file as {path, content}.')
      .max(DEPLOY_MAX_FILES, `A deploy may include at most ${DEPLOY_MAX_FILES} files.`),
  })
  .refine(
    (v) => v.files.reduce((n, f) => n + f.content.length, 0) <= DEPLOY_MAX_TOTAL_BYTES,
    'Total deploy size exceeds the 20 MB limit.',
  );

export const TailLogsInput = z.object({
  site_id: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export type ListSitesArgs = z.infer<typeof ListSitesInput>;
export type GetSiteArgs = z.infer<typeof GetSiteInput>;
export type BuildStatusArgs = z.infer<typeof BuildStatusInput>;
export type DeploySiteArgs = z.infer<typeof DeploySiteInput>;
export type TailLogsArgs = z.infer<typeof TailLogsInput>;
