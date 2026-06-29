/**
 * @module site_serving
 * @description Static site serving engine for Project Sites.
 *
 * Resolves incoming hostnames to site records, serves static HTML/CSS/JS from
 * R2, and injects a promotional top bar for sites on the free plan.
 *
 * ## Resolution Flow
 *
 * ```
 * Request hostname
 *   ├─ KV cache hit → return cached site info
 *   ├─ Subdomain (slug.projectsites.dev) → lookup by slug
 *   └─ Custom domain → lookup in hostnames table → join sites → join subscriptions
 *       └─ Cache result in KV for 60 s
 * ```
 *
 * ## R2 Bucket Layout
 *
 * | Path Pattern                              | Content           |
 * | ----------------------------------------- | ----------------- |
 * | `marketing/index.html`                    | Homepage SPA      |
 * | `sites/{slug}/{version}/index.html`       | Generated site    |
 * | `sites/{slug}/{version}/privacy.html`     | Privacy policy    |
 * | `sites/{slug}/{version}/terms.html`       | Terms of service  |
 * | `sites/{slug}/{version}/research.json`    | AI research data  |
 *
 * @packageDocumentation
 */

import { DOMAINS } from '@project-sites/shared';
import type { Env } from '../types/env.js';
import { dbQueryOne } from './db.js';
import { minifyCssCached } from './css_minify.js';
import { parseBranchHost } from './site_branches.js';
import { buildAnalyticsTracker } from './analytics_tracker.js';
import { log } from '../lib/log.js';

const serveLog = log.child('site_serving');

/**
 * Generate the promotional top bar HTML injected into unpaid sites.
 *
 * The bar is fixed to the top of the viewport and includes a CTA to upgrade.
 * It cannot be dismissed — the visitor must upgrade to remove it.
 *
 * @param slug - The site's slug (used to build the upgrade link).
 * @returns HTML string to inject after the `<body>` tag.
 *
 * @example
 * ```ts
 * const topBar = generateTopBar('vitos-mens-salon');
 * const injected = html.replace(/(<body[^>]*>)/i, `$1\n${topBar}\n`);
 * ```
 */
export function generateTopBar(slug: string): string {
  return generateConversionFlow(slug);
}

/**
 * Whether a generated site is served cookie-free — i.e. neither GA4 nor GTM
 * (the only cookie-setting trackers we inject) is configured. The platform's own
 * visitor beacon (`buildAnalyticsTracker`) is cookieless by design (per-pageview
 * in-memory id, no cookie/localStorage), and PostHog/Sentry are never injected
 * into served sites — so absent GA4/GTM the site sets ZERO cookies. AN38 (#129).
 *
 * @param env - Worker env (reads `GA4_MEASUREMENT_ID` + `GTM_CONTAINER_ID`).
 * @returns `true` when no cookie-setting tracker is injected.
 */
export function isServedSiteCookieless(env: Env | undefined): boolean {
  return !env?.GA4_MEASUREMENT_ID && !env?.GTM_CONTAINER_ID;
}

/**
 * A small, accessible "No cookies · GDPR" privacy badge injected into served
 * sites that set zero cookies (AN38 #129) — a genuine differentiator + trust
 * signal. Fixed bottom-left, low-emphasis, never obscures content; sits below
 * the free-tier conversion bar (`z-index` 99990 < the bar's 99998) so on free
 * previews the bar takes precedence and on live (paid) sites it is visible.
 *
 * @returns HTML string to inject after the `<body>` tag, or `''` when not cookieless.
 *
 * @example
 * ```ts
 * if (isServedSiteCookieless(env)) bodyInjection += generateNoCookiesBadge();
 * ```
 */
export function generateNoCookiesBadge(): string {
  return (
    `<a id="ps-nocookie" href="https://${DOMAINS.SITES_BASE}" target="_blank" rel="noopener"` +
    ` aria-label="This site uses no cookies and is GDPR-friendly. Built on ProjectSites."` +
    ` title="No cookies · GDPR-friendly">` +
    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"` +
    ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<circle cx="12" cy="12" r="9"/><path d="M8.5 8.5h.01M15.5 9.5h.01M9.5 15.5h.01M14.5 14.5h.01"/>` +
    `<path d="M4 4l16 16"/></svg>` +
    `<span>No cookies · GDPR</span></a>` +
    `<style>#ps-nocookie{position:fixed;bottom:12px;left:12px;z-index:99990;display:inline-flex;` +
    `align-items:center;gap:6px;padding:5px 11px;border-radius:999px;font:600 11px/1 ` +
    `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;letter-spacing:.01em;` +
    `color:#0f172a;background:rgba(255,255,255,.82);border:1px solid rgba(15,23,42,.12);` +
    `box-shadow:0 2px 10px rgba(0,0,0,.12);backdrop-filter:blur(8px);text-decoration:none;` +
    `opacity:.78;transition:opacity .2s}#ps-nocookie:hover{opacity:1}#ps-nocookie svg{opacity:.7}` +
    `@media(prefers-color-scheme:dark){#ps-nocookie{color:#e2e8f0;background:rgba(15,23,42,.72);` +
    `border-color:rgba(255,255,255,.14)}}@media print{#ps-nocookie{display:none}}</style>`
  );
}

/**
 * "Open now" live badge (#60). A self-contained client-side script that reads the
 * page's OWN `LocalBusiness` JSON-LD `openingHours`, computes open/closed for the
 * visitor's local time, and renders a small fixed bottom-right pill ("● Open now"
 * / "Closed · opens 9 AM"). Live (client-side) so it's never stale behind the CDN.
 *
 * FAIL-SAFE: if no JSON-LD `openingHours` is found, or NOTHING parses, the badge
 * is NOT rendered — a wrong "Open now" would mislead customers, so silence beats
 * a guess. Parses the standard schema.org string form `"Mo-Fr 09:00-17:00"`
 * (single or array), including day-range wrap; unparseable entries are skipped.
 *
 * @returns HTML `<script>`+`<style>` to inject after `<body>`.
 */
