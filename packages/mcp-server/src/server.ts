/**
 * @module server
 * @description Builds the MCP server instance + a stdio entrypoint.
 *
 * Keeps a thin seam between the MCP SDK and our tool registry so test fakes
 * (and future HTTP transports) can swap in.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ProjectSitesClient } from '@projectsites/sdk';
import { buildTools, type ProjectSitesTool } from './tools.js';

export interface McpServerConfig {
  /** Bearer token (psk_...) for `@projectsites/sdk`. */
  apiToken: string;
  /** API base URL. Defaults to https://projectsites.dev */
  baseUrl?: string;
  /** Optional override — useful for tests. Defaults to the production SDK client. */
  client?: ProjectSitesClient;
}

const SERVER_NAME = '@projectsites/mcp-server';
const SERVER_VERSION = '0.1.0';

/** Build a configured `McpServer` instance with every Project Sites tool registered. */
export function createServer(config: McpServerConfig): McpServer {
  const client =
    config.client ??
    new ProjectSitesClient({
      apiToken: config.apiToken,
      baseUrl: config.baseUrl,
    });

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  const tools: ProjectSitesTool[] = buildTools(client);

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      // The MCP SDK passes the validated args object as the first arg.
      // Our handlers accept a plain Record<string, unknown> so the cast
      // here is purely structural — Zod has already validated.
      async (args: unknown) =>
        tool.handler((args as Record<string, unknown>) ?? {}),
    );
  }

  return server;
}

/** Start the MCP server on stdio (default for `claude-desktop` / `cursor`). */
export async function runStdioServer(config: McpServerConfig): Promise<void> {
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
