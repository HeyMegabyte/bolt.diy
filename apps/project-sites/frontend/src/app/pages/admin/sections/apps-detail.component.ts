import {
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';
import { RevealDirective } from '../../../directives/reveal.directive';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { HlmInputDirective } from '../../../ui';
import {
  APPS_CATALOG,
  isAppSupported,
  type CatalogApp,
  type InfraDep,
} from './apps-catalog.data';

interface InfraEstimate {
  readonly key: string;
  readonly label: string;
  readonly provider: string;
  readonly monthlyUsd: number;
}

const INFRA_PROVIDER_COST: Readonly<Record<InfraDep, InfraEstimate>> = {
  postgres:  { key: 'postgres',  label: 'Postgres',    provider: 'Neon (autoscale)',  monthlyUsd: 5 },
  redis:     { key: 'redis',     label: 'Redis',       provider: 'Upstash (per-req)', monthlyUsd: 3 },
  s3:        { key: 's3',        label: 'Object store', provider: 'Cloudflare R2',    monthlyUsd: 2 },
  sqlite:    { key: 'sqlite',    label: 'SQLite',      provider: 'Container volume',  monthlyUsd: 0 },
  volume:    { key: 'volume',    label: 'Volume',      provider: 'Container disk',    monthlyUsd: 1 },
  mailrelay: { key: 'mailrelay', label: 'Mail relay',  provider: 'Resend',            monthlyUsd: 0 },
} as const;

const INFRA_META: Readonly<Record<InfraDep, { glyph: string; label: string }>> = {
  postgres:  { glyph: '🐘', label: 'Postgres' },
  redis:     { glyph: '🟥', label: 'Redis' },
  s3:        { glyph: '🪣', label: 'R2 / S3' },
  sqlite:    { glyph: '💾', label: 'SQLite' },
  volume:    { glyph: '📦', label: 'Volume' },
  mailrelay: { glyph: '📬', label: 'Mail relay' },
} as const;

/**
 * Admin → App detail (catalog entry deep-dive + deploy panel).
 *
 * @remarks
 * Reads the `:id` route param, surfaces the full {@link CatalogApp} record
 * with env-var table, license, links, infra provisioning checklist, and the
 * cost breakdown for the deploy wizard. Submitting `Deploy` POSTs to
 * `/api/apps/instances` and routes to the boot-progress instance detail.
 */
@Component({
  selector: 'app-admin-app-detail',
  standalone: true,
  imports: [FormsModule, RouterLink, RevealDirective, RollingCounterComponent, HlmInputDirective],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- ─────────────────── BACK LINK ─────────────────── -->
      <a class="back-link" routerLink="/admin/apps">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        <span>All apps</span>
      </a>

      @if (app(); as a) {

        <!-- ─────────────────── HEADER ─────────────────── -->
        <header class="detail-head" appReveal>
          <div class="head-main">
            <div class="head-glyph" aria-hidden="true">{{ a.glyph }}</div>
            <div class="min-w-0 flex-1">
              <div class="kicker">{{ categoryLabel(a) }}</div>
              <h2 class="section-h text-2xl font-bold text-white m-0 mt-1">{{ a.name }}</h2>
              <p class="text-[0.84rem] text-text-secondary m-0 mt-1 max-w-prose leading-relaxed">{{ a.tagline }}</p>
              @if (a.tags.length > 0) {
                <div class="tag-row mt-2">
                  @for (t of a.tags; track t) {
                    <span class="tag-pill">{{ t }}</span>
                  }
                </div>
              }
            </div>
          </div>
        </header>

        <!-- ─────────────────── TWO-COLUMN LAYOUT ─────────────────── -->
        <div class="grid-2col">

          <!-- ─── LEFT: description + links + env table ─── -->
          <section class="space-y-5" appReveal>

            <article class="card">
              <h3 class="card-h">About</h3>
              <p class="text-[0.85rem] text-text-secondary leading-relaxed m-0">{{ a.description }}</p>
              <div class="meta-row">
                <a class="meta-link" [href]="a.homepage" target="_blank" rel="noopener noreferrer">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>
                  Homepage
                </a>
                <a class="meta-link" [href]="a.repo" target="_blank" rel="noopener noreferrer">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
                  Source
                </a>
                <span class="meta-pill"><span class="meta-pill-k">License</span> {{ a.license }}</span>
                <span class="meta-pill"><span class="meta-pill-k">Port</span> {{ a.port }}</span>
                <span class="meta-pill"><span class="meta-pill-k">RAM</span> {{ a.memoryMB }} MiB</span>
                @if (a.volumeMB) {
                  <span class="meta-pill"><span class="meta-pill-k">Disk</span> {{ a.volumeMB }} MiB</span>
                }
              </div>
            </article>

            <article class="card">
              <header class="flex items-center justify-between flex-wrap gap-2 mb-3">
                <h3 class="card-h m-0">Environment variables</h3>
                <span class="text-[0.66rem] text-text-secondary font-mono">{{ a.env.length }} keys · {{ requiredCount(a) }} required</span>
              </header>
              @if (a.env.length === 0) {
                <p class="text-[0.78rem] text-text-secondary m-0">No env vars required — container runs with defaults.</p>
              } @else {
                <div class="env-table" role="table">
                  <div class="env-row env-row-head" role="row">
                    <div role="columnheader">Key</div>
                    <div role="columnheader">Description</div>
                    <div role="columnheader" class="text-right">Source</div>
                  </div>
                  @for (e of a.env; track e.key) {
                    <div class="env-row" role="row">
                      <div role="cell">
                        <code class="env-key">{{ e.key }}</code>
                        @if (e.required) {
                          <span class="env-req" title="Required" aria-label="Required">*</span>
                        }
                      </div>
                      <div role="cell" class="env-desc">
                        {{ e.description }}
                        @if (e.default) {
                          <div class="env-default">default: <code>{{ e.default }}</code></div>
                        }
                      </div>
                      <div role="cell" class="text-right">
                        @if (e.auto) {
                          <span class="env-auto" [title]="autoSourceLabel(e.auto)">{{ autoSourceLabel(e.auto) }}</span>
                        } @else if (!e.required) {
                          <span class="env-optional">optional</span>
                        } @else {
                          <span class="env-manual">you provide</span>
                        }
                      </div>
                    </div>
                  }
                </div>
              }
            </article>

            <article class="card">
              <h3 class="card-h">Dockerfile</h3>
              <p class="text-[0.74rem] text-text-secondary leading-relaxed">
                Container image — pulled at boot:
              </p>
              <pre class="code-pre"><code>{{ dockerfilePreview() }}</code></pre>
              <div class="mt-3 flex items-center gap-2 flex-wrap">
                <a class="meta-link" [href]="a.repo" target="_blank" rel="noopener noreferrer">
                  Upstream README
                </a>
                @if (a.composeRef) {
                  <a class="meta-link" [href]="a.composeRef" target="_blank" rel="noopener noreferrer">Reference compose file</a>
                }
              </div>
            </article>
          </section>

          <!-- ─── RIGHT: deploy panel ─── -->
          <aside class="space-y-5">
            <article class="card deploy-card" appReveal>
              <h3 class="card-h">Deploy</h3>

              @if (supported()) {
              <label class="form-field">
                <span class="form-label">Subdomain</span>
                <div class="subdomain-input">
                  <input
                    type="text"
                    hlmInput
                    [seamless]="true"
                    class="subdomain-field flex-1"
                    [(ngModel)]="subdomain"
                    (ngModelChange)="onSubdomainChange($event)"
                    placeholder="my-{{ a.id }}"
                    aria-label="Subdomain"
                    pattern="[a-z0-9-]+"
                    data-testid="apps-deploy-subdomain" />
                  <span class="subdomain-suffix">.app.projectsites.dev</span>
                </div>
                @if (subdomainError()) {
                  <span class="form-help form-help--err">{{ subdomainError() }}</span>
                } @else {
                  <span class="form-help">Lowercase letters, digits, dashes. 3-40 chars.</span>
                }
              </label>

              <div class="checklist">
                <div class="checklist-h">Provisioning</div>
                @for (item of provisioning(); track item.key) {
                  <div class="check-row">
                    <span class="check-glyph" [class.is-managed]="item.managed">
                      @if (item.managed) {
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      } @else {
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      }
                    </span>
                    <span class="check-label">{{ item.label }}</span>
                    <span class="check-provider">{{ item.provider }}</span>
                  </div>
                }
              </div>

              <div class="cost-breakdown">
                <div class="cost-h">Monthly estimate</div>
                @for (line of costLines(); track line.key) {
                  <div class="cost-line">
                    <span class="cost-line-label">{{ line.label }}</span>
                    <span class="cost-line-value">$<app-rolling-counter [value]="line.monthlyUsd" /></span>
                  </div>
                }
                <div class="cost-total">
                  <span class="cost-total-label">Total</span>
                  <span class="cost-total-value">$<app-rolling-counter [value]="totalCost()" /><span class="cost-unit">/mo</span></span>
                </div>
              </div>

              <button
                type="button"
                class="btn-deploy"
                [disabled]="!canDeploy() || deploying()"
                (click)="deploy(a)"
                data-testid="apps-deploy-cta">
                @if (deploying()) {
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="spinning"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                  <span>Provisioning…</span>
                } @else {
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
                  <span>Deploy {{ a.name }}</span>
                }
              </button>

              @if (!canDeploy() && !deploying()) {
                <span class="form-help form-help--muted">
                  Fix the form to unlock deploy.
                </span>
              }
              } @else {
                <div class="soon-panel" data-testid="apps-deploy-soon" role="status">
                  <span class="soon-badge">Coming soon</span>
                  <p class="soon-title">{{ a.name }} isn't deployable yet</p>
                  <p class="soon-body">
                    This app is in the catalog as a preview. Its one-click runtime
                    container ships in a future drop — we'll light up Deploy here the
                    moment it's ready.
                  </p>
                </div>
              }
            </article>
          </aside>
        </div>
      } @else {
        <div class="card notice notice-red" role="alert">
          <strong>App not found.</strong>
          <span class="block text-[0.74rem] mt-1">No catalog entry with id <code class="font-mono">{{ appId() }}</code>.</span>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .kicker {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.6rem; font-weight: 700; letter-spacing: 0.14em;
      text-transform: uppercase; color: var(--ps-accent, #00E5FF); opacity: 0.85;
    }
    .section-h { font-family: 'Sora', system-ui, sans-serif; letter-spacing: -0.02em; }
    .card-h {
      font-family: 'Sora', system-ui, sans-serif;
      font-size: 0.78rem; font-weight: 700;
      color: var(--ps-ink, #fff); letter-spacing: 0.01em;
      margin: 0 0 0.7rem 0;
    }

    .back-link {
      display: inline-flex; align-items: center; gap: 5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em;
      color: rgba(255,255,255,0.62);
      text-decoration: none; padding: 4px 8px;
      border-radius: 6px; transition: color 140ms ease, background 140ms ease;
    }
    .back-link:hover { color: var(--ps-accent, #00E5FF); background: rgba(255,255,255,0.04); }
    .back-link:focus-visible { outline: var(--ps-ring-focus, 2px solid #00E5FF); outline-offset: 2px; }

    .detail-head { padding: 0; }
    .head-main {
      display: flex; align-items: flex-start; gap: 1rem;
      padding: 1.2rem;
      background: var(--ps-surface-1, rgba(13,13,40,0.62));
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: var(--ps-radius-xl, 22px);
    }
    .head-glyph {
      flex-shrink: 0;
      width: 64px; height: 64px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 2.2rem; line-height: 1;
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 10%, transparent);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 24%, transparent);
      border-radius: var(--ps-radius-sm, 12px);
    }

    .tag-row { display: flex; flex-wrap: wrap; gap: 4px; }
    .tag-pill {
      padding: 2px 8px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.62rem; font-weight: 600;
      color: rgba(255,255,255,0.65);
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 999px;
    }

    .grid-2col {
      display: grid; gap: 1.25rem;
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    }
    @media (max-width: 1000px) {
      .grid-2col { grid-template-columns: 1fr; }
    }

    .card {
      background: var(--ps-surface-1, rgba(13,13,40,0.62));
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: var(--ps-radius-lg, 14px);
      padding: 1.2rem;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
    }

    .meta-row {
      display: flex; flex-wrap: wrap; gap: 6px;
      margin-top: 0.85rem;
    }
    .meta-link {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 10px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 999px;
      color: var(--ps-accent, #00E5FF);
      font-size: 0.7rem; font-weight: 600;
      text-decoration: none;
      transition: background 140ms ease, border-color 140ms ease;
    }
    .meta-link:hover { background: color-mix(in oklch, var(--ps-accent, #00E5FF) 8%, rgba(255,255,255,0.04)); border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 35%, transparent); }
    .meta-pill {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 10px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 999px;
      color: rgba(255,255,255,0.74);
      font-size: 0.7rem;
    }
    .meta-pill-k {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.08em;
      color: rgba(255,255,255,0.48);
    }

    /* ─── Env table ─── */
    .env-table {
      display: flex; flex-direction: column; gap: 0;
      border-radius: var(--ps-radius-sm, 8px); overflow: hidden;
      border: 1px solid rgba(255,255,255,0.06);
    }
    .env-row {
      display: grid;
      grid-template-columns: minmax(120px, 1fr) minmax(200px, 2fr) minmax(100px, auto);
      gap: 0.85rem; align-items: start;
      padding: 0.65rem 0.85rem;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      font-size: 0.74rem;
    }
    .env-row:last-child { border-bottom: none; }
    .env-row-head {
      background: rgba(255,255,255,0.03);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em;
      color: rgba(255,255,255,0.48); font-weight: 700;
    }
    .env-key {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.72rem; color: var(--ps-accent, #00E5FF);
      background: rgba(0,229,255,0.08);
      padding: 1px 6px; border-radius: 4px; word-break: break-all;
    }
    .env-req { color: #fbbf24; margin-left: 4px; font-weight: 700; }
    .env-desc { color: rgba(255,255,255,0.78); line-height: 1.45; }
    .env-default {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.62rem; color: rgba(255,255,255,0.5); margin-top: 2px;
    }
    .env-auto, .env-optional, .env-manual {
      display: inline-flex; align-items: center;
      padding: 2px 7px; border-radius: 999px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.6rem; font-weight: 600; white-space: nowrap;
    }
    .env-auto {
      color: #34d399;
      background: rgba(52,211,153,0.1);
      border: 1px solid rgba(52,211,153,0.28);
    }
    .env-optional { color: rgba(255,255,255,0.45); border: 1px solid rgba(255,255,255,0.08); }
    .env-manual { color: #fbbf24; background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.22); }

    /* ─── Code preview ─── */
    .code-pre {
      background: rgba(0,0,0,0.42);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: var(--ps-radius-sm, 8px);
      padding: 0.85rem 1rem;
      overflow-x: auto;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.72rem; line-height: 1.6;
      color: rgba(255,255,255,0.86);
      white-space: pre;
    }

    /* ─── Deploy panel ─── */
    .deploy-card {
      position: sticky; top: 1rem;
      display: flex; flex-direction: column; gap: 1.1rem;
    }

    /* Soon (catalog-placeholder) apps: no deploy form, an honest coming-soon note. */
    .soon-panel {
      display: flex; flex-direction: column; gap: 0.5rem;
      padding: 1.1rem 1rem;
      border: 1px dashed color-mix(in oklch, var(--ps-accent, #00E5FF) 32%, transparent);
      border-radius: 12px;
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 5%, transparent);
    }
    .soon-badge {
      align-self: flex-start;
      font-size: 0.6rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
      padding: 2px 8px; border-radius: 999px;
      color: var(--ps-accent, #00E5FF);
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 14%, transparent);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 30%, transparent);
    }
    .soon-title { margin: 0; font-size: 0.86rem; font-weight: 600; color: #fff; }
    .soon-body { margin: 0; font-size: 0.74rem; line-height: 1.5; color: rgba(255,255,255,0.6); }

    .form-field { display: flex; flex-direction: column; gap: 6px; }
    .form-label {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.1em;
      color: rgba(255,255,255,0.55); font-weight: 700;
    }
    .form-help { font-size: 0.66rem; color: rgba(255,255,255,0.5); }
    .form-help--err { color: #fca5a5; }
    .form-help--muted { color: rgba(255,255,255,0.4); }

    .subdomain-input {
      display: flex; align-items: stretch;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: var(--ps-radius-sm, 8px);
      background: rgba(0,0,0,0.32);
      transition: border-color 140ms ease;
      overflow: hidden;
    }
    .subdomain-input:focus-within {
      border-color: color-mix(in oklch, var(--ps-accent, #00E5FF) 50%, transparent);
    }
    /* seamless segment inside .subdomain-input; hlmInput [seamless] owns
       border/bg/outline — this only carries padding + mono type + color */
    .subdomain-field {
      padding: 0.55rem 0.7rem;
      color: var(--ps-ink, #fff);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.74rem;
      min-width: 0;
    }
    .subdomain-suffix {
      display: inline-flex; align-items: center;
      padding: 0.55rem 0.7rem;
      background: rgba(255,255,255,0.04);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.7rem; color: rgba(255,255,255,0.55);
      border-left: 1px solid rgba(255,255,255,0.08);
      white-space: nowrap;
    }

    /* ─── Provisioning checklist ─── */
    .checklist { display: flex; flex-direction: column; gap: 0; }
    .checklist-h {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.1em;
      color: rgba(255,255,255,0.55); font-weight: 700;
      margin-bottom: 6px;
    }
    .check-row {
      display: grid;
      grid-template-columns: 18px 1fr auto;
      gap: 8px; align-items: center;
      padding: 0.4rem 0; font-size: 0.74rem;
      border-bottom: 1px dashed rgba(255,255,255,0.04);
    }
    .check-row:last-child { border-bottom: none; }
    .check-glyph {
      width: 18px; height: 18px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 50%;
      background: rgba(251,191,36,0.12); color: #fbbf24;
      border: 1px solid rgba(251,191,36,0.32);
    }
    .check-glyph.is-managed {
      background: rgba(52,211,153,0.14); color: #34d399;
      border-color: rgba(52,211,153,0.36);
    }
    .check-label { color: var(--ps-ink, #fff); font-weight: 600; }
    .check-provider {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.62rem; color: rgba(255,255,255,0.55);
    }

    /* ─── Cost breakdown ─── */
    .cost-breakdown {
      padding: 0.85rem 1rem;
      background: color-mix(in oklch, var(--ps-accent, #00E5FF) 4%, transparent);
      border: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 16%, transparent);
      border-radius: var(--ps-radius-sm, 10px);
    }
    .cost-h {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.1em;
      color: rgba(255,255,255,0.55); font-weight: 700; margin-bottom: 6px;
    }
    .cost-line {
      display: flex; justify-content: space-between; align-items: baseline;
      font-size: 0.74rem; padding: 4px 0;
    }
    .cost-line-label { color: rgba(255,255,255,0.7); }
    .cost-line-value {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--ps-ink, #fff); font-weight: 600;
    }
    .cost-total {
      display: flex; justify-content: space-between; align-items: baseline;
      padding-top: 8px; margin-top: 6px;
      border-top: 1px solid color-mix(in oklch, var(--ps-accent, #00E5FF) 22%, transparent);
    }
    .cost-total-label {
      font-family: 'Sora', system-ui, sans-serif; font-size: 0.78rem;
      color: var(--ps-ink, #fff); font-weight: 600;
    }
    .cost-total-value {
      font-family: 'Sora', system-ui, sans-serif; font-size: 1.15rem;
      font-weight: 700; color: var(--ps-accent, #00E5FF);
    }
    .cost-unit { font-size: 0.62rem; color: rgba(255,255,255,0.5); font-weight: 500; margin-left: 2px; }

    /* ─── Buttons ─── */
    .btn-deploy {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      width: 100%;
      padding: 0.85rem 1.2rem;
      border-radius: var(--ps-radius-sm, 10px);
      background: linear-gradient(135deg, var(--ps-accent, #00E5FF) 0%, color-mix(in oklch, var(--ps-accent, #00E5FF) 70%, #7c3aed) 100%);
      color: #060610;
      font-family: 'Sora', system-ui, sans-serif;
      font-size: 0.82rem; font-weight: 700;
      border: none; cursor: pointer;
      box-shadow: 0 8px 24px -10px color-mix(in oklch, var(--ps-accent, #00E5FF) 55%, transparent);
      transition: transform 140ms ease, box-shadow 140ms ease, filter 140ms ease;
    }
    .btn-deploy:hover:not(:disabled) {
      transform: translateY(-1px);
      filter: brightness(1.08);
      box-shadow: 0 12px 32px -10px color-mix(in oklch, var(--ps-accent, #00E5FF) 70%, transparent);
    }
    .btn-deploy:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
    .btn-deploy:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }

    .spinning { animation: spin 900ms linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }

    .notice {
      display: flex; gap: 0.6rem; align-items: flex-start;
      font-size: 0.82rem; line-height: 1.5;
      padding: 0.85rem 1rem;
    }
    .notice strong { display: block; }
    .notice-red {
      background: rgba(248,113,113,0.06);
      border-color: rgba(248,113,113,0.3);
      color: #fecaca;
    }
    .notice-red strong { color: #fca5a5; }
  `],
})
export class AppDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private state = inject(AdminStateService);

  appId = signal<string>('');
  app = signal<CatalogApp | null>(null);
  subdomain = '';
  deploying = signal<boolean>(false);

  private subdomainTouched = signal<boolean>(false);
  private subdomainSignal = signal<string>('');

  /** Per-line cost breakdown — container + every infra provider. */
  costLines = computed<readonly InfraEstimate[]>(() => {
    const a = this.app();
    if (!a) return [];
    const container: InfraEstimate = {
      key: 'container',
      label: 'Container (Cloudflare Workers)',
      provider: 'CFC',
      monthlyUsd: Math.max(1, a.estCostMonthly - this.sumInfra(a)),
    };
    const infra = a.infra.map((d) => INFRA_PROVIDER_COST[d]);
    return [container, ...infra];
  });

  totalCost = computed<number>(() => this.costLines().reduce((acc, l) => acc + l.monthlyUsd, 0));

  /**
   * Synthetic Dockerfile shown on the detail page. Built off-template so
   * `}` in template literals doesn't collide with Angular's @-block syntax.
   */
  dockerfilePreview = computed<string>(() => {
    const a = this.app();
    if (!a) return '';
    const envLines = a.env.map((e) => {
      const value = e.auto ? `<from-${e.auto}>` : e.default ?? '<configured-at-deploy>';
      return `ENV ${e.key}=${value}`;
    });
    return [
      `FROM ${a.image}`,
      '',
      `EXPOSE ${a.port}`,
      '',
      '# Auto-resolved by the deploy pipeline:',
      ...envLines,
    ].join('\n');
  });

  /** Provisioning checklist — every infra dep + whether the platform manages it. */
  provisioning = computed<ReadonlyArray<{ key: string; label: string; provider: string; managed: boolean }>>(() => {
    const a = this.app();
    if (!a) return [];
    return a.infra.map((d) => ({
      key: d,
      label: INFRA_META[d].label,
      provider: INFRA_PROVIDER_COST[d].provider,
      managed: d !== 'mailrelay',
    }));
  });

  subdomainError = computed<string | null>(() => {
    if (!this.subdomainTouched()) return null;
    const v = this.subdomainSignal().trim();
    if (!v) return 'Subdomain is required.';
    if (v.length < 3) return 'Min 3 characters.';
    if (v.length > 40) return 'Max 40 characters.';
    if (!/^[a-z0-9-]+$/.test(v)) return 'Lowercase letters, digits, and dashes only.';
    if (v.startsWith('-') || v.endsWith('-')) return 'Cannot start or end with a dash.';
    return null;
  });

  canDeploy = computed<boolean>(() => {
    const v = this.subdomainSignal().trim();
    return v.length >= 3 && v.length <= 40 && /^[a-z0-9-]+$/.test(v) && !v.startsWith('-') && !v.endsWith('-');
  });

  /** Live (deployable today) vs Soon (catalog placeholder — no runtime container yet). */
  readonly supported = computed<boolean>(() => {
    const a = this.app();
    return !!a && isAppSupported(a.id);
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.appId.set(id);
    const found = APPS_CATALOG.find((a) => a.id === id) ?? null;
    this.app.set(found);
    if (found) {
      this.subdomain = `${found.id}-${this.shortSlug()}`;
      this.subdomainSignal.set(this.subdomain);
    }
  }

  onSubdomainChange(value: string): void {
    this.subdomainTouched.set(true);
    this.subdomainSignal.set(value);
  }

  categoryLabel(a: CatalogApp): string {
    return a.category.charAt(0).toUpperCase() + a.category.slice(1);
  }

  requiredCount(a: CatalogApp): number {
    return a.env.filter((e) => e.required).length;
  }

  autoSourceLabel(auto: NonNullable<CatalogApp['env'][number]['auto']>): string {
    switch (auto) {
      case 'postgres_url': return 'auto · postgres';
      case 'redis_url':    return 'auto · redis';
      case 's3_url':       return 'auto · r2';
      case 'public_url':   return 'auto · domain';
      case 'secret':       return 'auto · secret';
      default:             return 'auto';
    }
  }

  private sumInfra(a: CatalogApp): number {
    return a.infra.reduce((acc, d) => acc + INFRA_PROVIDER_COST[d].monthlyUsd, 0);
  }

  private shortSlug(): string {
    const s = this.state.selectedSite();
    if (!s) return 'app';
    return (s.slug || s.business_name || 'app').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 12).replace(/-+$/, '');
  }

  /**
   * POST `/api/apps/instances` and route to the boot-progress detail.
   *
   * The worker-side handler is wired by the backend agent — failures
   * surface via the standard toast pipeline.
   */
  deploy(a: CatalogApp): void {
    // Soon apps have no runtime container yet — never POST a doomed deploy.
    if (!isAppSupported(a.id) || !this.canDeploy() || this.deploying()) return;
    this.deploying.set(true);
    const payload = {
      app_id: a.id,
      subdomain: this.subdomain.trim(),
      env_overrides: {} as Record<string, string>,
    };
    this.api.post<{ instance_id: string }>('/apps/instances', payload).subscribe({
      next: (r) => {
        this.deploying.set(false);
        const id = r.instance_id;
        this.toast.success(`${a.name} provisioning — booting container`);
        if (id) {
          this.router.navigate(['/admin/apps/instances', id]);
        } else {
          this.router.navigate(['/admin/apps/instances']);
        }
      },
      error: () => {
        this.deploying.set(false);
        // Error toast handled inside ApiService — no double-fire here.
        console.warn('[apps] deploy failed', a.id);
      },
    });
  }
}