export function generateOpenNowBadge(): string {
  const js =
    `(function(){try{` +
    `var DAY={su:0,mo:1,tu:2,we:3,th:4,fr:5,sa:6};` +
    `function mins(t){var m=/^(\\d{1,2}):(\\d{2})/.exec(t);return m?(+m[1])*60+(+m[2]):null}` +
    `function fmt(x){var hh=(x/60)|0,mm=x%60,ap=hh>=12?'PM':'AM',h12=((hh+11)%12)+1;return h12+(mm?':'+(mm<10?'0':'')+mm:'')+' '+ap}` +
    `var hours=[];var blocks=document.querySelectorAll('script[type="application/ld+json"]');` +
    `for(var i=0;i<blocks.length;i++){try{var j=JSON.parse(blocks[i].textContent||'null');var arr=Array.isArray(j)?j:[j];` +
    `for(var k=0;k<arr.length;k++){var oh=arr[k]&&arr[k].openingHours;if(oh)hours=hours.concat(Array.isArray(oh)?oh:[oh])}}catch(e){}}` +
    `if(!hours.length)return;` + // no hours → no badge
    `var now=new Date(),dow=now.getDay(),cur=now.getHours()*60+now.getMinutes();` +
    `var parsed=false,open=false,nextOpen=null;` +
    `for(var h=0;h<hours.length;h++){var m=/^([A-Za-z]{2})(?:\\s*-\\s*([A-Za-z]{2}))?\\s+(\\d{1,2}:\\d{2})\\s*-\\s*(\\d{1,2}:\\d{2})/.exec(String(hours[h]).trim());` +
    `if(!m)continue;var d1=DAY[m[1].toLowerCase()],d2=m[2]?DAY[m[2].toLowerCase()]:d1;if(d1==null||d2==null)continue;` +
    `var o=mins(m[3]),c=mins(m[4]);if(o==null||c==null)continue;parsed=true;` +
    `var inDay=(d1<=d2)?(dow>=d1&&dow<=d2):(dow>=d1||dow<=d2);` +
    `if(inDay){if(cur>=o&&cur<c)open=true;if(cur<o&&(nextOpen==null||o<nextOpen))nextOpen=o}}` +
    `if(!parsed)return;` + // nothing parsed → fail-safe hide
    `var label=open?'Open now':(nextOpen!=null?'Closed · opens '+fmt(nextOpen):'Closed');` +
    `var el=document.createElement('div');el.id='ps-opennow';el.setAttribute('role','status');` +
    `el.setAttribute('aria-label',label);el.className=open?'ps-on-open':'ps-on-closed';` +
    `el.innerHTML='<span class="ps-on-dot"></span>'+label;document.body.appendChild(el)` +
    `}catch(_){}})();`;
  const css =
    `#ps-opennow{position:fixed;bottom:12px;right:12px;z-index:99990;display:inline-flex;align-items:center;` +
    `gap:6px;padding:5px 12px;border-radius:999px;font:600 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;` +
    `background:rgba(255,255,255,.9);color:#0f172a;border:1px solid rgba(15,23,42,.12);box-shadow:0 2px 10px rgba(0,0,0,.12);backdrop-filter:blur(8px)}` +
    `#ps-opennow .ps-on-dot{width:7px;height:7px;border-radius:50%}` +
    `#ps-opennow.ps-on-open .ps-on-dot{background:#16a34a;box-shadow:0 0 0 3px rgba(22,163,74,.18)}` +
    `#ps-opennow.ps-on-closed .ps-on-dot{background:#ef4444}` +
    `@media(prefers-color-scheme:dark){#ps-opennow{background:rgba(15,23,42,.82);color:#e2e8f0;border-color:rgba(255,255,255,.14)}}` +
    `@media print{#ps-opennow{display:none}}`;
  return `<script>${js}</script><style>${css}</style>`;
}

/**
 * Generate the "Wow → Own → Buy" conversion flow for unpaid sites.
 *
 * Two components injected:
 * 1. Bottom bar with badge + CTA (appears after 25s or 40% scroll, animated)
 * 2. Ownership modal (on "Claim" click — plan, domain search, Stripe checkout)
 *
 * Zero external dependencies. Self-contained vanilla JS/CSS.
 */
