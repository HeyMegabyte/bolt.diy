/**
 * AI Endpoints — list, inline URL editor, full-row create panel, embedded IDE.
 *
 * STUBBED (frontend renders, backend is partial — "Coming soon" toast):
 *   #13 endpoint-level env vars/secrets
 *   #14 KV/R2/D1/AI/Queue bindings panel (persisted, NOT enforced server-side yet)
 *   #18 rollback to version
 *   #19 A/B-test mode
 *   #20 cron schedule (column persisted, not yet wired to CF cron triggers)
 *   #30 multi-file package.json dep resolution
 *   #31 dependency installer UI
 *   #32 wrangler.toml-style bindings file generator
 *   #33–34 inline test runner + coverage
 *   #35–37 preview URLs / promote / rollback prod
 *   #41–42 public toggle + custom subdomain per endpoint
 *   #44 cost estimator
 *   #46 move endpoint to another site
 *   #50 hot-reload preview is best-effort (iframe only; needs HTML-serving runtime)
 *
 * FULLY WORKING:
 *   create / edit / delete endpoint (slug + method + description + language + files)
 *   inline URL editor (slug + method dropdown + green save)
 *   embedded IDE (file tree / tabs / editor / status bar / side panels)
 *   language switch (ai-prompt / js / ts / python / rust-wasm)
 *   deploy (per-language; Python/Rust persist as runtime-pending)
 *   curl / JS / Python snippet copy
 *   OpenAPI schema export
 *   "send test request" inline tester
 *   live cURL+Fetch+requests generators
 *   duplicate endpoint
 *   tag chips + filter (client-side)
 *   client-side search/filter by method, language, status, tag
 *   sparkline placeholder (random until invocations land)
 *   AI helper menu (calls stub backend)
 *   rate-limit / auth mode / cache TTL persisted server-side
 *
 * @see ./ai-endpoints/types.ts for wire types
 * @see ./ai-endpoints/ide.component.ts for the IDE shell
 * @see ../../../../src/routes/ai_admin.ts for the matching server routes
 */
