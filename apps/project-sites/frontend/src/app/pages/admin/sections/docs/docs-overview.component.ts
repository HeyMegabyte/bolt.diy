import { Component, computed, inject, type OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ToastService } from '../../../../services/toast.service';
import { renderMarkdown } from '../docs.component';

/**
 * Authoritative admin-API overview markdown. Hand-written so it ships at
 * SPA-deploy speed (R2 push) rather than worker-deploy speed.
 *
 * Rendered through `renderMarkdown` (re-exported from the shell component)
 * so it inherits the prose-docs styles + inline copy buttons on every
 * fenced block.
 */
const OVERVIEW_MARKDOWN = String.raw`# Project Sites API

The Project Sites API is the programmatic surface behind every site you build on projectsites.dev. Use it to read or update site config, manage custom hostnames, query analytics, list snapshots, route form submissions, and call your custom AI endpoints from the outside.

This document explains the conventions every endpoint follows. Browse the left rail for per-endpoint details and use the **Send** button to fire live requests against your own session — every call is auto-signed with your bearer token.

## Authentication

Every authenticated endpoint accepts a bearer token:

` + '```http' + `
Authorization: Bearer ps_sk_live_…
` + '```' + `

Tokens come from one of two places:

- **Browser sessions** — issued by the magic-link or Google OAuth flow and stored in ` + '`localStorage`' + `. The Docs explorer below uses this automatically.
- **Programmatic API keys** — generate dedicated, scoped keys at [/admin/user#api-keys](/admin/user#api-keys). Use these for CLIs, CI jobs, and server-to-server integrations. They never expire on their own; rotate them by revoking + reissuing.

Magic-link tokens work for programmatic clients too, but they expire when the browser session ends. Use a dedicated API key for anything that should outlive a tab.

## Base URL

` + '```' + `
https://projectsites.dev/api
` + '```' + `

The public per-site **form submit** endpoint lives outside ` + '`/api`' + ` and is reachable without authentication (Turnstile-protected):

` + '```' + `
https://projectsites.dev/v1/forms/submit
` + '```' + `

## Rate Limits

The API is rate-limited to **60 requests per minute per token**. Overage returns:

` + '```http' + `
HTTP/1.1 429 Too Many Requests
Retry-After: 18
Content-Type: application/json

{ "error": { "code": "RATE_LIMITED", "message": "Slow down.", "request_id": "uuid" } }
` + '```' + `

Honor the ` + '`Retry-After`' + ` value — it is seconds (integer), not a date. Bursts above 10 req/sec get queued; sustained bursts get throttled.

## Response Shape

Every successful response is a JSON object with a ` + '`data`' + ` key and an optional ` + '`meta`' + ` block:

` + '```json' + `
{
  "data": { "id": "uuid", "name": "Vito\'s Mens Salon" },
  "meta": { "request_id": "req_01HW…", "duration_ms": 42 }
}
` + '```' + `

Every error is a JSON object with an ` + '`error`' + ` key. The shape never changes regardless of which endpoint failed:

` + '```json' + `
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Site not found",
    "request_id": "req_01HW…"
  }
}
` + '```' + `

Every response — success or error — carries an ` + '`X-Request-ID`' + ` header. Quote it when filing support tickets.

## Pagination

Collection endpoints accept ` + '`?limit`' + ` and ` + '`?offset`' + ` query parameters:

` + '```http' + `
GET /api/audit-logs?limit=50&offset=100
` + '```' + `

Defaults are ` + '`limit=50`' + ` and ` + '`offset=0`' + `. The hard maximum is ` + '`limit=200`' + ` — larger values are clamped silently. Responses include the total count under ` + '`meta.total`' + ` so you can drive a numeric paginator without a second request.

## Versioning

The current major version is **v1**. Routes prefixed ` + '`/api/`' + ` follow the stable contract; additive changes (new optional fields, new endpoints, new ` + '`meta`' + ` keys) ship without a version bump. Removals or rename-style breaks ship behind ` + '`/api/v2/`' + ` and run side-by-side for at least 12 months before the v1 deprecation date.

The public form endpoint lives at ` + '`/v1/forms/submit`' + ` for the same reason — its contract is explicitly versioned because thousands of customer sites POST to it.

## Conventions

- **IDs** — all entity IDs are UUID v4 strings (` + '`"id": "01HW8K…"`' + `). Slugs are kebab-case ASCII.
- **Timestamps** — ISO-8601 UTC strings (` + '`"2026-05-23T17:42:00.123Z"`' + `). Never epoch seconds.
- **Event names** — dot-namespaced (` + '`site.deploy`' + `, ` + '`hostname.add`' + `, ` + '`form.submit`' + `).
- **Idempotency** — ` + '`POST`' + ` and ` + '`DELETE`' + ` accept an ` + '`Idempotency-Key`' + ` header (any UUID). The same key replays the original response for 24 hours.
- **Content-Type** — every mutation expects ` + '`application/json`' + ` unless the endpoint says otherwise (e.g. file uploads use ` + '`multipart/form-data`' + `).

## SDKs

No official SDKs yet. The contract is small enough that ` + '`fetch`' + ` works fine from anywhere:

` + '```bash' + `
curl -sS https://projectsites.dev/api/sites \
  -H "Authorization: Bearer $PS_TOKEN" | jq '.data[].slug'
` + '```' + `

` + '```ts' + `
const res = await fetch('https://projectsites.dev/api/sites', {
  headers: { Authorization: ` + '`Bearer ${process.env.PS_TOKEN}`' + ` },
});
const { data } = await res.json();
` + '```' + `

Open an issue if you would like a generated TypeScript / Python / Go client — the OpenAPI spec at [/api/admin/docs/openapi.json](/api/admin/docs/openapi.json) is the source of truth.
`;