export function generateConversionFlow(slug: string): string {
  const editUrl = `https://${DOMAINS.BOLT_BASE}/?slug=${encodeURIComponent(slug)}`;

  return `<!-- ProjectSites Conversion Flow v2 -->
<style>
@keyframes ps-slide-up{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes ps-fade-in{from{opacity:0}to{opacity:1}}
@keyframes ps-modal-in{from{opacity:0;transform:translateY(24px) scale(0.96)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes ps-pulse{0%,100%{box-shadow:0 0 0 0 rgba(124,58,237,0.4)}50%{box-shadow:0 0 0 6px rgba(124,58,237,0)}}
@keyframes ps-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
#ps-bar{position:fixed;bottom:0;left:0;right:0;z-index:99998;transform:translateY(100%);opacity:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
#ps-bar.ps-visible{animation:ps-slide-up 0.6s cubic-bezier(0.16,1,0.3,1) forwards}
#ps-bar-inner{display:flex;align-items:center;justify-content:space-between;padding:10px 20px;background:linear-gradient(135deg,rgba(10,6,30,0.97) 0%,rgba(22,14,56,0.97) 100%);backdrop-filter:blur(20px);border-top:1px solid rgba(124,58,237,0.15);box-shadow:0 -8px 32px rgba(0,0,0,0.4)}
#ps-bar-left{display:flex;align-items:center;gap:12px}
#ps-bar-brand{display:flex;align-items:center;gap:6px;padding:5px 12px;border-radius:20px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);font-size:11px;color:rgba(255,255,255,0.5);transition:all 0.25s;text-decoration:none}
#ps-bar-brand:hover{background:rgba(255,255,255,0.08);border-color:rgba(124,58,237,0.3);color:rgba(255,255,255,0.8)}
#ps-bar-brand svg{opacity:0.5}
#ps-bar-build{font-weight:600;letter-spacing:0.01em;white-space:nowrap}
@media(max-width:600px){#ps-bar-build{display:none}}
#ps-bar-edit{display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:20px;background:rgba(100,255,218,0.06);border:1px solid rgba(100,255,218,0.15);color:#64ffda;font-size:11px;font-weight:600;text-decoration:none;letter-spacing:0.02em;transition:all 0.25s}
#ps-bar-edit:hover{background:rgba(100,255,218,0.12);border-color:rgba(100,255,218,0.35);transform:translateY(-1px)}
#ps-bar-edit:active{transform:translateY(0)}
#ps-bar-msg{color:rgba(255,255,255,0.7);font-size:13px;margin:0}
#ps-bar-msg strong{color:#fff}
#ps-bar-right{display:flex;align-items:center;gap:10px}
#ps-claim-btn{padding:8px 22px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border:none;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;transition:all 0.25s;box-shadow:0 2px 12px rgba(124,58,237,0.3);letter-spacing:0.01em;animation:ps-pulse 2.5s infinite}
#ps-claim-btn:hover{transform:translateY(-2px) scale(1.02);box-shadow:0 6px 24px rgba(124,58,237,0.5)}
#ps-claim-btn:active{transform:translateY(0) scale(0.98)}
#ps-bar-x{background:none;border:none;color:rgba(255,255,255,0.25);font-size:16px;cursor:pointer;padding:4px;transition:all 0.2s;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center}
#ps-bar-x:hover{color:rgba(255,255,255,0.7);background:rgba(255,255,255,0.05)}
#ps-overlay{display:none;position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0);backdrop-filter:blur(0px);transition:all 0.3s ease;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
#ps-overlay.ps-open{display:flex;background:rgba(0,0,0,0.65);backdrop-filter:blur(10px)}
#ps-modal{background:linear-gradient(160deg,#0c0824 0%,#12093a 40%,#0c0824 100%);border:1px solid rgba(124,58,237,0.2);border-radius:20px;max-width:480px;width:calc(100% - 32px);max-height:calc(100vh - 48px);overflow-y:auto;padding:28px;color:#fff;box-shadow:0 32px 80px rgba(0,0,0,0.7),0 0 60px rgba(124,58,237,0.08);animation:ps-modal-in 0.35s cubic-bezier(0.16,1,0.3,1)}
#ps-modal h2{font-size:22px;font-weight:700;margin:0 0 4px;letter-spacing:-0.01em}
#ps-modal .ps-sub{color:rgba(255,255,255,0.4);font-size:12px;margin:0 0 20px;font-family:monospace}
.ps-plan{background:rgba(124,58,237,0.06);border:1px solid rgba(124,58,237,0.18);border-radius:14px;padding:18px;margin-bottom:16px}
.ps-price-row{display:flex;align-items:baseline;gap:6px;margin-bottom:14px}
.ps-price{font-size:36px;font-weight:800;background:linear-gradient(135deg,#fff,#c4b5fd);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.ps-period{font-size:13px;color:rgba(255,255,255,0.4)}
.ps-features{list-style:none;padding:0;margin:0 0 16px;display:grid;grid-template-columns:1fr 1fr;gap:5px}
.ps-features li{font-size:12px;color:rgba(255,255,255,0.65);display:flex;align-items:center;gap:5px}
.ps-check{width:14px;height:14px;flex-shrink:0;color:#4ade80}
.ps-domain-section{margin-top:14px;position:relative}
.ps-domain-label{display:block;font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:5px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em}
.ps-domain-wrap{position:relative}
.ps-domain-input{width:100%;padding:10px 40px 10px 14px;background:rgba(255,255,255,0.05);border:1.5px solid rgba(124,58,237,0.25);border-radius:10px;color:#fff;font-size:14px;font-family:inherit;outline:none;transition:all 0.25s;box-sizing:border-box}
.ps-domain-input:focus{border-color:rgba(124,58,237,0.6);box-shadow:0 0 20px rgba(124,58,237,0.15);background:rgba(255,255,255,0.08)}
.ps-domain-input::placeholder{color:rgba(255,255,255,0.25)}
.ps-domain-input.ps-available{border-color:rgba(74,222,128,0.5);box-shadow:0 0 16px rgba(74,222,128,0.1)}
.ps-domain-input.ps-unavailable{border-color:rgba(239,68,68,0.4);box-shadow:0 0 12px rgba(239,68,68,0.08)}
.ps-domain-status{position:absolute;right:12px;top:50%;transform:translateY(-50%);font-size:16px;transition:all 0.2s;opacity:0}
.ps-domain-status.ps-show{opacity:1}
.ps-results{margin-top:8px;display:flex;flex-wrap:wrap;gap:5px;min-height:24px}
.ps-tag{padding:3px 10px;border-radius:7px;font-size:11px;font-weight:500;transition:all 0.2s;border:1px solid transparent;cursor:default}
.ps-tag-avail{background:rgba(74,222,128,0.08);color:#4ade80;border-color:rgba(74,222,128,0.15);cursor:pointer}
.ps-tag-avail:hover{background:rgba(74,222,128,0.16);border-color:rgba(74,222,128,0.35);transform:translateY(-1px)}
.ps-tag-avail.ps-sel{background:rgba(74,222,128,0.2);border-color:#4ade80;box-shadow:0 0 8px rgba(74,222,128,0.15)}
.ps-tag-taken{background:rgba(255,255,255,0.02);color:rgba(255,255,255,0.2);text-decoration:line-through}
.ps-tag-checking{color:rgba(255,255,255,0.3);font-size:11px;background:linear-gradient(90deg,rgba(255,255,255,0.05) 25%,rgba(255,255,255,0.1) 50%,rgba(255,255,255,0.05) 75%);background-size:200% 100%;animation:ps-shimmer 1.5s infinite;border-radius:7px;padding:3px 10px}
#ps-go-btn{width:100%;padding:12px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border:none;border-radius:11px;font-size:14px;font-weight:700;cursor:pointer;transition:all 0.25s;box-shadow:0 4px 16px rgba(124,58,237,0.3);margin-top:14px}
#ps-go-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 28px rgba(124,58,237,0.45)}
#ps-go-btn:active:not(:disabled){transform:translateY(0)}
#ps-go-btn:disabled{opacity:0.5;cursor:not-allowed}
.ps-footer{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:14px}
.ps-footer a,.ps-footer button{background:none;border:none;color:rgba(255,255,255,0.4);font-size:12px;cursor:pointer;text-decoration:none;transition:color 0.2s;font-family:inherit;padding:0}
.ps-footer a:hover,.ps-footer button:hover{color:rgba(255,255,255,0.8)}
#ps-close-modal{position:absolute;top:10px;right:14px;background:none;border:none;color:rgba(255,255,255,0.2);font-size:20px;cursor:pointer;transition:all 0.2s;line-height:1;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%}
#ps-close-modal:hover{color:rgba(255,255,255,0.6);background:rgba(255,255,255,0.05)}
@media(max-width:600px){#ps-bar-inner{flex-wrap:wrap;gap:8px;padding:8px 14px}#ps-bar-msg{width:100%;text-align:center;font-size:12px}#ps-bar-left{width:100%;justify-content:center}#ps-bar-right{width:100%;justify-content:center}#ps-modal{padding:20px 16px}.ps-features{grid-template-columns:1fr}}
</style>

<!-- Bottom Bar (badge + CTA integrated, hidden initially) -->
<div id="ps-bar">
  <div id="ps-bar-inner">
    <div id="ps-bar-left">
      <a id="ps-bar-brand" href="https://${DOMAINS.SITES_BASE}/?ref=preview" target="_blank" rel="noopener" aria-label="Build your own free site on ProjectSites" title="Build your own free site on ProjectSites">
        <svg width="18" height="18" viewBox="0 0 32 32" fill="none"><defs><linearGradient id="psg" x1="0" y1="0" x2="32" y2="32"><stop offset="0%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#6d28d9"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#psg)"/><path d="M8 12l8-4 8 4M8 16l8 4 8-4M8 20l8 4 8-4" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/><circle cx="16" cy="12" r="2" fill="#fff" opacity="0.7"/></svg>
        <span id="ps-bar-build">Build your own</span>
      </a>
      <a id="ps-bar-edit" href="${editUrl}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
        Edit with AI
      </a>
    </div>
    <p id="ps-bar-msg"><strong>This website is yours</strong> — make it official</p>
    <div id="ps-bar-right">
      <button id="ps-claim-btn">Claim for $50/mo</button>
      <button id="ps-bar-x" aria-label="Dismiss">&times;</button>
    </div>
  </div>
</div>

<!-- Ownership Modal -->
<div id="ps-overlay">
  <div id="ps-modal" style="position:relative">
    <button id="ps-close-modal" aria-label="Close">&times;</button>
    <h2>Make It Yours</h2>
    <p class="ps-sub">${slug}.projectsites.dev</p>

    <div class="ps-plan">
      <div class="ps-price-row">
        <span class="ps-price">$50</span>
        <span class="ps-period">/ month</span>
      </div>
      <ul class="ps-features">
        <li><svg class="ps-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>Custom domain</li>
        <li><svg class="ps-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>Edit with AI</li>
        <li><svg class="ps-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>No branding</li>
        <li><svg class="ps-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>SSL &amp; CDN</li>
        <li><svg class="ps-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>Contact form</li>
        <li><svg class="ps-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>Analytics</li>
        <li><svg class="ps-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>Google Maps</li>
        <li><svg class="ps-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>Priority support</li>
      </ul>

      <div class="ps-domain-section">
        <label class="ps-domain-label" for="ps-dinput">Choose your domain</label>
        <div class="ps-domain-wrap">
          <input class="ps-domain-input" id="ps-dinput" type="text" placeholder="yourbusiness.com" autocomplete="off" spellcheck="false" />
          <span class="ps-domain-status" id="ps-dstatus"></span>
        </div>
        <div class="ps-results" id="ps-dresults"></div>
      </div>

      <button id="ps-go-btn">Get Started — $50/month</button>
    </div>

    <div class="ps-footer">
      <a href="${editUrl}">✏️ Edit with AI first</a>
      <span style="color:rgba(255,255,255,0.1)">·</span>
      <button onclick="document.getElementById('ps-overlay').classList.remove('ps-open')">Keep free for now</button>
    </div>
  </div>
</div>

<script>
(function(){
  if(window!==window.top)return;
  /* Enforce smooth scroll on all anchor links site-wide */
  document.documentElement.style.scrollBehavior='smooth';
  document.addEventListener('click',function(e){
    var a=e.target.closest('a[href^="#"]');
    if(a){var t=document.querySelector(a.getAttribute('href'));if(t){e.preventDefault();t.scrollIntoView({behavior:'smooth',block:'start'})}}
  });
  var S='${slug}',API='https://${DOMAINS.SITES_BASE}';
  var bar=document.getElementById('ps-bar');
  var overlay=document.getElementById('ps-overlay');
  var dinput=document.getElementById('ps-dinput');
  var dstatus=document.getElementById('ps-dstatus');
  var dresults=document.getElementById('ps-dresults');
  var goBtn=document.getElementById('ps-go-btn');
  var sel='';
  var dt;

  /* Show bar after 25s or 40% scroll */
  if(!sessionStorage.getItem('ps-x')){
    var s=false;
    function show(){if(!s){s=true;bar.classList.add('ps-visible')}}
    setTimeout(show,25000);
    window.addEventListener('scroll',function(){
      var pct=window.scrollY/(document.documentElement.scrollHeight-window.innerHeight);
      if(pct>0.4)show();
    },{passive:true});
  }

  /* Open/close modal */
  document.getElementById('ps-claim-btn').onclick=function(){overlay.classList.add('ps-open')};
  document.getElementById('ps-close-modal').onclick=function(){overlay.classList.remove('ps-open')};
  overlay.onclick=function(e){if(e.target===overlay)overlay.classList.remove('ps-open')};
  document.getElementById('ps-bar-x').onclick=function(){bar.style.display='none';sessionStorage.setItem('ps-x','1')};

  /* Domain search — checks exact + variations */
  dinput.addEventListener('input',function(){
    clearTimeout(dt);
    var v=this.value.trim().replace(/[^a-z0-9.-]/gi,'').toLowerCase().replace(/\\.[a-z]+$/i,'');
    if(v.length<2){dresults.innerHTML='';dstatus.className='ps-domain-status';dstatus.textContent='';sel='';return}
    dstatus.className='ps-domain-status ps-show';dstatus.textContent='⏳';
    dresults.innerHTML='<span class="ps-tag-checking">Checking availability...</span>';
    dt=setTimeout(function(){
      fetch(API+'/api/domains/availability?name='+encodeURIComponent(v))
        .then(function(r){return r.json()})
        .then(function(d){
          var items=d.data||[];
          var anyAvail=items.some(function(i){return i.available});
          /* Update input status indicator */
          var exact=items.find(function(i){return i.domain===v+'.com'});
          if(exact){
            if(exact.available){dstatus.textContent='✅';dstatus.className='ps-domain-status ps-show';dinput.className='ps-domain-input ps-available'}
            else{dstatus.textContent='❌';dstatus.className='ps-domain-status ps-show';dinput.className='ps-domain-input ps-unavailable'}
          }else{dstatus.className='ps-domain-status';dinput.className='ps-domain-input'}
          /* Render tags */
          dresults.innerHTML='';sel='';
          items.forEach(function(it){
            var t=document.createElement('span');
            t.className='ps-tag '+(it.available?'ps-tag-avail':'ps-tag-taken');
            t.textContent=it.domain;
            if(it.available){
              if(!sel){sel=it.domain;t.classList.add('ps-sel')}
              t.onclick=function(){
                document.querySelectorAll('.ps-tag.ps-sel').forEach(function(x){x.classList.remove('ps-sel')});
                t.classList.add('ps-sel');sel=it.domain;
              };
            }
            dresults.appendChild(t);
          });
          if(!anyAvail&&items.length>0){
            var hint=document.createElement('span');
            hint.style.cssText='display:block;width:100%;font-size:11px;color:rgba(255,255,255,0.3);margin-top:4px';
            hint.textContent='Try adding a prefix like "get" or "my", or a different name';
            dresults.appendChild(hint);
          }
        })
        .catch(function(){
          dstatus.textContent='⚠️';dstatus.className='ps-domain-status ps-show';
          dresults.innerHTML='<span style="font-size:11px;color:rgba(255,255,255,0.3)">Domain search temporarily unavailable — you can add a domain later</span>';
        });
    },500);
  });

  /* Checkout */
  goBtn.onclick=function(){
    goBtn.disabled=true;goBtn.textContent='Redirecting to checkout...';
    fetch(API+'/api/conversion/checkout',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({slug:S,domain:sel||null})
    })
    .then(function(r){return r.json()})
    .then(function(d){
      if(d.data&&d.data.checkout_url)window.location.href=d.data.checkout_url;
      else{goBtn.textContent='Error — try again';goBtn.disabled=false}
    })
    .catch(function(){goBtn.textContent='Connection error — try again';goBtn.disabled=false});
  };
})();
</script>
<!-- End ProjectSites Conversion Flow -->`;
}

