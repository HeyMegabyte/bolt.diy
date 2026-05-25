/**
 * Telegram — Bot API. No OAuth dance; bot token is shared, chat_id stored
 * in account.metadata.
 * Docs: https://core.telegram.org/bots/api#sendmessage
 */
import {
  BROWSER_HEADERS,
  composeContent,
  emptyAnalytics,
  requireEnv,
  type AnalyticsSnapshot,
  type Publisher,
  type PublishResult,
  type SocialAccountCtx,
} from './types.js';

function chatId(account: SocialAccountCtx): string {
  const c = (account.metadata?.chat_id as string | undefined) ?? account.external_id;
  if (!c) throw new Error('telegram_chat_id_missing');
  return c;
}

export const telegram: Publisher = {
  async publish(env, account, post): Promise<PublishResult> {
    const creds = requireEnv(env, 'telegram', 'https://t.me/BotFather', 'TELEGRAM_BOT_TOKEN');
    const text = composeContent(post, 'telegram').slice(0, 4096);
    const res = await fetch(`https://api.telegram.org/bot${creds.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId(account), text, disable_web_page_preview: false }),
    });
    if (!res.ok) throw new Error(`telegram_publish_failed:${res.status}:${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { ok: boolean; result?: { message_id: number; chat: { id: number; username?: string } } };
    if (!data.ok || !data.result) throw new Error('telegram_publish_err');
    const username = data.result.chat.username;
    const url = username
      ? `https://t.me/${username}/${data.result.message_id}`
      : `https://t.me/c/${String(data.result.chat.id).replace('-100', '')}/${data.result.message_id}`;
    return { external_id: String(data.result.message_id), external_url: url };
  },
  async fetchAnalytics(_env, _account, _externalPostId): Promise<AnalyticsSnapshot> {
    // Telegram Bot API exposes no per-message analytics by default. Channel
    // post views require getChat + the message must be in a channel; returns
    // null gracefully.
    return emptyAnalytics({ reason: 'telegram_no_analytics' });
  },
};
