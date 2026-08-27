/**
 * @module generated/app_js
 *
 * The unified client script served at `GET https://projectsites.dev/app.js` and
 * injected at the edge into EVERY generated customer site (see
 * {@link ../services/site_serving.ts} → `injectUnifiedClientScript`).
 *
 * It is authored as a single string constant (not a `public/app.js` file) because
 * the Worker does not serve `public/` — there is no `serveStatic`/`[assets]`
 * binding — so a string the route returns is the only build-step-free way to ship
 * it. The route (`GET /app.js` in `src/index.ts`) returns {@link APP_JS} verbatim
 * with `content-type: application/javascript; charset=utf-8` + a 1h cache.
 *
 * The script is PURE vanilla ES5-safe JS — no modules, no build step, runs in any
 * browser. It consolidates four concerns, each self-contained + fail-soft:
 *
 * 1. **Analytics** — fires a `pageview` to `POST /api/events` on load, and a
 *    `conversion` event for outbound / tel: / mailto: / CTA clicks. Fire-and-forget
 *    `fetch` with `keepalive:true`. Body matches `IncomingEventSchema`
 *    (`{eventId, siteId, eventType, timestamp, payload, referer}`).
 * 2. **Form hijack** — capture-phase submit listener + MutationObserver catch every
 *    `<form>` site-wide, `preventDefault`, serialize fields, POST to
 *    `POST /api/contact-form/<slug>` (`{name, email, phone?, message}`), show inline
 *    success/error text, and emit a `form_submit` analytics event.
 * 3. **Upgrade bar** — for `data-paid="false"` sites, injects the sticky
 *    "Claim / Edit with AI" bar (same copy + bolt-editor URL the server previously
 *    rendered via `generateConversionFlow`). Paid sites render nothing.
 * 4. **Sentry / PostHog stubs** — no-op init that reads future keys from `data-*`
 *    attributes with clear TODO hooks. No real SDKs are loaded.
 *
 * The `<slug>` and `<paid>` values arrive via the injected script tag's
 * `data-slug` / `data-paid` attributes; slug falls back to the first hostname label.
 *
 * @example
 * // src/index.ts
 * import { APP_JS } from './generated/app_js.js';
 * app.get('/app.js', (c) =>
 *   c.body(APP_JS, 200, {
 *     'content-type': 'application/javascript; charset=utf-8',
 *     'cache-control': 'public, max-age=3600',
 *   }),
 * );
 */

/**
 * The unified vanilla-JS client script, verbatim. Served at `/app.js` and injected
 * into every generated site. Pure ES5-safe JS — no modules, no dependencies.
 *
 * @remarks Static constant — no interpolation, so nothing here can leak Worker
 * state into the client. The per-site `data-slug` / `data-paid` come from the
 * injected `<script>` tag, never from this string.
 */