/**
 * Resolve a hostname to a site record.
 *
 * Uses a two-tier lookup: KV cache (60 s TTL) → D1 database.
 * Supports dot-based subdomains (`slug.projectsites.dev`), legacy dash-based
 * subdomains (`slug-sites.megabyte.space`), and custom CNAME domains
 * (looked up in the `hostnames` table).
 *
 * @param env      - Worker environment (needs `CACHE_KV`, `DB`).
 * @param db       - D1Database binding.
 * @param hostname - The incoming request's `Host` header value.
 * @returns Resolved site info or `null` if not found.
 *
 * @example
 * ```ts
 * const site = await resolveSite(env, env.DB, 'vitos-mens-salon.projectsites.dev');
 * if (site) {
 *   return serveSiteFromR2(env, site, '/');
 * }
 * ```
 */
export async function resolveSite(
  env: Env,
  db: D1Database,
  hostname: string,
): Promise<{
  site_id: string;
  slug: string;
  org_id: string;
  current_build_version: string | null;
  plan: string;
} | null> {
  // Branch preview fast path: {branch}--{slug}.projectsites.dev
  // The `--` separator distinguishes branches from snapshot names (which use `-`).
  const branchInfo = parseBranchHost(hostname);
  if (branchInfo) {
    const branchRow = await dbQueryOne<{
      id: string;
      site_id: string;
      r2_path: string | null;
      status: string;
    }>(
      db,
      `SELECT b.id, b.site_id, b.r2_path, b.status
         FROM site_branches b
         JOIN sites s ON s.id = b.site_id
        WHERE b.branch_name = ? AND s.slug = ?
          AND b.deleted_at IS NULL AND s.deleted_at IS NULL
        LIMIT 1`,
      [branchInfo.branchName, branchInfo.slug],
    );

    if (branchRow && branchRow.r2_path && branchRow.status !== 'closed') {
      const siteRow = await dbQueryOne<{ id: string; org_id: string }>(
        db,
        'SELECT id, org_id FROM sites WHERE id = ? AND deleted_at IS NULL',
        [branchRow.site_id],
      );
      if (siteRow) {
        return {
          site_id: branchRow.site_id,
          slug: `${branchInfo.branchName}--${branchInfo.slug}`,
          org_id: siteRow.org_id,
          // Branch R2 path IS the version — stored as sites/{slug}/branches/{name}/
          current_build_version: branchRow.r2_path,
          plan: 'free', // Branch previews always show top bar (never claim-able)
        };
      }
    }
    // Branch not found / closed → fall through to 404 (do NOT resolve as base slug)
    return null;
  }

  // Fast path: check KV cache
  const cacheKey = `host:${hostname}`;
  const cached = await env.CACHE_KV.get(cacheKey, 'json');

  if (cached) {
    serveLog.debug('kv_cache_hit', { hostname });
    return cached as {
      site_id: string;
      slug: string;
      org_id: string;
      current_build_version: string | null;
      plan: string;
    };
  }

  // Extract slug from hostname (e.g., slug.projectsites.dev)
  let slug: string | null = null;
  const RESERVED_SLUGS = new Set(['editor', 'www', 'api', 'admin', 'staging', 'mail', 'smtp']);

  if (hostname.endsWith(DOMAINS.SITES_SUFFIX)) {
    slug = hostname.slice(0, -DOMAINS.SITES_SUFFIX.length);
  }

  // Don't resolve reserved subdomains as sites
  if (slug && RESERVED_SLUGS.has(slug)) {
    slug = null;
  }

  // Try hostname table lookup first (for custom domains)
  if (!slug) {
    const hostnameRow = await dbQueryOne<{ site_id: string; org_id: string }>(
      db,
      'SELECT site_id, org_id FROM hostnames WHERE hostname = ? AND status = ? AND deleted_at IS NULL',
      [hostname, 'active'],
    );

    if (hostnameRow) {
      const siteRow = await dbQueryOne<{ slug: string; current_build_version: string | null }>(
        db,
        'SELECT slug, current_build_version FROM sites WHERE id = ? AND deleted_at IS NULL',
        [hostnameRow.site_id],
      );

      if (siteRow) {
        const subRow = await dbQueryOne<{ plan: string; status: string }>(
          db,
          'SELECT plan, status FROM subscriptions WHERE org_id = ? AND deleted_at IS NULL',
          [hostnameRow.org_id],
        );

        const plan = subRow?.plan === 'paid' && subRow.status === 'active' ? 'paid' : 'free';

        const resolved = {
          site_id: hostnameRow.site_id,
          slug: siteRow.slug,
          org_id: hostnameRow.org_id,
          current_build_version: siteRow.current_build_version,
          plan,
        };

        // Fire-and-forget: a cache write must NEVER break serving. On the KV daily
        // put-limit (or any quota error) the bare await threw → resolveSite 500'd
        // every generated site (2026-06-24). Swallow — a failed write just means a
        // cache miss next request, not an outage. Per fail-fast-build-fail-soft-prod.
        await env.CACHE_KV.put(cacheKey, JSON.stringify(resolved), { expirationTtl: 60 }).catch(
          () => {},
        );
        return resolved;
      }
    }
  }

  // Look up by slug — with snapshot resolution
  // Pattern: {slug}-{snapshot}.projectsites.dev → serve frozen version
  // The snapshot name is separated by the LAST occurrence of a known snapshot pattern
  if (slug) {
    // First try exact slug match
    let siteRow = await dbQueryOne<{
      id: string;
      slug: string;
      org_id: string;
      current_build_version: string | null;
    }>(
      db,
      'SELECT id, slug, org_id, current_build_version FROM sites WHERE slug = ? AND deleted_at IS NULL',
      [slug],
    );

    // If no exact match, try snapshot resolution: {slug}-{snapshot}
    let snapshotVersion: string | null = null;
    if (!siteRow && slug.includes('-')) {
      // Try progressively shorter prefixes to find the base slug
      const parts = slug.split('-');
      for (let i = parts.length - 1; i >= 1; i--) {
        const candidateSlug = parts.slice(0, i).join('-');
        const candidateSnapshot = parts.slice(i).join('-');
        const candidateRow = await dbQueryOne<{
          id: string;
          slug: string;
          org_id: string;
          current_build_version: string | null;
        }>(
          db,
          'SELECT id, slug, org_id, current_build_version FROM sites WHERE slug = ? AND deleted_at IS NULL',
          [candidateSlug],
        );
        if (candidateRow) {
          // Found a base site — now look up the snapshot
          const snapshot = await dbQueryOne<{ build_version: string }>(
            db,
            'SELECT build_version FROM site_snapshots WHERE site_id = ? AND snapshot_name = ? AND deleted_at IS NULL',
            [candidateRow.id, candidateSnapshot],
          );
          if (snapshot) {
            siteRow = candidateRow;
            snapshotVersion = snapshot.build_version;
            serveLog.debug('snapshot_resolved', {
              slug: candidateSlug,
              version: snapshot.build_version,
            });
          }
          break;
        }
      }
    }

    if (siteRow) {
      const subRow = await dbQueryOne<{ plan: string; status: string }>(
        db,
        'SELECT plan, status FROM subscriptions WHERE org_id = ? AND deleted_at IS NULL',
        [siteRow.org_id],
      );

      const plan = subRow?.plan === 'paid' && subRow.status === 'active' ? 'paid' : 'free';

      const resolved = {
        site_id: siteRow.id,
        slug: siteRow.slug,
        org_id: siteRow.org_id,
        // Use snapshot version if resolved, otherwise latest
        current_build_version: snapshotVersion || siteRow.current_build_version,
        plan,
      };

      // Fire-and-forget: a cache write must NEVER break serving. On the KV daily
      // put-limit (or any quota error) the bare await threw → resolveSite 500'd
      // every generated site (2026-06-24). Swallow — a failed write just means a
      // cache miss next request, not an outage. Per fail-fast-build-fail-soft-prod.
      await env.CACHE_KV.put(cacheKey, JSON.stringify(resolved), { expirationTtl: 60 }).catch(
        () => {},
      );
      return resolved;
    }

    // R2 fallback: check for bolt-published sites (no D1 record)
    const manifest = await env.SITES_BUCKET.get(`sites/${slug}/_manifest.json`);

    if (manifest) {
      try {
        const data = (await manifest.json()) as { current_version: string };
        const resolved = {
          site_id: `bolt-${slug}`,
          slug,
          org_id: 'bolt-community',
          current_build_version: data.current_version,
          plan: 'free',
        };

        // Fire-and-forget: a cache write must NEVER break serving. On the KV daily
        // put-limit (or any quota error) the bare await threw → resolveSite 500'd
        // every generated site (2026-06-24). Swallow — a failed write just means a
        // cache miss next request, not an outage. Per fail-fast-build-fail-soft-prod.
        await env.CACHE_KV.put(cacheKey, JSON.stringify(resolved), { expirationTtl: 60 }).catch(
          () => {},
        );
        return resolved;
      } catch {
        // Malformed manifest — treat as not found
      }
    }
  }

  serveLog.debug('site_not_found', { hostname });
  return null;
}

