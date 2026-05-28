/**
 * /admin/features — Features Hub.
 *
 * Single-page surface for every flag-gated feature shipped this session.
 * Each feature card shows: flag state, description, owner, the bound endpoint(s),
 * a live "Try it" button that calls the API + renders the JSON response inline.
 *
 * Grouped by theme (Models · Database · CWV · A11y · GEO · Editor · Monetization
 * · Observability · Media · Platform · Gaps). Tab strip across the top.
 *
 * Tab switches are URL-persistent via `?tab=` query param so deep links work.
 * Per [[brian-preferences]] the chrome is tight — feature density wins, not
 * marketing copy.
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

interface FlagDef {
  key: string;
  description: string;
  default_enabled: boolean;
  default_rollout_percent: number;
  stage: string;
  owner_email: string;
}

interface Feature {
  flag: string;
  name: string;
  tab: string;
  endpoints: Array<{ method: 'GET' | 'POST'; path: string; sample_body?: unknown }>;
  why: string;
}

const FEATURES: Feature[] = [
  // ── Models / DB / Audit / GitHub (Tab: Stack)
  { flag: 'multi_model_router', name: 'Multi-model router', tab: 'stack', endpoints: [{ method: 'GET', path: '/api/models' }, { method: 'GET', path: '/api/models/cost?model=claude-sonnet-4-6&input_tokens=1000&output_tokens=500' }], why: 'Customers pick Opus / Sonnet / Workers AI / GPT-5 per prompt with live cost preview.' },
  { flag: 'db_provisioning', name: 'Neon + Supabase provisioning', tab: 'stack', endpoints: [{ method: 'GET', path: '/api/db-providers' }, { method: 'POST', path: '/api/db-providers/provision', sample_body: { provider: 'neon', org_id: 'demo-org', site_id: 'demo-site' } }], why: 'One-click Postgres for any generated site in <60s.' },
  { flag: 'audit_hash_chain', name: 'SOC 2 audit chain', tab: 'stack', endpoints: [{ method: 'POST', path: '/api/audit/append', sample_body: { org_id: 'demo-org', actor: 'admin@demo.com', action: 'flag.toggle', payload: { flag: 'multi_model_router' } } }, { method: 'GET', path: '/api/audit/verify/demo-org' }], why: 'Immutable hash-chain audit trail — tamper-evident.' },
  { flag: 'github_sync', name: 'GitHub two-way sync', tab: 'stack', endpoints: [{ method: 'GET', path: '/api/integrations/github/connect' }, { method: 'GET', path: '/api/integrations/github/status' }], why: 'Commit on save, PR per branch via GitHub App.' },
  { flag: 'token_burn_meter', name: 'Token burn meter', tab: 'stack', endpoints: [{ method: 'GET', path: '/api/usage/burn?org_id=demo-org' }, { method: 'POST', path: '/api/usage/record', sample_body: { org_id: 'demo-org', model: 'claude-sonnet-4-6', input_tokens: 1200, output_tokens: 600 } }], why: 'Live monthly burn + projection, no surprise bills.' },
  { flag: 'snapshot_rollback', name: 'Snapshot rollback', tab: 'stack', endpoints: [{ method: 'GET', path: '/api/snapshots/by-site/demo-site' }, { method: 'POST', path: '/api/snapshots/by-site/demo-site', sample_body: { label: 'pre-publish', diff_summary: 'manual checkpoint' } }], why: 'Forward-only snapshot per AI edit; one-click revert.' },
  { flag: 'template_marketplace', name: 'Template marketplace', tab: 'stack', endpoints: [{ method: 'GET', path: '/api/marketplace/templates?industry=restaurant' }], why: 'Industry templates with 70/30 creator revenue split.' },

  // ── CWV (Tab: cwv)
  { flag: 'cwv_publish_gate', name: 'Lighthouse publish gate', tab: 'cwv', endpoints: [{ method: 'POST', path: '/api/cwv/gate/demo-site', sample_body: { urls: ['/', '/about', '/services'] } }], why: 'Block publish if LCP > 2.5s, INP > 200ms, or CLS > 0.1.' },
  { flag: 'rum_telemetry', name: 'Real user CWV ingest', tab: 'cwv', endpoints: [{ method: 'POST', path: '/api/rum/ingest', sample_body: { site_id: 'demo-site', route: '/', lcp: 1800, cls: 0.04, inp: 120 } }], why: 'Web-vitals v4 + Long Animation Frame telemetry per route.' },
  { flag: 'critical_css_inline', name: 'Critical CSS extractor', tab: 'cwv', endpoints: [{ method: 'POST', path: '/api/critical-css', sample_body: { html: '<style>body{margin:0;background:#060610}.hero{padding:4rem}</style><div class="hero">Welcome</div>' } }], why: 'Inline above-the-fold CSS, defer the rest.' },
  { flag: 'image_triplet_pipeline', name: 'AVIF/WebP/JPEG triplet', tab: 'cwv', endpoints: [{ method: 'POST', path: '/api/image-pipeline/triplet', sample_body: { r2_key: 'media/demo/hero.png' } }], why: '20-30% smaller than WebP, <picture> served everywhere.' },
  { flag: 'speed_score_widget', name: 'Speed Score widget', tab: 'cwv', endpoints: [{ method: 'GET', path: '/api/speed-score/demo-site' }], why: 'Per-customer CWV vs industry benchmark + share-with-client PDF.' },

  // ── GEO (Tab: geo)
  { flag: 'geo_visibility_tracker', name: 'AI search visibility', tab: 'geo', endpoints: [{ method: 'GET', path: '/api/geo/queries?org_id=demo-org' }, { method: 'POST', path: '/api/geo/queries', sample_body: { org_id: 'demo-org', query: 'best plumber in newark nj' } }], why: 'Daily ChatGPT / Claude / Perplexity citation tracking.' },
  { flag: 'cornerstone_autorefresh', name: 'Cornerstone auto-refresh', tab: 'geo', endpoints: [{ method: 'GET', path: '/api/cornerstone/by-site/demo-site' }, { method: 'POST', path: '/api/cornerstone/by-site/demo-site/refresh', sample_body: { route: '/' } }], why: 'Monthly Workflow regen of top-10 pages — MIT Sloan: stale = -81% citations.' },

  // ── Accessibility (Tab: a11y)
  { flag: 'axe_publish_gate', name: 'axe-core publish gate', tab: 'a11y', endpoints: [{ method: 'POST', path: '/api/axe/gate/demo-site', sample_body: { urls: ['/'] } }], why: 'Block publish on WCAG 2.2 AA violations at 6 viewports.' },
  { flag: 'ai_alt_text', name: 'AI alt-text', tab: 'a11y', endpoints: [{ method: 'POST', path: '/api/alt-text', sample_body: { image_url: 'https://example.com/hero.jpg', context: 'artisan bakery counter at sunset' } }], why: 'Vision-model alt text on every uploaded image.' },
  { flag: 'wcag22_wizard', name: 'WCAG 2.2 manual wizard', tab: 'a11y', endpoints: [{ method: 'GET', path: '/api/wcag22/wizard' }], why: 'The 8 criteria axe cannot auto-detect, surfaced as a publish checklist.' },
  { flag: 'oklch_contrast_lift', name: 'OKLCH contrast lift', tab: 'a11y', endpoints: [{ method: 'POST', path: '/api/contrast/check', sample_body: { fg: '#888888', bg: '#0a0a0a' } }, { method: 'POST', path: '/api/contrast/lift', sample_body: { token: '#888888' } }], why: 'Auto-lift palette tokens that fail 4.5:1 via OKLCH relative-color.' },

  // ── Editor UX (Tab: editor)
  { flag: 'section_overlay', name: 'Section overlay', tab: 'editor', endpoints: [{ method: 'GET', path: '/api/overlay/by-site/demo-site/sections' }], why: 'Hover preview → jump to source file:line.' },
  { flag: 'approval_workflow', name: 'Agency → client approval', tab: 'editor', endpoints: [{ method: 'POST', path: '/api/approval/link', sample_body: { site_id: 'demo-site', agency_org_id: 'demo-agency' } }], why: 'Signed-token review link; client approves before publish.' },

  // ── Monetization (Tab: monetize)
  { flag: 'stripe_meters', name: 'Stripe Meters', tab: 'monetize', endpoints: [{ method: 'POST', path: '/api/meters/event', sample_body: { customer_id: 'cus_demo', event_name: 'ai_tokens', value: 1000, identifier: 'idem-demo-1' } }], why: 'Usage-based AI billing via Stripe post-2025-03-31 API.' },
  { flag: 'upsell_campaign_month3', name: 'Annual upsell at month 3', tab: 'monetize', endpoints: [{ method: 'GET', path: '/api/campaigns' }], why: 'Workflow + Resend personalized email at the 90-day mark.' },
  { flag: 'referral_credits', name: 'Referral credits', tab: 'monetize', endpoints: [{ method: 'GET', path: '/api/referrals/code?user_id=demo-user' }], why: '$25 each side, Stripe coupon-backed.' },
  { flag: 'cost_attribution', name: 'Cost attribution', tab: 'monetize', endpoints: [{ method: 'GET', path: '/api/costs/breakdown?org_id=demo-org' }, { method: 'GET', path: '/api/agency/cost-attribution?org_id=demo-org' }], why: 'CF + AI cents per tenant, agency exports as CSV.' },

  // ── Observability (Tab: obs)
  { flag: 'otlp_unified_events', name: 'OTLP unified events', tab: 'obs', endpoints: [{ method: 'POST', path: '/api/otlp/span', sample_body: { name: 'demo.span', duration_ms: 12, status: 'ok' } }], why: 'D1 + WS + fetch + AI spans → Axiom in one stream.' },
  { flag: 'tenant_sentry_releases', name: 'Per-tenant Sentry', tab: 'obs', endpoints: [{ method: 'GET', path: '/api/sentry/issues?org_id=demo-org' }, { method: 'POST', path: '/api/sentry/token', sample_body: { org_id: 'demo-org' } }], why: 'Customer-self-serve error feed scoped to their org.' },
  { flag: 'slo_tracker', name: 'SLO tracker', tab: 'obs', endpoints: [{ method: 'GET', path: '/api/slo?org_id=demo-org' }, { method: 'POST', path: '/api/slo', sample_body: { org_id: 'demo-org', route: '/api/sites/*', availability: 99.9, p99_latency_ms: 500 } }], why: 'Per-route availability + p99 latency targets, burn-rate alerts.' },

  // ── Media gen (Tab: media)
  { flag: 'veo_hero_loop', name: 'Veo 3.1 hero loops', tab: 'media', endpoints: [{ method: 'POST', path: '/api/gen/veo/preview-cost', sample_body: { duration_s: 8, tier: 'fast' } }, { method: 'POST', path: '/api/gen/veo', sample_body: { org_id: 'demo-org', prompt: 'Slow dolly across artisan bakery counter at sunrise', duration_s: 8, tier: 'fast' } }], why: '8s native-audio brand-locked loops at $0.10/sec.' },
  { flag: 'page_podcast', name: 'Per-page AI podcast', tab: 'media', endpoints: [{ method: 'POST', path: '/api/gen/podcast', sample_body: { org_id: 'demo-org', page_content: 'Bayonne Bakery is a family-run artisan bakery in Newark NJ established 2018. Sourdough, croissants, holiday boxes.' } }], why: '3-min synthesized audio overview per page, R2-cached.' },
  { flag: 'logo_regenerator', name: 'Brand kit regenerator', tab: 'media', endpoints: [{ method: 'POST', path: '/api/gen/brand-kit', sample_body: { org_id: 'demo-org', prompt: 'A bold geometric monogram for an artisan bakery, warm color palette' } }], why: 'Sketch / prompt → DTCG kit: favicons + apple-touch + OG + maskable.' },

  // ── Platforms / multi-tenant (Tab: platform)
  { flag: 'wfp_dispatch', name: 'Workers for Platforms', tab: 'platform', endpoints: [{ method: 'GET', path: '/api/dispatch/sites/demo-site' }], why: 'Dispatch-namespace per-tenant isolation + custom CPU caps.' },
  { flag: 'egress_control', name: 'Egress control', tab: 'platform', endpoints: [{ method: 'GET', path: '/api/egress/rules?org_id=demo-org' }], why: 'Per-tenant outbound rules + audit log.' },
  { flag: 'agency_tier', name: 'Agency invoices', tab: 'platform', endpoints: [{ method: 'GET', path: '/api/agency/invoices' }], why: 'Stripe Connect Express splits per-client revenue.' },
  { flag: 'whitelabel_admin', name: 'White-label branding', tab: 'platform', endpoints: [{ method: 'GET', path: '/api/branding' }], why: 'Agencies brand the admin as their own; custom hostname.' },

  // ── Gap surface (Tab: gaps)
  { flag: 'i18n_auto_locale', name: 'Locale detect (ACS)', tab: 'gaps', endpoints: [{ method: 'GET', path: '/api/locale/detect?city=newark&state=nj&country=US' }], why: 'Newark NJ → [en, es, pt] — auto-fire i18n mirrors per service area.' },
  { flag: 'pwa_manifest_full', name: 'Full PWA manifest', tab: 'gaps', endpoints: [{ method: 'GET', path: '/api/pwa/manifest?org_id=demo-org' }], why: 'Screenshots + shortcuts + share_target + file_handlers + protocol_handlers.' },
  { flag: 'web_push', name: 'Web push subscribe', tab: 'gaps', endpoints: [{ method: 'POST', path: '/api/push/subscribe', sample_body: { user_id: 'demo-user', endpoint: 'https://fcm.googleapis.com/test', p256dh: 'demo', auth: 'demo' } }], why: 'VAPID push for deploy / lead / billing alerts.' },
  { flag: 'auto_changelog', name: 'Auto changelog', tab: 'gaps', endpoints: [{ method: 'POST', path: '/api/changelog/generate', sample_body: { commits: [{ sha: 'a1b2c3d', message: 'feat: add Veo hero loops', author: 'projectsites', date: '2026-05-28' }, { sha: 'e4f5g6h', message: 'fix: D1 connection timeout under load', author: 'projectsites', date: '2026-05-28' }] } }], why: 'Workers AI groups commits into user-outcome bullets per deploy.' },

  // ── 10 brilliant (Tab: brilliant)
  { flag: 'site_mcp_server', name: 'Site-as-MCP-server', tab: 'brilliant', endpoints: [{ method: 'GET', path: '/api/sites/demo-site/mcp/discovery' }, { method: 'POST', path: '/api/sites/demo-site/mcp/discovery' }], why: 'Every customer site becomes Siri/Claude/Cursor queryable. Zero competitor parity.' },
  { flag: 'cold_tier_thaw', name: 'Cold-tier auto-thaw', tab: 'brilliant', endpoints: [{ method: 'GET', path: '/api/cold-tier/status/demo-site' }, { method: 'POST', path: '/api/cold-tier/archive/demo-site' }, { method: 'POST', path: '/api/cold-tier/thaw/demo-site' }], why: 'Idle 90d → archive to R2 IA. First hit thaws <30s. Long-tail tenancy cost → $0.' },
  { flag: 'ai_auto_router', name: 'AI auto-router (workload-aware)', tab: 'brilliant', endpoints: [{ method: 'POST', path: '/api/router/pick', sample_body: { prompt: 'Add a pricing section', org_id: 'demo-org' } }, { method: 'GET', path: '/api/router/stats?org_id=demo-org' }], why: '~80% AI cost reduction by auto-routing simple/free, complex/Opus, creative/Sonnet.' },
  { flag: 'ghost_routes', name: 'Ghost routes', tab: 'brilliant', endpoints: [{ method: 'GET', path: '/api/ghost-routes/list/demo-site' }, { method: 'POST', path: '/api/ghost-routes/preview', sample_body: { site_id: 'demo-site', path: '/pricing' } }], why: 'Catch-all generates /pricing /about /faq on first hit. Long-tail SEO at $0.' },
  { flag: 'speed_compare_widget', name: 'Speed-compare widget', tab: 'brilliant', endpoints: [{ method: 'POST', path: '/api/speed-compare', sample_body: { customer_site: 'demo.projectsites.dev', competitor_url: 'https://example-bakery.com' } }], why: 'Embeddable comparison widget. Viral acquisition loop — every share = backlink.' },
  { flag: 'auto_gen_static_files', name: '50 auto-gen static files', tab: 'brilliant', endpoints: [{ method: 'GET', path: '/api/auto-files/list/demo-site' }, { method: 'POST', path: '/api/auto-files/regenerate/demo-site/llms.txt' }], why: 'llms.txt / sitemaps / OG cards / favicons / RSS materialize on first hit per site.' },
  { flag: 'hallucination_guard', name: 'Hallucination guard', tab: 'brilliant', endpoints: [{ method: 'POST', path: '/api/hallucination-check', sample_body: { site_id: 'demo-site', page_route: '/about', text: 'Founded in 2003 with 200 employees serving the Newark community since opening day.' } }, { method: 'GET', path: '/api/hallucination-flags/demo-site' }], why: 'Every AI claim cited to research_data or flagged. EU AI Act 2026 Article 50 compliance.' },
  { flag: 'visitor_recognition', name: 'Visitor recognition', tab: 'brilliant', endpoints: [{ method: 'POST', path: '/api/visitor/recognize', sample_body: { site_id: 'demo-site', anon_id: 'anon-abc123', source: 'google', city: 'Newark', country: 'US' } }, { method: 'GET', path: '/api/visitor/personalize/demo-site?anon_id=anon-abc123' }], why: 'Anon DO tracks visit count; 2nd+ visit shows personalized hero variant.' },
  { flag: 'faq_from_tickets', name: 'FAQ-from-tickets', tab: 'brilliant', endpoints: [{ method: 'POST', path: '/api/faq-builder/from-tickets', sample_body: { site_id: 'demo-site', tickets: [{ id: 't1', body: 'Do you ship internationally?' }, { id: 't2', body: 'How do I cancel my subscription?' }, { id: 't3', body: 'Do you ship outside US?' }] } }, { method: 'GET', path: '/api/faq-builder/draft/demo-site' }], why: 'Vectorize clusters real support tickets → FAQPage drafts. Real questions, not generic.' },
  { flag: 'competitor_monitor', name: 'Competitor monitor + counter-ship', tab: 'brilliant', endpoints: [{ method: 'POST', path: '/api/competitor-monitor/scan/demo-org' }, { method: 'GET', path: '/api/competitor-monitor/list/demo-org' }], why: 'Daily scrape of competitors. New section detected → AI drafts counter-section.' },
];

const TABS: Array<{ id: string; label: string; icon: string }> = [
  { id: 'brilliant', label: '★ Brilliant', icon: '★' },
  { id: 'stack', label: 'Stack', icon: '⚙' },
  { id: 'cwv', label: 'Core Web Vitals', icon: '⚡' },
  { id: 'geo', label: 'AI Search (GEO)', icon: '◆' },
  { id: 'a11y', label: 'Accessibility', icon: '◉' },
  { id: 'editor', label: 'Editor UX', icon: '✎' },
  { id: 'monetize', label: 'Monetization', icon: '$' },
  { id: 'obs', label: 'Observability', icon: '⊙' },
  { id: 'media', label: 'Media Gen', icon: '▶' },
  { id: 'platform', label: 'Platforms', icon: '⊞' },
  { id: 'gaps', label: 'Gap Surface', icon: '+' },
];

@Component({
  selector: 'app-admin-features-hub',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="hub">
      <header class="hub-head">
        <div>
          <h1>Features Hub</h1>
          <p class="hub-sub">
            {{ enabledCount() }} / {{ totalCount() }} features enabled in this environment.
            Every endpoint below is gated by <a routerLink="/admin/feature-flags">a feature flag</a>.
            Off = 404 (doesn't leak feature existence). On = handler runs.
          </p>
        </div>
        <div class="hub-search">
          <input
            type="search"
            placeholder="Search features…"
            [ngModel]="search()"
            (ngModelChange)="search.set($event)"
            aria-label="Search features"
          />
        </div>
      </header>

      <nav class="hub-tabs" role="tablist" aria-label="Feature categories">
        @for (t of tabs; track t.id) {
          <button
            class="hub-tab"
            [class.hub-tab-active]="tab() === t.id"
            (click)="setTab(t.id)"
            role="tab"
            [attr.aria-selected]="tab() === t.id"
          >
            <span class="hub-tab-icon">{{ t.icon }}</span>
            <span class="hub-tab-label">{{ t.label }}</span>
            <span class="hub-tab-count">{{ countFor(t.id) }}</span>
          </button>
        }
      </nav>

      <ul class="hub-grid">
        @for (f of visible(); track f.flag) {
          <li class="hub-card" [attr.data-flag-on]="flagState(f.flag)?.default_enabled">
            <header class="hub-card-head">
              <div>
                <h2 class="hub-card-name">{{ f.name }}</h2>
                <code class="hub-card-key">{{ f.flag }}</code>
              </div>
              <div class="hub-state">
                @if (flagState(f.flag); as s) {
                  <span class="hub-pill" [class.hub-pill-on]="s.default_enabled" [class.hub-pill-off]="!s.default_enabled">
                    {{ s.default_enabled ? 'ON' : 'OFF' }} · {{ s.stage }}
                  </span>
                } @else {
                  <span class="hub-pill">loading…</span>
                }
              </div>
            </header>

            <p class="hub-why">{{ f.why }}</p>

            <div class="hub-endpoints">
              @for (e of f.endpoints; track e.method + e.path; let i = $index) {
                <div class="hub-endpoint">
                  <span class="hub-method" [attr.data-method]="e.method">{{ e.method }}</span>
                  <code class="hub-path" title="Click to copy" (click)="copy(e.path)">{{ e.path }}</code>
                  <button class="hub-try" (click)="tryIt(f, i)" [disabled]="loading()[f.flag + ':' + i]">
                    {{ loading()[f.flag + ':' + i] ? '…' : 'Try' }}
                  </button>
                </div>
                @if (result()[f.flag + ':' + i]; as r) {
                  <div class="hub-result" [attr.data-status]="r.status">
                    <header>
                      <span class="hub-result-status">HTTP {{ r.status }}</span>
                      @if (r.status === 404) {
                        <span class="hub-result-hint">Flag is OFF — that's why this 404'd (never 403; doesn't leak feature existence).</span>
                      }
                    </header>
                    <pre>{{ r.body | json }}</pre>
                  </div>
                }
              }
            </div>
          </li>
        }
      </ul>

      @if (visible().length === 0) {
        <div class="hub-empty">No features match the current filter.</div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; padding: 1.25rem 1.5rem 4rem; max-width: 1400px; margin: 0 auto; color: var(--ps-ink, #f4f4ff); }
    .hub-head { display: flex; align-items: start; justify-content: space-between; gap: 1.5rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
    .hub-head h1 { margin: 0 0 .25rem; font-size: clamp(1.5rem, 3vw, 2.25rem); }
    .hub-sub { color: color-mix(in oklch, currentColor 65%, transparent); margin: 0; max-width: 72ch; }
    .hub-sub a { color: var(--ps-accent, #00e5ff); }
    .hub-search input { padding: .65rem .9rem; border-radius: 10px; background: color-mix(in oklch, var(--ps-bg, #060610) 65%, transparent); border: 1px solid color-mix(in oklch, currentColor 18%, transparent); color: inherit; font: inherit; min-width: 280px; }
    .hub-search input:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }

    .hub-tabs { display: flex; gap: .375rem; flex-wrap: wrap; margin-bottom: 1.5rem; padding: .25rem; background: color-mix(in oklch, var(--ps-bg, #060610) 60%, transparent); border: 1px solid color-mix(in oklch, currentColor 12%, transparent); border-radius: 12px; }
    .hub-tab { background: transparent; color: inherit; border: 0; padding: .55rem .85rem; border-radius: 8px; cursor: pointer; font: inherit; font-size: .9rem; display: inline-flex; align-items: center; gap: .5rem; transition: background .12s ease; }
    .hub-tab:hover { background: color-mix(in oklch, currentColor 8%, transparent); }
    .hub-tab-active { background: var(--ps-accent, #00e5ff); color: var(--ps-bg, #060610); }
    .hub-tab-active:hover { background: var(--ps-accent, #00e5ff); }
    .hub-tab-icon { font-size: 1rem; opacity: .85; }
    .hub-tab-count { background: color-mix(in oklch, currentColor 18%, transparent); padding: .05rem .45rem; border-radius: 999px; font-size: .72rem; font-family: var(--ps-mono, ui-monospace, monospace); }
    .hub-tab-active .hub-tab-count { background: color-mix(in oklch, currentColor 22%, transparent); }

    .hub-grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 1rem; }
    .hub-card { background: color-mix(in oklch, var(--ps-bg, #060610) 55%, transparent); border: 1px solid color-mix(in oklch, currentColor 14%, transparent); border-radius: 14px; padding: 1.1rem 1.15rem 1.2rem; display: flex; flex-direction: column; gap: .85rem; }
    .hub-card[data-flag-on="true"] { border-color: color-mix(in oklch, #4ade80 35%, transparent); }
    .hub-card-head { display: flex; align-items: start; justify-content: space-between; gap: .75rem; }
    .hub-card-name { margin: 0; font-size: 1.05rem; }
    .hub-card-key { font-family: var(--ps-mono, ui-monospace, monospace); font-size: .72rem; color: color-mix(in oklch, currentColor 55%, transparent); }
    .hub-pill { font-size: .7rem; padding: .2rem .55rem; border-radius: 999px; background: color-mix(in oklch, currentColor 15%, transparent); text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
    .hub-pill-on { background: #4ade80; color: #052e16; }
    .hub-pill-off { background: color-mix(in oklch, currentColor 12%, transparent); color: color-mix(in oklch, currentColor 75%, transparent); }
    .hub-why { color: color-mix(in oklch, currentColor 70%, transparent); margin: 0; font-size: .9rem; line-height: 1.45; }
    .hub-endpoints { display: flex; flex-direction: column; gap: .35rem; }
    .hub-endpoint { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; padding: .35rem 0; border-top: 1px dashed color-mix(in oklch, currentColor 12%, transparent); }
    .hub-endpoint:first-child { border-top: 0; padding-top: 0; }
    .hub-method { font-family: var(--ps-mono, ui-monospace, monospace); font-size: .72rem; font-weight: 700; padding: .15rem .45rem; border-radius: 5px; }
    .hub-method[data-method="GET"] { background: #4ade80; color: #052e16; }
    .hub-method[data-method="POST"] { background: #fbbf24; color: #1c1917; }
    .hub-path { font-family: var(--ps-mono, ui-monospace, monospace); font-size: .8rem; flex: 1 1 200px; word-break: break-all; cursor: copy; padding: .15rem .35rem; border-radius: 4px; }
    .hub-path:hover { background: color-mix(in oklch, currentColor 10%, transparent); }
    .hub-try { background: transparent; color: inherit; border: 1px solid color-mix(in oklch, currentColor 25%, transparent); padding: .25rem .65rem; border-radius: 6px; cursor: pointer; font: inherit; font-size: .8rem; }
    .hub-try:hover:not(:disabled) { border-color: var(--ps-accent, #00e5ff); color: var(--ps-accent, #00e5ff); }
    .hub-try:disabled { opacity: .5; cursor: progress; }
    .hub-result { background: color-mix(in oklch, var(--ps-bg, #060610) 75%, transparent); border-radius: 8px; padding: .55rem .65rem; font-size: .78rem; border: 1px solid transparent; }
    .hub-result[data-status="404"] { border-color: color-mix(in oklch, #fbbf24 40%, transparent); }
    .hub-result[data-status="200"] { border-color: color-mix(in oklch, #4ade80 40%, transparent); }
    .hub-result header { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; margin-bottom: .35rem; }
    .hub-result-status { font-family: var(--ps-mono, ui-monospace, monospace); font-weight: 600; }
    .hub-result-hint { color: color-mix(in oklch, currentColor 70%, transparent); font-size: .75rem; }
    .hub-result pre { margin: 0; font-family: var(--ps-mono, ui-monospace, monospace); font-size: .75rem; overflow: auto; max-height: 220px; }
    .hub-empty { padding: 3rem; text-align: center; border: 1px dashed color-mix(in oklch, currentColor 18%, transparent); border-radius: 12px; color: color-mix(in oklch, currentColor 55%, transparent); }
  `],
})
export class AdminFeaturesHubComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly tabs = TABS;
  readonly features = FEATURES;
  readonly tab = signal<string>('brilliant');
  readonly search = signal('');
  readonly flags = signal<Record<string, FlagDef>>({});
  readonly loading = signal<Record<string, boolean>>({});
  readonly result = signal<Record<string, { status: number; body: unknown }>>({});

  readonly totalCount = computed(() => this.features.length);
  readonly enabledCount = computed(() => this.features.filter((f) => this.flags()[f.flag]?.default_enabled).length);

  readonly visible = computed(() => {
    const q = this.search().trim().toLowerCase();
    const t = this.tab();
    return this.features.filter((f) => {
      if (f.tab !== t) return false;
      if (!q) return true;
      return f.name.toLowerCase().includes(q) || f.flag.toLowerCase().includes(q) || f.why.toLowerCase().includes(q);
    });
  });

  countFor(tabId: string): number {
    return this.features.filter((f) => f.tab === tabId).length;
  }

  flagState(key: string): FlagDef | undefined {
    return this.flags()[key];
  }

  async ngOnInit(): Promise<void> {
    this.route.queryParamMap.subscribe((q) => {
      const t = q.get('tab');
      if (t && this.tabs.some((x) => x.id === t)) this.tab.set(t);
    });
    try {
      const res = await firstValueFrom(this.http.get<{ flags: FlagDef[] }>('/api/feature-flags'));
      const map: Record<string, FlagDef> = {};
      for (const f of res.flags ?? []) map[f.key] = f;
      this.flags.set(map);
    } catch {
      // graceful — cards still render with state "loading…"
    }
  }

  setTab(id: string): void {
    this.tab.set(id);
    this.router.navigate([], { relativeTo: this.route, queryParams: { tab: id }, queryParamsHandling: 'merge' });
  }

  async tryIt(feature: Feature, endpointIdx: number): Promise<void> {
    const ep = feature.endpoints[endpointIdx];
    const key = `${feature.flag}:${endpointIdx}`;
    this.loading.update((m) => ({ ...m, [key]: true }));
    try {
      const url = ep.path;
      const opts = ep.method === 'POST' && ep.sample_body !== undefined ? { body: ep.sample_body as Record<string, unknown> } : {};
      let response: { status: number; body: unknown };
      try {
        if (ep.method === 'GET') {
          const body = await firstValueFrom(this.http.get(url, { observe: 'response' }));
          response = { status: body.status, body: body.body };
        } else {
          const body = await firstValueFrom(this.http.post(url, (opts as { body?: unknown }).body ?? {}, { observe: 'response' }));
          response = { status: body.status, body: body.body };
        }
      } catch (e) {
        const err = e as { status?: number; error?: unknown };
        response = { status: err.status ?? 0, body: err.error ?? { error: 'network_error' } };
      }
      this.result.update((m) => ({ ...m, [key]: response }));
    } finally {
      this.loading.update((m) => ({ ...m, [key]: false }));
    }
  }

  copy(text: string): void {
    navigator.clipboard?.writeText(text).catch(() => {});
  }
}
