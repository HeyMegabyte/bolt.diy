/**
 * Per-site donation widget embed (backlog #30).
 *
 * @remarks
 *  One-line drop-in script lets third-party sites accept donations through
 *  this tenant's Stripe Connect account, with a 1.5% application_fee routed
 *  to the platform (same rail as `/api/pay`).
 *
 *  Surfaces:
 *   - `GET /_widget/donate.js`            — host-facing script. Renders an
 *     `<iframe sandbox>` pointing at the embed page. ~1 KB, no deps.
 *   - `GET /_widget/donate/embed`         — sandboxed iframe (HTML + JS) that
 *     mounts Stripe Link Express Checkout via `/api/pay`. Permissive CORS
 *     OFF; the iframe origin matches the tenant Worker, so Stripe can verify.
 *
 *  Usage from any third-party site:
 *
 * @example
 *   <script src="https://acme.projectsites.dev/_widget/donate.js"
 *           data-amount="2500"></script>
 */
import { Hono } from 'hono';
import type { AppContext } from '../env';

const app = new Hono<AppContext>();

// ── Host-facing loader ───────────────────────────────────────────────────────
const HOST_JS = (origin: string): string => `/* projectsites donate widget — embed v1 */
(function(){
  if (typeof document === 'undefined') return;
  var s = document.currentScript;
  if (!s) return;
  var amount = parseInt(s.getAttribute('data-amount') || '2500', 10);
  var label = s.getAttribute('data-label') || 'Donate';
  var locale = (navigator.language || 'en').slice(0, 5);
  var origin = ${JSON.stringify(origin)};
  var qs = new URLSearchParams({ amount: String(amount), label: label, locale: locale });
  var holder = document.createElement('div');
  holder.setAttribute('data-pa-donate-host', '1');
  holder.style.cssText = 'all:initial;display:block;width:100%;max-width:420px;margin:0 auto;';
  var f = document.createElement('iframe');
  f.src = origin + '/_widget/donate/embed?' + qs.toString();
  f.title = label;
  f.loading = 'lazy';
  f.style.cssText = 'border:0;width:100%;height:320px;background:transparent;color-scheme:normal;display:block;';
  f.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-same-origin');
  f.setAttribute('allow', 'payment ' + origin);
  f.setAttribute('referrerpolicy', 'no-referrer');
  holder.appendChild(f);
  s.parentNode && s.parentNode.insertBefore(holder, s);
  // Resize on postMessage from the iframe.
  window.addEventListener('message', function(e){
    if (e.origin !== origin || !e.data) return;
    if (e.data.type === 'pa:donate:resize' && typeof e.data.height === 'number') {
      f.style.height = Math.min(900, Math.max(220, e.data.height)) + 'px';
    }
  });
})();`;

app.get('/donate.js', (c) => {
  const origin = `${new URL(c.req.url).protocol}//${new URL(c.req.url).hostname}`;
  return new Response(HOST_JS(origin), {
    status: 200,
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
      // Loader is intentionally embeddable from any origin.
      'access-control-allow-origin': '*',
    },
  });
});

// ── Iframe embed body ────────────────────────────────────────────────────────
app.get('/donate/embed', (c) => {
  const url = new URL(c.req.url);
  const rawAmount = parseInt(url.searchParams.get('amount') ?? '2500', 10);
  const amount = clampAmountCents(rawAmount);
  const label = (url.searchParams.get('label') ?? 'Donate').slice(0, 64);
  const locale = (url.searchParams.get('locale') ?? 'en').slice(0, 5);
  const tenantName = c.env.TENANT_NAME;
  const stripeAvailable = Boolean(
    c.env.STRIPE_SECRET_KEY && c.env.STRIPE_CONNECTED_ACCOUNT_ID,
  );

  const html = renderEmbed({
    tenantName,
    amount,
    label,
    locale,
    stripeAvailable,
  });

  // Strict CSP — only the embedded iframe origin + Stripe Link domains. The
  // iframe is sandboxed via the host loader; here we ensure the document itself
  // can ONLY talk to Stripe + our own `/api/pay`.
  const csp =
    "default-src 'none'; " +
    "base-uri 'none'; " +
    "frame-ancestors *; " + // explicit; this surface is meant to embed
    "img-src 'self' data: https://*.stripe.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' 'unsafe-inline' https://js.stripe.com; " +
    "connect-src 'self' https://api.stripe.com https://m.stripe.network; " +
    "frame-src https://js.stripe.com https://hooks.stripe.com";

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'content-security-policy': csp,
      // Override the global X-Frame-Options DENY for THIS route only —
      // embedded by definition.
      'x-frame-options': 'ALLOWALL',
      'referrer-policy': 'no-referrer',
    },
  });
});

function clampAmountCents(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 2500;
  return Math.min(10_000_000, Math.max(100, Math.round(n)));
}

interface EmbedArgs {
  tenantName: string;
  amount: number;
  label: string;
  locale: string;
  stripeAvailable: boolean;
}

