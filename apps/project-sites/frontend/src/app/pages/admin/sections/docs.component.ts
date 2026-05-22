import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../services/api.service';
import { AuthService } from '../../../services/auth.service';
import { ToastService } from '../../../services/toast.service';

/**
 * One operation in the OpenAPI document. Flattened from `paths[path][method]`
 * so the UI can sort + filter + group with a single `Array.prototype.filter`.
 */
interface Operation {
  /** Upper-case HTTP method (`GET`, `POST`, ...). */
  readonly method: string;
  /** OpenAPI-style path with `{param}` segments. */
  readonly path: string;
  /** Short summary — the right-pane title and the row label. */
  readonly summary: string;
  /** First tag — used to group endpoints in the left rail. */
  readonly tag: string;
  /** Stable operation id (e.g. `get_api_auth_me`) used as the React-key. */
  readonly operationId: string;
  /** `true` when the path declares `security: [{ bearerAuth: [] }]`. */
  readonly authRequired: boolean;
  /** Path parameters extracted from the spec. */
  readonly parameters: ReadonlyArray<{ name: string; in: string; description?: string }>;
  /** Optional request-body JSON schema. */
  readonly requestBody?: unknown;
  /** Optional example response body. */
  readonly responseExample?: unknown;
}

/** Top-level OpenAPI spec shape we actually consume. */
interface OpenApiSpec {
  readonly openapi: string;
  readonly info: { title: string; version: string; description?: string };
  readonly tags?: Array<{ name: string; description?: string }>;
  readonly paths: Record<string, Record<string, RawOp>>;
}

interface RawOp {
  summary?: string;
  tags?: string[];
  operationId?: string;
  security?: unknown[];
  parameters?: Array<{ name: string; in: string; description?: string }>;
  requestBody?: { content?: { 'application/json'?: { schema?: unknown } } };
  responses?: Record<string, { content?: { 'application/json'?: { example?: unknown } } }>;
}

/** Captured live response after the user clicks Send. */
interface LiveResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly elapsedMs: number;
}

const SESSION_KEY = 'ps_docs_selected';

/**
 * Admin → Docs → interactive API explorer.
 *
 * Three panes:
 *
 *   - **Left rail** — collapsible groups by tag, search box filters by
 *     `path|summary|method`.
 *   - **Right pane** — Overview tab (markdown) OR a selected endpoint's
 *     docs (summary, params, schemas, examples) PLUS a Try-It panel that
 *     issues live calls with the user's session token.
 *   - **Live response tabset** — pretty-printed JSON body, raw headers, and a
 *     copyable cURL snippet.
 *
 * The component never bundles `swagger-ui-dist` or a markdown library — both
 * are hand-rolled to keep the lazy chunk small (< 50 KB gzip target).
 *
 * @example
 * ```ts
 * // wire-up lives in app.routes.ts:
 * { path: 'docs', loadComponent: () =>
 *   import('./pages/admin/sections/docs.component').then((m) => m.AdminDocsComponent) }
 * ```
 */