/**
 * Default child route — renders the API overview markdown when the user
 * visits `/admin/docs` with no endpoint selected.
 *
 * @remarks
 * Lazy-loaded as a separate chunk so the shell stays slim. The overview
 * itself never fetches anything from the worker — the markdown is bundled.
 *
 * @example
 * ```ts
 * { path: '', component: DocsOverviewComponent }
 * ```
 */
@Component({
  selector: 'app-docs-overview',
  standalone: true,
  template: `
    <section class="docs-detail card" aria-label="API overview" data-testid="docs-overview-root">
      <div class="prose-docs-wrap">
        <article class="card prose-docs" (click)="onMarkdownClick($event)" [innerHTML]="overviewHtml()"></article>
      </div>
    </section>
  `,
  styles: [`
    :host { display: contents; }

    /* ── Detail surface — same shape as the endpoint card so layouts match ── */
    .docs-detail {
      padding: 24px !important;
      display: flex; flex-direction: column; gap: 0;
      max-height: 78vh; overflow-y: auto;
      scrollbar-width: thin; scrollbar-color: rgba(0,229,255,0.18) transparent;
      border: 1px solid rgba(255,255,255,0.06) !important;
      box-shadow: var(--ps-shadow-md, 0 6px 18px -8px rgba(0, 0, 0, 0.42));
    }
    .docs-detail::-webkit-scrollbar { width: 6px; }
    .docs-detail::-webkit-scrollbar-thumb { background: rgba(0,229,255,0.18); border-radius: 3px; }

    /* ── Markdown / Overview prose — 720px column for readable reading ───── */
    .prose-docs-wrap { max-width: 720px; margin: 0 auto; width: 100%; }
    .prose-docs { padding: 24px !important; }
    .prose-docs :first-child { margin-top: 0; }
    .prose-docs h1 {
      font-size: clamp(1.8rem, 2.4vw + 1rem, 3rem);
      font-weight: 800; letter-spacing: -0.02em; line-height: 1.1;
      color: #fff; margin: 0 0 16px;
      background: linear-gradient(90deg, #fff, #00E5FF 60%, #7C3AED);
      -webkit-background-clip: text; background-clip: text; color: transparent;
      text-wrap: balance;
    }
    .prose-docs h2 {
      font-family: 'Sora', ui-sans-serif, system-ui, sans-serif;
      font-size: 1.5rem; font-weight: 600; color: #fff;
      margin: 32px 0 16px; padding-bottom: 10px;
      border-bottom: 1px solid;
      border-image: linear-gradient(90deg, rgba(0,229,255,0.45), transparent) 1;
      letter-spacing: -0.02em; line-height: 1.2;
    }
    .prose-docs h3 {
      position: relative; padding-left: 18px;
      font-family: 'Sora', ui-sans-serif, system-ui, sans-serif;
      font-size: 1.08rem; font-weight: 600; color: #fff;
      margin: 24px 0 8px;
      letter-spacing: -0.02em; line-height: 1.3;
    }
    .prose-docs h3::before {
      content: '#'; position: absolute; left: 0; top: 0;
      font-family: ui-monospace, monospace; color: #00E5FF;
      font-weight: 700; opacity: 0.7;
    }
    .prose-docs p {
      color: #cbd5e1; font-size: 0.9rem; line-height: 1.7;
      margin: 0 0 16px; text-wrap: pretty; max-width: 72ch;
    }
    .prose-docs ul {
      list-style: none; padding-left: 0; margin: 0 0 16px;
      display: flex; flex-direction: column; gap: 4px;
    }
    .prose-docs li {
      position: relative; padding-left: 20px;
      color: #cbd5e1; font-size: 0.88rem; line-height: 1.6;
    }
    .prose-docs li::before {
      content: ''; position: absolute; left: 4px; top: 0.7em;
      width: 6px; height: 6px; border-radius: 999px;
      background: #00E5FF; box-shadow: 0 0 6px rgba(0,229,255,0.6);
    }
    .prose-docs code {
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
      font-size: 0.82rem;
      background: rgba(0,229,255,0.08); color: #fff;
      padding: 2px 7px; border-radius: 4px;
      border: 1px solid rgba(0,229,255,0.18);
    }
    .prose-docs pre {
      position: relative;
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-feature-settings: "calt", "liga";
      font-size: 0.78rem; line-height: 1.6;
      background: rgba(255,255,255,0.025);
      border: 1px solid rgba(255,255,255,0.06); border-radius: 10px;
      padding: 16px; overflow: auto;
      margin: 16px 0;
    }
    .prose-docs pre code {
      background: transparent; border: 0; padding: 0;
      font-size: inherit; color: #fff;
    }
    .prose-docs pre .copy-code-btn {
      position: absolute; top: 8px; right: 8px;
      padding: 4px 9px; border-radius: 6px;
      background: rgba(0,229,255,0.10); color: #00E5FF;
      border: 1px solid rgba(0,229,255,0.30);
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 0.62rem; font-weight: 600; letter-spacing: 0.02em;
      cursor: pointer; opacity: 0; transform: translateY(-2px);
      transition: opacity 140ms ease, transform 140ms ease, background 140ms ease;
    }
    .prose-docs pre:hover .copy-code-btn,
    .prose-docs pre:focus-within .copy-code-btn { opacity: 1; transform: translateY(0); }
    .prose-docs pre .copy-code-btn:hover { background: rgba(0,229,255,0.18); color: #fff; }
    .prose-docs pre .copy-code-btn.is-copied { background: rgba(74,222,128,0.18); color: #4ade80; border-color: rgba(74,222,128,0.32); opacity: 1; }
    .prose-docs a {
      color: #00E5FF; text-decoration: none;
      border-bottom: 1px dashed rgba(0,229,255,0.4);
      transition: border-color 160ms ease, color 160ms ease;
    }
    .prose-docs a:hover { border-bottom-color: #00E5FF; color: #fff; }
    .prose-docs strong { color: #fff; font-weight: 700; }
    .prose-docs em { color: rgba(255,255,255,0.85); font-style: italic; }
  `],
})
export class DocsOverviewComponent implements OnInit {
  private title = inject(Title);
  private meta = inject(Meta);
  private toast = inject(ToastService);

