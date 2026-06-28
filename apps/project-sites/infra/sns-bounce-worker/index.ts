/**
 * projectsites-sns-bounce — SNS → Listmonk bounce/complaint bridge.
 *
 * Amazon SES publishes bounce + complaint events to an SNS topic, which delivers
 * them (HTTPS POST) here. This Worker:
 *   1. Completes the SNS subscription handshake — on `SubscriptionConfirmation`
 *      it GETs the `SubscribeURL` (Listmonk's own webhook does NOT do this, so the
 *      subscription would otherwise stay PendingConfirmation forever).
 *   2. Forwards real `Notification` events — the raw, still-signed SNS JSON body —
 *      to Listmonk's SES webhook, which verifies the signature and applies the
 *      configured bounce action (blocklist on hard-bounce / complaint).
 *
 * Stateless, no secrets. Only same-host subrequest target is Listmonk's webhook.
 */
const LISTMONK_SES_WEBHOOK = 'https://mail.projectsites.dev/webhooks/service/ses';

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'GET' || request.method === 'HEAD') {
      return new Response('sns-bounce bridge ok', { status: 200 });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, POST' } });
    }

    const bodyText = await request.text();
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return new Response('invalid json', { status: 400 });
    }

    const type =
      request.headers.get('x-amz-sns-message-type') ?? (msg.Type as string | undefined) ?? '';

    // 1. SNS handshake — confirm (or acknowledge unsubscribe) by visiting the URL.
    if (type === 'SubscriptionConfirmation' || type === 'UnsubscribeConfirmation') {
      const subscribeUrl = msg.SubscribeURL as string | undefined;
      if (subscribeUrl && /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(subscribeUrl)) {
        const r = await fetch(subscribeUrl);
        return new Response(`subscription ${type} -> ${r.status}`, { status: 200 });
      }
      return new Response('missing/invalid SubscribeURL', { status: 400 });
    }

    // 2. Notification (bounce/complaint) — forward the raw signed body to Listmonk.
    const forward = await fetch(LISTMONK_SES_WEBHOOK, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-amz-sns-message-type': type || 'Notification',
      },
      body: bodyText,
    });
    return new Response(await forward.text(), { status: forward.status });
  },
};