@Component({
  selector: 'app-admin-docs',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="docs-root p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4">
      <header class="docs-header">
        <div class="docs-title-wrap">
          <h2 class="docs-title">
            <span class="docs-title-glyph" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
            </span>
            <span class="docs-title-text">API Docs</span>
            @if (spec(); as s) {
              <span class="docs-version-chip" title="OpenAPI version">v{{ s.info.version }}</span>
            }
          </h2>
          <p class="docs-subtitle">
            Interactive explorer. Every call uses your signed-in session — try any endpoint, inspect the live JSON, copy a cURL.
          </p>
        </div>
        <div class="docs-tabs" role="tablist" aria-label="Docs sections">
          <button
            role="tab"
            class="docs-tab"
            [class.is-active]="tab() === 'overview'"
            [attr.aria-selected]="tab() === 'overview'"
            (click)="setTab('overview')"
            title="App overview + route tree"
          >Overview</button>
          <button
            role="tab"
            class="docs-tab"
            [class.is-active]="tab() === 'endpoints'"
            [attr.aria-selected]="tab() === 'endpoints'"
            (click)="setTab('endpoints')"
            title="Live API explorer"
          >Endpoints</button>
          <button class="btn-ghost docs-refresh" (click)="reload()" [disabled]="loading()" title="Re-fetch spec">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            {{ loading() ? '…' : 'Refresh' }}
          </button>
        </div>
      </header>

      <div class="docs-divider" aria-hidden="true"></div>

      @if (loading() && !spec()) {
        <div class="card docs-loading">
          <span class="glow-skel" style="width:140px;height:14px;">loading</span>
          <span class="glow-skel" style="width:90px;height:14px;">loading</span>
          <span class="glow-skel" style="width:200px;height:14px;">loading</span>
        </div>
      }

      @if (error()) {
        <div class="card docs-error">
          <strong class="text-amber-300">Could not load the docs.</strong>
          <span>{{ error() }}</span>
        </div>
      }

      @if (tab() === 'overview' && overviewHtml()) {
        <article class="card prose-docs" [innerHTML]="overviewHtml()"></article>
      }

      @if (tab() === 'endpoints' && spec()) {
        <div class="docs-explorer">
          <!-- ─── Left rail ─── -->
          <aside class="docs-rail card" aria-label="Endpoint list">
            <div class="docs-search">
              <svg class="docs-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                class="input-field docs-search-input"
                placeholder="Filter by path, method or tag…"
                [ngModel]="search()"
                (ngModelChange)="search.set($event)"
                aria-label="Filter endpoints"
                data-testid="docs-search"
              />
              <kbd class="docs-kbd-hint" aria-hidden="true">⌘K</kbd>
            </div>
            <div class="docs-rail-meta">
              <span>{{ filteredOperations().length }} endpoint{{ filteredOperations().length === 1 ? '' : 's' }}</span>
              <span class="docs-rail-meta-dot" aria-hidden="true">·</span>
              <span>{{ groupedOperations().length }} group{{ groupedOperations().length === 1 ? '' : 's' }}</span>
            </div>
            <nav class="docs-groups" aria-label="Endpoint groups">
              @for (group of groupedOperations(); track group.tag) {
                <details class="docs-group" [open]="group.open">
                  <summary class="docs-group-head">
                    <svg class="docs-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                    <span class="docs-group-name">{{ group.tag }}</span>
                    <span class="docs-group-count">{{ group.items.length }}</span>
                  </summary>
                  <div class="docs-group-items">
                    @for (op of group.items; track op.operationId) {
                      <button
                        class="endpoint-row"
                        [class.is-active]="selectedId() === op.operationId"
                        [attr.aria-current]="selectedId() === op.operationId ? 'page' : null"
                        data-testid="endpoint-row"
                        (click)="select(op)"
                        [title]="op.method + ' ' + op.path"
                      >
                        <span class="method method-{{ op.method.toLowerCase() }}">{{ op.method }}</span>
                        <span class="path">{{ op.path }}</span>
                      </button>
                    }
                  </div>
                </details>
              }
              @if (groupedOperations().length === 0) {
                <div class="docs-rail-empty">No endpoints match “{{ search() }}”.</div>
              }
            </nav>
          </aside>

          <!-- ─── Right pane ─── -->
          <section class="docs-detail card" aria-label="Endpoint detail">
            @if (selected(); as op) {
              <header class="docs-op-head">
                <div class="docs-op-head-row">
                  <span class="method method-{{ op.method.toLowerCase() }} method-lg">{{ op.method }}</span>
                  <code class="docs-op-path">{{ op.path }}</code>
                  @if (op.authRequired) {
                    <span class="docs-auth-chip" title="Requires Bearer token">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                      </svg>
                      auth
                    </span>
                  }
                </div>
                <h3 class="docs-op-summary">{{ op.summary }}</h3>
                <p class="docs-op-tag">in <em>{{ op.tag }}</em> · operationId <code>{{ op.operationId }}</code></p>
              </header>

              <div class="docs-section-divider" aria-hidden="true"></div>

              @if (op.parameters.length > 0) {
                <section class="docs-section">
                  <div class="muted-h">Path parameters</div>
                  <div class="docs-params">
                    @for (p of op.parameters; track p.name) {
                      <div class="docs-param-row">
                        <div class="docs-param-meta">
                          <code class="docs-param-name">{{ p.name }}</code>
                          <span class="docs-param-in">{{ p.in }}</span>
                          @if (p.description) {
                            <span class="docs-param-desc">{{ p.description }}</span>
                          }
                        </div>
                        <input
                          class="input-field docs-param-input"
                          [ngModel]="paramValue(p.name)"
                          (ngModelChange)="setParam(p.name, $event)"
                          [placeholder]="'value for {' + p.name + '}'"
                          [attr.aria-label]="'Value for ' + p.name"
                        />
                      </div>
                    }
                  </div>
                </section>
              }

              @if (op.requestBody) {
                <section class="docs-section">
                  <div class="muted-h docs-section-h">Request body
                    <span class="docs-mono-tag">application/json</span>
                  </div>
                  <div class="docs-json-editor">
                    <pre class="docs-json-gutter" aria-hidden="true">{{ gutterFor(requestBodyJson()) }}</pre>
                    <textarea
                      class="docs-json-area"
                      rows="10"
                      [ngModel]="requestBodyJson()"
                      (ngModelChange)="requestBodyJson.set($event)"
                      (keydown.enter)="onBodyKeydown($event)"
                      spellcheck="false"
                      aria-label="Request body JSON"
                    ></textarea>
                  </div>
                  <div class="docs-body-actions">
                    <button class="btn-ghost docs-mini-btn" (click)="validateBody()" title="Run JSON.parse against the editor body">Validate JSON</button>
                    @if (bodyValidation(); as v) {
                      <span class="docs-validation" [class.is-ok]="v.ok" [class.is-bad]="!v.ok">{{ v.message }}</span>
                    }
                  </div>
                </section>
              }

              <section class="docs-section">
                <div class="muted-h">Request headers</div>
                <pre class="docs-headers-block"><span class="docs-h-key">Authorization</span>: Bearer <span class="docs-h-tok">{{ maskedToken() }}</span>
<span class="docs-h-key">Content-Type</span>: application/json</pre>
              </section>

              <div class="docs-send-row">
                <button
                  class="btn-primary docs-send"
                  data-testid="endpoint-try-send"
                  (click)="send()"
                  [disabled]="sending()"
                  title="Send request (⌘+Enter)"
                >
                  @if (sending()) {
                    <span class="docs-send-spin" aria-hidden="true"></span>
                    Sending…
                  } @else {
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                    Send
                    <kbd class="docs-kbd-inline" aria-hidden="true">⌘↵</kbd>
                  }
                </button>
                <button class="btn-ghost docs-mini-btn" (click)="copyCurl()" title="Copy the equivalent cURL command">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  Copy cURL
                </button>
                @if (copyToast()) {
                  <span class="docs-copy-toast">Copied ✓</span>
                }
              </div>

              @if (response(); as r) {
                <div class="docs-section-divider" aria-hidden="true"></div>
                <section class="docs-response" aria-label="Response">
                  <div class="docs-response-bar">
                    <span class="docs-status-pill"
                          [class.is-ok]="r.status > 0 && r.status < 400"
                          [class.is-warn]="r.status >= 400 && r.status < 500"
                          [class.is-bad]="r.status >= 500 || r.status === 0">
                      {{ r.status || 'ERR' }} {{ r.statusText }}
                    </span>
                    <span class="docs-latency"><b>{{ r.elapsedMs }}</b> ms</span>
                    <div class="docs-segmented" role="tablist" aria-label="Response view">
                      <button class="docs-seg" [class.is-active]="responseTab() === 'body'" (click)="responseTab.set('body')" role="tab" [attr.aria-selected]="responseTab() === 'body'">Body</button>
                      <button class="docs-seg" [class.is-active]="responseTab() === 'headers'" (click)="responseTab.set('headers')" role="tab" [attr.aria-selected]="responseTab() === 'headers'">Headers</button>
                      <button class="docs-seg" [class.is-active]="responseTab() === 'curl'" (click)="responseTab.set('curl')" role="tab" [attr.aria-selected]="responseTab() === 'curl'">cURL</button>
                    </div>
                    <button class="btn-ghost docs-mini-btn docs-resp-copy" (click)="copyResponse()" title="Copy current view">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                    </button>
                  </div>
                  @if (responseTab() === 'body') {
                    <pre class="docs-code-block" data-testid="response-body"><code [innerHTML]="prettyBodyHtml()"></code></pre>
                  }
                  @if (responseTab() === 'headers') {
                    <pre class="docs-code-block docs-code-muted">{{ headerLines(r) }}</pre>
                  }
                  @if (responseTab() === 'curl') {
                    <pre class="docs-code-block">{{ curlSnippet() }}</pre>
                  }
                </section>
              }
            } @else {
              <div class="docs-empty">
                <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
                </svg>
                <h3>Pick an endpoint</h3>
                <p>Choose any method on the left to view its docs, fill in params, and fire a live request against your session.</p>
              </div>
            }
          </section>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: contents; }

    /* ── Rhythm + base ─────────────────────────────────────────────────── */
    .docs-root {
      --rhythm: 8px;
      --r1: var(--rhythm);              /* 8  */
      --r2: calc(var(--rhythm) * 2);    /* 16 */
      --r3: calc(var(--rhythm) * 3);    /* 24 */
      --r4: calc(var(--rhythm) * 4);    /* 32 */
      --r5: calc(var(--rhythm) * 5);    /* 40 */
      --docs-primary: #00E5FF;
      --docs-violet: #c084fc;
      --docs-amber: #fbbf24;
      --docs-red: #f87171;
      --docs-lime: #a3e635;
      --docs-green: #4ade80;
      --docs-line: rgba(255,255,255,0.06);
      --docs-line-hi: rgba(0,229,255,0.22);
      --docs-bg-soft: rgba(255,255,255,0.02);
      --docs-fg: #e2e8f0;
      --docs-fg-mute: #94a3b8;
      font-feature-settings: "tnum","cv11","ss01";
      display: flex;
      flex-direction: column;
      gap: var(--r3);
    }

    /* ── Header ────────────────────────────────────────────────────────── */
    .docs-header {
      display: flex; align-items: flex-end; justify-content: space-between;
      gap: var(--r3); flex-wrap: wrap;
    }
    .docs-title-wrap { display: flex; flex-direction: column; gap: 6px; max-width: 60ch; }
    .docs-title {
      display: inline-flex; align-items: center; gap: 10px;
      margin: 0; color: #fff; font-size: 1.35rem; line-height: 1.15;
      font-weight: 800; letter-spacing: -0.01em;
    }
    .docs-title-glyph {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px; border-radius: 8px;
      background: linear-gradient(135deg, rgba(0,229,255,0.18), rgba(124,58,237,0.18));
      border: 1px solid rgba(0,229,255,0.32); color: var(--docs-primary);
      box-shadow: 0 0 18px -6px rgba(0,229,255,0.45);
    }
    .docs-title-text {
      background: linear-gradient(90deg, #fff, #00E5FF 65%, #7C3AED);
      -webkit-background-clip: text; background-clip: text; color: transparent;
      text-wrap: balance;
    }
    .docs-version-chip {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.62rem; font-weight: 700; letter-spacing: 0.04em;
      padding: 3px 7px; border-radius: 999px;
      background: rgba(0,229,255,0.08); color: var(--docs-primary);
      border: 1px solid rgba(0,229,255,0.25);
    }
    .docs-subtitle {
      margin: 0; color: var(--docs-fg-mute); font-size: 0.82rem; line-height: 1.55;
      max-width: 60ch; text-wrap: pretty;
    }
    .docs-tabs { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .docs-tab {
      position: relative;
      padding: 0.5rem 0.95rem; border-radius: 8px;
      background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.72);
      border: 1px solid var(--docs-line); cursor: pointer;
      font-size: 0.76rem; font-weight: 600; letter-spacing: 0.01em;
      transition: background 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease;
    }
    .docs-tab:hover { background: rgba(0,229,255,0.06); border-color: var(--docs-line-hi); color: #fff; }
    .docs-tab.is-active {
      background: linear-gradient(135deg, rgba(0,229,255,0.16), rgba(124,58,237,0.16));
      color: #fff; border-color: rgba(0,229,255,0.45);
      box-shadow: 0 0 0 1px rgba(0,229,255,0.12) inset, 0 6px 18px -10px rgba(0,229,255,0.55);
    }
    .docs-refresh { padding: 0.5rem 0.9rem; font-size: 0.74rem; }

    /* ── Divider ───────────────────────────────────────────────────────── */
    .docs-divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(0,229,255,0.18), transparent);
      margin: 0;
    }
    .docs-section-divider {
      height: 1px; margin: var(--r1) 0 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.10), transparent);
    }

    /* ── Status surfaces ───────────────────────────────────────────────── */
    .docs-loading {
      display: flex; gap: 10px; padding: 1.5rem !important;
      align-items: center; justify-content: center;
    }
    .docs-error {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      background: rgba(245,158,11,0.06) !important;
      border-color: rgba(245,158,11,0.30) !important;
      font-size: 0.8rem;
    }

    /* ── Explorer grid ─────────────────────────────────────────────────── */
    .docs-explorer {
      display: grid; gap: var(--r3);
      grid-template-columns: 260px minmax(0, 1fr);
      container-type: inline-size;
    }
    @media (max-width: 1024px) {
      .docs-explorer { grid-template-columns: 1fr; }
      .docs-rail { position: sticky; top: 0; z-index: 5; max-height: 42vh !important; }
    }

    /* ── Left rail ─────────────────────────────────────────────────────── */
    .docs-rail {
      padding: var(--r2) !important;
      display: flex; flex-direction: column; gap: var(--r1);
      max-height: 78vh; overflow-y: auto;
      scrollbar-width: thin; scrollbar-color: rgba(0,229,255,0.18) transparent;
    }
    .docs-rail::-webkit-scrollbar { width: 6px; }
    .docs-rail::-webkit-scrollbar-thumb { background: rgba(0,229,255,0.18); border-radius: 3px; }
    .docs-search { position: relative; }
    .docs-search-icon {
      position: absolute; left: 9px; top: 50%; transform: translateY(-50%);
      color: var(--docs-fg-mute); pointer-events: none;
    }
    .docs-search-input { width: 100%; padding-left: 28px !important; padding-right: 44px !important; font-size: 0.78rem; }
    .docs-kbd-hint {
      position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
      font-family: ui-monospace, monospace; font-size: 0.6rem;
      color: var(--docs-fg-mute); background: rgba(255,255,255,0.04);
      border: 1px solid var(--docs-line); border-radius: 4px;
      padding: 2px 5px; pointer-events: none;
    }
    .docs-rail-meta {
      display: flex; align-items: center; gap: 6px;
      font-size: 0.62rem; color: var(--docs-fg-mute);
      text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700;
      padding: 2px 4px;
    }
    .docs-rail-meta-dot { color: rgba(255,255,255,0.18); }
    .docs-groups { display: flex; flex-direction: column; gap: 4px; }

    .docs-group { border-radius: 8px; }
    .docs-group-head {
      position: sticky; top: -1px; z-index: 1;
      display: flex; align-items: center; gap: 8px;
      padding: 8px 8px;
      background: linear-gradient(180deg, rgba(6,6,16,0.92), rgba(6,6,16,0.78));
      backdrop-filter: blur(6px);
      cursor: pointer; user-select: none;
      font-size: 0.7rem; color: #fff; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      border-radius: 6px;
      transition: color 160ms ease, background 160ms ease;
    }
    .docs-group-head::-webkit-details-marker { display: none; }
    .docs-group-head:hover { color: var(--docs-primary); background: linear-gradient(180deg, rgba(6,6,16,0.96), rgba(0,229,255,0.05)); }
    .docs-chevron { color: var(--docs-fg-mute); transition: transform 200ms cubic-bezier(0.16,1,0.3,1); flex-shrink: 0; }
    .docs-group[open] > .docs-group-head .docs-chevron { transform: rotate(90deg); color: var(--docs-primary); }
    .docs-group-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .docs-group-count {
      font-family: ui-monospace, monospace; font-size: 0.6rem; font-weight: 700;
      color: var(--docs-fg-mute); background: rgba(255,255,255,0.05);
      border: 1px solid var(--docs-line); border-radius: 999px;
      padding: 1px 7px; min-width: 22px; text-align: center;
    }
    .docs-group-items {
      display: flex; flex-direction: column; gap: 1px;
      padding: 4px 0 6px 6px;
    }
    @starting-style {
      .docs-group[open] > .docs-group-items { opacity: 0; transform: translateY(-2px); }
    }
    .docs-group[open] > .docs-group-items {
      animation: docsGroupIn 220ms cubic-bezier(0.16,1,0.3,1) both;
    }
    @keyframes docsGroupIn {
      from { opacity: 0; transform: translateY(-2px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ── Endpoint rows ─────────────────────────────────────────────────── */
    .endpoint-row {
      position: relative;
      display: flex; align-items: center; gap: 0.55rem;
      padding: 0.42rem 0.55rem 0.42rem 0.7rem;
      border-radius: 6px; border: none;
      background: transparent; color: #cbd5e1; cursor: pointer;
      font-size: 0.74rem; text-align: left; width: 100%;
      transition: background 140ms ease, color 140ms ease, transform 140ms ease;
    }
    .endpoint-row::before {
      content: ''; position: absolute; left: 0; top: 6px; bottom: 6px;
      width: 3px; border-radius: 2px;
      background: transparent; transition: background 180ms ease;
    }
    .endpoint-row:hover { background: rgba(0,229,255,0.06); color: #fff; }
    .endpoint-row:hover::before { background: rgba(0,229,255,0.35); }
    .endpoint-row.is-active {
      background: linear-gradient(90deg, rgba(0,229,255,0.14), rgba(0,229,255,0.04));
      color: #fff;
    }
    .endpoint-row.is-active::before { background: var(--docs-primary); box-shadow: 0 0 8px rgba(0,229,255,0.6); }
    .endpoint-row:focus-visible {
      outline: 2px solid var(--docs-primary); outline-offset: 2px;
    }
    .endpoint-row .path {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.72rem;
      flex: 1; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    /* ── Method pills ──────────────────────────────────────────────────── */
    .method {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 700; font-size: 0.6rem; letter-spacing: 0.06em;
      padding: 3px 7px; border-radius: 5px;
      min-width: 48px; text-align: center; flex-shrink: 0;
      border: 1px solid transparent;
      font-feature-settings: "tnum","cv11";
    }
    .method-lg {
      font-size: 0.74rem; padding: 5px 11px; min-width: 64px;
      letter-spacing: 0.08em; border-radius: 6px;
    }
    .method-get    { background: rgba(0,229,255,0.10);  color: var(--docs-primary);  border-color: rgba(0,229,255,0.32); }
    .method-post   { background: rgba(168,85,247,0.12); color: var(--docs-violet);   border-color: rgba(168,85,247,0.32); }
    .method-put    { background: rgba(245,158,11,0.10); color: var(--docs-amber);    border-color: rgba(245,158,11,0.32); }
    .method-patch  { background: rgba(163,230,53,0.10); color: var(--docs-lime);     border-color: rgba(163,230,53,0.32); }
    .method-delete { background: rgba(239,68,68,0.10);  color: var(--docs-red);      border-color: rgba(239,68,68,0.32); }

    .docs-rail-empty {
      padding: var(--r3) var(--r2); text-align: center;
      color: var(--docs-fg-mute); font-size: 0.78rem; font-style: italic;
    }

    /* ── Right pane (detail) ───────────────────────────────────────────── */
    .docs-detail {
      padding: var(--r3) !important;
      display: flex; flex-direction: column; gap: var(--r3);
      max-height: 78vh; overflow-y: auto;
      scrollbar-width: thin; scrollbar-color: rgba(0,229,255,0.18) transparent;
    }
    .docs-detail::-webkit-scrollbar { width: 6px; }
    .docs-detail::-webkit-scrollbar-thumb { background: rgba(0,229,255,0.18); border-radius: 3px; }

    .docs-op-head { display: flex; flex-direction: column; gap: var(--r1); }
    .docs-op-head-row { display: flex; align-items: center; gap: var(--r1); flex-wrap: wrap; }
    .docs-op-path {
      flex: 1; min-width: 0; word-break: break-all;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.96rem; color: #fff; font-weight: 500;
      letter-spacing: -0.005em;
    }
    .docs-op-summary {
      margin: 0; font-size: 1.05rem; color: #fff; font-weight: 700;
      letter-spacing: -0.005em; line-height: 1.35; text-wrap: balance;
    }
    .docs-op-tag {
      margin: 0; font-size: 0.74rem; color: var(--docs-fg-mute);
      font-style: italic;
    }
    .docs-op-tag em { color: rgba(255,255,255,0.78); font-style: normal; font-weight: 500; }
    .docs-op-tag code {
      font-family: ui-monospace, monospace; font-size: 0.7rem;
      color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.04);
      padding: 1px 6px; border-radius: 4px; font-style: normal;
    }
    .docs-auth-chip {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 0.65rem; font-weight: 700; letter-spacing: 0.04em;
      padding: 4px 8px; border-radius: 999px;
      background: rgba(124,58,237,0.10); color: var(--docs-violet);
      border: 1px solid rgba(124,58,237,0.28);
      text-transform: uppercase;
    }

    /* ── Detail sections ───────────────────────────────────────────────── */
    .docs-section { display: flex; flex-direction: column; gap: 10px; }
    .docs-section-h {
      display: inline-flex; align-items: center; gap: 8px;
    }
    .docs-mono-tag {
      font-family: ui-monospace, monospace; font-size: 0.6rem; font-weight: 600;
      text-transform: lowercase; letter-spacing: 0;
      color: var(--docs-fg-mute); background: rgba(255,255,255,0.04);
      border: 1px solid var(--docs-line); border-radius: 4px;
      padding: 1px 6px;
    }

    /* params */
    .docs-params { display: flex; flex-direction: column; gap: 8px; }
    .docs-param-row {
      display: grid; grid-template-columns: minmax(180px, 240px) 1fr; gap: 12px;
      align-items: center;
      padding: 8px 10px; border-radius: 8px;
      background: var(--docs-bg-soft); border: 1px solid var(--docs-line);
      transition: border-color 160ms ease, background 160ms ease;
    }
    .docs-param-row:hover { border-color: var(--docs-line-hi); }
    .docs-param-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .docs-param-name {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 0.78rem; color: #fff; font-weight: 600;
    }
    .docs-param-in {
      font-size: 0.6rem; color: var(--docs-fg-mute);
      text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700;
    }
    .docs-param-desc { font-size: 0.7rem; color: rgba(255,255,255,0.55); font-style: italic; }
    .docs-param-input { font-size: 0.78rem; font-family: ui-monospace, monospace; }
    @media (max-width: 640px) {
      .docs-param-row { grid-template-columns: 1fr; }
    }

    /* JSON editor */
    .docs-json-editor {
      display: grid; grid-template-columns: 36px 1fr;
      background: var(--docs-bg-soft);
      border: 1px solid var(--docs-line); border-radius: 8px;
      overflow: hidden; transition: border-color 160ms ease;
    }
    .docs-json-editor:focus-within { border-color: rgba(0,229,255,0.45); box-shadow: 0 0 0 3px rgba(0,229,255,0.10); }
    .docs-json-gutter {
      margin: 0; padding: 10px 6px 10px 8px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 0.72rem; line-height: 1.55;
      color: rgba(255,255,255,0.25); text-align: right;
      background: rgba(255,255,255,0.02);
      border-right: 1px solid var(--docs-line);
      user-select: none; white-space: pre;
      tab-size: 2;
    }
    .docs-json-area {
      width: 100%; border: 0; outline: 0; resize: vertical;
      padding: 10px 12px; background: transparent;
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 0.74rem; line-height: 1.55; color: #fff;
      tab-size: 2; min-height: 160px;
    }
    .docs-body-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .docs-validation { font-size: 0.72rem; font-family: ui-monospace, monospace; }
    .docs-validation.is-ok { color: var(--docs-green); }
    .docs-validation.is-bad { color: var(--docs-amber); }

    /* Headers */
    .docs-headers-block {
      margin: 0; padding: 12px 14px;
      background: var(--docs-bg-soft); border: 1px solid var(--docs-line);
      border-radius: 8px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 0.72rem; line-height: 1.7; color: rgba(255,255,255,0.72);
      white-space: pre-wrap; word-break: break-all;
    }
    .docs-h-key { color: var(--docs-amber); }
    .docs-h-tok { color: var(--docs-green); }

    /* Send row */
    .docs-send-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .docs-send {
      padding: 0.65rem 1.2rem !important; font-size: 0.82rem !important;
      gap: 8px !important;
    }
    .docs-kbd-inline {
      font-family: ui-monospace, monospace; font-size: 0.62rem;
      padding: 2px 6px; border-radius: 4px;
      background: rgba(0,0,0,0.32); color: rgba(255,255,255,0.85);
      border: 1px solid rgba(255,255,255,0.18);
      margin-left: 4px;
    }
    .docs-mini-btn { padding: 0.45rem 0.85rem !important; font-size: 0.72rem !important; }
    .docs-copy-toast {
      color: var(--docs-green); font-size: 0.72rem; font-weight: 600;
      animation: docsToast 220ms cubic-bezier(0.16,1,0.3,1);
    }
    @keyframes docsToast { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
    .docs-send-spin {
      width: 12px; height: 12px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.25);
      border-top-color: var(--docs-primary);
      animation: docsSpin 700ms linear infinite;
      display: inline-block;
    }
    @keyframes docsSpin { to { transform: rotate(360deg); } }

    /* ── Response ──────────────────────────────────────────────────────── */
    .docs-response { display: flex; flex-direction: column; gap: 10px; }
    .docs-response-bar {
      position: sticky; top: 0; z-index: 2;
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 8px 4px;
      background: linear-gradient(180deg, rgba(6,6,16,0.92), rgba(6,6,16,0.65));
      backdrop-filter: blur(6px);
    }
    .docs-status-pill {
      font-family: ui-monospace, monospace; font-weight: 700; font-size: 0.72rem;
      padding: 4px 10px; border-radius: 999px;
      border: 1px solid transparent; letter-spacing: 0.02em;
    }
    .docs-status-pill.is-ok   { background: rgba(74,222,128,0.10); color: var(--docs-green); border-color: rgba(74,222,128,0.32); }
    .docs-status-pill.is-warn { background: rgba(245,158,11,0.10); color: var(--docs-amber); border-color: rgba(245,158,11,0.32); }
    .docs-status-pill.is-bad  { background: rgba(239,68,68,0.10);  color: var(--docs-red);   border-color: rgba(239,68,68,0.32); }
    .docs-latency {
      font-family: ui-monospace, monospace; font-size: 0.72rem;
      color: var(--docs-fg-mute);
    }
    .docs-latency b { color: #fff; font-weight: 600; }
    .docs-segmented {
      display: inline-flex; align-items: center; gap: 0;
      padding: 3px; border-radius: 8px;
      background: rgba(255,255,255,0.04); border: 1px solid var(--docs-line);
      margin-left: auto;
    }
    .docs-seg {
      padding: 4px 10px; border-radius: 6px; border: 0;
      background: transparent; color: rgba(255,255,255,0.65);
      font-size: 0.7rem; font-weight: 600; cursor: pointer;
      transition: background 160ms ease, color 160ms ease;
    }
    .docs-seg:hover { color: #fff; }
    .docs-seg.is-active {
      background: linear-gradient(135deg, rgba(0,229,255,0.18), rgba(124,58,237,0.18));
      color: #fff; box-shadow: 0 0 0 1px rgba(0,229,255,0.28) inset;
    }
    .docs-resp-copy { padding: 0.35rem 0.55rem !important; }
    .docs-code-block {
      margin: 0; padding: 14px 16px;
      background: rgba(255,255,255,0.025);
      border: 1px solid var(--docs-line); border-radius: 10px;
      overflow: auto; max-height: 360px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.74rem; line-height: 1.6; color: #fff;
      white-space: pre-wrap; word-break: break-word;
      tab-size: 2;
    }
    .docs-code-muted { color: var(--docs-fg-mute); }

    /* JSON syntax highlight tokens */
    .tk-key  { color: var(--docs-amber); }
    .tk-str  { color: var(--docs-green); }
    .tk-num  { color: var(--docs-primary); }
    .tk-bool { color: var(--docs-violet); }
    .tk-null { color: rgba(255,255,255,0.45); font-style: italic; }
    .tk-pun  { color: rgba(255,255,255,0.45); }

    /* ── Empty ─────────────────────────────────────────────────────────── */
    .docs-empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; padding: var(--r5) var(--r3); text-align: center;
      color: var(--docs-fg-mute);
    }
    .docs-empty svg { color: rgba(0,229,255,0.55); }
    .docs-empty h3 { margin: 0; color: #fff; font-size: 1rem; font-weight: 700; }
    .docs-empty p { margin: 0; max-width: 38ch; font-size: 0.8rem; line-height: 1.55; text-wrap: pretty; }

    /* ── Markdown / Overview prose ─────────────────────────────────────── */
    .prose-docs { padding: var(--r3) !important; }
    .prose-docs :first-child { margin-top: 0; }
    .prose-docs h1 {
      font-size: clamp(1.8rem, 2.4vw + 1rem, 3rem);
      font-weight: 800; letter-spacing: -0.02em; line-height: 1.1;
      color: #fff; margin: 0 0 var(--r2);
      background: linear-gradient(90deg, #fff, #00E5FF 60%, #7C3AED);
      -webkit-background-clip: text; background-clip: text; color: transparent;
      text-wrap: balance;
    }
    .prose-docs h2 {
      font-size: 1.35rem; font-weight: 700; color: #fff;
      margin: var(--r4) 0 var(--r2); padding-bottom: 8px;
      border-bottom: 1px solid;
      border-image: linear-gradient(90deg, rgba(0,229,255,0.45), transparent) 1;
      letter-spacing: -0.01em; line-height: 1.25;
    }
    .prose-docs h3 {
      position: relative; padding-left: 18px;
      font-size: 1.02rem; font-weight: 600; color: #fff;
      margin: var(--r3) 0 var(--r1); letter-spacing: -0.005em;
    }
    .prose-docs h3::before {
      content: '#'; position: absolute; left: 0; top: 0;
      font-family: ui-monospace, monospace; color: var(--docs-primary);
      font-weight: 700; opacity: 0.7;
    }
    .prose-docs p {
      color: #cbd5e1; font-size: 0.9rem; line-height: 1.7;
      margin: 0 0 var(--r2); text-wrap: pretty; max-width: 72ch;
    }
    .prose-docs ul {
      list-style: none; padding-left: 0; margin: 0 0 var(--r2);
      display: flex; flex-direction: column; gap: 4px;
    }
    .prose-docs li {
      position: relative; padding-left: 20px;
      color: #cbd5e1; font-size: 0.88rem; line-height: 1.6;
    }
    .prose-docs li::before {
      content: ''; position: absolute; left: 4px; top: 0.7em;
      width: 6px; height: 6px; border-radius: 999px;
      background: var(--docs-primary); box-shadow: 0 0 6px rgba(0,229,255,0.6);
    }
    .prose-docs code {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 0.82rem;
      background: rgba(0,229,255,0.08); color: #fff;
      padding: 2px 7px; border-radius: 4px;
      border: 1px solid rgba(0,229,255,0.18);
    }
    .prose-docs pre {
      position: relative;
      font-family: ui-monospace, monospace; font-size: 0.78rem; line-height: 1.6;
      background: rgba(255,255,255,0.025);
      border: 1px solid var(--docs-line); border-radius: 10px;
      padding: var(--r2); overflow: auto;
      margin: var(--r2) 0;
    }
    .prose-docs pre code {
      background: transparent; border: 0; padding: 0;
      font-size: inherit; color: #fff;
    }
    .prose-docs a {
      color: var(--docs-primary); text-decoration: none;
      border-bottom: 1px dashed rgba(0,229,255,0.4);
      transition: border-color 160ms ease, color 160ms ease;
    }
    .prose-docs a:hover { border-bottom-color: var(--docs-primary); color: #fff; }
    .prose-docs strong { color: #fff; font-weight: 700; }
    .prose-docs em { color: rgba(255,255,255,0.85); font-style: italic; }

    /* ── Shared muted heading ──────────────────────────────────────────── */
    .muted-h {
      font-size: 0.62rem; color: var(--docs-fg-mute);
      text-transform: uppercase; letter-spacing: 0.08em;
      font-weight: 700;
    }

    /* ── Focus + motion safety ─────────────────────────────────────────── */
    .docs-tab:focus-visible,
    .docs-seg:focus-visible,
    .docs-mini-btn:focus-visible,
    .endpoint-row:focus-visible,
    .docs-group-head:focus-visible {
      outline: 2px solid var(--docs-primary);
      outline-offset: 2px;
      border-radius: 6px;
    }
    @media (prefers-reduced-motion: reduce) {
      .docs-tab, .docs-seg, .endpoint-row, .docs-chevron,
      .docs-group-head, .docs-copy-toast, .docs-send-spin {
        transition: none !important; animation: none !important;
      }
    }
  `],
})
export class AdminDocsComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  readonly tab = signal<'overview' | 'endpoints'>('endpoints');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly spec = signal<OpenApiSpec | null>(null);
  readonly overviewHtml = signal<string>('');
  readonly search = signal<string>('');
  readonly selectedId = signal<string | null>(null);

  readonly paramValues = signal<Record<string, string>>({});
  readonly requestBodyJson = signal<string>('');
  readonly bodyValidation = signal<{ ok: boolean; message: string } | null>(null);

  readonly sending = signal(false);
  readonly response = signal<LiveResponse | null>(null);
  readonly responseTab = signal<'body' | 'headers' | 'curl'>('body');
  readonly copyToast = signal(false);

  /** Flattened operation list — derived from the OpenAPI doc. */
  readonly operations = computed<Operation[]>(() => {
    const s = this.spec();
    if (!s) return [];
    const out: Operation[] = [];
    for (const [path, methods] of Object.entries(s.paths)) {
      for (const [method, opRaw] of Object.entries(methods)) {
        if (typeof opRaw !== 'object' || opRaw === null) continue;
        const op = opRaw as RawOp;
        const tags = op.tags ?? ['other'];
        const respExample = op.responses?.['200']?.content?.['application/json']?.example;
        out.push({
          method: method.toUpperCase(),
          path,
          summary: op.summary ?? `${method.toUpperCase()} ${path}`,
          tag: tags[0] ?? 'other',
          operationId: op.operationId ?? `${method}_${path}`,
          authRequired: Array.isArray(op.security) && op.security.length > 0,
          parameters: op.parameters ?? [],
          requestBody: op.requestBody?.content?.['application/json']?.schema,
          responseExample: respExample,
        });
      }
    }
    return out.sort((a, b) => (a.tag === b.tag ? a.path.localeCompare(b.path) : a.tag.localeCompare(b.tag)));
  });

  readonly filteredOperations = computed<Operation[]>(() => {
    const q = this.search().trim().toLowerCase();
    const all = this.operations();
    if (!q) return all;
    return all.filter(
      (op) =>
        op.path.toLowerCase().includes(q) ||
        op.summary.toLowerCase().includes(q) ||
        op.method.toLowerCase().includes(q) ||
        op.tag.toLowerCase().includes(q),
    );
  });

  readonly groupedOperations = computed(() => {
    const groups = new Map<string, Operation[]>();
    for (const op of this.filteredOperations()) {
      const arr = groups.get(op.tag);
      if (arr) arr.push(op);
      else groups.set(op.tag, [op]);
    }
    return Array.from(groups.entries())
      .map(([tag, items]) => ({ tag, items, open: true }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  });

  readonly selected = computed<Operation | null>(() => {
    const id = this.selectedId();
    if (!id) return null;
    return this.operations().find((o) => o.operationId === id) ?? null;
  });

  readonly maskedToken = computed<string>(() => {
    const t = this.auth.getToken();
    if (!t) return '<not signed in>';
    if (t.length <= 10) return '****';
    return `${t.slice(0, 4)}…${t.slice(-4)}`;
  });

  readonly prettyBody = computed<string>(() => {
    const r = this.response();
    if (!r) return '';
    try {
      return JSON.stringify(JSON.parse(r.body), null, 2);
    } catch {
      return r.body;
    }
  });

  /** Syntax-highlighted JSON body for the response Body tab. */
  readonly prettyBodyHtml = computed<string>(() => {
    const text = this.prettyBody();
    if (!text) return '';
    return highlightJson(text);
  });

  readonly curlSnippet = computed<string>(() => {
    const op = this.selected();
    if (!op) return '';
    const url = this.resolvedUrl();
    const token = this.auth.getToken() ?? '<TOKEN>';
    const parts = [
      `curl -X ${op.method} '${url}'`,
      `  -H 'Authorization: Bearer ${token}'`,
      `  -H 'Content-Type: application/json'`,
    ];
    if (op.requestBody && this.requestBodyJson()) {
      const escaped = this.requestBodyJson().replace(/'/g, `'\\''`);
      parts.push(`  -d '${escaped}'`);
    }
    return parts.join(' \\\n');
  });

  ngOnInit(): void {
    this.reload();
    // Restore last selection
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) this.selectedId.set(saved);
    } catch {
      // Storage disabled — ignore.
    }
  }

  setTab(tab: 'overview' | 'endpoints'): void {
    this.tab.set(tab);
  }

  paramValue(name: string): string {
    return this.paramValues()[name] ?? '';
  }

  setParam(name: string, value: string): void {
    this.paramValues.set({ ...this.paramValues(), [name]: value });
  }

  /** Build a line-number gutter for the JSON body textarea. */
  gutterFor(text: string): string {
    const lines = (text || ' ').split('\n').length;
    const out: string[] = [];
    for (let i = 1; i <= lines; i++) out.push(String(i));
    return out.join('\n');
  }

  /** ⌘+Enter inside the body editor fires Send. */
  onBodyKeydown(ev: Event): void {
    const e = ev as KeyboardEvent;
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void this.send();
    }
  }

  /**
   * Fetch the live OpenAPI spec + the markdown app overview in parallel.
   */
  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.get<OpenApiSpec>('/admin/docs/openapi.json').subscribe({
      next: (s) => {
        this.spec.set(s);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(err instanceof Error ? err.message : 'Failed to load OpenAPI spec');
        this.loading.set(false);
      },
    });
    this.api.get<{ data: { markdown: string } }>('/admin/docs/app-overview').subscribe({
      next: (r) => this.overviewHtml.set(renderMarkdown(r.data.markdown)),
      error: () => {
        /* overview optional */
      },
    });
  }

  select(op: Operation): void {
    this.selectedId.set(op.operationId);
    this.paramValues.set({});
    this.requestBodyJson.set(op.requestBody ? JSON.stringify(buildExampleFromSchema(op.requestBody), null, 2) : '');
    this.bodyValidation.set(null);
    this.response.set(null);
    try {
      sessionStorage.setItem(SESSION_KEY, op.operationId);
    } catch {
      // ignore
    }
  }

  validateBody(): void {
    const text = this.requestBodyJson().trim();
    if (!text) {
      this.bodyValidation.set({ ok: true, message: 'Body is empty (will not be sent)' });
      return;
    }
    try {
      JSON.parse(text);
      this.bodyValidation.set({ ok: true, message: 'Looks like valid JSON.' });
    } catch (err) {
      this.bodyValidation.set({ ok: false, message: err instanceof Error ? err.message : 'Invalid JSON' });
    }
  }

  resolvedUrl(): string {
    const op = this.selected();
    if (!op) return '';
    let path = op.path;
    const params = this.paramValues();
    for (const [k, v] of Object.entries(params)) {
      if (!v) continue;
      path = path.replace(`{${k}}`, encodeURIComponent(v));
    }
    return `${typeof location !== 'undefined' ? location.origin : ''}${path}`;
  }

  headerLines(r: LiveResponse): string {
    return Object.entries(r.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
  }

  /**
   * Issue the live HTTP request against the user's session and capture
   * status, headers, body, and elapsed time.
   */
  async send(): Promise<void> {
    const op = this.selected();
    if (!op) return;
    // Don't allow GET while path params are unfilled
    for (const p of op.parameters) {
      if (!this.paramValues()[p.name]) {
        this.toast.error(`Fill in path parameter "${p.name}" before sending.`);
        return;
      }
    }
    this.sending.set(true);
    this.response.set(null);
    const url = this.resolvedUrl();
    const token = this.auth.getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const init: RequestInit = { method: op.method, headers };
    if (op.method !== 'GET' && op.method !== 'DELETE' && this.requestBodyJson().trim()) {
      init.body = this.requestBodyJson();
    }
    const started = performance.now();
    try {
      const res = await fetch(url, init);
      const body = await res.text();
      const respHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => (respHeaders[k] = v));
      this.response.set({
        status: res.status,
        statusText: res.statusText,
        headers: respHeaders,
        body,
        elapsedMs: Math.round(performance.now() - started),
      });
      this.responseTab.set('body');
    } catch (err) {
      this.response.set({
        status: 0,
        statusText: 'Network error',
        headers: {},
        body: err instanceof Error ? err.message : String(err),
        elapsedMs: Math.round(performance.now() - started),
      });
    } finally {
      this.sending.set(false);
    }
  }

  copyCurl(): void {
    const snippet = this.curlSnippet();
    if (!snippet) return;
    this.writeClipboard(snippet);
  }

  /** Copy whichever response view is currently visible. */
  copyResponse(): void {
    const r = this.response();
    if (!r) return;
    const tab = this.responseTab();
    const text = tab === 'body' ? this.prettyBody() : tab === 'headers' ? this.headerLines(r) : this.curlSnippet();
    if (text) this.writeClipboard(text);
  }

  private writeClipboard(text: string): void {
    try {
      navigator.clipboard.writeText(text).catch(() => undefined);
      this.copyToast.set(true);
      setTimeout(() => this.copyToast.set(false), 1500);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Build a minimal example object from a JSON schema. Recursive — handles
 * `object|array|string|number|boolean` and respects `example` when set.
 *
 * @example
 * ```ts
 * buildExampleFromSchema({ type: 'object', properties: { id: { type: 'string' } } });
 * // → { id: '' }
 * ```
 */
function buildExampleFromSchema(schema: unknown): unknown {
  if (typeof schema !== 'object' || schema === null) return null;
  const s = schema as { type?: string; properties?: Record<string, unknown>; items?: unknown; example?: unknown };
  if (s.example !== undefined) return s.example;
  if (s.type === 'object' && s.properties) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties)) {
      out[k] = buildExampleFromSchema(v);
    }
    return out;
  }
  if (s.type === 'array') return [buildExampleFromSchema(s.items ?? {})];
  if (s.type === 'string') return '';
  if (s.type === 'number') return 0;
  if (s.type === 'boolean') return false;
  return null;
}

/**
 * Hand-rolled JSON tokenizer → HTML. Tokens: keys (amber), strings (green),
 * numbers (cyan), booleans (violet), null (grey), punctuation (faint white).
 *
 * Operates on the already-pretty-printed output of `JSON.stringify(_, null, 2)`,
 * so input is trusted-formatted but still HTML-escaped defensively.
 *
 * @example
 * ```ts
 * highlightJson('{"id":1,"name":"x","ok":true,"x":null}')
 * // → '<span class="tk-pun">{</span><span class="tk-key">"id"</span>…'
 * ```
 */
function highlightJson(src: string): string {
  const escape = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // String literal followed by `:` => key; otherwise => string value.
  return escape(src).replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g,
    (_match, str?: string, colon?: string, bool?: string, num?: string, pun?: string) => {
      if (str) {
        return colon
          ? `<span class="tk-key">${str}</span><span class="tk-pun">${colon}</span>`
          : `<span class="tk-str">${str}</span>`;
      }
      if (bool) return bool === 'null' ? `<span class="tk-null">${bool}</span>` : `<span class="tk-bool">${bool}</span>`;
      if (num) return `<span class="tk-num">${num}</span>`;
      if (pun) return `<span class="tk-pun">${pun}</span>`;
      return _match as string;
    },
  );
}

