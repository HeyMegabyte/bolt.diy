/**
 * Landing pages for cloud-hosted SaaS subdomains (analytics/logs/billing/webhooks/links).
 *
 * @remarks
 * These subdomains (`analytics.projectsites.dev`, `logs.projectsites.dev`, etc.)
 * point to SaaS destinations (PostHog Cloud, Axiom, Stripe Dashboard, Hookdeck,
 * Dub) but previously fell through to the Worker's catch-all and returned 404.
 *
 * Each subdomain gets a minimal dark-themed landing page with a branded CTA button
 * linking to the cloud login URL. No self-hosted backend — the SaaS runs the service;
 * this page says "here's where it lives".
 *
 * @packageDocumentation
 */

/** One cloud-hosted platform service with a landing page. */
interface PlatformService {
  /** Single-label subdomain (no `.projectsites.dev`). */
  readonly sub: string;
  /** Human display name. */
  readonly name: string;
  /** One-line description of what the service does for the platform. */
  readonly description: string;
  /** The SaaS login / dashboard URL. */
  readonly url: string;
}

/** Registry of platform SaaS subdomains, keyed by single-label subdomain. */
export const PLATFORM_SERVICES: Readonly<Record<string, PlatformService>> = {
  analytics: {
    sub: 'analytics',
    name: 'Analytics',
    description:
      'Product analytics, session replays, and feature flags — real-time insights about your users and their behavior.',
    url: 'https://us.posthog.com',
  },
  logs: {
    sub: 'logs',
    name: 'Logs',
    description:
      'Centralized structured logging, search, dashboards, and alerts — every event, every trace, every request.',
    url: 'https://app.axiom.co',
  },
  billing: {
    sub: 'billing',
    name: 'Billing',
    description:
      'Subscription management, invoicing, payment processing, revenue analytics, and customer portal.',
    url: 'https://dashboard.stripe.com',
  },
  webhooks: {
    sub: 'webhooks',
    name: 'Webhooks',
    description:
      'Inspect, replay, and monitor every webhook — never miss an event from any integration.',
    url: 'https://console.hookdeck.com',
  },
  links: {
    sub: 'links',
    name: 'Links',
    description:
      'Short link management, branded domains, click tracking, QR codes — every link measured.',
    url: 'https://app.dub.co',
  },
};

/**
 * Resolve the {@link PlatformService} for a full hostname, or `undefined` if the
 * host is not a platform-service subdomain.
 *
 * @param hostname - Full request host, e.g. `analytics.projectsites.dev`.
 * @returns the matching service, or `undefined`.
 * @example resolvePlatformService('billing.projectsites.dev')?.name // 'Billing'
 */
export function resolvePlatformService(hostname: string): PlatformService | undefined {
  const h = hostname.toLowerCase();
  const suffix = '.projectsites.dev';
  if (!h.endsWith(suffix)) return undefined;
  const sub = h.slice(0, -suffix.length);
  return PLATFORM_SERVICES[sub];
}

/**
 * Render the full branded HTML landing page for a platform SaaS subdomain.
 *
 * @param svc - The service to render.
 * @returns a complete, self-contained HTML document string.
 * @example platformServiceLanding(PLATFORM_SERVICES.analytics) // '<!DOCTYPE html>...'
 */
export function platformServiceLanding(svc: PlatformService): string {
  const host = `${svc.sub}.projectsites.dev`;
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${svc.name} — ProjectSites</title>
<meta name="description" content="${svc.description}">
<meta name="color-scheme" content="dark">
<link rel="canonical" href="https://${host}/">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{min-height:100vh;background:#060610;color:#f4f4ff;font-family:'Space Grotesk',system-ui,sans-serif;line-height:1.6;
    display:flex;align-items:center;justify-content:center;padding:40px 20px;
    background-image:radial-gradient(60% 50% at 50% 0%,rgba(0,229,255,.10),transparent 70%)}
  .wrap{max-width:600px;width:100%;text-align:center}
  .status{display:inline-flex;align-items:center;gap:8px;font-family:'JetBrains Mono',monospace;font-size:.72rem;
    letter-spacing:.18em;text-transform:uppercase;color:#7ee787;margin-bottom:18px}
  .dot{width:8px;height:8px;border-radius:50%;background:#7ee787;box-shadow:0 0 10px #7ee787}
  .eyebrow{font-family:'JetBrains Mono',monospace;font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;color:#00e5ff;margin-bottom:14px}
  h1{font-size:clamp(2rem,5vw,3rem);font-weight:700;letter-spacing:-.03em;line-height:1.05;margin-bottom:14px;
    background:linear-gradient(135deg,#fff,rgba(0,229,255,.85));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .sub{color:#94a3b8;font-size:1.05rem;margin-bottom:32px;max-width:50ch;margin-left:auto;margin-right:auto}
  .btn{display:inline-block;padding:14px 36px;border-radius:12px;background:linear-gradient(135deg,#00e5ff,#50aae3);
    color:#060610;font-weight:700;font-size:1.05rem;font-family:inherit;text-decoration:none;transition:all .2s;
    border:none;cursor:pointer}
  .btn:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,229,255,.25)}
  .btn:active{transform:translateY(0)}
  .host{font-family:'JetBrains Mono',monospace;color:#64748b;font-size:.82rem;margin-top:32px}
  a{color:#00e5ff;text-decoration:none}a:hover{text-decoration:underline}
  .foot{margin-top:16px;font-size:.82rem;color:#64748b}
  .arrow{display:inline-block;margin-left:6px;transition:transform .15s}.btn:hover .arrow{transform:translateX(3px)}
</style></head><body><div class="wrap">
  <div class="status"><span class="dot"></span>Operational</div>
  <div class="eyebrow">ProjectSites · Cloud Service</div>
  <h1>${svc.name}</h1>
  <p class="sub">${svc.description}</p>
  <a class="btn" href="${svc.url}" target="_blank" rel="noopener noreferrer">Open ${svc.name}<span class="arrow">→</span></a>
  <p class="host">${host}</p>
  <p class="foot">&larr; <a href="https://projectsites.dev/">projectsites.dev</a></p>
</div></body></html>`;
}
