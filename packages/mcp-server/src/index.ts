/**
 * @package @projectsites/mcp-server
 * @description Model Context Protocol server for projectsites.dev.
 *
 * Exposes every public API surface via typed MCP tools so external agents
 * (Claude Desktop, ChatGPT, Cursor, Claude Agent SDK apps) can drive the
 * platform — list sites, deploy, update the Trust Center, manage the
 * Enterprise plan, watch Stripe App Marketplace installs.
 *
 * Two factories ship:
 *   - {@link createServer}      — returns a configured `McpServer` instance
 *                                 ready to bind to any transport.
 *   - {@link runStdioServer}    — runs the server on stdio for local
 *                                 `claude-desktop` / `cursor` integration.
 *
 * @example
 * ```ts
 * import { runStdioServer } from '@projectsites/mcp-server';
 *
 * await runStdioServer({
 *   apiToken: process.env.PROJECTSITES_API_TOKEN!,
 *   baseUrl: 'https://projectsites.dev',
 * });
 * ```
 */

export { createServer, runStdioServer, type McpServerConfig } from './server.js';
export { buildTools, type ProjectSitesTool } from './tools.js';
