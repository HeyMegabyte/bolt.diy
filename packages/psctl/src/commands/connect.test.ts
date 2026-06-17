/**
 * Unit tests for the pure `psctl connect` config helpers. Run with:
 *   node --test --experimental-strip-types src/commands/connect.test.ts
 * (or `bun test src/commands/connect.test.ts`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMcpEntry,
  mergeMcpConfig,
  resolveConfigPath,
  isPskToken,
  MCP_SERVER_KEY,
} from './connect-config.ts';

test('buildMcpEntry targets /api/mcp with a Bearer header and trims trailing slashes', () => {
  const e = buildMcpEntry('psk_abc12345', 'https://projectsites.dev/');
  assert.equal(e.type, 'http');
  assert.equal(e.url, 'https://projectsites.dev/api/mcp');
  assert.equal(e.headers.Authorization, 'Bearer psk_abc12345');
});

test('mergeMcpConfig preserves existing servers + top-level keys', () => {
  const existing = { foo: 1, mcpServers: { other: { type: 'stdio' } } };
  const merged = mergeMcpConfig(existing, buildMcpEntry('psk_abc12345'));
  assert.equal((merged as { foo: number })['foo'], 1); // unrelated key kept
  const servers = merged['mcpServers'] as Record<string, unknown>;
  assert.ok(servers['other'], 'existing server preserved');
  assert.ok(servers[MCP_SERVER_KEY], 'projectsites server added');
});

test('mergeMcpConfig handles a missing / non-object existing config', () => {
  const merged = mergeMcpConfig(null, buildMcpEntry('psk_abc12345'));
  assert.ok((merged['mcpServers'] as Record<string, unknown>)[MCP_SERVER_KEY]);
});

test('mergeMcpConfig overwrites a stale projectsites entry (re-connect)', () => {
  const existing = { mcpServers: { [MCP_SERVER_KEY]: { type: 'http', url: 'old', headers: { Authorization: 'Bearer psk_old00000' } } } };
  const merged = mergeMcpConfig(existing, buildMcpEntry('psk_new12345'));
  const servers = merged['mcpServers'] as Record<string, { headers: { Authorization: string } }>;
  const entry = servers[MCP_SERVER_KEY];
  assert.ok(entry, 'entry present');
  assert.equal(entry.headers.Authorization, 'Bearer psk_new12345');
});

test('resolveConfigPath maps scope to the right file', () => {
  assert.equal(resolveConfigPath('project', '/work/app', '/home/u'), '/work/app/.mcp.json');
  assert.equal(resolveConfigPath('global', '/work/app', '/home/u'), '/home/u/.claude.json');
});

test('isPskToken accepts psk_ tokens and rejects junk', () => {
  assert.equal(isPskToken('psk_abc12345'), true);
  assert.equal(isPskToken('sk_abc12345'), false);
  assert.equal(isPskToken('psk_short'), false);
  assert.equal(isPskToken(undefined), false);
});