/**
 * Serve a site's static files from R2.
 *
 * Looks up the file at `sites/{slug}/{version}/{path}` in R2, falls back to
 * `index.html` for SPA-style routing. Injects the promotional top bar for
 * HTML responses on the free plan.
 *
 * @param env         - Worker environment (needs `SITES_BUCKET`).
 * @param site        - Resolved site info from {@link resolveSite}.
 * @param requestPath - The URL pathname (e.g. `/`, `/about`, `/style.css`).
 * @returns HTTP Response with correct content-type and caching headers.
 *
 * @example
 * ```ts
 * const response = await serveSiteFromR2(env, site, '/privacy.html');
 * ```
 */
export async function serveSiteFromR2(
  env: Env,
  site: {
    site_id: string;
    slug: string;
    current_build_version: string | null;
    plan: string;
  },
  requestPath: string,
): Promise<Response> {
  // Block access to meta files and manifests
  if (requestPath.startsWith('/_meta/') || requestPath === '/_manifest.json') {
    serveLog.warn('serve_blocked_path', { slug: site.slug, path: requestPath });

    return new Response('Not Found', { status: 404 });
  }

  // If the site has no published version yet (still building), show a branded "building" page
  if (!site.current_build_version) {
    const buildingHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Building... | ${site.slug}</title><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0f;color:#e0e0e0;font-family:'Space Grotesk',sans-serif;overflow:hidden}@keyframes gradient{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}@keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.05);opacity:.8}}@keyframes spin{to{transform:rotate(360deg)}}.bg{position:fixed;inset:0;background:linear-gradient(-45deg,#0a0a0f,#0d1117,#0a1628,#0f0a1e);background-size:400% 400%;animation:gradient 8s ease infinite}.container{text-align:center;max-width:500px;padding:2rem;position:relative;z-index:1}.spinner{width:60px;height:60px;border:3px solid rgba(0,255,200,.1);border-top-color:#00ffc8;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 2rem}.title{font-size:2rem;font-weight:700;background:linear-gradient(135deg,#00ffc8,#00d4ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:pulse 2s ease-in-out infinite}.subtitle{color:#8892a4;margin-top:1rem;font-size:1.1rem;line-height:1.6}.slug{color:#4a9;font-family:monospace;font-size:.9rem;margin-top:1.5rem}p.note{color:#556;font-size:.8rem;margin-top:2rem}</style><meta http-equiv="refresh" content="15"></head><body><div class="bg"></div><div class="container"><div class="spinner"></div><div class="title">Building your website</div><p class="subtitle">Our AI is crafting a gorgeous, custom website. This usually takes a few minutes.</p><p class="slug">${site.slug}.projectsites.dev</p><p class="note">This page auto-refreshes every 15 seconds.</p></div></body></html>`;
    return new Response(buildingHtml, {
      status: 200,
      headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-cache, no-store' },
    });
  }

  const version = site.current_build_version;

  // Normalize path: resolve directory-style URLs to index.html
  let filePath = requestPath;
  if (filePath === '/') {
    filePath = '/index.html';
  } else if (filePath.endsWith('/')) {
    // /about/ → /about/index.html
    filePath += 'index.html';
  }

  // Branch previews store `current_build_version` as the full R2 prefix
  // (e.g. `sites/vitos/branches/feat-hero/`). Detect and use verbatim.
  const isBranchPath = version?.startsWith('sites/') && version.includes('/branches/');
  const r2Path = isBranchPath
    ? `${version}${filePath.replace(/^\//, '')}`
    : `sites/${site.slug}/${version}${filePath}`;

  serveLog.debug('serve_site_lookup', { slug: site.slug, version, r2Path });

  let object = await env.SITES_BUCKET.get(r2Path);

  // Helper: build a versioned R2 path respecting branch-path format.
  const versionedPath = (suffix: string): string =>
    isBranchPath
      ? `${version}${suffix.replace(/^\//, '')}`
      : `sites/${site.slug}/${version}${suffix}`;

  // For paths without extensions (e.g. /about), try directory index then .html extension
  if (!object && !filePath.includes('.')) {
    // /about → try /about/index.html
    const dirIndexPath = versionedPath(`${filePath}/index.html`);
    object = await env.SITES_BUCKET.get(dirIndexPath);

    if (!object) {
      // /about → try /about.html
      const htmlPath = versionedPath(`${filePath}.html`);
      object = await env.SITES_BUCKET.get(htmlPath);
    }
  }

  // For paths with nested directories that didn't match, try flat file name fallback
  // e.g. /blog/barbara-cary → try /blog-barbara-cary.html
  if (!object && filePath.includes('/') && !filePath.includes('.')) {
    const flatName = filePath.replace(/^\//, '').replace(/\//g, '-');
    const flatPath = versionedPath(`/${flatName}.html`);
    object = await env.SITES_BUCKET.get(flatPath);
    if (object) {
      serveLog.debug('serve_flat_fallback', { slug: site.slug, flatPath });
    }
  }

  if (!object) {
    // Try assets/ directory (logo, favicon, discovered images — not versioned)
    if (requestPath.startsWith('/assets/')) {
      const assetPath = `sites/${site.slug}${requestPath}`;
      const asset = await env.SITES_BUCKET.get(assetPath);
      if (asset) {
        const ext = requestPath.split('.').pop()?.toLowerCase() || '';
        const ct =
          {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            svg: 'image/svg+xml',
            webp: 'image/webp',
            ico: 'image/x-icon',
          }[ext] || 'application/octet-stream';
        return new Response(asset.body, {
          headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' },
        });
      }
    }

    // Try index.html for SPA fallback (catch-all for client-side routing)
    if (!requestPath.includes('.')) {
      const fallbackPath = versionedPath('/index.html');
      const fallback = await env.SITES_BUCKET.get(fallbackPath);

      if (fallback) {
        serveLog.debug('serve_spa_fallback', { slug: site.slug, requestPath });
        return buildSiteResponse(fallback, site, 'text/html; charset=utf-8', env);
      }
    }

    serveLog.warn('serve_not_found', { slug: site.slug, r2Path, requestPath });

    return new Response('Not Found', { status: 404 });
  }

  // Use the resolved file path for content-type detection, not the raw request path.
  // Raw path '/' has no extension → would return 'application/octet-stream' (download).
  // For directory/bare paths that resolved via fallback, force text/html.
  const contentType = filePath.includes('.')
    ? getContentType(filePath)
    : 'text/html; charset=utf-8';
  return buildSiteResponse(object, site, contentType, env);
}

/**
 * Generate Google Tag Manager container snippet (head portion).
 *
 * @param containerId - GTM Container ID (e.g., GTM-XXXXXXX).
 * @returns HTML `<script>` block to inject before `</head>`.
 */
function generateGtmHeadSnippet(containerId: string): string {
  return `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${containerId}');</script>`;
}

/**
 * Generate Google Tag Manager noscript snippet (body portion).
 *
 * @param containerId - GTM Container ID (e.g., GTM-XXXXXXX).
 * @returns HTML `<noscript>` block to inject after `<body>`.
 */
function generateGtmBodySnippet(containerId: string): string {
  return `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${containerId}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;
}

/**
 * Generate Google Analytics 4 (gtag.js) tracking snippet.
 *
 * Injects the GA4 global site tag with site_slug as a custom dimension
 * for per-site segmentation across a single GA4 property.
 *
 * @param measurementId - GA4 Measurement ID (e.g., G-XXXXXXXX).
 * @param slug          - Site slug for custom dimension enrichment.
 * @returns HTML `<script>` block to inject before `</head>`.
 */
function generateGa4Snippet(measurementId: string, slug: string): string {
  return `<!-- Google Analytics 4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>
<script>
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());
gtag('config','${measurementId}',{
  send_page_view:true,
  custom_map:{'dimension1':'site_slug'},
  site_slug:'${slug}'
});
</script>`;
}

/**
 * Generate the PWA meta + favicon link block injected into every served site.
 *
 * Fixes the deprecated `apple-mobile-web-app-capable` warning by including the
 * standardized `mobile-web-app-capable` alongside it, and guarantees the icon
 * paths referenced by `site.webmanifest` resolve (worker fallback serves them
 * from `sites/{slug}/assets/`).
 *
 * @param slug - Site slug used in icon path resolution + theme branding hooks.
 * @returns HTML block to inject before `</head>`.
 */
function generatePwaMetaSnippet(slug: string): string {
  void slug;
  return `<!-- PWA + Favicon (auto-injected) -->
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png">
<link rel="icon" type="image/png" sizes="512x512" href="/android-chrome-512x512.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">`;
}

/**
 * Anti-FOUC (Flash Of Unstyled Content) snippet, injected into every served site.
 *
 * Generated sites load Google Fonts with `display=swap`, which paints with a
 * fallback face first and then re-renders when the web font arrives — visible as
 * a text reflow / layout shift on first load. This snippet hides `<body>` until
 * either `document.fonts.ready` resolves or a 1500 ms safety net fires
 * (whichever comes first), then fades content in over 180 ms.
 *
 * The CSS lives in `<head>` so it applies before first paint. The class is
 * toggled on `<html>` (not `<body>`) so it works even before `<body>` parses.
 *
 * @returns HTML `<style>` + `<script>` block to inject before `</head>`.
 */
/**
 * Convert render-blocking Google-Fonts stylesheet links into NON-render-blocking
 * loads via the `media="print"` + `onload="this.media='all'"` pattern.
 *
 * Generated sites ship the font CSS as a blocking `<link rel="stylesheet">` in
 * `<head>`. That (a) delays first paint by a full cross-origin RTT on slow
 * connections, and (b) BLOCKS the subsequent inline anti-FOUC script (an inline
 * script waits for every preceding stylesheet), so the `body{opacity:0}` gate
 * can't lift until the (often 7-weight) fonts finish downloading. Making the font
 * CSS async removes both stalls; `font-display:swap` (already in every Google-Fonts
 * URL we emit) keeps text legible in the system fallback meanwhile.
 *
 * @remarks Impure-free — pure string transform. CSP-safe: served-site CSP allows
 *   inline event handlers (`default-src ... 'unsafe-inline'`, no strict-dynamic).
 * @param html - The site HTML to transform.
 * @returns HTML with every Google-Fonts `<link rel="stylesheet">` made async.
 * @example
 * asyncifyRenderBlockingFonts('<link href="https://fonts.googleapis.com/css2?x" rel="stylesheet">')
 * // → '<link href="https://fonts.googleapis.com/css2?x" rel="stylesheet" media="print" onload="this.media=\'all\'">'
 */
export function asyncifyRenderBlockingFonts(html: string): string {
  return html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/href=("|')https:\/\/fonts\.googleapis\.com\//i.test(tag)) return tag;
    if (!/\brel=("|')stylesheet\1/i.test(tag)) return tag;
    if (/\bmedia=/i.test(tag) || /\bonload=/i.test(tag)) return tag; // already async
    return tag.replace(/\/?>$/, ` media="print" onload="this.media='all'">`);
  });
}

/**
 * Auto-inject a STABLE `data-ps-section` attribute onto every top-level
 * `<section>` of a served page (AN26 #112) — the stable hook that section-level
 * conversion attribution (AN27 #63) reads. Each id is derived from the section's
 * existing `id` (slug-sanitized → semantic + stable, e.g. "services", "pricing")
 * and falls back to a deterministic 1-based index when no id is present, so the
 * same structure always yields the same attribution keys across rebuilds.
 *
 * Purely additive: only injects when the attribute is absent, never rewrites
 * other markup, and sanitizes the key to `[a-z0-9_-]` so it can't break the tag.
 *
 * @param html - The served HTML.
 * @returns HTML with `data-ps-section` on each `<section>` that lacked one.
 *
 * @example
 * ```ts
 * injectSectionInstrumentation('<section id="Services">…</section>');
 * // → '<section data-ps-section="services" id="Services">…</section>'
 * ```
 */
export function injectSectionInstrumentation(html: string): string {
  let i = 0;
  return html.replace(/<section\b([^>]*)>/gi, (tag, attrs: string) => {
    i += 1;
    if (/\bdata-ps-section=/i.test(attrs)) return tag; // already instrumented
    const idMatch = /\bid=("|')([^"']+)\1/i.exec(attrs);
    const fromId = idMatch
      ? idMatch[2]
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '')
      : '';
    const key = fromId || `section-${i}`;
    return `<section data-ps-section="${key}"${attrs}>`;
  });
}

/**
 * Synthesize a static, contentful hero into a generated site's EMPTY `#root` so
 * the largest-contentful-paint candidate (the headline) paints at FCP instead of
 * only after the React bundle boots (~3s on throttled 3G). The headline, subline,
 * and theme color are read from the served HTML's own `<head>` (`og:title` /
 * `<title>` / `meta[name=description]` / `meta[name=theme-color]`) — already in
 * the bytes we are transforming — so this adds ZERO extra reads on the hot path.
 *
 * React renders via `createRoot(#root).render()` (CSR, not hydration), which
 * REPLACES `#root`'s children on boot → the swap is clean (no hydration mismatch)
 * and the `min-height:100vh` box holds the hero in place → ~0 CLS.
 *
 * Perf loop #14, 2026-06-23 — the untried lever from fire 7: fires 6-7 only tried
 * font/anti-FOUC tweaks, which cannot move FCP/LCP into an EMPTY body. Injecting
 * real content into `#root` is what gives the paint something to render early.
 *
 * @param html - The generated site's full HTML.
 * @returns HTML with a static hero in `#root`, or the input unchanged when `#root`
 *   is absent / already populated, or no headline can be derived from the head.
 * @example
 * injectAppShellHero('<head><title>Acme | Best widgets</title></head><body><div id="root"></div></body>')
 * // → '...<div id="root"><section data-app-shell="hero" ...><h1>Acme</h1>...</section></div>...'
 */
