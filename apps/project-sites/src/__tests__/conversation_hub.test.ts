/**
 * Unit tests for {@link ConversationHub} — the deprecated Pulse Inbox
 * Durable Object stub (convergence r51).
 *
 * `ConversationHub` is intentionally behavior-free: the Inbox feature was
 * removed 2026-05-25 but the DO class survives so Cloudflare's DO migration
 * history (`v_conversation_hub` tag) stays valid until a `deleted_classes`
 * migration ships. Its only contract: every inbound `fetch` — regardless of
 * method, path, headers, or body — returns HTTP 410 Gone with a stable
 * JSON envelope `{ error, message, docs }` and `Content-Type:
 * application/json`.
 *
 * These specs construct the DO with a MOCKED `DurableObjectState` + env
 * (no Miniflare), mirroring the `cloudflare:workers` virtual mock used in
 * `do-tracehub.test.ts`, and lock that 410 contract so a future "re-enable
 * Inbox here" regression (re-implementing on the stub instead of a fresh
 * `ConversationHubV2` class) fails loudly.
 */

jest.mock(
  'cloudflare:workers',
  () => ({
    __esModule: true,
    DurableObject: class<E> {
      ctx: unknown;
      env: E;
      constructor(ctx: unknown, env: E) {
        this.ctx = ctx;
        this.env = env;
      }
    },
  }),
  { virtual: true },
);

import { ConversationHub } from '../durable_objects/conversation_hub.js';
import type { Env } from '../types/env.js';

/**
 * Build a mocked `DurableObjectState`. The stub never touches storage, so
 * every method is a `jest.fn()` purely to satisfy the type + prove the DO
 * does NOT read or write state on the deprecated path.
 */
function makeState(): {
  state: DurableObjectState;
  storage: {
    get: jest.Mock;
    put: jest.Mock;
    list: jest.Mock;
    delete: jest.Mock;
  };
} {
  const storage = {
    get: jest.fn(),
    put: jest.fn(),
    list: jest.fn(),
    delete: jest.fn(),
  };
  const state = {
    storage,
    id: { toString: () => 'do-id', equals: () => false },
    waitUntil: jest.fn(),
    blockConcurrencyWhile: jest.fn(),
  };
  return { state: state as unknown as DurableObjectState, storage };
}

function makeHub(): {
  hub: ConversationHub;
  storage: ReturnType<typeof makeState>['storage'];
} {
  const { state, storage } = makeState();
  const hub = new ConversationHub(state, {} as Env);
  return { hub, storage };
}

describe('ConversationHub (deprecated Pulse Inbox DO stub)', () => {
  it('responds 410 Gone to a GET request', async () => {
    const { hub } = makeHub();
    const res = await hub.fetch(new Request('http://do/inbox'));
    expect(res.status).toBe(410);
  });

  it('responds 410 Gone to a POST with a body (ignores the body)', async () => {
    const { hub } = makeHub();
    const res = await hub.fetch(
      new Request('http://do/inbox/messages', {
        method: 'POST',
        body: JSON.stringify({ text: 'hello', conversationId: 'c1' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(res.status).toBe(410);
  });

  it('sets Content-Type: application/json on the 410 response', async () => {
    const { hub } = makeHub();
    const res = await hub.fetch(new Request('http://do/anything'));
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('returns the stable gone envelope { error, message, docs }', async () => {
    const { hub } = makeHub();
    const res = await hub.fetch(new Request('http://do/inbox'));
    const body = (await res.json()) as {
      error: string;
      message: string;
      docs: string;
    };
    expect(body.error).toBe('gone');
    expect(body.message).toContain('Pulse Inbox');
    expect(body.message).toContain('deprecated');
    expect(body.docs).toBe('https://projectsites.dev/changelog');
  });

  it('emits a body that is valid, parseable JSON', async () => {
    const { hub } = makeHub();
    const res = await hub.fetch(new Request('http://do/inbox'));
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text)).toHaveProperty('error', 'gone');
  });

  it('returns 410 regardless of method (PUT/DELETE/PATCH/HEAD)', async () => {
    const { hub } = makeHub();
    for (const method of ['PUT', 'DELETE', 'PATCH', 'HEAD']) {
      const res = await hub.fetch(
        new Request('http://do/inbox', { method }),
      );
      expect(res.status).toBe(410);
    }
  });

  it('returns 410 for any path (does not route on the URL)', async () => {
    const { hub } = makeHub();
    for (const path of ['/', '/inbox', '/messages/123', '/broadcast', '/ws']) {
      const res = await hub.fetch(new Request(`http://do${path}`));
      expect(res.status).toBe(410);
    }
  });

  it('never reads or writes Durable Object storage (no state side-effects)', async () => {
    const { hub, storage } = makeHub();
    await hub.fetch(
      new Request('http://do/inbox', {
        method: 'POST',
        body: JSON.stringify({ text: 'should be ignored' }),
      }),
    );
    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.list).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('returns a fresh Response each call (no shared/cached body lock)', async () => {
    const { hub } = makeHub();
    const a = await hub.fetch(new Request('http://do/inbox'));
    const b = await hub.fetch(new Request('http://do/inbox'));
    // Both bodies must be independently readable.
    await expect(a.json()).resolves.toHaveProperty('error', 'gone');
    await expect(b.json()).resolves.toHaveProperty('error', 'gone');
  });
});
