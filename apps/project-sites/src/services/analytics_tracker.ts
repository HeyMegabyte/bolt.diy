/**
 * @module services/analytics_tracker
 *
 * Builds the client-side beacon `<script>` injected into every served site so
 * page events reach `POST /api/events` (Plane H of `_CONVERGENCE_BACKLOG.md`).
 * This closes the "Analytics tab shows nothing" gap whose #1 cause is a site
 * with NO tracking code. Pure + deterministic → unit-testable; the serve path
 * supplies the `siteId` and injects the returned string before `</body>`.
 *
 * The emitted runtime: defines `window.PS_SITE_ID` + `window.psTrack(type,
 * payload)`, auto-fires a `pageview` on load, builds a fully
 * `IncomingEventSchema`-valid event (UUID `eventId`, ms `timestamp`), and
 * delivers via `navigator.sendBeacon` (fetch+keepalive fallback). Every call is
 * wrapped so a tracking failure can never break the host page.
 *
 * @example
 * const html = baseHtml.replace('</body>', buildAnalyticsTracker('site-123') + '</body>');
 */

const DEFAULT_ENDPOINT = 'https://projectsites.dev/api/events';

/**
 * JSON-encode a value for safe embedding inside an inline `<script>`: escape
 * `<` to `<` so a hostile `siteId` (e.g. `</script>…`) can never break out
 * of the script element. The standard JSON-in-HTML XSS guard.
 */
function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Options for {@link buildAnalyticsTracker}. */
export interface AnalyticsTrackerOptions {
  /** Ingestion endpoint. Defaults to the prod `/api/events`. */
  endpoint?: string;
}

/**
 * Build the inline analytics beacon `<script>` for a site.
 *
 * @param siteId - The site this tracker reports for (embedded XSS-safely).
 * @param opts - Optional endpoint override.
 * @returns A complete `<script>…</script>` string ready to inject before `</body>`.
 * @example
 * buildAnalyticsTracker('site-123'); // → '<script>…</script>'
 */
export function buildAnalyticsTracker(siteId: string, opts: AnalyticsTrackerOptions = {}): string {
  const s = scriptSafeJson(siteId);
  const u = scriptSafeJson(opts.endpoint ?? DEFAULT_ENDPOINT);
  // Single-line IIFE — error-safe end to end; never throws into the host page.
  const body =
    `(function(){var S=${s},U=${u};window.PS_SITE_ID=S;` +
    `function uid(){try{return crypto.randomUUID()}catch(e){var x='';for(var i=0;i<40;i++)x+=(Math.random()*16|0).toString(16);return x}}` +
    `window.psTrack=function(t,p){try{` +
    `var e={eventId:uid(),siteId:S,eventType:t||'custom',timestamp:Date.now(),payload:p||{}};var b=JSON.stringify(e);` +
    `if(navigator.sendBeacon){navigator.sendBeacon(U,b)}else{fetch(U,{method:'POST',body:b,keepalive:true}).catch(function(){})}` +
    `}catch(_){}};` +
    `try{window.psTrack('pageview',{path:location.pathname,referrer:document.referrer})}catch(_){}` +
    // AN18 (#60): click-to-call & directions are THE service-business conversions.
    // Capture-phase delegated click listener classifies tel:/mailto:/maps links and
    // fires a `conversion` event tagged with the nearest data-ps-section (AN26 → AN27).
    `try{function near(el){while(el&&el!==document){if(el.getAttribute){var v=el.getAttribute('data-ps-section');if(v!=null)return v}el=el.parentNode}return null}` +
    `document.addEventListener('click',function(ev){try{var el=ev.target;` +
    `while(el&&el!==document&&!(el.tagName==='A'&&el.href)){el=el.parentNode}` +
    `if(!el||el===document)return;var h=el.href||'';var k='';` +
    `if(/^tel:/i.test(h))k='call';else if(/^mailto:/i.test(h))k='email';` +
    `else if(/maps\\.(google|apple)\\.|google\\.[^\\/]+\\/maps|\\/maps\\/dir/i.test(h))k='directions';` +
    `if(!k)return;window.psTrack('conversion',{kind:k,section:near(el),href:h.slice(0,200)})}catch(_){}},true)}catch(_){}` +
    `})();`;
  return `<script>${body}</script>`;
}

/**
 * Inject the tracker before the closing `</body>` of an HTML document. If no
 * `</body>` exists (fragment / malformed), append it. Idempotent: a document
 * already carrying `window.PS_SITE_ID` is returned unchanged.
 *
 * @param html - The served HTML.
 * @param siteId - The site id.
 * @param opts - Optional endpoint override.
 * @returns The HTML with the tracker injected.
 */
export function injectAnalyticsTracker(
  html: string,
  siteId: string,
  opts: AnalyticsTrackerOptions = {},
): string {
  if (html.includes('window.PS_SITE_ID')) return html;
  const tag = buildAnalyticsTracker(siteId, opts);
  const idx = html.lastIndexOf('</body>');
  if (idx === -1) return html + tag;
  return html.slice(0, idx) + tag + html.slice(idx);
}
