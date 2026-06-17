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

export type ListSitesArgs = z.infer<typeof ListSitesInput>;
export type GetSiteArgs = z.infer<typeof GetSiteInput>;
export type BuildStatusArgs = z.infer<typeof BuildStatusInput>;
