/**
 * @module commands/connect-config
 * @description Pure, dependency-free config helpers for `psctl connect`. Kept
 * separate from `connect.ts` (which does fs/readline/SDK I/O) so the logic is
 * unit-testable without pulling in `@projectsites/sdk` or touching the disk.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/** Default API origin (mirrors @projectsites/sdk DEFAULT_BASE_URL). */
export const DEFAULT_BASE_URL = 'https://projectsites.dev';

/** The key under `mcpServers` the entry is written to. */
export const MCP_SERVER_KEY = 'projectsites';

/** Shape of the HTTP MCP server entry an MCP client reads. */
export interface McpHttpEntry {
  type: 'http';
  url: string;
  headers: { Authorization: string };
}

/** Build the MCP server entry pointing at the platform MCP endpoint. */
export function buildMcpEntry(token: string, baseUrl: string = DEFAULT_BASE_URL): McpHttpEntry {
  const base = baseUrl.replace(/\/+$/, '');
  return { type: 'http', url: `${base}/api/mcp`, headers: { Authorization: `Bearer ${token}` } };
}

/**
 * Merge the projectsites entry into an existing MCP config object WITHOUT
 * clobbering other servers or unrelated top-level keys. Pure → unit-tested.
 */
export function mergeMcpConfig(existing: unknown, entry: McpHttpEntry): Record<string, unknown> {
  const base = (existing && typeof existing === 'object' ? existing : {}) as Record<string, unknown>;
  const current = base['mcpServers'];
  const servers = current && typeof current === 'object' ? (current as Record<string, unknown>) : {};
  return { ...base, mcpServers: { ...servers, [MCP_SERVER_KEY]: entry } };
}

/** Resolve the target config path for the chosen scope. */
export function resolveConfigPath(
  scope: 'global' | 'project',
  cwd: string = process.cwd(),
  home: string = homedir(),
): string {
  return scope === 'global' ? join(home, '.claude.json') : join(cwd, '.mcp.json');
}

/** A psk_ public API token. */
export function isPskToken(t: unknown): t is string {
  return typeof t === 'string' && /^psk_[A-Za-z0-9]{8,}$/.test(t.trim());
}
