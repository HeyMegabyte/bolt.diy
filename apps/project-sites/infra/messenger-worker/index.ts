/**
 * projectsites-messenger — Listmonk Postback messenger → SMS (Twilio) + Telegram,
 * plus per-subscriber channel opt-in capture (#5) and Telegram linking (#3).
 *
 * Endpoints:
 *   POST /sms, /telegram      — Listmonk Postback delivery (HTTP Basic, MESSENGER_SECRET).
 *                               Sends to a recipient ONLY if they opted into the channel
 *                               (attribs.channels) AND have the handle (phone / chat id).
 *   POST /link                — self-service opt-in: { uuid, phone?, channels[] } → writes
 *                               the subscriber's phone + channels via the Listmonk API.
 *   POST /telegram-webhook     — Telegram bot updates. On `/start <subscriber-uuid>` it
 *                               captures the chat id → subscriber attribs + adds the
 *                               telegram channel, then replies. Secured by Telegram's
 *                               secret-token header (= MESSENGER_SECRET).
 *
 * Hosted on workers.dev (Listmonk + Telegram + the preference page all reach it without
 * the zone Bot Fight Mode in the path; the Worker's subrequest to Listmonk's API bypasses
 * BFM as a same-account worker subrequest).
 */
export interface Env {
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_FROM: string;
  TELEGRAM_BOT_TOKEN: string;
  MESSENGER_SECRET: string;
  LISTMONK_API_TOKEN: string;
}

const LISTMONK = 'https://mail.projectsites.dev';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

interface Recipient {
  uuid?: string;
  attribs?: Record<string, unknown>;
}
interface Payload {
  subject?: string;
  body?: string;
  recipients?: Recipient[];
  subscriber?: Recipient;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...CORS } });

function htmlToText(input: string): string {
  return (input || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function optedIn(attribs: Record<string, unknown>, channel: string): boolean {
  const ch = attribs.channels;
  if (Array.isArray(ch)) return ch.map((x) => str(x).toLowerCase()).includes(channel);
  const single = str(attribs.channel).toLowerCase();
  if (single) return single === channel || single === 'all';
  return attribs[`${channel}_optin`] === true;
}
function handleFor(attribs: Record<string, unknown>, channel: string): string {
  return channel === 'sms'
    ? str(attribs.phone) || str(attribs.sms) || str(attribs.mobile) || str(attribs.phone_number)
    : str(attribs.telegram_chat_id) || str(attribs.telegram_id) || str(attribs.telegram);
}

async function sendSms(env: Env, to: string, body: string): Promise<Response> {
  return fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: body }).toString(),
  });
}
async function sendTelegram(env: Env, chatId: string, text: string): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
}

function basicAuthOk(request: Request, env: Env): boolean {
  const h = request.headers.get('authorization') || '';
  if (!h.toLowerCase().startsWith('basic ')) return false;
  try {
    return env.MESSENGER_SECRET !== '' && atob(h.slice(6)).split(':').slice(1).join(':') === env.MESSENGER_SECRET;
  } catch {
    return false;
  }
}

