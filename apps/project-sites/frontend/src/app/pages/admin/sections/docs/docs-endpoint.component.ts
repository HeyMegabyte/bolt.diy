import { Component, HostListener, computed, effect, inject, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { AuthService } from '../../../../services/auth.service';
import { ToastService } from '../../../../services/toast.service';
import { HlmInputDirective } from '../../../../ui';
import {
  DocsSpecService,
  ENDPOINT_META,
  ERROR_CODE_BLURBS,
  type EndpointMeta,
  type Operation,
  buildExampleFromSchema,
  highlightJson,
} from '../docs.component';

/** Captured live response after the user clicks Send. */
interface LiveResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly elapsedMs: number;
}

/**
 * Per-endpoint child route — renders the detail card for the operation
 * resolved from the `:endpointId` route param.
 *
 * Reads the spec via the shared {@link DocsSpecService} (provided by the
 * parent shell), so a deep-link load (`/admin/docs/get_api_auth_me`) and a
 * left-rail click both end up showing the same card with no double fetch.
 *
 * @remarks
 * Lazy-loaded as its own chunk via `loadComponent` in `app.routes.ts` so the
 * heavy Try-It UI never costs the overview reader anything.
 *
 * @example
 * ```ts
 * { path: ':endpointId', loadComponent: () =>
 *     import('./sections/docs/docs-endpoint.component').then((m) => m.DocsEndpointComponent) }
 * ```
 */