export const APP_JS = `/*! ProjectSites unified client — analytics + forms + upgrade bar. No deps. */
(function () {
  'use strict';
  if (window.__PS_APP_JS__) return; // idempotent: never double-init
  window.__PS_APP_JS__ = true;

  var SCRIPT =
    document.currentScript ||
    (function () {
      var s = document.querySelectorAll('script[src*="/app.js"]');
      return s.length ? s[s.length - 1] : null;
    })();

  function attr(name, fallback) {
    var v = SCRIPT && SCRIPT.getAttribute(name);
    return v == null || v === '' ? fallback : v;
  }

  var API = attr('data-api', 'https://projectsites.dev');
  var SLUG = attr('data-slug', '') || (location.hostname.split('.')[0] || 'site');
  var PAID = attr('data-paid', 'false') === 'true';
  var BOLT_BASE = attr('data-bolt-base', 'editor.projectsites.dev');
  var SITES_BASE = attr('data-sites-base', 'projectsites.dev');

  var onReady = function (fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  };

  // ── session id (in-memory, cookieless) ───────────────────────────────
  var SESSION_ID = (function () {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) {}
    return (
      'ps-' +
      Date.now().toString(36) +
      '-' +
      Math.random().toString(36).slice(2, 10)
    );
  })();

  function uuid() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /* ───────────────────────── Analytics ───────────────────────── */
  // Fire-and-forget POST to /api/events. Body matches IncomingEventSchema.
  function track(eventType, payload) {
    try {
      var body = {
        eventId: uuid(),
        siteId: SLUG,
        eventType: eventType,
        sessionId: SESSION_ID,
        timestamp: Date.now(),
        payload: payload || {}
      };
      try {
        if (document.referrer) body.referer = document.referrer;
      } catch (e) {}
      fetch(API + '/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
        mode: 'cors',
        credentials: 'omit'
      })['catch'](function () {});
    } catch (e) {
      /* analytics must never break the page */
    }
  }

  function pageview() {
    var path = '/';
    try {
      path = location.pathname + location.search;
    } catch (e) {}
    track('pageview', { href: path, title: document.title || undefined });
  }

  // Outbound / tel / mailto / CTA clicks → conversion event.
  function sectionOf(el) {
    try {
      var s = el.closest && el.closest('[data-ps-section],section,[id]');
      if (!s) return undefined;
      return s.getAttribute('data-ps-section') || s.id || undefined;
    } catch (e) {
      return undefined;
    }
  }

  function classifyLink(href) {
    if (!href) return null;
    if (href.indexOf('tel:') === 0) return 'call';
    if (href.indexOf('mailto:') === 0) return 'email';
    if (href.indexOf('sms:') === 0) return 'sms';
    if (/^https?:/i.test(href)) {
      try {
        var u = new URL(href, location.href);
        if (u.host !== location.host) return 'outbound';
      } catch (e) {}
      if (/google\\.[a-z.]+\\/maps|maps\\.app\\.goo\\.gl|maps\\.google/i.test(href)) return 'directions';
    }
    return null;
  }

  function onClick(ev) {
    try {
      var t = ev.target;
      var a = t && t.closest ? t.closest('a[href],button[data-ps-cta]') : null;
      if (!a) return;
      var href = a.getAttribute('href') || '';
      var kind = a.getAttribute('data-ps-cta') || classifyLink(href);
      if (!kind) return;
      track('conversion', { kind: kind, section: sectionOf(a), href: href || undefined });
    } catch (e) {}
  }

  /* ───────────────────────── Form hijack ───────────────────────── */
  var HIJACKED = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  function marked(form) {
    if (HIJACKED) {
      if (HIJACKED.has(form)) return true;
      HIJACKED.add(form);
      return false;
    }
    if (form.__psBound) return true;
    form.__psBound = true;
    return false;
  }

  function firstField(form, names) {
    for (var i = 0; i < names.length; i++) {
      var el =
        form.querySelector('[name="' + names[i] + '"]') ||
        form.querySelector('[name*="' + names[i] + '" i]') ||
        form.querySelector('input[type="' + names[i] + '"]');
      if (el && el.value != null && String(el.value).trim() !== '') return String(el.value).trim();
    }
    return '';
  }

  function statusEl(form) {
    var el = form.querySelector('[data-ps-form-status]');
    if (!el) {
      el = document.createElement('p');
      el.setAttribute('data-ps-form-status', '');
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.style.cssText =
        'margin:12px 0 0;font:600 14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;';
      form.appendChild(el);
    }
    return el;
  }

  function setStatus(form, msg, ok) {
    var el = statusEl(form);
    el.textContent = msg;
    el.style.color = ok ? '#16a34a' : '#dc2626';
  }

  function serialize(form) {
    var name = firstField(form, ['name', 'fullname', 'full_name', 'your-name', 'text']);
    var email = firstField(form, ['email', 'e-mail', 'your-email']);
    var phone = firstField(form, ['phone', 'tel', 'telephone', 'mobile']);
    var message = firstField(form, [
      'message',
      'msg',
      'comments',
      'comment',
      'details',
      'inquiry',
      'body',
      'textarea'
    ]);
    if (!message) {
      var ta = form.querySelector('textarea');
      if (ta && ta.value) message = String(ta.value).trim();
    }
    return { name: name, email: email, phone: phone || undefined, message: message };
  }

  function submitForm(form, ev) {
    // ALWAYS stop the native submit FIRST — app.js fully owns this form. The two
    // client-validation branches below \`return\` early; if preventDefault ran only
    // after them (the old bug), an incomplete submit did a native GET reload that
    // WIPED the inline error AND the visitor's typed input — a silent
    // conversion-killer on the lead-gen form. Prevent unconditionally, then serialize.
    if (ev) ev.preventDefault();
    var data = serialize(form);
    // The endpoint validates: name, email, message (>=10 chars). Give inline
    // feedback for the obvious cases before the round-trip.
    if (!data.name || !data.email) {
      setStatus(form, 'Please add your name and email.', false);
      return;
    }
    if (!data.message || data.message.length < 10) {
      setStatus(form, 'Please add a message (at least 10 characters).', false);
      return;
    }
    setStatus(form, 'Sending…', true);
    track('form_start', { form: form.id || form.name || 'contact' });

    fetch(API + '/api/contact-form/' + encodeURIComponent(SLUG), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
      mode: 'cors',
      credentials: 'omit'
    })
      .then(function (res) {
        return res
          .json()
          ['catch'](function () {
            return {};
          })
          .then(function (json) {
            return { ok: res.ok, json: json };
          });
      })
      .then(function (r) {
        if (r.ok) {
          setStatus(form, 'Thanks! Your message has been sent.', true);
          try {
            form.reset();
          } catch (e) {}
          track('form_submit', { form: form.id || form.name || 'contact' });
        } else {
          var m =
            (r.json && r.json.error && r.json.error.message) ||
            'Something went wrong. Please try again or email us directly.';
          setStatus(form, m, false);
        }
      })
      ['catch'](function () {
        setStatus(form, 'Network error. Please try again.', false);
      });
  }

  function onSubmit(ev) {
    var form = ev.target;
    if (!form || form.tagName !== 'FORM') return;
    if (form.getAttribute('data-ps-ignore') != null) return; // opt-out hook
    submitForm(form, ev);
  }

  function bindForms() {
    // Capture-phase document listener catches EVERY form incl. late ones, and
    // marking prevents a double-send if a form is bound twice.
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) marked(forms[i]);
  }

  /* ───────────────────────── Upgrade bar ───────────────────────── */
  function injectUpgradeBar() {
    if (PAID) return; // paid sites: no bar
    if (document.getElementById('ps-upgrade-bar')) return;
    var editUrl = 'https://' + BOLT_BASE + '/?slug=' + encodeURIComponent(SLUG);
    var buildUrl = 'https://' + SITES_BASE + '/?ref=preview';

    var css =
      '#ps-upgrade-bar{position:fixed;left:0;right:0;bottom:0;z-index:99998;transform:translateY(110%);' +
      'transition:transform .5s cubic-bezier(.16,1,.3,1);font-family:-apple-system,BlinkMacSystemFont,\\'Segoe UI\\',Roboto,sans-serif}' +
      '#ps-upgrade-bar.ps-in{transform:translateY(0)}' +
      '#ps-ub-inner{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 20px;' +
      'background:linear-gradient(135deg,rgba(10,6,30,.97),rgba(22,14,56,.97));backdrop-filter:blur(20px);' +
      'border-top:1px solid rgba(124,58,237,.2);box-shadow:0 -8px 32px rgba(0,0,0,.4)}' +
      '#ps-ub-left{display:flex;align-items:center;gap:12px;min-width:0}' +
      '#ps-ub-brand{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:20px;' +
      'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);font-size:11px;' +
      'color:rgba(255,255,255,.55);text-decoration:none;white-space:nowrap}' +
      '#ps-ub-brand:hover{background:rgba(255,255,255,.08);color:#fff}' +
      '#ps-ub-edit{display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:20px;' +
      'background:rgba(100,255,218,.06);border:1px solid rgba(100,255,218,.15);color:#64ffda;font-size:11px;' +
      'font-weight:600;text-decoration:none}' +
      '#ps-ub-edit:hover{background:rgba(100,255,218,.12)}' +
      '#ps-ub-msg{color:rgba(255,255,255,.7);font-size:13px;margin:0}#ps-ub-msg strong{color:#fff}' +
      '#ps-ub-right{display:flex;align-items:center;gap:10px}' +
      '#ps-ub-claim{padding:8px 22px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border:none;' +
      'border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 2px 12px rgba(124,58,237,.3);text-decoration:none;display:inline-block}' +
      '#ps-ub-claim:hover{transform:translateY(-2px)}' +
      '#ps-ub-x{background:none;border:none;color:rgba(255,255,255,.3);font-size:18px;cursor:pointer;width:28px;height:28px;border-radius:50%}' +
      '#ps-ub-x:hover{color:#fff;background:rgba(255,255,255,.06)}' +
      '@media(max-width:600px){#ps-ub-msg{display:none}#ps-ub-inner{padding:8px 14px}}' +
      '@media print{#ps-upgrade-bar{display:none}}';

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'ps-upgrade-bar';
    bar.innerHTML =
      '<div id="ps-ub-inner">' +
      '<div id="ps-ub-left">' +
      '<a id="ps-ub-brand" href="' +
      buildUrl +
      '" target="_blank" rel="noopener" data-ps-cta="brand">Built on ProjectSites</a>' +
      '<a id="ps-ub-edit" href="' +
      editUrl +
      '" data-ps-cta="edit_with_ai">Edit with AI</a>' +
      '</div>' +
      '<p id="ps-ub-msg"><strong>This website is yours</strong> — make it official</p>' +
      '<div id="ps-ub-right">' +
      '<a id="ps-ub-claim" href="' +
      editUrl +
      '" data-ps-cta="claim">Claim for $50/mo</a>' +
      '<button id="ps-ub-x" aria-label="Dismiss">&times;</button>' +
      '</div></div>';
    document.body.appendChild(bar);

    // reveal after 25s OR 40% scroll, matching the server bar's behavior
    var revealed = false;
    var doReveal = function () {
      if (revealed) return;
      revealed = true;
      bar.className = 'ps-in';
    };
    setTimeout(doReveal, 25000);
    var onScroll = function () {
      var h = document.documentElement;
      var denom = (h.scrollHeight || 1) - h.clientHeight;
      var pct = denom > 0 ? (h.scrollTop || document.body.scrollTop) / denom : 0;
      if (pct >= 0.4) {
        doReveal();
        window.removeEventListener('scroll', onScroll);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    var x = document.getElementById('ps-ub-x');
    if (x)
      x.addEventListener('click', function () {
        bar.style.display = 'none';
      });
  }

  /* ─────────────────── Sentry / PostHog stubs ─────────────────── */
  // No-op initializers wired to read FUTURE keys from data-* attributes. These
  // deliberately load NO real SDK — they are hooks for when per-site keys ship.
  function initSentryStub() {
    var dsn = attr('data-sentry-dsn', '');
    if (!dsn) return;
    // TODO(observability): when per-site Sentry ships, lazy-load @sentry/browser
    // here (createElement('script') from the CDN) and call Sentry.init({ dsn }).
    // Until then this is intentionally a no-op so the attribute is a safe seam.
    window.__PS_SENTRY__ = { dsn: dsn, init: function () {} };
  }

  function initPosthogStub() {
    var key = attr('data-posthog-key', '');
    if (!key) return;
    var host = attr('data-posthog-host', 'https://us.i.posthog.com');
    // TODO(observability): when per-site PostHog ships, inject the posthog-js
    // snippet here and call posthog.init(key, { api_host: host }). No-op for now.
    window.__PS_POSTHOG__ = { key: key, host: host, capture: function () {} };
  }

  /* ───────────────────────── Boot ───────────────────────── */
  onReady(function () {
    try {
      pageview();
    } catch (e) {}
    try {
      document.addEventListener('click', onClick, true);
    } catch (e) {}
    try {
      document.addEventListener('submit', onSubmit, true); // capture phase
      bindForms();
      if (typeof MutationObserver !== 'undefined') {
        var mo = new MutationObserver(function () {
          bindForms();
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
      }
    } catch (e) {}
    try {
      injectUpgradeBar();
    } catch (e) {}
    try {
      initSentryStub();
      initPosthogStub();
    } catch (e) {}
  });
})();
`;
