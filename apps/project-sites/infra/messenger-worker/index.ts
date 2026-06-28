/**
 * projectsites-messenger — Listmonk Postback messenger → SMS (Twilio) + Telegram.
 *
 * Listmonk POSTs a campaign message (one or more recipients) to /sms or /telegram.
 * For EACH recipient we honor their per-subscriber channel preference (#5): a
 * recipient is messaged on a channel ONLY if they have explicitly opted into it
 * (subscriber attrib `channels` includes the channel, or a channel-specific opt-in)
 * AND they have the contact handle for it (phone / telegram chat id). Otherwise we
 * silently skip them (still 200, so Listmonk records the send without error/retry).
 *
 * Channels are deliberately OPT-IN (not opt-out) for SMS/Telegram — these cost money
 * and carry consent obligations (TCPA etc.), so no attrib = no send.
 *
 * Auth: Listmonk sends HTTP Basic (messenger username+password); we check the password
 * against MESSENGER_SECRET. Read-path only reaches providers with our own creds.
 */
export interface Env {
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_FROM: string;
  TELEGRAM_BOT_TOKEN: string;
  MESSENGER_SECRET: string;
}

interface Recipient {
  uuid?: string;
  email?: string;
  name?: string;
  attribs?: Record<string, unknown>;
  status?: string;
}
interface Payload {
  subject?: string;
  body?: string;
  content_type?: string;
  recipients?: Recipient[];
  subscriber?: Recipient;
}

/** Strip HTML to readable plain text for SMS/Telegram. */
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

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Has the subscriber opted into `channel`? Opt-in only. */
function optedIn(attribs: Record<string, unknown>, channel: string): boolean {
  const ch = attribs.channels;
  if (Array.isArray(ch)) return ch.map((x) => str(x).toLowerCase()).includes(channel);
  const single = str(attribs.channel).toLowerCase();
  if (single) return single === channel || single === 'all';
  // explicit per-channel opt-in flag fallback (e.g. sms_optin: true)
  return attribs[`${channel}_optin`] === true;
}

/** Pull the contact handle for a channel from subscriber attribs. */
function handleFor(attribs: Record<string, unknown>, channel: string): string {
  if (channel === 'sms') {
    return str(attribs.phone) || str(attribs.sms) || str(attribs.mobile) || str(attribs.phone_number);
  }
  return str(attribs.telegram_chat_id) || str(attribs.telegram_id) || str(attribs.telegram);
}

async function sendSms(env: Env, to: string, body: string): Promise<Response> {
  const form = new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: body });
  return fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
}

async function sendTelegram(env: Env, chatId: string, text: string): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
}

function authOk(request: Request, env: Env): boolean {
  const h = request.headers.get('authorization') || '';
  if (!h.toLowerCase().startsWith('basic ')) return false;
  try {
    const pass = atob(h.slice(6)).split(':').slice(1).join(':');
    return !!env.MESSENGER_SECRET && pass === env.MESSENGER_SECRET;
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const channel = url.pathname.replace(/^\/+/, '').toLowerCase(); // "sms" | "telegram"

    if (request.method === 'GET') return new Response('projectsites-messenger ok', { status: 200 });
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    if (channel !== 'sms' && channel !== 'telegram') return new Response('unknown channel', { status: 404 });
    if (!authOk(request, env)) return new Response('unauthorized', { status: 401 });

    let p: Payload;
    try {
      p = (await request.json()) as Payload;
    } catch {
      return new Response('invalid json', { status: 400 });
    }

    const recipients = p.recipients ?? (p.subscriber ? [p.subscriber] : []);
    const text = htmlToText(p.body ?? '');
    const subject = str(p.subject);
    // Lead with the subject for SMS/Telegram if the body doesn't already include it.
    const message = subject && !text.startsWith(subject) ? `${subject}\n\n${text}` : text;

    let sent = 0,
      skipped = 0;
    const errors: string[] = [];

    for (const r of recipients) {
      const attribs = (r.attribs ?? {}) as Record<string, unknown>;
      const handle = handleFor(attribs, channel);
      if (!handle || !optedIn(attribs, channel)) {
        skipped++; // #5: not opted in / no handle for this channel
        continue;
      }
      try {
        const res = channel === 'sms' ? await sendSms(env, handle, message) : await sendTelegram(env, handle, message);
        if (res.ok) sent++;
        else {
          skipped++;
          errors.push(`${r.uuid ?? handle}: ${res.status} ${(await res.text()).slice(0, 140)}`);
        }
      } catch (e) {
        skipped++;
        errors.push(`${r.uuid ?? handle}: ${(e as Error).message}`);
      }
    }

    // Always 200 to Listmonk unless EVERY attempted send hard-failed.
    const status = errors.length > 0 && sent === 0 && skipped === errors.length ? 502 : 200;
    return new Response(JSON.stringify({ channel, sent, skipped, errors }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  },
};