/**
 * Minimal markdown → HTML renderer. Supports headings (#–###), fenced code
 * blocks, inline code, unordered lists, links, bold/italic, and paragraphs.
 *
 * Kept tiny (~40 lines) so the lazy chunk stays below the 50 KB gzip budget
 * imposed on \`/admin/docs\`.
 *
 * @example
 * ```ts
 * renderMarkdown('# Hi\n\n- one\n- two'); // → '<h1>Hi</h1>\n<ul>…</ul>'
 * ```
 */
function renderMarkdown(md: string): string {
  const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Strip code fences first and stash them so paragraph splitting doesn't break.
  const fences: string[] = [];
  let src = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    const id = fences.length;
    fences.push(`<pre><code>${escapeHtml(code as string)}</code></pre>`);
    return ` FENCE${id} `;
  });

  const blocks = src.split(/\n{2,}/).map((blk) => blk.trim()).filter(Boolean);

  const html = blocks.map((blk) => {
    if (/^ FENCE\d+ $/.test(blk)) {
      const idx = Number(blk.match(/\d+/)?.[0] ?? '0');
      return fences[idx] ?? '';
    }
    if (blk.startsWith('### ')) return `<h3>${inline(blk.slice(4))}</h3>`;
    if (blk.startsWith('## ')) return `<h2>${inline(blk.slice(3))}</h2>`;
    if (blk.startsWith('# ')) return `<h1>${inline(blk.slice(2))}</h1>`;
    if (/^[-*]\s/.test(blk)) {
      const items = blk
        .split('\n')
        .map((ln) => ln.replace(/^[-*]\s+/, '').trim())
        .filter(Boolean)
        .map((it) => `<li>${inline(it)}</li>`)
        .join('');
      return `<ul>${items}</ul>`;
    }
    return `<p>${inline(blk)}</p>`;
  }).join('\n');

  return html;

  function inline(text: string): string {
    // Order matters: code first (don't touch its contents).
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) =>
        `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  }
}