export function injectAppShellHero(html: string): string {
  const emptyRoot = /<div([^>]*\bid=("|')root\2[^>]*)>\s*<\/div>/i;
  if (!emptyRoot.test(html)) return html;

  const rawHeadline =
    headContent(html, 'og:title', 'property') ?? firstMatch(html, /<title[^>]*>([^<]*)<\/title>/i);
  if (!rawHeadline) return html;
  const headline = decodeEntities(rawHeadline.split('|')[0].trim());
  if (!headline) return html;

  const rawSub =
    headContent(html, 'description', 'name') ?? headContent(html, 'og:description', 'property');
  const subline = rawSub ? decodeEntities(rawSub.trim()) : '';

  const bg = sanitizeHexColor(headContent(html, 'theme-color', 'name')) ?? '#0a0a0f';
  const fg = relativeLuminance(bg) > 0.5 ? '#0b0b0f' : '#f5f5f7';

  const hero = appShellHeroMarkup(headline, subline, bg, fg);
  return html.replace(emptyRoot, (_m, attrs) => `<div${attrs}>${hero}</div>`);
}

/** Read a `<meta name|property="key" content="...">` value from the head (attribute-order-agnostic). */
function headContent(html: string, key: string, attr: 'name' | 'property'): string | undefined {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    firstMatch(
      html,
      new RegExp(`<meta[^>]+${attr}=("|')${esc}\\1[^>]*content=("|')([^"']*)\\2`, 'i'),
      3,
    ) ??
    firstMatch(
      html,
      new RegExp(`<meta[^>]+content=("|')([^"']*)\\1[^>]*${attr}=("|')${esc}\\3`, 'i'),
      2,
    )
  );
}

function firstMatch(html: string, re: RegExp, group = 1): string | undefined {
  const m = re.exec(html);
  return m?.[group]?.trim() || undefined;
}

/** Allow only `#rgb` / `#rrggbb`; reject anything else to prevent style injection via theme-color. */
function sanitizeHexColor(c: string | undefined): string | undefined {
  return c && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()) ? c.trim() : undefined;
}