  readonly overviewHtml = computed<string>(() => renderMarkdown(OVERVIEW_MARKDOWN));

  ngOnInit(): void {
    this.title.setTitle('API Docs — Project Sites');
    this.meta.updateTag({
      name: 'description',
      content: 'Project Sites API overview — auth, base URL, rate limits, response shape, pagination, versioning, conventions, SDKs.',
    });
  }

  /**
   * Delegated click handler for copy buttons inside the rendered overview
   * markdown. Catches clicks on `.copy-code-btn` inside any `<pre>` block,
   * copies the sibling `<code>` text, and flips the button into a
   * "Copied ✓" state for 1.2s.
   */
  onMarkdownClick(ev: Event): void {
    const t = ev.target as HTMLElement | null;
    if (!t) return;
    const btn = t.closest('button.copy-code-btn') as HTMLButtonElement | null;
    if (!btn) return;
    const pre = btn.closest('pre');
    const code = pre?.querySelector('code');
    const text = code?.textContent ?? '';
    if (!text) return;
    try {
      void navigator.clipboard.writeText(text);
      const original = btn.textContent ?? 'Copy';
      btn.textContent = 'Copied ✓';
      btn.classList.add('is-copied');
      this.toast.success('Copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('is-copied');
      }, 1200);
    } catch {
      this.toast.error('Clipboard unavailable');
    }
  }
}
