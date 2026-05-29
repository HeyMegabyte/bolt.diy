#!/usr/bin/env node
/**
 * @module cli
 * @description Entry point for `npx @projectsites/mcp-server`.
 *
 * Reads the Project Sites API token from one of (in order of precedence):
 *   - PROJECTSITES_API_TOKEN env var
 *   - PS_API_TOKEN env var
 *   - --token <psk_...> argv flag
 *
 * Optionally reads the API base URL from PROJECTSITES_BASE_URL (defaults to
 * https://projectsites.dev).
 */

import { runStdioServer } from './server.js';

function argFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

const apiToken =
  process.env['PROJECTSITES_API_TOKEN'] ??
  process.env['PS_API_TOKEN'] ??
  argFlag('token');

if (!apiToken) {
  process.stderr.write(
    [
      'projectsites-mcp: missing API token',
      '',
      'Set PROJECTSITES_API_TOKEN, PS_API_TOKEN, or pass --token <psk_...>',
      'Generate a token at https://projectsites.dev/admin/api-tokens',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const baseUrl = process.env['PROJECTSITES_BASE_URL'] ?? argFlag('base-url');

runStdioServer({
  apiToken,
  baseUrl,
}).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`projectsites-mcp: ${message}\n`);
  process.exit(1);
});