/** WCAG relative luminance (0 = black … 1 = white) of a `#rgb`/`#rrggbb` hex color. */
function relativeLuminance(hex: string): number {
  let h = hex.replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((x) => x + x)
      .join('');
  const channels = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Decode the handful of HTML entities that appear in title/meta text, so we can re-escape safely. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

function appShellHeroMarkup(headline: string, subline: string, bg: string, fg: string): string {
  const h = escapeHtml(headline);
  const sub = subline
    ? `<p style="margin:0;max-width:42ch;font-size:clamp(1rem,2.5vw,1.35rem);line-height:1.5;opacity:.72">${escapeHtml(subline)}</p>`
    : '';
  return (
    `<section data-app-shell="hero" style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:1.25rem;padding:6vh 5vw;box-sizing:border-box;background:${bg};color:${fg};font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">` +
    // Size to MATCH the largest generated React hero (Tailwind text-8xl = 6rem); a
    // strictly-smaller static h1 lets the late React h1 overtake the LCP candidate
    // (measured: run with text-8xl hero → LCP reverted to 5.5s). Equal-or-larger
    // area keeps the early static paint as the winning LCP. (perf loop #14 fire 31.)
    `<h1 style="margin:0;font-weight:800;line-height:1.04;letter-spacing:-0.02em;font-size:clamp(2.75rem,9vw,6rem);max-width:20ch">${h}</h1>` +
    sub +
    `</section>`
  );
}

/**
 * Speculation Rules snippet (#40) — prefetch same-origin links on `moderate`
 * eagerness (hover / pointerdown) so multi-page generated sites navigate near-
 * instantly. `prefetch` (not `prerender`) fetches + caches the next document
 * WITHOUT executing its JS, so it never double-fires the site's analytics or
 * wastes a full render — the safe default for small-business sites. Browsers
 * that don't support Speculation Rules simply ignore the unknown script type.
 *
 * @returns a `<script type="speculationrules">` block to inject before `</head>`.
 * @example generateSpeculationRulesSnippet().includes('speculationrules') // true
 */
function generateSpeculationRulesSnippet(): string {
  return `<!-- Speculation Rules: prefetch same-origin links on hover for instant nav -->
<script type="speculationrules">
{"prefetch":[{"source":"document","where":{"href_matches":"/*"},"eagerness":"moderate"}]}
</script>`;
}

function generateAntiFoucSnippet(): string {
  // Perf (perf loop #14, 2026-06-23): the safety-net was 1500ms. The reveal script
  // is a synchronous inline <script>, so it runs only AFTER the preceding
  // render-blocking CSS bundle loads; a 1500ms net on TOP of that pinned the body
  // hidden until ≈(CSS-ready ~1s)+1.5s ≈ 2.5s on throttled 3G — the dominant FCP
  // blocker on every served site. Cut to 300ms: reveal still prefers fonts.ready
  // (no-swap on warm cache) but no longer stalls 1.5s past CSS-ready. CLS-SAFE:
  // measured CLS stayed 0.003 even though fonts load AFTER the reveal on 3G (the
  // swap already happens post-reveal), so revealing earlier moves the same
  // negligible swap up without adding shift. Real fix for the swap-flash is a
  // metric-adjusted fallback @font-face (homepage pattern); follow-up.
  return `<!-- Anti-FOUC: hide + freeze animations until fonts ready or 300ms safety net -->
<style id="ps-anti-fouc">
html:not(.ps-fonts-ready) body{opacity:0}
html:not(.ps-fonts-ready) *,html:not(.ps-fonts-ready) *::before,html:not(.ps-fonts-ready) *::after{
  animation:none !important;
  transition:none !important;
}
html.ps-fonts-ready body{opacity:1;transition:opacity .2s ease-out}
@media (prefers-reduced-motion: reduce){html.ps-fonts-ready body{transition:none}}
</style>
<script>(function(){var h=document.documentElement,fired=false,r=function(){if(fired)return;fired=true;requestAnimationFrame(function(){requestAnimationFrame(function(){h.classList.add('ps-fonts-ready')})})};if(document.fonts&&document.fonts.ready){document.fonts.ready.then(r);}setTimeout(r,300);})();</script>`;
}

/**
 * Build an HTTP response for a site file, injecting analytics, error tracking,
 * and the promotional top bar for HTML on free plans.
 *
 * @param object      - R2 object body.
 * @param site        - Site metadata (slug, plan).
 * @param contentType - MIME type for the Content-Type header.
 * @param env         - Worker environment for PostHog/Sentry keys.
 * @returns Fully formed Response.
 */
async function buildSiteResponse(
  object: R2ObjectBody,
  site: { slug: string; plan: string },
  contentType: string,
  env?: Env,
): Promise<Response> {
  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=300, s-maxage=3600',
    'X-Site-Slug': site.slug,
  });

  // For HTML responses, inject tracking snippets and top bar
  if (contentType.startsWith('text/html')) {
    let html = await object.text();

    // Perf: take render-blocking Google-Fonts CSS off the critical path so first
    // paint (and the anti-FOUC body gate, which an inline script lifts only after
    // preceding stylesheets load) no longer waits on a cross-origin font download.
    // font-display:swap keeps text legible meanwhile. (perf loop #14, 2026-06-23.)
    html = asyncifyRenderBlockingFonts(html);

    // Inject analytics + error tracking before </head> (for all sites, paid and free)
    if (env) {
      let headInjection = '';

      // Google Tag Manager (head script)
      if (env.GTM_CONTAINER_ID) {
        headInjection += generateGtmHeadSnippet(env.GTM_CONTAINER_ID);
      }

      // Google Analytics 4
      if (env.GA4_MEASUREMENT_ID) {
        headInjection += generateGa4Snippet(env.GA4_MEASUREMENT_ID, site.slug);
      }

      // PostHog and Sentry are intentionally NOT injected into served
      // business-portfolio sites. End users visit small-business sites and
      // we don't surveil them or expose third-party error trackers there.
      // Worker-internal telemetry (this Worker's own monitoring) still uses
      // POSTHOG_API_KEY + SENTRY_DSN, but those keys never reach client HTML.

      // Always inject mobile-web-app meta + favicon links (auto-managed PWA setup).
      headInjection += generatePwaMetaSnippet(site.slug);

      // Always inject anti-FOUC snippet — gates body visibility on font load to
      // prevent the Google Fonts swap-flash that shifts hero/headline layout.
      headInjection += generateAntiFoucSnippet();

      // #40 — Speculation Rules: prefetch same-origin links on hover for instant
      // multi-page navigation (browsers without support ignore it).
      headInjection += generateSpeculationRulesSnippet();

      if (headInjection) {
        html = html.replace(/<\/head>/i, `${headInjection}\n</head>`);
      }
    }

    // Inject GTM noscript + top bar after <body>
    let bodyInjection = '';
    if (env?.GTM_CONTAINER_ID) {
      bodyInjection += generateGtmBodySnippet(env.GTM_CONTAINER_ID);
    }
    if (site.plan !== 'paid') {
      bodyInjection += generateTopBar(site.slug);
    }
    // Unified Analytics beacon (Plane H) — inject when ingestion is enabled by a
    // simple var (normal deploy → D1 store → Analytics tab) OR when the dispatcher
    // DO is bound (adds external fan-out). Keyed by slug; XSS guard in the builder.
    if (env?.ANALYTICS_INGEST_ENABLED === 'true' || env?.EVENT_DISPATCHER) {
      bodyInjection += buildAnalyticsTracker(site.slug);
    }
    // AN38 (#129): zero-cookie sites get a "No cookies · GDPR" trust badge.
    // Gated on actual cookielessness (no GA4/GTM) so the claim is never a lie.
    if (isServedSiteCookieless(env)) {
      bodyInjection += generateNoCookiesBadge();
    }
    // #60: live "Open now" badge — self-gates client-side on the page's own
    // LocalBusiness JSON-LD openingHours (renders nothing when absent/unparseable).
    bodyInjection += generateOpenNowBadge();
    if (bodyInjection) {
      html = html.replace(/(<body[^>]*>)/i, `$1\n${bodyInjection}\n`);
    }

    // AN26 (#112): stamp a stable `data-ps-section` on every <section> so
    // section-level conversion attribution (AN27) has a deterministic hook.
    // Gated to the analytics-enabled path (the attribute only feeds analytics).
    if (env?.ANALYTICS_INGEST_ENABLED === 'true' || env?.EVENT_DISPATCHER) {
      html = injectSectionInstrumentation(html);
    }

    // Perf loop #14 (2026-06-23): generated sites are pure CSR — nothing paints
    // until React boots (~3s on 3G). Synthesize a static hero into the empty
    // #root from the page's own <head> so FCP/LCP land at first paint instead.
    // Defensive no-op when #root is absent/populated or no headline is derivable;
    // killswitch = `wrangler rollback`. Mirrors the marketing app-shell pattern.
    html = injectAppShellHero(html);

    return new Response(html, { status: 200, headers });
  }

  // CSS minify-on-serve via lightningcss-wasm with KV cache. Falls through to
  // raw bytes on any error so a WASM blip never breaks the serve path.
  if (env && contentType.startsWith('text/css')) {
    try {
      const raw = await object.arrayBuffer();
      const { bytes, cacheHit } = await minifyCssCached(env, raw, `${site.slug}.css`);
      headers.set('X-CSS-Min', cacheHit ? 'hit' : 'miss');
      headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
      return new Response(bytes, { status: 200, headers });
    } catch (err) {
      serveLog.warn('css_minify_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return new Response(object.body, { status: 200, headers });
}

/**
 * Map a file extension to its MIME type.
 *
 * @param path - File path or URL pathname.
 * @returns MIME type string (defaults to `application/octet-stream`).
 */
function getContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
    xml: 'application/xml',
    txt: 'text/plain',
    webmanifest: 'application/manifest+json',
  };
  return types[ext ?? ''] ?? 'application/octet-stream';
}