/** GET subscriber by uuid → merge attribs (+ optional channel) → PUT. */
async function listmonkSetSubscriber(
  env: Env,
  uuid: string,
  patch: { phone?: string; channels?: string[]; chatId?: string; addChannel?: string },
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!UUID_RE.test(uuid)) return { ok: false, error: 'bad uuid' };
  const auth = `token projectsites_api:${env.LISTMONK_API_TOKEN}`;
  const q = encodeURIComponent(`subscribers.uuid = '${uuid}'`);
  const gr = await fetch(`${LISTMONK}/api/subscribers?query=${q}&per_page=1`, { headers: { Authorization: auth } });
  if (!gr.ok) return { ok: false, status: gr.status, error: 'lookup failed' };
  const sub = ((await gr.json()) as { data?: { results?: Array<Record<string, unknown>> } }).data?.results?.[0];
  if (!sub) return { ok: false, error: 'subscriber not found' };

  const attribs: Record<string, unknown> = { ...((sub.attribs as Record<string, unknown>) || {}) };
  if (patch.phone) attribs.phone = patch.phone;
  if (patch.chatId) attribs.telegram_chat_id = patch.chatId;
  const channelSet = new Set<string>(Array.isArray(attribs.channels) ? (attribs.channels as string[]) : []);
  for (const c of patch.channels ?? []) channelSet.add(c);
  if (patch.addChannel) channelSet.add(patch.addChannel);
  if (channelSet.size) attribs.channels = [...channelSet];

  const body = {
    email: sub.email,
    name: sub.name,
    attribs,
    lists: Array.isArray(sub.lists) ? (sub.lists as Array<{ id: number }>).map((l) => l.id) : [],
    preconfirm_subscriptions: true,
  };
  const pr = await fetch(`${LISTMONK}/api/subscribers/${sub.id}`, {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: pr.ok, status: pr.status };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname.replace(/^\/+/, '').toLowerCase();
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'GET') return new Response('projectsites-messenger ok', { status: 200 });
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    // --- Telegram bot webhook: capture chat id on /start <uuid> ---
    if (path === 'telegram-webhook') {
      if (request.headers.get('x-telegram-bot-api-secret-token') !== env.MESSENGER_SECRET)
        return new Response('unauthorized', { status: 401 });
      const upd = (await request.json().catch(() => ({}))) as {
        message?: { text?: string; chat?: { id?: number } };
      };
      const text = str(upd.message?.text);
      const chatId = upd.message?.chat?.id;
      if (chatId && text.startsWith('/start')) {
        const token = text.split(/\s+/)[1] ?? '';
        if (UUID_RE.test(token)) {
          const r = await listmonkSetSubscriber(env, token, { chatId: String(chatId), addChannel: 'telegram' });
          await sendTelegram(
            env,
            String(chatId),
            r.ok
              ? '✅ Linked! You will now receive ProjectSites updates here on Telegram.'
              : '⚠️ Could not link this account — open the link from your email preferences again.',
          );
        } else {
          await sendTelegram(env, String(chatId), 'Open the Telegram link from your ProjectSites email preferences to subscribe.');
        }
      }
      return json({ ok: true }); // always 200 to Telegram
    }

    // --- self-service opt-in: phone + channels for a subscriber (uuid is the credential) ---
    if (path === 'link') {
      const b = (await request.json().catch(() => ({}))) as { uuid?: string; phone?: string; channels?: string[] };
      const uuid = str(b.uuid);
      if (!UUID_RE.test(uuid)) return json({ ok: false, error: 'bad uuid' }, 400);
      const phone = str(b.phone);
      if (phone && !/^\+[1-9]\d{6,15}$/.test(phone)) return json({ ok: false, error: 'phone must be E.164 (+15551234567)' }, 400);
      const channels = (b.channels ?? []).map((c) => str(c).toLowerCase()).filter((c) => ['email', 'sms', 'telegram'].includes(c));
      const r = await listmonkSetSubscriber(env, uuid, { phone: phone || undefined, channels });
      return json(r, r.ok ? 200 : 400);
    }

    // --- Listmonk Postback delivery: sms | telegram ---
    if (path !== 'sms' && path !== 'telegram') return new Response('unknown route', { status: 404 });
    if (!basicAuthOk(request, env)) return new Response('unauthorized', { status: 401 });

    let p: Payload;
    try {
      p = (await request.json()) as Payload;
    } catch {
      return json({ error: 'invalid json' }, 400);
    }
    const recipients = p.recipients ?? (p.subscriber ? [p.subscriber] : []);
    const text = htmlToText(p.body ?? '');
    const subject = str(p.subject);
    const message = subject && !text.startsWith(subject) ? `${subject}\n\n${text}` : text;

    let sent = 0,
      skipped = 0;
    const errors: string[] = [];
    for (const r of recipients) {
      const attribs = (r.attribs ?? {}) as Record<string, unknown>;
      const handle = handleFor(attribs, path);
      if (!handle || !optedIn(attribs, path)) {
        skipped++;
        continue;
      }
      try {
        const res = path === 'sms' ? await sendSms(env, handle, message) : await sendTelegram(env, handle, message);
        if (res.ok) sent++;
        else {
          skipped++;
          errors.push(`${r.uuid ?? handle}: ${res.status} ${(await res.text()).slice(0, 120)}`);
        }
      } catch (e) {
        skipped++;
        errors.push(`${r.uuid ?? handle}: ${(e as Error).message}`);
      }
    }
    const status = errors.length > 0 && sent === 0 && skipped === errors.length ? 502 : 200;
    return json({ channel: path, sent, skipped, errors }, status);
  },
};