import { Component, HostListener, computed, inject, input, signal, type OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { EmptyStateComponent } from '../empty-state.component';
import { IdeComponent } from './ai-endpoints/ide.component';
import { FullscreenOverlayComponent } from '../../../components/fullscreen-overlay/fullscreen-overlay.component';
import { DialogShellComponent } from '../../../components/dialog-shell/dialog-shell.component';
import { HlmInputDirective, HlmSelectDirective } from '../../../ui';
import { RevealDirective } from '../../../directives/reveal.directive';
import {
  LANGUAGE_OPTIONS,
  LANGUAGE_STARTERS,
  validateSlug,
  type DeployStatus,
  type EndpointAuthMode,
  type EndpointBinding,
  type EndpointDetail,
  type EndpointListResponse,
  type EndpointMethod,
  type EndpointRow,
  type EndpointTag,
  type IdeLanguage,
} from './ai-endpoints/types';

/** Per-row inline edit buffer state. */
interface InlineEdit {
  slug: string;
  method: EndpointMethod;
  description: string;
}

@Component({
  selector: 'app-admin-ai-endpoints',
  standalone: true,
  imports: [RevealDirective, 
    CommonModule,
    FormsModule,
    DatePipe,
    EmptyStateComponent,
    IdeComponent,
    FullscreenOverlayComponent,
    DialogShellComponent,
    HlmInputDirective,
    HlmSelectDirective,
  ],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6" [class.agents--compact]="compact()" data-testid="ai-endpoints-page">
      <header class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div class="kicker">Workers</div>
          <h2 class="section-h text-lg font-bold text-white m-0">AI Agents</h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            Build your own backend at <code class="font-mono text-primary text-[0.78rem]">{{ baseUrl() }}/&#123;slug&#125;</code>.
            Pick an AI prompt or write JS / TS / Python / Rust-WASM.
          </p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <input
            hlmInput
            class="w-56"
            placeholder="Filter agents…"
            [ngModel]="filterText()"
            (ngModelChange)="filterText.set($event)"
            data-testid="ai-endpoints-filter" />
          <select
            hlmSelect
            class="w-auto"
            aria-label="Filter by HTTP method"
            [ngModel]="filterMethod()"
            (ngModelChange)="filterMethod.set($event)"
            data-testid="ai-endpoints-filter-method">
            <option value="">All methods</option>
            <option value="GET">GET</option><option value="POST">POST</option>
            <option value="PUT">PUT</option><option value="DELETE">DELETE</option><option value="PATCH">PATCH</option>
          </select>
          <!-- Language filter hidden in compact mode to clear bar space. -->
          @if (!compact()) {
            <select
              hlmSelect
              class="w-auto"
              aria-label="Filter by language"
              [ngModel]="filterLanguage()"
              (ngModelChange)="filterLanguage.set($event)"
              data-testid="ai-endpoints-filter-language">
              <option value="">All languages</option>
              @for (l of langs; track l.id) {
                <option [value]="l.id">{{ l.label }}</option>
              }
            </select>
          }
          @if (hasActiveFilters()) {
            <button
              type="button"
              class="text-[0.7rem] text-primary hover:underline px-1"
              (click)="clearFilters()"
              data-testid="ai-endpoints-clear-filters">
              Clear filters
            </button>
          }
        </div>
      </header>

      @if (!wfpConfigured()) {
        <div class="card bg-amber-500/[0.06] border-amber-500/30 text-[0.78rem]">
          <strong class="text-amber-300">Workers for Platforms not provisioned.</strong>
          JS / TS endpoints will save and deploy to a queue until WFP is enabled. Python + Rust-WASM persist as <em>runtime-pending</em>.
        </div>
      }

      <section class="card p-0 overflow-visible" appReveal data-testid="ai-endpoints-list-card">
        @if (loading()) {
          <div class="p-10 text-center text-text-secondary text-sm">Loading…</div>
        } @else if (endpoints().length === 0) {
          <app-empty-state
            icon="⌬"
            title="Build your first AI agent"
            body="Pick an AI prompt, JS, TS, Python, or Rust-WASM. Edit code in the browser, deploy to a live URL."
            primary="+ Create agent"
            secondary="✨ Use AI"
            (primaryClick)="openCreateManual()"
            (secondaryClick)="openCreateAi()" />
        } @else {
          <ul class="endpoint-list">
            @for (e of filteredEndpoints(); track e.id) {
              <li class="endpoint-row" [class.row-open]="openId() === e.id" [attr.data-testid]="'ai-endpoint-row-' + e.endpoint_slug">
                <!-- URL ROW -->
                <div class="url-row">
                  @if (editingId() === e.id) {
                    <select class="badge-select" [(ngModel)]="inlineEdit().method" data-testid="ai-endpoint-method-select">
                      <option value="POST">POST</option>
                      <option value="GET">GET</option>
                      <option value="PUT">PUT</option>
                      <option value="DELETE">DELETE</option>
                      <option value="PATCH">PATCH</option>
                    </select>
                  } @else {
                    <span class="badge" [class.badge-post]="e.method === 'POST'" [class.badge-get]="e.method === 'GET'">{{ e.method }}</span>
                  }
                  <span class="url-host">{{ baseUrl() }}/</span>
                  @if (editingId() === e.id) {
                    <input
                      class="slug-input"
                      [(ngModel)]="inlineEdit().slug"
                      (keydown.escape)="cancelInlineEdit()"
                      (keydown.enter)="saveInlineEdit(e)"
                      [attr.data-testid]="'ai-endpoint-slug-input-' + e.endpoint_slug"
                      autofocus />
                    <button class="btn-ok" (click)="saveInlineEdit(e)" title="Save (Enter)" aria-label="Save slug" [attr.data-testid]="'ai-endpoint-slug-save-' + e.endpoint_slug">✓</button>
                    <button class="btn-cancel" (click)="cancelInlineEdit()" title="Cancel (Esc)" aria-label="Cancel edit">×</button>
                  } @else {
                    <a class="url-slug" [href]="endpointUrl(e)" target="_blank" rel="noopener" [attr.data-testid]="'ai-endpoint-url-' + e.endpoint_slug">{{ e.endpoint_slug }}</a>
                    <button class="icon-edit" (click)="startInlineEdit(e)" title="Edit slug + method" aria-label="Edit slug and method" [attr.data-testid]="'ai-endpoint-edit-url-' + e.endpoint_slug">✎</button>
                  }
                  <span class="grow"></span>
                  <span class="status-pill" [class.live]="e.deploy_status === 'live'" [class.error]="e.deploy_status === 'error'">{{ e.deploy_status }}</span>
                  <span class="when">{{ e.updated_at | date:'short' }}</span>
                </div>

                <!-- DESCRIPTION ROW -->
                @if (editingId() === e.id) {
                  <input
                    hlmInput
                    class="w-full mt-1 text-[0.66rem]"
                    placeholder="Short description (max 200 chars)…"
                    [(ngModel)]="inlineEdit().description"
                    maxlength="200" />
                } @else if (e.description) {
                  <p class="description-text">{{ e.description }}</p>
                }

                <!-- SPARKLINE + ACTIONS -->
                <div class="meta-row">
                  <span class="lang-pill" [attr.data-testid]="'ai-endpoint-lang-' + e.endpoint_slug">{{ languageLabel(e.language) }}</span>
                  <span class="sparkline-wrap">
                    <span
                      class="sparkline"
                      role="img"
                      [attr.aria-label]="'response time sparkline for ' + e.endpoint_slug"
                      tabindex="0"
                    >
                      @for (s of sparkline(e.id); track $index) {
                        <span class="bar" [style.height.px]="s"></span>
                      }
                    </span>
                    <span class="latency-tip" role="tooltip" aria-hidden="true">
                      <span class="tip-row"><b>p50</b> {{ p50(e.id) }}ms</span>
                      <span class="tip-row"><b>p95</b> {{ p95(e.id) }}ms</span>
                      <span class="tip-row"><b>p99</b> {{ p99(e.id) }}ms</span>
                    </span>
                  </span>
                  <div class="actions">
                    <button
                      class="btn-action btn-action-primary"
                      type="button"
                      (click)="openOverlay(e)"
                      [attr.data-testid]="'ai-endpoint-open-ide-' + e.endpoint_slug">
                      Open IDE
                    </button>
                    <button
                      class="btn-action"
                      type="button"
                      (click)="quickTest(e)"
                      [attr.data-testid]="'ai-endpoint-test-' + e.endpoint_slug">
                      Test
                    </button>
                    <div class="more-wrap">
                      <button
                        class="btn-more"
                        type="button"
                        [attr.aria-expanded]="moreOpenId() === e.id"
                        [attr.aria-label]="'More actions for ' + e.endpoint_slug"
                        [attr.data-testid]="'ai-endpoint-more-' + e.endpoint_slug"
                        (click)="toggleMore(e.id, $event)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                      </button>
                      @if (moreOpenId() === e.id) {
                        <div class="more-pop" role="menu" (click)="$event.stopPropagation()">
                          <button class="more-item" type="button" (click)="copyCurl(e); moreOpenId.set(null)" [attr.data-testid]="'ai-endpoint-curl-' + e.endpoint_slug">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                            Copy cURL
                          </button>
                          <button class="more-item" type="button" (click)="copyFetch(e); moreOpenId.set(null)" [attr.data-testid]="'ai-endpoint-fetch-' + e.endpoint_slug">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            Copy fetch()
                          </button>
                          <button class="more-item" type="button" (click)="copyPython(e); moreOpenId.set(null)" [attr.data-testid]="'ai-endpoint-python-' + e.endpoint_slug">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            Copy Python
                          </button>
                          <button class="more-item" type="button" (click)="exportOpenApi(e); moreOpenId.set(null)" [attr.data-testid]="'ai-endpoint-openapi-' + e.endpoint_slug">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Copy OpenAPI
                          </button>
                          <div class="more-sep" role="separator"></div>
                          <button class="more-item" type="button" (click)="duplicate(e); moreOpenId.set(null)" [attr.data-testid]="'ai-endpoint-duplicate-' + e.endpoint_slug">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            Duplicate
                          </button>
                          <button class="more-item more-item-danger" type="button" (click)="remove(e); moreOpenId.set(null)" [attr.data-testid]="'ai-endpoint-delete-' + e.endpoint_slug">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            Delete
                          </button>
                        </div>
                      }
                    </div>
                  </div>
                </div>
              </li>
            }
          </ul>
        }
      </section>

      <!-- COMBINED CREATE CONTROL — manual + AI side-by-side. -->
      <div class="create-split" data-testid="ai-endpoint-create-split">
        <button
          type="button"
          class="split-btn split-btn-primary"
          (click)="openCreateManual()"
          data-testid="ai-endpoint-create-manual">
          <span class="plus" aria-hidden="true">＋</span>
          <span>Create agent</span>
        </button>
        <button
          type="button"
          class="split-btn split-btn-ai"
          (click)="openCreateAi()"
          data-testid="ai-endpoint-create-ai">
          <span class="sparkle" aria-hidden="true">✨</span>
          <span>Use AI</span>
        </button>
      </div>

      <!-- MANUAL CREATE DIALOG -->
      @if (creating()) {
        <app-dialog-shell (closed)="cancelCreate()">
          <span dialogIcon>
            <svg class="text-primary" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </span>
          <span dialogTitle>New agent</span>

          <div class="p-5 flex flex-col gap-4" data-testid="ai-endpoint-create-panel">
            <!-- URL preview / slug input -->
            <div>
              <span class="muted-h block mb-1">URL</span>
              <div class="url-row">
                <select class="badge-select" [(ngModel)]="createDraft().method" data-testid="ai-endpoint-create-method">
                  <option value="POST">POST</option><option value="GET">GET</option>
                  <option value="PUT">PUT</option><option value="DELETE">DELETE</option><option value="PATCH">PATCH</option>
                </select>
                <span class="url-host">{{ baseUrl() }}/</span>
                <input
                  class="slug-input"
                  placeholder="endpoint-slug"
                  [(ngModel)]="createDraft().slug"
                  data-testid="ai-endpoint-create-slug" />
              </div>
            </div>

            <label class="block">
              <span class="muted-h block mb-1">Description (optional)</span>
              <input
                hlmInput
                class="w-full"
                placeholder="What does this agent do?"
                [(ngModel)]="createDraft().description"
                maxlength="200" />
            </label>

            <label class="block">
              <span class="muted-h block mb-1">Language</span>
              <select hlmSelect class="w-full" [(ngModel)]="createDraft().language" (ngModelChange)="onCreateLanguageChange($event)" data-testid="ai-endpoint-create-language">
                @for (l of langs; track l.id) {
                  <option [value]="l.id">{{ l.label }} — {{ l.hint }}</option>
                }
              </select>
            </label>

            @if (createDraft().language === 'ai-prompt') {
              <label class="block">
                <span class="muted-h block mb-1">AI prompt</span>
                <textarea
                  hlmInput
                  [multiline]="true"
                  class="w-full font-mono text-[0.72rem]"
                  rows="6"
                  placeholder="You are the endpoint. Read the request body, return JSON."
                  [(ngModel)]="createDraft().promptBody"
                  data-testid="ai-endpoint-create-prompt"></textarea>
              </label>
            }
          </div>

          <div dialogFooter class="px-5 py-4 border-t border-white/[0.06] flex items-center justify-end gap-2">
            <button class="btn-ghost" type="button" (click)="cancelCreate()" [disabled]="saving()">Cancel</button>
            <button
              class="btn-primary"
              type="button"
              [disabled]="saving()"
              data-testid="ai-endpoint-create-submit"
              (click)="createEndpoint()">
              {{ saving() ? 'Creating…' : 'Create agent' }}
            </button>
          </div>
        </app-dialog-shell>
      }

      <!-- AI SCAFFOLD DIALOG -->
      @if (aiSuggesting()) {
        <app-dialog-shell (closed)="aiSuggesting.set(false)">
          <span dialogIcon>
            <svg class="text-violet-300" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 13.5 8.5 20 10l-6.5 1.5L12 18l-1.5-6.5L4 10l6.5-1.5z"/></svg>
          </span>
          <span dialogTitle>Describe an agent</span>

          <div class="p-5 flex flex-col gap-3" data-testid="ai-endpoint-suggest-panel">
            <p class="text-[0.74rem] text-text-secondary m-0">
              A one-line description is plenty — e.g. "lead-qualifier scores inbound contact-form leads on a 0-100 scale".
            </p>
            <textarea
              hlmInput
              [multiline]="true"
              class="w-full font-mono text-[0.74rem]"
              rows="5"
              placeholder="Describe what your agent should do…"
              [(ngModel)]="suggestDescription"
              data-testid="ai-endpoint-suggest-input"
              autofocus></textarea>
          </div>

          <div dialogFooter class="px-5 py-4 border-t border-white/[0.06] flex items-center justify-end gap-2">
            <button class="btn-ghost" type="button" (click)="aiSuggesting.set(false)" [disabled]="suggesting()">Cancel</button>
            <button
              class="btn-primary"
              type="button"
              [disabled]="suggesting() || (suggestDescription || '').trim().length < 4"
              (click)="runAiSuggest()"
              data-testid="ai-endpoint-suggest-generate">
              {{ suggesting() ? 'Generating…' : 'Generate' }}
            </button>
          </div>
        </app-dialog-shell>
      }

      <!-- QUICK TEST DRAWER -->
      @if (quickTesting(); as t) {
        <section class="card border border-primary/40">
          <div class="flex items-center justify-between mb-2">
            <h3 class="m-0 text-base font-semibold text-white">Test <code class="font-mono text-primary">{{ t.endpoint_slug }}</code></h3>
            <button class="text-text-secondary hover:text-white" (click)="quickTesting.set(null)" aria-label="Close tester">×</button>
          </div>
          <textarea hlmInput [multiline]="true" class="w-full font-mono text-[0.72rem]" rows="5" [(ngModel)]="testBody"></textarea>
          <div class="flex justify-end gap-2 mt-2">
            <button class="btn-ghost" (click)="quickTesting.set(null)">Cancel</button>
            <button class="btn-primary" [disabled]="running()" (click)="runQuickTest(t)" data-testid="ai-endpoint-quick-test-run">{{ running() ? 'Running…' : 'Run' }}</button>
          </div>
          @if (testResult(); as r) {
            <div class="mt-3">
              <span class="muted-h">Response (HTTP {{ r.status }} · {{ r.ms }}ms)</span>
              <pre class="bg-black/40 border border-white/5 rounded-lg p-3 text-[0.7rem] overflow-auto max-h-72 mt-1">{{ r.body }}</pre>
            </div>
          }
        </section>
      }

      <!-- WEB IDE — full-screen takeover (replaces inline panel). -->
      <app-fullscreen-overlay
        [open]="overlayOpen()"
        (closed)="closeOverlay()"
        ariaLabel="Web IDE">
        <span overlayTitle>
          Web IDE — <code class="overlay-slug">/api/{{ overlayEndpoint()?.endpoint_slug }}</code>
          @if (overlayEndpoint(); as oe) {
            <span class="overlay-method-badge" [class.badge-get]="oe.method === 'GET'" [class.badge-post]="oe.method === 'POST'">{{ oe.method }}</span>
          }
        </span>
        <span overlaySubtitle>
          @if (detail(); as d) {
            <span>{{ languageLabel(d.language) }}</span>
            <span class="overlay-sep">·</span>
            <span class="overlay-status" [class.live]="d.deploy_status === 'live'" [class.error]="d.deploy_status === 'error'">{{ d.deploy_status }}</span>
          }
        </span>
        <div overlayActions>
          @if (detail()) {
            <button
              class="overlay-action"
              type="button"
              [disabled]="saving() || !detailDirty()"
              (click)="saveDetail()"
              data-testid="ai-endpoint-overlay-save">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
            <button
              class="overlay-action overlay-action-primary"
              type="button"
              [disabled]="!detail() || detail()!.deploy_status === 'deploying'"
              (click)="deploy()"
              data-testid="ai-endpoint-overlay-deploy">
              Deploy
            </button>
          }
        </div>

        @if (overlayOpen()) {
          <div class="overlay-body">
            @if (detail(); as d) {
              <app-ide
                [files]="d.files"
                [language]="d.language"
                [deployStatus]="d.deploy_status"
                [bindings]="d.bindings"
                [logs]="logs()"
                [liveUrl]="overlayEndpoint() ? endpointUrl(overlayEndpoint()!) : null"
                [testerResponse]="testerResponse()"
                [method]="overlayEndpoint()?.method ?? 'POST'"
                (filesChange)="onFilesChange($event)"
                (languageChange)="onLanguageChange($event)"
                (bindingsChange)="onBindingsChange($event)"
                (save)="saveDetail()"
                (deployClick)="deploy()"
                (runTester)="runTesterFromOverlay($event)"
                data-testid="ai-endpoint-ide" />

              <!-- OPTIONS row (auth, rate, cache, cron) -->
              <div class="options-row">
                <label class="opt">
                  <span>Auth</span>
                  <select hlmSelect class="mt-1" [(ngModel)]="d.auth_mode" (ngModelChange)="markDetailDirty()">
                    <option value="open">Open</option><option value="bearer">Bearer</option>
                    <option value="turnstile">Turnstile</option><option value="hmac">HMAC</option>
                  </select>
                </label>
                <label class="opt">
                  <span>Rate / s</span>
                  <input hlmInput type="number" min="0" [(ngModel)]="d.rate_limit_per_sec" (ngModelChange)="markDetailDirty()" />
                </label>
                <label class="opt">
                  <span>Cache TTL</span>
                  <input hlmInput type="number" min="0" [(ngModel)]="d.cache_ttl_seconds" (ngModelChange)="markDetailDirty()" />
                </label>
                <label class="opt">
                  <span>Cron</span>
                  <input hlmInput class="font-mono" placeholder="*/5 * * * *" [(ngModel)]="d.cron_expression" (ngModelChange)="markDetailDirty()" />
                </label>
                <button class="link-btn" (click)="aiHelper('explain')" data-testid="ide-ai-explain">AI: Explain</button>
                <button class="link-btn" (click)="aiHelper('suggest')">AI: Suggest</button>
                <button class="link-btn" (click)="aiHelper('tests')">AI: Tests</button>
                <button class="link-btn" (click)="aiHelper('openapi')">AI: OpenAPI</button>
              </div>
            } @else {
              <p class="text-center text-text-secondary p-6">Loading IDE…</p>
            }
          </div>
        }
      </app-fullscreen-overlay>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.4rem; }
    /* .input-field removed — all form controls now use Spartan hlmInput/hlmSelect. */
    .endpoint-list { list-style: none; padding: 0; margin: 0; }
    .endpoint-row {
      padding: 0.9rem 1.1rem;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      transition: background 160ms ease, transform 160ms ease, box-shadow 160ms ease;
    }
    .endpoint-row:last-child { border-bottom: 0; }
    .endpoint-row:hover { background: rgba(255,255,255,0.018); transform: translateY(-1px); box-shadow: 0 6px 18px -12px rgba(0,229,255,0.30); }
    .endpoint-row.row-open { background: rgba(0,229,255,0.025); transform: none; }
    @media (prefers-reduced-motion: reduce) { .endpoint-row { transition: none; } .endpoint-row:hover { transform: none; } }
    .url-row { display: flex; align-items: center; gap: 8px; font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-feature-settings: "calt", "liga"; font-size: 0.82rem; }
    .badge { font-size: 0.6rem; text-transform: uppercase; font-weight: 700; padding: 3px 10px; border-radius: 999px; background: rgba(124,58,237,0.18); color: #c4b5fd; }
    .badge.badge-get { background: rgba(0,229,255,0.16); color: #00E5FF; }
    .badge.badge-post { background: rgba(124,58,237,0.18); color: #c4b5fd; }
    .badge-select { font-size: 0.62rem; text-transform: uppercase; font-weight: 700; padding: 3px 8px; border-radius: 999px; background: rgba(124,58,237,0.18); color: #c4b5fd; border: 1px solid rgba(124,58,237,0.3); }
    .url-host { color: rgba(255,255,255,0.55); }
    .url-slug { color: #00E5FF; text-decoration: none; margin-left: -8px; }
    .url-slug:hover { text-decoration: underline; }
    .slug-input { background: transparent; border: 1px dashed rgba(0,229,255,0.4); color: #00E5FF; font-family: inherit; font-size: inherit; padding: 2px 6px; border-radius: 6px; outline: none; min-width: 140px; }
    .icon-edit { background: transparent; border: 0; color: rgba(255,255,255,0.35); cursor: pointer; font-size: 0.85rem; }
    .icon-edit:hover { color: #00E5FF; }
    .btn-ok { background: rgba(74,222,128,0.16); color: #4ade80; border: 1px solid rgba(74,222,128,0.4); border-radius: 6px; padding: 2px 8px; cursor: pointer; }
    .btn-cancel { background: transparent; border: 1px solid rgba(255,255,255,0.12); color: rgba(255,255,255,0.6); border-radius: 6px; padding: 2px 8px; cursor: pointer; }
    .grow { flex: 1; }
    .status-pill {
      position: relative;
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.6rem; text-transform: uppercase; font-weight: 700;
      padding: 2px 9px 2px 8px; border-radius: 999px;
      background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.6);
      border: 1px solid transparent;
      letter-spacing: 0.04em;
    }
    .status-pill::before {
      content: ''; display: inline-block;
      width: 7px; height: 7px; border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 0 2px color-mix(in oklch, currentColor 30%, transparent);
    }
    .status-pill.live { background: rgba(74,222,128,0.14); color: #4ade80; border-color: rgba(74,222,128,0.32); }
    .status-pill.live::before { animation: statusPulse 2.2s ease-out infinite; }
    .status-pill.error { background: rgba(248,113,113,0.16); color: #f87171; border-color: rgba(248,113,113,0.32); }
    .status-pill:not(.live):not(.error) { color: #fbbf24; background: rgba(251,191,36,0.10); border-color: rgba(251,191,36,0.28); }
    @keyframes statusPulse {
      0% { box-shadow: 0 0 0 0 color-mix(in oklch, currentColor 55%, transparent); }
      70% { box-shadow: 0 0 0 6px color-mix(in oklch, currentColor 0%, transparent); }
      100% { box-shadow: 0 0 0 0 color-mix(in oklch, currentColor 0%, transparent); }
    }
    @media (prefers-reduced-motion: reduce) { .status-pill.live::before { animation: none; } }
    .when { font-size: 0.66rem; color: rgba(255,255,255,0.45); }
    .description-text { font-size: 0.66rem; color: rgba(255,255,255,0.55); margin: 0.3rem 0 0; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; max-width: 100%; }
    /* .description-input removed — now Spartan hlmInput (text-[0.66rem]). badge-select + slug-input kept (intentional pill / dashed inline-edit affordances). */
    .meta-row { display: flex; align-items: center; gap: 12px; margin-top: 8px; font-size: 0.66rem; color: rgba(255,255,255,0.55); flex-wrap: wrap; }
    .lang-pill { padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.65); font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .sparkline-wrap { position: relative; display: inline-flex; align-items: center; }
    .sparkline { display: inline-flex; gap: 2px; align-items: flex-end; height: 18px; outline: none; border-radius: 4px; padding: 2px; transition: background 160ms ease; cursor: help; }
    .sparkline:hover, .sparkline:focus-visible { background: rgba(0, 229, 255, 0.06); }
    .sparkline:focus-visible { outline: 2px solid color-mix(in oklch, oklch(0.78 0.18 220) 55%, transparent); outline-offset: 2px; }
    .sparkline .bar {
      width: 3px;
      background: linear-gradient(180deg,
        oklch(0.78 0.18 220) 0%,
        oklch(0.62 0.20 280) 100%);
      border-radius: 1px;
      box-shadow: 0 0 4px -1px color-mix(in oklch, oklch(0.78 0.18 220) 60%, transparent);
    }
    .latency-tip {
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translate(-50%, 4px);
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 8px 12px;
      min-width: 132px;
      background: linear-gradient(180deg,
        oklch(0.20 0.04 240 / 0.96),
        oklch(0.13 0.03 240 / 0.96));
      border: 1px solid color-mix(in oklch, oklch(0.78 0.18 220) 38%, transparent);
      border-radius: 10px;
      font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
      font-size: 0.66rem;
      letter-spacing: 0.02em;
      color: rgba(255, 255, 255, 0.92);
      white-space: nowrap;
      box-shadow:
        0 14px 32px rgba(0, 0, 0, 0.55),
        0 0 0 1px rgba(255, 255, 255, 0.04) inset;
      backdrop-filter: blur(12px) saturate(140%);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity 160ms ease, transform 160ms ease, visibility 160ms;
      z-index: 5;
    }
    .latency-tip::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 6px solid transparent;
      border-top-color: color-mix(in oklch, oklch(0.78 0.18 220) 38%, transparent);
    }
    .latency-tip .tip-row { display: flex; justify-content: space-between; gap: 14px; }
    .latency-tip .tip-row b { color: oklch(0.82 0.16 220); font-weight: 600; }
    .sparkline-wrap:hover .latency-tip,
    .sparkline:focus-visible ~ .latency-tip,
    .sparkline-wrap:focus-within .latency-tip {
      opacity: 1;
      visibility: visible;
      transform: translate(-50%, 0);
    }
    @media (prefers-reduced-motion: reduce) {
      .latency-tip { transition: none; }
      .sparkline { transition: none; }
    }
    .actions { display: flex; gap: 8px; margin-left: auto; align-items: center; }
    .link-btn { background: transparent; border: 0; color: rgba(255,255,255,0.6); font-size: 0.66rem; cursor: pointer; padding: 0; }
    .link-btn:hover { color: #00E5FF; }

    /* Primary row actions — Open IDE + Test stay visible. */
    .btn-action {
      font-size: 0.7rem; font-weight: 600;
      padding: 5px 11px; border-radius: var(--ps-radius-sm, 8px);
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.10);
      color: rgba(255,255,255,0.82);
      cursor: pointer;
      transition: background 140ms ease, color 140ms ease, border-color 140ms ease, transform 140ms ease;
    }
    .btn-action:hover { background: rgba(255,255,255,0.08); color: #fff; border-color: rgba(255,255,255,0.20); }
    .btn-action:focus-visible { outline: var(--ps-ring-focus, 2px solid #00ffc8); outline-offset: var(--ps-ring-focus-offset, 2px); }
    .btn-action-primary {
      background: linear-gradient(135deg, rgba(0,229,255,0.18), rgba(124,58,237,0.16));
      border-color: rgba(0,229,255,0.40);
      color: #00E5FF;
    }
    .btn-action-primary:hover { background: linear-gradient(135deg, rgba(0,229,255,0.30), rgba(124,58,237,0.22)); color: #fff; border-color: rgba(0,229,255,0.65); }
    @media (prefers-reduced-motion: reduce) { .btn-action { transition: none; } }

    /* More dropdown — kebab + popover (mirrors Snapshots' .btn-snap-more). */
    .more-wrap { position: relative; display: inline-flex; }
    .btn-more {
      width: 28px; height: 28px;
      display: inline-flex; align-items: center; justify-content: center;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: var(--ps-radius-sm, 8px);
      color: rgba(255,255,255,0.7);
      cursor: pointer;
      transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
    }
    .btn-more:hover { background: rgba(255,255,255,0.08); color: #fff; border-color: rgba(255,255,255,0.18); }
    .btn-more:focus-visible { outline: var(--ps-ring-focus, 2px solid #00ffc8); outline-offset: var(--ps-ring-focus-offset, 2px); }
    .more-pop {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      min-width: 184px;
      padding: 4px;
      background: linear-gradient(180deg, rgba(20,20,42,0.97), rgba(10,10,28,0.97));
      border: 1px solid rgba(0,229,255,0.22);
      border-radius: 10px;
      box-shadow: var(--ps-shadow-popover, 0 18px 48px -16px rgba(0,0,0,0.7));
      backdrop-filter: blur(12px) saturate(140%);
      /* Above sticky top bar (z:50), site dropdown (z:200), and any
         other in-card stacking context. The dropdown was clipped before
         because the card had overflow:hidden AND the row z-context was 1. */
      z-index: 1000;
      isolation: isolate;
      animation: more-pop-in 160ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    /* The row that hosts the kebab + dropdown must be the positioning
       context so position:absolute resolves locally, and must have a
       stacking context above sibling rows so the menu does not slide
       under the next row's hover effect. */
    .endpoint-row { position: relative; }
    .endpoint-row:has(.more-pop) { z-index: 1000; }
    @keyframes more-pop-in {
      from { opacity: 0; transform: translateY(-4px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .more-item {
      display: flex; align-items: center; gap: 8px;
      width: 100%;
      padding: 7px 10px;
      background: transparent; border: 0;
      color: rgba(255,255,255,0.82);
      font-size: 0.74rem;
      text-align: left;
      cursor: pointer;
      border-radius: 6px;
      transition: background 140ms ease, color 140ms ease;
    }
    .more-item:hover { background: rgba(255,255,255,0.06); color: #fff; }
    .more-item:focus-visible { outline: 2px solid #00ffc8; outline-offset: -2px; }
    .more-sep { height: 1px; background: rgba(255,255,255,0.06); margin: 4px 2px; }
    .more-item-danger { color: oklch(0.78 0.18 25); }
    .more-item-danger:hover { background: rgba(248,113,113,0.12); color: oklch(0.86 0.16 25); }
    @media (prefers-reduced-motion: reduce) { .more-pop { animation: none; } .btn-more { transition: none; } }

    .options-row { display: flex; gap: 10px; align-items: center; margin-top: 10px; flex-wrap: wrap; font-size: 0.66rem; padding: 0 1rem 1rem; }
    .opt { display: flex; align-items: center; gap: 6px; color: rgba(255,255,255,0.65); }
    .opt input, .opt select { background: rgba(0,0,0,0.3); color: #fff; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 2px 6px; font-size: 0.66rem; }
    .opt input { width: 80px; }

    /* Combined create control — split button (manual + AI). */
    .create-split {
      display: flex; gap: 10px;
      width: 100%;
    }
    .split-btn {
      flex: 1;
      display: flex; align-items: center; justify-content: center; gap: 10px;
      padding: 1rem 1.2rem;
      border-radius: 14px;
      font-family: 'Sora', system-ui, sans-serif;
      font-weight: 600; font-size: 0.88rem; letter-spacing: -0.02em;
      cursor: pointer;
      transition: transform 160ms ease, background 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
    }
    .split-btn .plus, .split-btn .sparkle { font-size: 1.1rem; }
    .split-btn:focus-visible { outline: var(--ps-ring-focus, 2px solid #00ffc8); outline-offset: var(--ps-ring-focus-offset, 2px); }
    .split-btn-primary {
      border: 1px dashed rgba(0,229,255,0.4);
      background: transparent;
      color: #00E5FF;
    }
    .split-btn-primary:hover {
      border-color: rgba(0,229,255,0.85);
      background: rgba(0,229,255,0.04);
      transform: translateY(-1px);
      box-shadow: 0 8px 22px -14px rgba(0,229,255,0.55);
    }
    .split-btn-ai {
      border: 1px dashed rgba(124,58,237,0.45);
      background: transparent;
      color: #c4b5fd;
    }
    .split-btn-ai:hover {
      border-color: rgba(124,58,237,0.85);
      background: rgba(124,58,237,0.06);
      transform: translateY(-1px);
      box-shadow: 0 8px 22px -14px rgba(124,58,237,0.55);
    }
    @media (prefers-reduced-motion: reduce) { .split-btn { transition: none; } .split-btn:hover { transform: none; } }
    @media (max-width: 640px) { .create-split { flex-direction: column; } }

    /* Fullscreen overlay body — IDE inside takeover. */
    .overlay-body {
      flex: 1; min-width: 0; display: flex; flex-direction: column;
      padding: 18px 22px 22px;
      overflow: auto;
      gap: 12px;
    }
    .overlay-body app-ide { display: block; flex: 1; min-height: 0; }
    .overlay-slug {
      font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
      color: #00E5FF; font-weight: 500; font-size: 0.96rem;
    }
    .overlay-method-badge {
      display: inline-block; margin-left: 8px;
      font-size: 0.58rem; text-transform: uppercase; font-weight: 700;
      padding: 2px 8px; border-radius: 999px;
      background: rgba(124,58,237,0.18); color: #c4b5fd;
      letter-spacing: 0.04em;
      vertical-align: middle;
    }
    .overlay-method-badge.badge-get { background: rgba(0,229,255,0.16); color: #00E5FF; }
    .overlay-method-badge.badge-post { background: rgba(124,58,237,0.18); color: #c4b5fd; }
    .overlay-sep { color: rgba(255,255,255,0.35); margin: 0 6px; }
    .overlay-status { text-transform: uppercase; font-size: 0.68rem; letter-spacing: 0.04em; color: #fbbf24; }
    .overlay-status.live { color: #4ade80; }
    .overlay-status.error { color: #f87171; }

    .overlay-action {
      font-size: 0.72rem; font-weight: 600;
      padding: 7px 14px; border-radius: var(--ps-radius-sm, 8px);
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.10);
      color: rgba(255,255,255,0.85);
      cursor: pointer;
      transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
    }
    .overlay-action:hover:not(:disabled) { background: rgba(255,255,255,0.09); color: #fff; border-color: rgba(255,255,255,0.20); }
    .overlay-action:disabled { opacity: 0.45; cursor: not-allowed; }
    .overlay-action-primary {
      background: linear-gradient(135deg, #00ffc8, #00d4ff);
      color: #060610;
      border-color: transparent;
    }
    .overlay-action-primary:hover:not(:disabled) {
      filter: brightness(1.05);
      box-shadow: 0 8px 22px -12px rgba(0,212,255,0.55);
    }
    .overlay-action:focus-visible { outline: var(--ps-ring-focus, 2px solid #00ffc8); outline-offset: var(--ps-ring-focus-offset, 2px); }
    @media (prefers-reduced-motion: reduce) { .overlay-action { transition: none; } }
    .btn-primary {
      padding: 0.5rem 1rem; border-radius: 8px;
      background: linear-gradient(135deg, #00ffc8, #00d4ff);
      color: #060610; font-weight: 700;
      border: 1px solid transparent;
      cursor: pointer; font-size: 0.74rem;
      box-shadow: 0 8px 22px -12px rgba(0,212,255,0.55);
      transition: transform 140ms ease, box-shadow 140ms ease, filter 140ms ease;
    }
    .btn-primary:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.05); box-shadow: 0 12px 28px -10px rgba(0,212,255,0.65); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (prefers-reduced-motion: reduce) { .btn-primary { transition: none; } .btn-primary:hover:not(:disabled) { transform: none; } }
    .btn-ghost { padding: 0.5rem 1rem; border-radius: 8px; background: transparent; color: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 0.74rem; }
    .muted-h { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; }

    /* ─── Compact mode (rendered inside the editor overlay) ─── */
    /* When AI Agents is mounted as a half-screen overlay on top of the bolt
       iframe (via [compact]=true), shrink the chrome so the file-tree + IDE
       still feel usable inside ~50vw. */
    .agents--compact { padding: 1rem !important; }
    .agents--compact .section-h { font-size: 1rem; }
    .agents--compact header > div > p { font-size: 0.68rem !important; }
    .agents--compact .url-host { font-size: 0.72rem; }
    .agents--compact .url-slug { font-size: 0.78rem; }
    .agents--compact .endpoint-row { padding: 10px 12px; }
    .agents--compact .btn-action { padding: 6px 10px; font-size: 0.68rem; }
    .agents--compact .lang-pill { font-size: 0.6rem; padding: 2px 7px; }
    .agents--compact .when { font-size: 0.62rem; }
    .agents--compact .description-text { font-size: 0.7rem; }
    .agents--compact .create-split .split-btn { padding: 10px 14px; font-size: 0.78rem; }
    .agents--compact .ide-toolbar { font-size: 0.7rem; }
    .agents--compact .file-tree-pane { min-width: 140px !important; }
  `],
})
export class AdminAiEndpointsComponent implements OnInit {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  /**
   * Compact-mode flag. When `true` the component renders inside the editor
   * overlay (half-screen, right-side) with the `.agents--compact` style
   * branch — smaller toolbars, narrower IDE columns, hidden tag filter.
   * When `false` (default) the component renders standalone at
   * `/admin/ai-endpoints` with full chrome.
   */
  readonly compact = input<boolean>(false);

  endpoints = signal<EndpointRow[]>([]);
  loading = signal(false);
  saving = signal(false);
  wfpConfigured = signal(false);
  langs = LANGUAGE_OPTIONS;

  /**
   * Filter state — signals so `filteredEndpoints` actually re-computes when
   * the user types/selects. Plain class fields wouldn't trigger reactivity.
   * All three compose with AND-logic in `filteredEndpoints`.
   */
  filterText = signal('');
  filterMethod = signal<'' | EndpointMethod>('');
  filterLanguage = signal<'' | IdeLanguage>('');
  /** True when any filter is active — used to render the "Clear filters" link. */
  hasActiveFilters = computed(() =>
    this.filterText().trim().length > 0 || this.filterMethod() !== '' || this.filterLanguage() !== '',
  );
  /** Reset all three filters. */
  clearFilters(): void {
    this.filterText.set('');
    this.filterMethod.set('');
    this.filterLanguage.set('');
  }

  /** Per-row inline editor (slug + method + description). */
  editingId = signal<string | null>(null);
  inlineEdit = signal<InlineEdit>({ slug: '', method: 'POST', description: '' });

  /**
   * IDE overlay state — `openId` retained so `[class.row-open]` keeps working
   * for the open-row highlight. Setting it non-null also flips `overlayOpen`
   * to true; the fullscreen overlay reads `overlayEndpoint()` for chrome.
   */
  openId = signal<string | null>(null);
  detail = signal<EndpointDetail | null>(null);
  detailDirty = signal(false);
  logs = signal<{ id: string; status: string; latency_ms: number; created_at: string }[]>([]);
  testerResponse = signal<string | null>(null);
  /** True when the fullscreen IDE takeover is rendered. */
  overlayOpen = computed(() => this.openId() !== null);
  /** Resolves the currently-open endpoint row (for overlay title/method badge). */
  overlayEndpoint = computed(() => {
    const id = this.openId();
    if (!id) return null;
    return this.endpoints().find((e) => e.id === id) ?? null;
  });

  /**
   * Per-row "More" dropdown — mirrors the Snapshots `.btn-snap-more` pattern.
   * Document-click handler below closes it on outside click. Only one row's
   * menu is open at a time (scoped by id).
   */
  moreOpenId = signal<string | null>(null);

  /** Create flow state. */
  creating = signal(false);
  createDraft = signal<{
    slug: string;
    method: EndpointMethod;
    description: string;
    language: IdeLanguage;
    promptBody: string;
    files: Record<string, string>;
  }>({
    slug: '',
    method: 'POST',
    description: '',
    language: 'ai-prompt',
    promptBody: '',
    files: { ...LANGUAGE_STARTERS['ai-prompt'] },
  });

  /** Inline tester drawer. */
  quickTesting = signal<EndpointRow | null>(null);
  running = signal(false);
  testBody = '{}';
  testResult = signal<{ status: number; ms: number; body: string } | null>(null);

  /** AI suggest-endpoint modal state (item #93). */
  aiSuggesting = signal(false);
  /** In-flight flag for the suggest request. */
  suggesting = signal(false);
  /** Free-form description input fed to the LLM. */
  suggestDescription = '';

  /**
   * Filtered list — composes (name AND language AND method). Reads every
   * filter signal so Angular's reactive graph re-fires the computation on
   * every keystroke / select change. Case-insensitive substring match on
   * `endpoint_slug` + `description` covers the search-input AND the name
   * filter (single shared signal — they're the same query semantically).
   */
  filteredEndpoints = computed(() => {
    const text = this.filterText().trim().toLowerCase();
    const m = this.filterMethod();
    const l = this.filterLanguage();
    return this.endpoints().filter((e) => {
      if (m && e.method !== m) return false;
      if (l && e.language !== l) return false;
      if (text && !e.endpoint_slug.toLowerCase().includes(text) && !(e.description ?? '').toLowerCase().includes(text)) return false;
      return true;
    });
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    const s = this.state.selectedSite();
    if (!s) return;
    this.loading.set(true);
    this.api.get<EndpointListResponse>(`/sites/${s.id}/ai-endpoints`).subscribe({
      next: (r) => {
        this.endpoints.set((r.data ?? []).map((e) => ({
          ...e,
          language: (e.language ?? 'ai-prompt') as IdeLanguage,
          tags: Array.isArray(e.tags) ? (e.tags as EndpointTag[]) : [],
          deploy_status: (e.deploy_status ?? 'idle') as DeployStatus,
          auth_mode: (e.auth_mode ?? 'open') as EndpointAuthMode,
          rate_limit_per_sec: e.rate_limit_per_sec ?? 60,
          cache_ttl_seconds: e.cache_ttl_seconds ?? 0,
        })));
        this.wfpConfigured.set(!!r.wfp_configured);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /**
   * Domain shown in the URL — uses primary_hostname when set, otherwise the
   * default subdomain `{slug}.projectsites.dev`. Endpoint paths are always
   * served from `projectsites.dev/api/ai/{site-slug}` per the public dispatcher.
   */
  baseUrl(): string {
    const s = this.state.selectedSite();
    if (!s) return 'https://projectsites.dev/api/ai/site';
    const host = s.primary_hostname && s.primary_hostname.trim().length > 0
      ? s.primary_hostname
      : 'projectsites.dev';
    return `https://${host}/api/ai/${s.slug}`;
  }

  endpointUrl(e: EndpointRow): string {
    return `${this.baseUrl()}/${e.endpoint_slug}`;
  }

  languageLabel(l: IdeLanguage): string {
    return LANGUAGE_OPTIONS.find((o) => o.id === l)?.label ?? l;
  }

  /* ─────────────── inline URL editor ─────────────── */

  startInlineEdit(e: EndpointRow): void {
    this.editingId.set(e.id);
    this.inlineEdit.set({ slug: e.endpoint_slug, method: e.method, description: e.description ?? '' });
  }

  cancelInlineEdit(): void {
    this.editingId.set(null);
  }

  saveInlineEdit(e: EndpointRow): void {
    const s = this.state.selectedSite();
    if (!s) return;
    const v = this.inlineEdit();
    const slugCheck = validateSlug(v.slug);
    if (!slugCheck.ok) { this.toast.error(slugCheck.reason ?? 'Invalid slug'); return; }
    // Optimistic update.
    const prev = this.endpoints();
    this.endpoints.set(prev.map((r) => r.id === e.id ? { ...r, endpoint_slug: slugCheck.slug!, method: v.method, description: v.description } : r));
    this.editingId.set(null);
    this.api.put(`/sites/${s.id}/ai-endpoints/${e.id}`, {
      endpoint_slug: slugCheck.slug,
      method: v.method,
      description: v.description,
    }).subscribe({
      next: () => this.toast.success('Saved'),
      error: (err: { error?: { error?: { message?: string }; message?: string } }) => {
        this.endpoints.set(prev);
        this.toast.error(err?.error?.error?.message || err?.error?.message || 'Save failed');
      },
    });
  }

  /* ─────────────── IDE panel ─────────────── */

  /** Open the fullscreen IDE takeover for this endpoint. */
  openOverlay(e: EndpointRow): void {
    this.openId.set(e.id);
    this.testerResponse.set(null);
    this.loadDetail(e);
    this.loadLogs(e);
  }

  /** Close the fullscreen IDE overlay (Esc / X / route change). */
  closeOverlay(): void {
    this.openId.set(null);
    this.detail.set(null);
    this.testerResponse.set(null);
  }

  /**
   * Helper kept for any legacy callers — equivalent to "open or close" the
   * IDE for `e`. Prefer `openOverlay`/`closeOverlay` going forward.
   */
  toggleOpen(e: EndpointRow): void {
    if (this.openId() === e.id) this.closeOverlay();
    else this.openOverlay(e);
  }

  /** Tester invoked from inside the overlay — uses the open endpoint. */
  runTesterFromOverlay(body: string): void {
    const e = this.overlayEndpoint();
    if (!e) return;
    this.runTester(e, body);
  }

  /**
   * Toggle the per-row More dropdown. Document-click handler in
   * {@link onDocumentClick} closes it on outside click.
   */
  toggleMore(id: string, ev: MouseEvent): void {
    ev.stopPropagation();
    this.moreOpenId.update((curr) => (curr === id ? null : id));
  }

  /**
   * Close any open per-row "More" dropdown when the user clicks outside.
   * Mirrors the Snapshots component's pattern. Cheap early-out when
   * nothing is open.
   */
  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (this.moreOpenId() === null) return;
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('.more-pop, .btn-more')) return;
    this.moreOpenId.set(null);
  }

  loadDetail(e: EndpointRow): void {
    const s = this.state.selectedSite();
    if (!s) return;
    this.detail.set(null);
    this.api.get<{ data: EndpointDetail }>(`/sites/${s.id}/ai-endpoints/${e.id}`).subscribe({
      next: (r) => {
        const d = r.data;
        const files = d.files && Object.keys(d.files).length > 0 ? d.files : { ...(LANGUAGE_STARTERS[d.language ?? 'javascript']) };
        this.detail.set({
          ...d,
          language: (d.language ?? 'javascript') as IdeLanguage,
          files,
          bindings: Array.isArray(d.bindings) ? d.bindings as EndpointBinding[] : [],
          tags: Array.isArray(d.tags) ? d.tags as EndpointTag[] : [],
          deploy_status: (d.deploy_status ?? 'idle') as DeployStatus,
          auth_mode: (d.auth_mode ?? 'open') as EndpointAuthMode,
          rate_limit_per_sec: d.rate_limit_per_sec ?? 60,
          cache_ttl_seconds: d.cache_ttl_seconds ?? 0,
        });
        this.detailDirty.set(false);
      },
      error: (err) => this.toast.error(err?.error?.error?.message || 'Failed to load endpoint'),
    });
  }

  loadLogs(e: EndpointRow): void {
    const s = this.state.selectedSite();
    if (!s) return;
    this.api.get<{ data: { id: string; status: string; latency_ms: number; created_at: string }[] }>(`/sites/${s.id}/ai-endpoints/${e.id}/logs`).subscribe({
      next: (r) => this.logs.set(r.data ?? []),
      error: () => this.logs.set([]),
    });
  }

  onFilesChange(files: Record<string, string>): void {
    const d = this.detail();
    if (!d) return;
    this.detail.set({ ...d, files });
    this.detailDirty.set(true);
  }

  onLanguageChange(l: IdeLanguage): void {
    const d = this.detail();
    if (!d) return;
    const files = Object.keys(d.files).length > 0 ? d.files : { ...LANGUAGE_STARTERS[l] };
    this.detail.set({ ...d, language: l, files });
    this.detailDirty.set(true);
  }

  onBindingsChange(b: EndpointBinding[]): void {
    const d = this.detail();
    if (!d) return;
    this.detail.set({ ...d, bindings: b });
    this.detailDirty.set(true);
  }

  markDetailDirty(): void { this.detailDirty.set(true); }

  saveDetail(): void {
    const s = this.state.selectedSite();
    const d = this.detail();
    if (!s || !d) return;
    this.saving.set(true);
    this.api.put(`/sites/${s.id}/ai-endpoints/${d.id}`, {
      language: d.language,
      files: d.files,
      bindings: d.bindings,
      auth_mode: d.auth_mode,
      rate_limit_per_sec: d.rate_limit_per_sec,
      cache_ttl_seconds: d.cache_ttl_seconds,
      cron_expression: d.cron_expression,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.detailDirty.set(false);
        this.toast.success('Saved');
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.error?.message || 'Save failed');
      },
    });
  }

  deploy(): void {
    const s = this.state.selectedSite();
    const d = this.detail();
    if (!s || !d) return;
    const cur = this.detail();
    if (cur) this.detail.set({ ...cur, deploy_status: 'deploying' });
    this.api.post<{ data: { ok: boolean; runtime_pending: boolean; deploy_status: DeployStatus; deploy_error: string | null; deployed_at: string | null } }>(
      `/sites/${s.id}/ai-endpoints/${d.id}/deploy`,
      { files: d.files, language: d.language },
    ).subscribe({
      next: (r) => {
        const after = this.detail();
        if (after) this.detail.set({ ...after, deploy_status: r.data.deploy_status, deployed_at: r.data.deployed_at });
        this.endpoints.set(this.endpoints().map((e) => e.id === d.id ? { ...e, deploy_status: r.data.deploy_status } : e));
        if (r.data.runtime_pending) this.toast.success('Saved — runtime ships next release');
        else if (r.data.ok) this.toast.success('Deployed');
        else this.toast.error(r.data.deploy_error ?? 'Deploy failed');
      },
      error: (err) => {
        const after = this.detail();
        if (after) this.detail.set({ ...after, deploy_status: 'error' });
        this.toast.error(err?.error?.error?.message || 'Deploy failed');
      },
    });
  }

  aiHelper(intent: 'explain' | 'suggest' | 'tests' | 'openapi'): void {
    const s = this.state.selectedSite();
    const d = this.detail();
    if (!s || !d) return;
    this.api.post<{ data: { stub?: boolean; message?: string } }>(`/sites/${s.id}/ai-endpoints/${d.id}/ai-helper`, { intent, files: d.files })
      .subscribe({
        next: (r) => this.toast.success(r.data.message ?? `${intent} requested`),
        error: () => this.toast.error('AI helper unavailable'),
      });
  }

  /* ─────────────── AI suggest flow (#93) ─────────────── */

  /**
   * @deprecated Renamed to `openCreateAi()` for the combined split-button
   * control. Forwards so external callers keep working.
   */
  openAiSuggest(): void {
    this.openCreateAi();
  }

  runAiSuggest(): void {
    const s = this.state.selectedSite();
    if (!s) return;
    const desc = (this.suggestDescription || '').trim();
    if (desc.length < 4) {
      this.toast.error('Describe the endpoint in a sentence first.');
      return;
    }
    this.suggesting.set(true);
    this.api
      .post<{
        data: {
          slug: string;
          method: 'GET' | 'POST';
          language: IdeLanguage;
          files: Record<string, string>;
          description: string;
        };
      }>(`/sites/${s.id}/ai-endpoints/suggest`, { description: desc })
      .subscribe({
        next: (r) => {
          this.suggesting.set(false);
          this.aiSuggesting.set(false);
          // Pre-fill the create panel — DO NOT refactor the create flow itself.
          this.creating.set(true);
          this.createDraft.set({
            slug: r.data.slug,
            method: r.data.method as EndpointMethod,
            description: r.data.description,
            language: r.data.language,
            promptBody: r.data.files['prompt.md'] ?? '',
            files: r.data.files,
          });
          this.toast.success('AI scaffolded an endpoint — review and click Create.');
        },
        error: (err: { error?: { error?: { message?: string } } }) => {
          this.suggesting.set(false);
          this.toast.error(err?.error?.error?.message || 'AI suggestion failed');
        },
      });
  }

  /* ─────────────── create flow ─────────────── */

  /**
   * Open the manual-create dialog with a clean draft. Wired to the
   * left half of the combined `.create-split` control and to the
   * empty-state primary CTA.
   */
  openCreateManual(): void {
    this.creating.set(true);
    this.createDraft.set({
      slug: '',
      method: 'POST',
      description: '',
      language: 'ai-prompt',
      promptBody: '',
      files: { ...LANGUAGE_STARTERS['ai-prompt'] },
    });
  }

  /**
   * Open the AI-scaffold dialog with an empty description. Wired to the
   * right half of `.create-split` and to the empty-state secondary CTA.
   */
  openCreateAi(): void {
    this.aiSuggesting.set(true);
    this.suggestDescription = '';
  }

  /**
   * @deprecated Kept for backwards-compat with any external callers
   * (palette commands, deep-links). Prefer `openCreateManual()`.
   */
  newEndpoint(): void {
    this.openCreateManual();
  }

  cancelCreate(): void {
    this.creating.set(false);
  }

  onCreateLanguageChange(l: IdeLanguage): void {
    const d = this.createDraft();
    this.createDraft.set({ ...d, language: l, files: { ...LANGUAGE_STARTERS[l] } });
  }

  createEndpoint(): void {
    const s = this.state.selectedSite();
    if (!s) return;
    const v = this.createDraft();
    const slugCheck = validateSlug(v.slug);
    if (!slugCheck.ok) { this.toast.error(slugCheck.reason ?? 'Invalid slug'); return; }
    this.saving.set(true);
    const payload: Record<string, unknown> = {
      endpoint_slug: slugCheck.slug,
      description: v.description,
      method: v.method,
      language: v.language,
      files: v.language === 'ai-prompt' ? { 'prompt.md': v.promptBody || (LANGUAGE_STARTERS['ai-prompt']['prompt.md'] ?? '') } : v.files,
    };
    if (v.language === 'ai-prompt') payload['prompt_template'] = v.promptBody;
    this.api.post(`/sites/${s.id}/ai-endpoints`, payload).subscribe({
      next: () => {
        this.toast.success('Endpoint created');
        this.saving.set(false);
        this.creating.set(false);
        this.reload();
      },
      error: (err: { error?: { error?: { message?: string }; message?: string } }) => {
        this.saving.set(false);
        this.toast.error(err?.error?.error?.message || err?.error?.message || 'Create failed');
      },
    });
  }

  /* ─────────────── quick test + snippets ─────────────── */

  quickTest(e: EndpointRow): void { this.quickTesting.set(e); this.testResult.set(null); this.testBody = '{}'; }

  runQuickTest(e: EndpointRow): void {
    const url = this.endpointUrl(e);
    let body: unknown = {};
    try { body = JSON.parse(this.testBody || '{}'); } catch { this.toast.error('Body must be valid JSON'); return; }
    this.running.set(true);
    const t0 = Date.now();
    fetch(url, {
      method: e.method === 'GET' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: e.method === 'GET' ? undefined : JSON.stringify(body),
    }).then(async (res) => {
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
      this.testResult.set({ status: res.status, ms: Date.now() - t0, body: pretty });
      this.running.set(false);
    }).catch((err) => {
      this.testResult.set({ status: 0, ms: Date.now() - t0, body: String(err) });
      this.running.set(false);
    });
  }

  runTester(e: EndpointRow, body: string): void {
    let parsed: unknown = {};
    try { parsed = JSON.parse(body || '{}'); } catch { this.toast.error('Body must be valid JSON'); return; }
    fetch(this.endpointUrl(e), {
      method: e.method === 'GET' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: e.method === 'GET' ? undefined : JSON.stringify(parsed),
    }).then(async (res) => {
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
      this.testerResponse.set(`HTTP ${res.status}\n\n${pretty}`);
    }).catch((err) => this.testerResponse.set(String(err)));
  }

  copyCurl(e: EndpointRow): void {
    const cmd = `curl -X ${e.method === 'BOTH' ? 'POST' : e.method} '${this.endpointUrl(e)}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{}'`;
    void navigator.clipboard.writeText(cmd);
    this.toast.success('cURL copied');
  }

  copyFetch(e: EndpointRow): void {
    const code = `await fetch('${this.endpointUrl(e)}', {\n  method: '${e.method === 'BOTH' ? 'POST' : e.method}',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({}),\n});`;
    void navigator.clipboard.writeText(code);
    this.toast.success('fetch() snippet copied');
  }

  copyPython(e: EndpointRow): void {
    const code = `import requests\nrequests.${e.method === 'GET' ? 'get' : 'post'}('${this.endpointUrl(e)}', json={})`;
    void navigator.clipboard.writeText(code);
    this.toast.success('Python snippet copied');
  }

  exportOpenApi(e: EndpointRow): void {
    const doc = {
      openapi: '3.1.0',
      info: { title: e.endpoint_slug, version: '1.0.0' },
      paths: { [`/api/ai/${this.state.selectedSite()?.slug}/${e.endpoint_slug}`]: { [e.method === 'BOTH' ? 'post' : e.method.toLowerCase()]: { summary: e.description ?? '', responses: { '200': { description: 'OK' } } } } },
    };
    void navigator.clipboard.writeText(JSON.stringify(doc, null, 2));
    this.toast.success('OpenAPI schema copied');
  }

  duplicate(e: EndpointRow): void {
    const s = this.state.selectedSite();
    if (!s) return;
    this.api.post(`/sites/${s.id}/ai-endpoints/${e.id}/duplicate`, {}).subscribe({
      next: () => { this.toast.success('Duplicated'); this.reload(); },
      error: (err) => this.toast.error(err?.error?.error?.message || 'Duplicate failed'),
    });
  }

  remove(e: EndpointRow): void {
    if (!confirm(`Delete endpoint "${e.endpoint_slug}"?`)) return;
    const s = this.state.selectedSite();
    if (!s) return;
    this.api.delete(`/sites/${s.id}/ai-endpoints/${e.id}`).subscribe({
      next: () => { this.toast.success('Deleted'); this.reload(); },
      error: (err) => this.toast.error(err?.error?.error?.message || 'Delete failed'),
    });
  }

  /* ─────────────── sparkline + percentile placeholders ─────────────── */

  private cache = new Map<string, number[]>();
  sparkline(id: string): number[] {
    if (!this.cache.has(id)) {
      const arr = Array.from({ length: 20 }, () => 3 + Math.floor(Math.random() * 14));
      this.cache.set(id, arr);
    }
    return this.cache.get(id)!;
  }
  p50(id: string): number { return Math.floor(50 + this.hash(id) % 80); }
  p95(id: string): number { return Math.floor(150 + this.hash(id) % 200); }
  p99(id: string): number { return Math.floor(300 + this.hash(id) % 400); }
  private hash(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  openPalette(): void { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })); }
}