@Component({
  selector: 'app-docs-endpoint',
  standalone: true,
  imports: [FormsModule, RouterLink, HlmInputDirective],
  template: `
    <section class="docs-detail card" aria-label="Endpoint detail">
      <div class="prose-docs-wrap">
        @if (selected(); as op) {
          <div [attr.data-testid]="'docs-endpoint-root'" [attr.data-endpoint-id]="op.operationId"></div>

          <header class="docs-op-head" id="docs-toc-overview">
            <div class="docs-op-head-row">
              <span class="method method-{{ op.method.toLowerCase() }} method-lg">{{ op.method }}</span>
              <code class="docs-op-path">{{ op.path }}</code>
              <button
                type="button"
                class="docs-path-copy"
                (click)="copyPath(op.path)"
                title="Copy path"
                aria-label="Copy path to clipboard"
                [attr.data-testid]="'docs-endpoint-' + op.operationId + '-copy-path'"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </button>
              @if (op.authRequired) {
                <span class="docs-auth-chip" title="Requires Bearer token">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  auth
                </span>
              } @else {
                <span class="docs-public-chip" title="No authentication required">public</span>
              }
              @if (op.rateLimit) {
                <span class="docs-rl-chip" [title]="'Rate-limited: ' + op.rateLimit.requests + ' req / ' + op.rateLimit.windowSeconds + 's'">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  {{ op.rateLimit.requests }}/{{ op.rateLimit.windowSeconds }}s
                </span>
              }
            </div>
            <h3 class="docs-op-summary">{{ op.summary }}</h3>
            <p class="docs-op-tag">
              in <em>{{ op.category }}</em>
              · operationId <code>{{ op.operationId }}</code>
              @if (op.addedAt) {
                · added <time [attr.datetime]="op.addedAt">{{ op.addedAt }}</time>
              }
            </p>
            <div class="docs-op-quick-actions">
              <a
                class="docs-quick-link"
                [routerLink]="['/admin/audit']"
                [queryParams]="{ path: op.path, method: op.method }"
                title="Open the audit log filtered to recent calls of this endpoint"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                See recent calls in audit log
              </a>
            </div>
          </header>

          <div class="docs-section-divider" aria-hidden="true"></div>

          @if (selectedDescription(); as desc) {
            <section class="docs-section" id="docs-toc-description">
              <div class="muted-h">Description</div>
              <p class="docs-op-desc">{{ desc }}</p>
            </section>
          }

          @if (op.parameters.length > 0) {
            <section class="docs-section" id="docs-toc-params">
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
                      hlmInput
                      class="font-mono text-xs"
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
            <section class="docs-section" id="docs-toc-body">
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

          <section class="docs-section" id="docs-toc-headers">
            <div class="muted-h">Request headers</div>
            <pre class="docs-headers-block"><span class="docs-h-key">Authorization</span>: Bearer <span class="docs-h-tok">{{ maskedToken() }}</span>
<span class="docs-h-key">Content-Type</span>: application/json@for (h of extraHeaders(); track h.name) {
<span class="docs-h-key">{{ h.name }}</span>: <span class="docs-h-tok">{{ h.value }}</span>@if (h.note) { <span class="docs-h-note">  // {{ h.note }}</span>}}</pre>
          </section>

          @if (responseShape(); as shape) {
            <section class="docs-section" id="docs-toc-response">
              <div class="muted-h docs-section-h">Response shape
                <span class="docs-mono-tag">success</span>
              </div>
              <pre class="docs-code-block docs-response-shape">{{ shape }}</pre>
            </section>
          }

          @if (errorCodes().length > 0) {
            <section class="docs-section" id="docs-toc-errors">
              <div class="muted-h">Error codes</div>
              <div class="docs-error-codes">
                @for (code of errorCodes(); track code) {
                  <span class="docs-error-pill" [title]="errorCodeBlurb(code)">{{ code }}</span>
                }
              </div>
            </section>
          }

          <section class="docs-section" id="docs-toc-examples">
            <div class="muted-h docs-section-h">Examples
              <div class="docs-segmented docs-examples-seg" role="tablist" aria-label="Example flavour">
                <button class="docs-seg" [class.is-active]="exampleTab() === 'curl'" (click)="exampleTab.set('curl')" role="tab" [attr.aria-selected]="exampleTab() === 'curl'">cURL</button>
                <button class="docs-seg" [class.is-active]="exampleTab() === 'fetch'" (click)="exampleTab.set('fetch')" role="tab" [attr.aria-selected]="exampleTab() === 'fetch'">JS fetch</button>
                <button class="docs-seg" [class.is-active]="exampleTab() === 'workers'" (click)="exampleTab.set('workers')" role="tab" [attr.aria-selected]="exampleTab() === 'workers'">Workers</button>
              </div>
            </div>
            <pre class="docs-code-block" data-testid="docs-example-block"><code>{{ exampleSnippet() }}</code></pre>
            <div class="docs-body-actions">
              <button class="btn-ghost docs-mini-btn" (click)="copyExample()" title="Copy current example">Copy example</button>
            </div>
          </section>

          <div class="docs-send-row" id="docs-toc-try">
            <button
              class="docs-action-btn is-primary"
              [attr.data-testid]="'docs-endpoint-' + op.operationId + '-send'"
              (click)="send()"
              [disabled]="sending()"
              title="Send request (⌘+Enter)"
            >
              @if (sending()) {
                <span class="docs-send-spin" aria-hidden="true"></span>
                <span class="docs-btn-label">Sending…</span>
              } @else {
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
                <span class="docs-btn-label">Send</span>
                <kbd class="docs-kbd-inline" aria-hidden="true">⌘↵</kbd>
              }
            </button>
            <button
              class="docs-action-btn is-secondary"
              [attr.data-testid]="'docs-endpoint-' + op.operationId + '-copy-curl'"
              (click)="copyCurl()"
              title="Copy the equivalent cURL command"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <span class="docs-btn-label">Copy cURL</span>
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
        } @else if (specService.spec()) {
          <!-- Spec loaded but the :endpointId param does not match any operation. -->
          <div class="docs-404" data-testid="docs-404">
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <h3>Endpoint not found</h3>
            <p>“{{ endpointId() }}” doesn’t match any operation in the current OpenAPI spec.</p>
            <a class="docs-action-btn is-secondary" routerLink="/admin/docs">Back to overview</a>
          </div>
        } @else {
          <!-- Spec still loading — show a small skeleton instead of a flicker. -->
          <div class="docs-empty">
            <span class="glow-skel" style="width:240px;height:14px;">loading</span>
          </div>
        }
      </div>

      <!-- ─── TOC right rail — collapses < 1024px ─── -->
      @if (selected(); as op) {
        <aside class="docs-toc" aria-label="On this page">
          <div class="docs-toc-h">On this page</div>
          <nav class="docs-toc-nav">
            <a class="docs-toc-link" (click)="scrollTo('docs-toc-overview', $event)" href="#docs-toc-overview">Overview</a>
            @if (selectedDescription()) {
              <a class="docs-toc-link" (click)="scrollTo('docs-toc-description', $event)" href="#docs-toc-description">Description</a>
            }
            @if (op.parameters.length > 0) {
              <a class="docs-toc-link" (click)="scrollTo('docs-toc-params', $event)" href="#docs-toc-params">Path parameters</a>
            }
            @if (op.requestBody) {
              <a class="docs-toc-link" (click)="scrollTo('docs-toc-body', $event)" href="#docs-toc-body">Request body</a>
            }
            <a class="docs-toc-link" (click)="scrollTo('docs-toc-headers', $event)" href="#docs-toc-headers">Request headers</a>
            @if (responseShape()) {
              <a class="docs-toc-link" (click)="scrollTo('docs-toc-response', $event)" href="#docs-toc-response">Response shape</a>
            }
            @if (errorCodes().length > 0) {
              <a class="docs-toc-link" (click)="scrollTo('docs-toc-errors', $event)" href="#docs-toc-errors">Error codes</a>
            }
            <a class="docs-toc-link" (click)="scrollTo('docs-toc-examples', $event)" href="#docs-toc-examples">Examples</a>
            <a class="docs-toc-link docs-toc-link--cta" (click)="scrollTo('docs-toc-try', $event)" href="#docs-toc-try">Try it</a>
          </nav>
        </aside>
      }
    </section>
  `,
  styles: [`
    :host { display: contents; }

    /* ── Detail surface ─────────────────────────────────────────────────── */
    .docs-detail {
      padding: 24px !important;
      display: grid; gap: 24px;
      grid-template-columns: minmax(0, 1fr);
      max-height: 78vh; overflow-y: auto;
      scrollbar-width: thin; scrollbar-color: rgba(0,229,255,0.18) transparent;
      border: 1px solid rgba(255,255,255,0.06) !important;
      box-shadow: var(--ps-shadow-md, 0 6px 18px -8px rgba(0, 0, 0, 0.42));
    }
    .docs-detail::-webkit-scrollbar { width: 6px; }
    .docs-detail::-webkit-scrollbar-thumb { background: rgba(0,229,255,0.18); border-radius: 3px; }

    @media (min-width: 1280px) {
      .docs-detail { grid-template-columns: minmax(0, 1fr) 220px; }
    }
    @media (max-width: 1024px) {
      .docs-toc { display: none !important; }
    }

    .prose-docs-wrap { max-width: 720px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 24px; }

    .docs-section-divider {
      height: 1px; margin: 8px 0 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.10), transparent);
    }

    .docs-op-head { display: flex; flex-direction: column; gap: 8px; }
    .docs-op-head-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .docs-op-path {
      flex: 1; min-width: 0; word-break: break-all;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.96rem; color: #fff; font-weight: 500;
      letter-spacing: -0.005em;
    }
    .docs-op-summary {
      margin: 0;
      font-family: 'Sora', ui-sans-serif, system-ui, sans-serif;
      font-size: 1.32rem; color: #fff; font-weight: 600;
      letter-spacing: -0.02em; line-height: 1.25; text-wrap: balance;
    }
    .docs-op-desc {
      margin: 0;
      color: rgba(255, 255, 255, 0.78);
      font-size: 0.88rem; line-height: 1.65;
      max-width: 64ch; text-wrap: pretty;
    }
    .docs-op-tag {
      margin: 0; font-size: 0.74rem; color: #94a3b8;
      font-style: italic;
    }
    .docs-op-tag em { color: rgba(255,255,255,0.78); font-style: normal; font-weight: 500; }
    .docs-op-tag code {
      font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.7rem;
      color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.04);
      padding: 1px 6px; border-radius: 4px; font-style: normal;
    }
    .docs-auth-chip {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 0.65rem; font-weight: 700; letter-spacing: 0.04em;
      padding: 4px 8px; border-radius: 999px;
      background: rgba(124,58,237,0.10); color: #c084fc;
      border: 1px solid rgba(124,58,237,0.28);
      text-transform: uppercase;
    }
    .docs-public-chip {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 0.65rem; font-weight: 700; letter-spacing: 0.04em;
      padding: 4px 8px; border-radius: 999px;
      background: rgba(74,222,128,0.10); color: #4ade80;
      border: 1px solid rgba(74,222,128,0.28);
      text-transform: uppercase;
    }
    .docs-rl-chip {
      display: inline-flex; align-items: center; gap: 4px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.62rem; font-weight: 700; letter-spacing: 0.02em;
      padding: 4px 8px; border-radius: 999px;
      background: rgba(245,158,11,0.10); color: #fbbf24;
      border: 1px solid rgba(245,158,11,0.28);
      cursor: help;
    }
    .docs-path-copy {
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border-radius: 6px;
      background: transparent; color: rgba(255,255,255,0.55);
      border: 1px solid rgba(255,255,255,0.06);
      cursor: pointer;
      transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
    }
    .docs-path-copy:hover {
      background: rgba(0,229,255,0.08);
      color: #fff;
      border-color: rgba(0,229,255,0.32);
    }
    .docs-path-copy:focus-visible {
      outline: 2px solid #00E5FF; outline-offset: 2px;
    }

    /* Quick-action link below the op header — opens audit log filtered. */
    .docs-op-quick-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
    .docs-quick-link {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 9px; border-radius: 6px;
      font-size: 0.72rem; font-weight: 600;
      color: rgba(255,255,255,0.62);
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      text-decoration: none;
      transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
    }
    .docs-quick-link:hover {
      background: rgba(0,229,255,0.08);
      color: #fff;
      border-color: rgba(0,229,255,0.32);
    }
    .docs-quick-link:focus-visible {
      outline: 2px solid #00E5FF; outline-offset: 2px;
    }

    /* Examples-tab strip — sits inside the section header so it aligns right. */
    .docs-examples-seg { margin-left: auto !important; }

    .docs-section { display: flex; flex-direction: column; gap: 10px; }
    .docs-section-h { display: inline-flex; align-items: center; gap: 8px; }
    .docs-mono-tag {
      font-family: ui-monospace, monospace; font-size: 0.6rem; font-weight: 600;
      text-transform: lowercase; letter-spacing: 0;
      color: #94a3b8; background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.06); border-radius: 4px;
      padding: 1px 6px;
    }

    /* params */
    .docs-params { display: flex; flex-direction: column; gap: 8px; }
    .docs-param-row {
      display: grid; grid-template-columns: minmax(180px, 240px) 1fr; gap: 12px;
      align-items: center;
      padding: 8px 10px; border-radius: 8px;
      background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
      transition: border-color 160ms ease, background 160ms ease;
    }
    .docs-param-row:hover { border-color: rgba(0,229,255,0.22); }
    .docs-param-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .docs-param-name {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 0.78rem; color: #fff; font-weight: 600;
    }
    .docs-param-in {
      font-size: 0.6rem; color: #94a3b8;
      text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700;
    }
    .docs-param-desc { font-size: 0.7rem; color: rgba(255,255,255,0.55); font-style: italic; }
    /* .docs-param-input removed — param input now hlmInput + font-mono text-xs (Spartan). */
    @media (max-width: 640px) {
      .docs-param-row { grid-template-columns: 1fr; }
    }

    /* JSON editor */
    .docs-json-editor {
      display: grid; grid-template-columns: 36px 1fr;
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.06); border-radius: 8px;
      overflow: hidden; transition: border-color 160ms ease;
    }
    .docs-json-editor:focus-within { border-color: rgba(0,229,255,0.45); box-shadow: 0 0 0 3px rgba(0,229,255,0.10); }
    .docs-json-gutter {
      margin: 0; padding: 10px 6px 10px 8px;
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
      font-size: 0.72rem; line-height: 1.55;
      color: rgba(255,255,255,0.25); text-align: right;
      background: rgba(255,255,255,0.02);
      border-right: 1px solid rgba(255,255,255,0.06);
      user-select: none; white-space: pre;
      tab-size: 2;
    }
    .docs-json-area {
      width: 100%; border: 0; outline: 0; resize: vertical;
      padding: 10px 12px; background: transparent;
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
      font-size: 0.74rem; line-height: 1.55; color: #fff;
      tab-size: 2; min-height: 160px;
    }
    .docs-body-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .docs-validation { font-size: 0.72rem; font-family: ui-monospace, monospace; }
    .docs-validation.is-ok { color: #4ade80; }
    .docs-validation.is-bad { color: #fbbf24; }

    .docs-headers-block {
      margin: 0; padding: 12px 14px;
      background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
      border-radius: 8px;
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
      font-size: 0.72rem; line-height: 1.7; color: rgba(255,255,255,0.72);
      white-space: pre-wrap; word-break: break-all;
    }
    .docs-h-key { color: #fbbf24; }
    .docs-h-tok { color: #4ade80; }
    .docs-h-note { color: rgba(255, 255, 255, 0.38); font-style: italic; }

    .docs-send-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .docs-action-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      min-height: 38px; padding: 0 1.05rem;
      border-radius: 8px; cursor: pointer;
      font-size: 0.82rem; font-weight: 600; letter-spacing: 0.005em;
      font-family: ui-sans-serif, system-ui, sans-serif;
      text-decoration: none;
      transition: background 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease;
    }
    .docs-action-btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .docs-action-btn:focus-visible { outline: 2px solid #00E5FF; outline-offset: 2px; }
    .docs-action-btn .docs-btn-label { white-space: nowrap; }
    .docs-action-btn.is-primary {
      color: #060610;
      background: linear-gradient(135deg, #00E5FF, #7C3AED);
      border: 1px solid rgba(0, 229, 255, 0.55);
      box-shadow: 0 8px 22px -10px rgba(0, 229, 255, 0.65);
    }
    .docs-action-btn.is-primary:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 12px 28px -10px rgba(0, 229, 255, 0.85);
    }
    .docs-action-btn.is-secondary {
      color: rgba(255, 255, 255, 0.72);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255,255,255,0.06);
    }
    .docs-action-btn.is-secondary:hover {
      color: #fff;
      background: rgba(0, 229, 255, 0.06);
      border-color: rgba(0,229,255,0.22);
    }
    .docs-kbd-inline {
      font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.62rem;
      padding: 2px 6px; border-radius: 4px;
      background: rgba(0,0,0,0.32); color: rgba(255,255,255,0.85);
      border: 1px solid rgba(255,255,255,0.18);
      margin-left: 4px;
    }
    .docs-mini-btn { padding: 0.45rem 0.85rem !important; font-size: 0.72rem !important; }
    .docs-resp-copy { padding: 0.35rem 0.55rem !important; }

    .docs-response-shape { max-height: none !important; font-size: 0.78rem; color: rgba(255,255,255,0.86); }
    .docs-error-codes { display: flex; flex-wrap: wrap; gap: 6px; }
    .docs-error-pill {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.7rem; font-weight: 600; letter-spacing: 0.02em;
      padding: 4px 9px; border-radius: 999px;
      background: rgba(239, 68, 68, 0.08); color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.28);
      cursor: help;
    }

    /* TOC right rail */
    .docs-toc {
      position: sticky; top: 8px; align-self: flex-start;
      display: flex; flex-direction: column; gap: 8px;
      padding: 16px;
      border: 1px solid rgba(255,255,255,0.06); border-radius: 12px;
      background: rgba(255, 255, 255, 0.015);
      max-height: calc(78vh - 8px);
      overflow-y: auto;
    }
    .docs-toc-h {
      font-size: 0.6rem; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; color: #94a3b8;
      padding: 0 6px 4px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .docs-toc-nav { display: flex; flex-direction: column; gap: 1px; }
    .docs-toc-link {
      padding: 6px 8px; border-radius: 6px;
      font-size: 0.75rem; line-height: 1.4;
      color: rgba(255, 255, 255, 0.62);
      text-decoration: none; cursor: pointer;
      transition: background 140ms ease, color 140ms ease;
    }
    .docs-toc-link:hover {
      background: rgba(0, 229, 255, 0.06);
      color: #fff;
    }
    .docs-toc-link--cta {
      margin-top: 6px;
      color: #00E5FF;
      border: 1px dashed rgba(0, 229, 255, 0.32);
    }
    .docs-toc-link--cta:hover {
      background: rgba(0, 229, 255, 0.12);
      color: #fff;
      border-color: rgba(0, 229, 255, 0.55);
    }
    .docs-copy-toast {
      color: #4ade80; font-size: 0.72rem; font-weight: 600;
      animation: docsToast 220ms cubic-bezier(0.16,1,0.3,1);
    }
    @keyframes docsToast { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
    .docs-send-spin {
      width: 12px; height: 12px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.25);
      border-top-color: #00E5FF;
      animation: docsSpin 700ms linear infinite;
      display: inline-block;
    }
    @keyframes docsSpin { to { transform: rotate(360deg); } }

    /* Response */
    .docs-response { display: flex; flex-direction: column; gap: 10px; }
    .docs-response-bar {
      position: sticky; top: 0; z-index: 2;
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 8px 4px;
      background: linear-gradient(180deg, rgba(6,6,16,0.92), rgba(6,6,16,0.65));
      backdrop-filter: blur(6px);
    }
    .docs-status-pill {
      font-family: 'JetBrains Mono', ui-monospace, monospace; font-weight: 700; font-size: 0.72rem;
      padding: 4px 10px; border-radius: 999px;
      border: 1px solid transparent; letter-spacing: 0.02em;
    }
    .docs-status-pill.is-ok   { background: rgba(74,222,128,0.10); color: #4ade80; border-color: rgba(74,222,128,0.32); }
    .docs-status-pill.is-warn { background: rgba(245,158,11,0.10); color: #fbbf24; border-color: rgba(245,158,11,0.32); }
    .docs-status-pill.is-bad  { background: rgba(239,68,68,0.10);  color: #f87171;   border-color: rgba(239,68,68,0.32); }
    .docs-latency {
      font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.72rem;
      color: #94a3b8;
    }
    .docs-latency b { color: #fff; font-weight: 600; }
    .docs-segmented {
      display: inline-flex; align-items: center; gap: 0;
      padding: 3px; border-radius: 8px;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
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
    .docs-code-block {
      margin: 0; padding: 14px 16px;
      background: rgba(255,255,255,0.025);
      border: 1px solid rgba(255,255,255,0.06); border-radius: 10px;
      overflow: auto; max-height: 360px;
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-feature-settings: "calt", "liga";
      font-size: 0.78rem; line-height: 1.6; color: #fff;
      white-space: pre-wrap; word-break: break-word;
      tab-size: 2;
    }
    .docs-code-muted { color: #94a3b8; }

    .tk-key  { color: #fbbf24; }
    .tk-str  { color: #4ade80; }
    .tk-num  { color: #00E5FF; }
    .tk-bool { color: #c084fc; }
    .tk-null { color: rgba(255,255,255,0.45); font-style: italic; }
    .tk-pun  { color: rgba(255,255,255,0.45); }

    .muted-h {
      font-size: 0.62rem; color: #94a3b8;
      text-transform: uppercase; letter-spacing: 0.08em;
      font-weight: 700;
    }

    /* 404 fallback */
    .docs-404, .docs-empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; padding: 40px 24px; text-align: center;
      color: #94a3b8;
    }
    .docs-404 svg, .docs-empty svg { color: rgba(0,229,255,0.55); }
    .docs-404 h3, .docs-empty h3 { margin: 0; color: #fff; font-size: 1rem; font-weight: 700; }
    .docs-404 p, .docs-empty p { margin: 0 0 12px; max-width: 38ch; font-size: 0.8rem; line-height: 1.55; text-wrap: pretty; }

    .docs-seg:focus-visible,
    .docs-mini-btn:focus-visible {
      outline: 2px solid #00E5FF;
      outline-offset: 2px;
      border-radius: 6px;
    }
    @media (prefers-reduced-motion: reduce) {
      .docs-seg, .docs-copy-toast, .docs-send-spin {
        transition: none !important; animation: none !important;
      }
    }
  `],
})
export class DocsEndpointComponent implements OnInit {
  readonly specService = inject(DocsSpecService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private title = inject(Title);
  private meta = inject(Meta);

  /** Route param `:endpointId` — reactive signal driven by `paramMap`. */
  readonly endpointId = toSignal<string | null>(
    this.route.paramMap.pipe(map((p) => p.get('endpointId'))),
    { initialValue: null },
  );

  readonly paramValues = signal<Record<string, string>>({});
  readonly requestBodyJson = signal<string>('');
  readonly bodyValidation = signal<{ ok: boolean; message: string } | null>(null);

  readonly sending = signal(false);
  readonly response = signal<LiveResponse | null>(null);
  readonly responseTab = signal<'body' | 'headers' | 'curl'>('body');
  readonly exampleTab = signal<'curl' | 'fetch' | 'workers'>('curl');
  readonly copyToast = signal(false);

  /** Currently-selected operation from the spec — null when 404. */
  readonly selected = computed<Operation | null>(() =>
    this.specService.findById(this.endpointId()),
  );

  readonly maskedToken = computed<string>(() => {
    const t = this.auth.getToken();
    if (!t) return '<not signed in>';
    if (t.length <= 10) return '****';
    return `${t.slice(0, 4)}…${t.slice(-4)}`;
  });

  /** The locally-curated per-endpoint metadata for the currently-selected op. */
  private readonly selectedMeta = computed<EndpointMeta | null>(() => {
    const op = this.selected();
    if (!op) return null;
    return ENDPOINT_META[`${op.method} ${op.path}`] ?? null;
  });

  readonly selectedDescription = computed<string>(() => this.selectedMeta()?.description ?? '');
  readonly extraHeaders = computed<ReadonlyArray<{ name: string; value: string; note?: string }>>(
    () => this.selectedMeta()?.extraHeaders ?? [],
  );
  readonly responseShape = computed<string>(() => this.selectedMeta()?.responseShape ?? '');
  readonly errorCodes = computed<ReadonlyArray<string>>(() => this.selectedMeta()?.errorCodes ?? []);

  readonly prettyBody = computed<string>(() => {
    const r = this.response();
    if (!r) return '';
    try {
      return JSON.stringify(JSON.parse(r.body), null, 2);
    } catch {
      return r.body;
    }
  });

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

  /** Native `fetch()` snippet — pastes into any browser / Node 18+ / Bun / Deno script. */
  readonly fetchSnippet = computed<string>(() => {
    const op = this.selected();
    if (!op) return '';
    const url = this.resolvedUrl();
    const body = op.requestBody && this.requestBodyJson() ? this.requestBodyJson() : '';
    const lines: string[] = [];
    lines.push(`const res = await fetch('${url}', {`);
    lines.push(`  method: '${op.method}',`);
    lines.push(`  headers: {`);
    lines.push(`    'Authorization': \`Bearer \${process.env.PS_TOKEN}\`,`);
    lines.push(`    'Content-Type': 'application/json',`);
    lines.push(`  },`);
    if (body) {
      let inline = body;
      try { inline = JSON.stringify(JSON.parse(body)); } catch { /* leave as-is */ }
      lines.push(`  body: ${JSON.stringify(inline)},`);
    }
    lines.push(`});`);
    lines.push(`if (!res.ok) throw new Error(\`\${res.status} \${res.statusText}\`);`);
    lines.push(`const { data } = await res.json();`);
    return lines.join('\n');
  });

  /**
   * Cloudflare Workers snippet — same idea as the `fetch` example but uses
   * `env.PS_TOKEN` (binding via `wrangler secret put PS_TOKEN`) and runs from
   * inside a Worker handler.
   */
  readonly workersSnippet = computed<string>(() => {
    const op = this.selected();
    if (!op) return '';
    const url = this.resolvedUrl();
    const body = op.requestBody && this.requestBodyJson() ? this.requestBodyJson() : '';
    const lines: string[] = [];
    lines.push(`// wrangler.toml: wrangler secret put PS_TOKEN`);
    lines.push(`export default {`);
    lines.push(`  async fetch(req: Request, env: Env): Promise<Response> {`);
    lines.push(`    const res = await fetch('${url}', {`);
    lines.push(`      method: '${op.method}',`);
    lines.push(`      headers: {`);
    lines.push(`        'Authorization': \`Bearer \${env.PS_TOKEN}\`,`);
    lines.push(`        'Content-Type': 'application/json',`);
    lines.push(`      },`);
    if (body) {
      let inline = body;
      try { inline = JSON.stringify(JSON.parse(body)); } catch { /* leave as-is */ }
      lines.push(`      body: ${JSON.stringify(inline)},`);
    }
    lines.push(`    });`);
    lines.push(`    return new Response(await res.text(), { status: res.status });`);
    lines.push(`  },`);
    lines.push(`};`);
    return lines.join('\n');
  });

  /** Active example block based on the segmented control. */
  readonly exampleSnippet = computed<string>(() => {
    const tab = this.exampleTab();
    if (tab === 'fetch') return this.fetchSnippet();
    if (tab === 'workers') return this.workersSnippet();
    return this.curlSnippet();
  });

  constructor() {
    // Whenever the route param OR the spec resolves into a new operation,
    // reset the local Try-It state (params/body/response) and refresh the
    // document title + description for SEO/social/bookmark fidelity.
    effect(() => {
      const op = this.selected();
      if (op) {
        this.paramValues.set({});
        this.requestBodyJson.set(
          op.requestBody ? JSON.stringify(buildExampleFromSchema(op.requestBody), null, 2) : '',
        );
        this.bodyValidation.set(null);
        this.response.set(null);
        this.applyMeta(op);
      } else if (this.endpointId() && this.specService.spec()) {
        // 404 — endpoint id present but no matching operation.
        this.title.setTitle('API Docs — Endpoint not found — ProjectSites');
        this.meta.updateTag({
          name: 'description',
          content: 'The requested API endpoint does not exist in the current OpenAPI spec.',
        });
      }
    });
  }

  ngOnInit(): void {
    // Defensive: if the user deep-linked here and the spec has not loaded yet
    // (e.g. shell didn't run because of a hot reload), kick the load now.
    if (!this.specService.spec() && !this.specService.loading()) {
      this.specService.load();
    }
  }

  /** Update per-route `<title>` + `<meta description>` from the selected op. */
  private applyMeta(op: Operation): void {
    this.title.setTitle(`API Docs — ${op.method} ${op.path} — ProjectSites`);
    const meta = ENDPOINT_META[`${op.method} ${op.path}`];
    const raw = (meta?.description ?? op.summary ?? `${op.method} ${op.path}`).replace(/\s+/g, ' ').trim();
    // Truncate to 156 chars per Yoast-strict + our SEO budget. Cut at the last
    // word boundary inside the budget so we never ship a half-word + ellipsis.
    let desc = raw;
    if (desc.length > 156) {
      const slice = desc.slice(0, 155);
      const lastSpace = slice.lastIndexOf(' ');
      desc = (lastSpace > 80 ? slice.slice(0, lastSpace) : slice) + '…';
    }
    this.meta.updateTag({ name: 'description', content: desc });
  }

  paramValue(name: string): string {
    return this.paramValues()[name] ?? '';
  }

  setParam(name: string, value: string): void {
    this.paramValues.set({ ...this.paramValues(), [name]: value });
  }

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
   * Global ⌘/Ctrl+Return → Send hotkey.
   *
   * Mirrors the body-textarea-scoped hotkey for anywhere else on the page
   * — header, sidebar, response panel — so power users don't have to refocus
   * the JSON body just to fire the request.
   */
  @HostListener('window:keydown', ['$event'])
  onGlobalKeydown(e: KeyboardEvent): void {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key !== 'Enter') return;
    if (!this.selected()) return;
    if (this.sending()) return;
    e.preventDefault();
    void this.send();
  }

  scrollTo(id: string, ev?: Event): void {
    if (ev) ev.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  errorCodeBlurb(code: string): string {
    return ERROR_CODE_BLURBS[code] ?? 'See the API overview for the standard error envelope.';
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

  /** Copy the raw path (no host) — useful for pasting into other docs. */
  copyPath(path: string): void {
    this.writeClipboard(path);
  }

  /** Copy whichever example snippet is currently visible (curl | fetch | workers). */
  copyExample(): void {
    const text = this.exampleSnippet();
    if (text) this.writeClipboard(text);
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
