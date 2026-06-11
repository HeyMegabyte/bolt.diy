/**
 * Integration-branch coverage for the Telegram publisher
 * (`services/social_publishers/telegram.ts`): chat-id guard, sendMessage
 * (username vs c/id URL), http-!ok AND ok:false error paths, no-analytics.
 */
import { telegram } from '../services/social_publishers/telegram.js';
import type { SocialAccountCtx, PostCtx } from '../services/social_publishers/types.js';
import type { Env } from '../types/env.js';

const ENV = { TELEGRAM_BOT_TOKEN: 'bot' } as unknown as Env;
const account = (over: Partial<SocialAccountCtx> = {}): SocialAccountCtx => ({
  id: 'a1', org_id: 'o1', platform: 'telegram', external_id: null, handle: null,
  access_token: 'tok', refresh_token: null, token_expires_at: null, scopes: null,
  metadata: { chat_id: '-1001234' }, ...over,
});
const post = (over: Partial<PostCtx> = {}): PostCtx => ({
  id: 'p1', content: 'Hi TG', per_platform_overrides: null, media_urls: [], hashtags: [],
  mentions: [], link: null, ...over,
});
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const mock = (h: () => Response) => {
  const fn = jest.fn(async () => h());
  global.fetch = fn as unknown as typeof fetch;
  return fn;
};
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; jest.clearAllMocks(); });

describe('telegram.publish', () => {
  it('sends a message and builds a public username URL', async () => {
    mock(() => json({ ok: true, result: { message_id: 55, chat: { id: -1001234, username: 'mychan' } } }));
    expect(await telegram.publish(ENV, account(), post())).toEqual({
      external_id: '55', external_url: 'https://t.me/mychan/55',
    });
  });
  it('builds a c/<id> URL when the chat has no username', async () => {
    mock(() => json({ ok: true, result: { message_id: 55, chat: { id: -1001234 } } }));
    expect((await telegram.publish(ENV, account(), post())).external_url).toBe('https://t.me/c/1234/55');
  });
  it('throws without a chat id', async () => {
    mock(() => json({}));
    await expect(telegram.publish(ENV, account({ metadata: {}, external_id: null }), post())).rejects.toThrow(
      /telegram_chat_id_missing/,
    );
  });
  it('throws when the HTTP call is not OK', async () => {
    mock(() => new Response('no', { status: 400 }));
    await expect(telegram.publish(ENV, account(), post())).rejects.toThrow(/telegram_publish_failed:400/);
  });
  it('throws when the API returns ok:false', async () => {
    mock(() => json({ ok: false }));
    await expect(telegram.publish(ENV, account(), post())).rejects.toThrow(/telegram_publish_err/);
  });
});

describe('telegram.fetchAnalytics', () => {
  it('returns an empty snapshot (Telegram exposes no per-message analytics)', async () => {
    const s = await telegram.fetchAnalytics(ENV, account(), '55');
    expect(s.likes).toBeNull();
    expect(s.impressions).toBeNull();
  });
});