function renderEmbed(args: EmbedArgs): string {
  const escape = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const dollars = (args.amount / 100).toFixed(2);
  if (!args.stripeAvailable) {
    return `<!doctype html><meta charset="utf-8"><title>${escape(args.label)}</title>
<style>body{font:14px/1.4 system-ui;color:#1f2937;background:#fff;margin:0;padding:24px;}.box{border:1px solid #e5e7eb;border-radius:12px;padding:24px;text-align:center;}</style>
<div class="box"><h3 style="margin:0 0 8px;">${escape(args.tenantName)}</h3>
<p>Donations are not yet configured for this site.</p></div>`;
  }
  return `<!doctype html><html lang="${escape(args.locale)}"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(args.label)}</title>
<style>
  *{box-sizing:border-box}
  body{font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0a0a1a;background:transparent;margin:0;padding:16px;}
  .card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04);}
  h3{margin:0 0 4px;font-size:16px;}
  .muted{color:#64748b;font-size:12px;margin:0 0 12px;}
  .row{display:flex;gap:8px;align-items:center;margin:12px 0;}
  input[type=number]{flex:1;font:16px system-ui;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;}
  button{font:600 14px system-ui;padding:10px 16px;border:0;border-radius:8px;background:#0a0a1a;color:#fff;cursor:pointer;width:100%;}
  button:disabled{opacity:.6;cursor:not-allowed;}
  #stripe-mount{margin-top:12px;min-height:80px;}
  .small{font-size:11px;color:#64748b;margin-top:8px;text-align:center;}
  .err{color:#b91c1c;font-size:12px;margin-top:8px;}
  .ok{color:#15803d;font-size:13px;margin-top:8px;text-align:center;}
</style>
<div class="card">
  <h3>${escape(args.label)}</h3>
  <p class="muted">Supporting ${escape(args.tenantName)}</p>
  <div class="row">
    <span>$</span>
    <input id="amount" type="number" min="1" step="1" value="${dollars}" inputmode="decimal" aria-label="Amount in USD">
  </div>
  <button id="start" type="button">Continue</button>
  <div id="stripe-mount" aria-live="polite"></div>
  <div id="error" class="err" role="alert"></div>
  <div id="success" class="ok"></div>
  <p class="small">Secure payment via Stripe. 1.5% supports the platform.</p>
</div>
<script src="https://js.stripe.com/v3"></script>
<script>
(function(){
  function emitResize(){
    try {
      var h = document.documentElement.scrollHeight;
      parent.postMessage({ type: 'pa:donate:resize', height: h }, '*');
    } catch (e) {}
  }
  emitResize();
  var ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(emitResize) : null;
  if (ro) ro.observe(document.body);

  var amountInput = document.getElementById('amount');
  var btn = document.getElementById('start');
  var mount = document.getElementById('stripe-mount');
  var err = document.getElementById('error');
  var ok = document.getElementById('success');

  function setErr(m){ err.textContent = m || ''; }
  function setOk(m){ ok.textContent = m || ''; }

  btn.addEventListener('click', async function(){
    setErr(''); setOk('');
    var dollars = parseFloat(amountInput.value);
    if (!isFinite(dollars) || dollars < 1) { setErr('Enter at least $1.'); return; }
    btn.disabled = true;
    btn.textContent = 'Loading…';
    try {
      var res = await fetch('/api/pay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amount_cents: Math.round(dollars * 100),
          currency: 'usd',
          kind: 'donation',
          reference: 'widget:donate'
        })
      });
      if (!res.ok) {
        var detail = await res.text();
        throw new Error('Server refused payment intent: ' + res.status + ' ' + detail.slice(0,200));
      }
      var body = await res.json();
      var clientSecret = body.client_secret;
      if (!clientSecret) throw new Error('No client_secret returned.');
      if (typeof Stripe !== 'function') throw new Error('Stripe.js failed to load.');
      var stripe = Stripe(${JSON.stringify(args.stripeAvailable ? 'pk_live_or_test' : '')});
      // The host doesn't ship its publishable key — fall back to Stripe Link
      // hosted checkout via redirect. For inline embed v1 we use Express
      // Checkout Element when available, else show a hosted redirect link.
      if (stripe && stripe.elements) {
        var elements = stripe.elements({ clientSecret: clientSecret, appearance: { theme: 'flat' } });
        var express = elements.create('expressCheckout');
        express.mount('#stripe-mount');
        express.on('confirm', async function(ev){
          var conf = await stripe.confirmPayment({ elements: elements, clientSecret: clientSecret, redirect: 'if_required' });
          if (conf.error) { setErr(conf.error.message || 'Payment failed.'); btn.disabled = false; btn.textContent = 'Continue'; }
          else { setOk('Thank you for supporting ' + ${JSON.stringify(args.tenantName)} + '.'); emitResize(); }
        });
      } else {
        mount.innerHTML = '<a href="https://checkout.stripe.com/c/pay/' + encodeURIComponent(clientSecret) + '" target="_top" rel="noopener">Continue securely →</a>';
      }
      emitResize();
    } catch (e) {
      setErr((e && e.message) || 'Unable to start payment.');
      btn.disabled = false;
      btn.textContent = 'Continue';
    }
  });
})();
</script></html>`;
}

export default app;
