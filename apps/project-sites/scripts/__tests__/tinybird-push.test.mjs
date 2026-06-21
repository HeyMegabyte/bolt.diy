/**
 * Pure-builder coverage for the CLI-free Tinybird push script. Run:
 *   node --test scripts/__tests__/tinybird-push.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveConfig,
  datafileEndpoint,
  classifyResponse,
  pushAll,
} from '../tinybird-push.mjs';

test('resolveConfig prefers TINYBIRD_TOKEN, trims host slash, null when unset', () => {
  assert.deepEqual(
    resolveConfig({ TINYBIRD_API_HOST: 'https://api.x.co/', TINYBIRD_TOKEN: 't' }),
    { host: 'https://api.x.co', token: 't' },
  );
  // falls back to PASSWORD then MCP_TOKEN
  assert.equal(resolveConfig({ TINYBIRD_API_HOST: 'h', TINYBIRD_PASSWORD: 'p' })?.token, 'p');
  assert.equal(resolveConfig({ TINYBIRD_API_HOST: 'h', TINYBIRD_MCP_TOKEN: 'm' })?.token, 'm');
  assert.equal(resolveConfig({ TINYBIRD_TOKEN: 't' }), null); // no host
  assert.equal(resolveConfig({ TINYBIRD_API_HOST: 'h' }), null); // no token
});

test('datafileEndpoint routes by extension', () => {
  assert.equal(datafileEndpoint('https://h', 'datasources/x.datasource'), 'https://h/v0/datasources');
  assert.equal(datafileEndpoint('https://h', 'pipes/x.pipe'), 'https://h/v0/pipes');
});

test('classifyResponse: 2xx=created, 409=exists, Forward-403 detected, else failed', () => {
  assert.equal(classifyResponse(200), 'created');
  assert.equal(classifyResponse(201), 'created');
  assert.equal(classifyResponse(409), 'exists');
  assert.equal(classifyResponse(400, 'bad schema'), 'failed');
  assert.equal(classifyResponse(403, 'token needs scope PIPES:CREATE'), 'failed'); // plain 403
  // Forward workspace: classic API disabled
  assert.equal(
    classifyResponse(403, '{"error": "Adding or modifying pipes to this workspace can only be done via deployments."}'),
    'forward-deploy-required',
  );
});

test('pushAll posts datasources before pipes, bearer auth, idempotent on 409', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization, body: init.body });
    return { status: url.endsWith('/pipes') ? 409 : 201, text: async () => '' };
  };
  const results = await pushAll(
    { host: 'https://h', token: 'tok' },
    {
      fetchImpl,
      readFileImpl: async (p) => `BODY:${p}`,
      listImpl: async () => ['datasources/events.datasource', 'pipes/funnel.pipe'],
    },
  );
  // datasource first
  assert.match(calls[0].url, /\/v0\/datasources$/);
  assert.match(calls[1].url, /\/v0\/pipes$/);
  assert.equal(calls[0].auth, 'Bearer tok');
  assert.equal(results[0].verdict, 'created');
  assert.equal(results[1].verdict, 'exists'); // 409 treated as success
});

test('pushAll flags a Forward workspace from the 403 deployments message', async () => {
  const fetchImpl = async () => ({
    status: 403,
    text: async () => '{"error": "Adding or modifying pipes to this workspace can only be done via deployments."}',
  });
  const results = await pushAll(
    { host: 'https://h', token: 't' },
    { fetchImpl, readFileImpl: async () => 'x', listImpl: async () => ['pipes/funnel.pipe'] },
  );
  assert.equal(results[0].verdict, 'forward-deploy-required');
  assert.match(results[0].detail, /via deployments/);
});

test('pushAll surfaces a failure verdict with the error detail', async () => {
  const fetchImpl = async () => ({ status: 400, text: async () => 'bad schema' });
  const results = await pushAll(
    { host: 'https://h', token: 't' },
    { fetchImpl, readFileImpl: async () => 'x', listImpl: async () => ['pipes/bad.pipe'] },
  );
  assert.equal(results[0].verdict, 'failed');
  assert.equal(results[0].detail, 'bad schema');
});
