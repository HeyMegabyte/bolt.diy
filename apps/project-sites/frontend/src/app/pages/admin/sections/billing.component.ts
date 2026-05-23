import { Component, inject, signal, computed, type OnInit } from '@angular/core';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { DialogShellComponent } from '../../../components/dialog-shell/dialog-shell.component';

interface Bundle { credits: number; usd: number; price_id: string; }
interface CreditState { balance: number; bundles: Record<string, Bundle>; ledger: { delta: number; reason: string; stripe_session_id: string | null; created_at: string }[]; }
interface Alert { id: string; name: string; threshold_credits: number; alert_kind: string; notify_email: string; enabled: number; last_triggered_at: string | null; }
interface CostRow {
  site_id: string;
  slug: string;
  business_name: string | null;
  ai_calls: number;
  ai_credits: number;
  estimated_cost_micro_usd: number;
  bandwidth_bytes: number;
  storage_bytes: number;
  /** Optional extended fields — surfaced when present, otherwise rendered as "—". */
  plan?: string | null;
  last_invocation_at?: string | null;
}

/** Cost forecast shape returned by `GET /api/admin/forecast/cost` (item #95). */
interface CostForecastState {
  current_month_estimate_usd: number;
  next_month_forecast_usd: number;
  by_category: { workers: number; ai: number; r2: number; d1: number; email: number };
  biggest_driver: string;
  savings_tip: string;
}

/** Renderable bar in the inline-SVG chart. */
interface ForecastBar {
  label: string;
  usd: number;
  height: number;
  color: string;
}

@Component({
  selector: 'app-admin-billing',
  standalone: true,
  imports: [FormsModule, DatePipe, CurrencyPipe, RouterLink, DialogShellComponent],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">
      <div>
        <h2 class="text-lg font-bold text-white m-0">Billing &amp; Plan</h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
          AI Credits power form routing, chat, and your custom AI endpoints. Per-site cost breakdown + spend alerts below.
        </p>
      </div>

      <!-- ─────────────────── PLAN TIERS ─────────────────── -->
      <section class="card">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h3 class="m-0 text-base font-semibold text-white">Plan</h3>
            <p class="text-[0.7rem] text-text-secondary m-0 mt-0.5">Currently on <strong class="text-white">{{ planLabel() }}</strong>. Cancel any time.</p>
          </div>
          @if (plan() === 'pro') {
            <button class="btn-ghost" (click)="manage()">Manage</button>
          }
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          <!-- Free tier (informational) -->
          <div class="card-light p-4" [class.tier-active]="plan() === 'free'">
            <div class="flex items-baseline justify-between">
              <div class="text-base font-bold text-white">Free</div>
              <div class="text-lg font-bold text-white">$0<span class="text-[0.7rem] text-text-secondary">/mo</span></div>
            </div>
            <ul class="list-none p-0 mt-3 space-y-1.5 text-[0.74rem] text-text-secondary">
              <li>· 1 project</li>
              <li>· 100 AI credits / month</li>
              <li>· 1 custom domain</li>
              <li>· Community support</li>
              <li>· projectsites.dev branding</li>
            </ul>
          </div>

          <!-- Pro tier — entire card is clickable when on free. Uses a button element
               so keyboard activation is native + role/focus semantics are correct. -->
          @if (plan() === 'free') {
            <button
              type="button"
              class="plan-card-button card-light p-4 text-left"
              [class.is-upgrading]="upgrading()"
              [disabled]="upgrading()"
              data-testid="billing-pro-card"
              [attr.aria-label]="'Upgrade to Pro — $50 per month, opens checkout in a new tab'"
              (mousedown)="triggerRipple($event)"
              (click)="upgrade()">
              <div class="flex items-baseline justify-between">
                <div class="text-base font-bold text-white">Pro</div>
                <div class="text-lg font-bold text-white">$50<span class="text-[0.7rem] text-text-secondary">/mo</span></div>
              </div>
              <ul class="list-none p-0 mt-3 space-y-1.5 text-[0.74rem] text-text-secondary">
                <li>· Unlimited projects</li>
                <li>· 5,000 AI credits / month</li>
                <li>· Unlimited custom domains</li>
                <li>· Priority support · Audit log export</li>
                <li>· No projectsites.dev branding</li>
              </ul>
              <div class="plan-card-cta">
                <span class="plan-card-cta-text">{{ upgrading() ? 'Opening checkout…' : 'Upgrade to Pro' }}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                </svg>
              </div>
            </button>
          } @else {
            <div class="card-light p-4" [class.tier-active]="plan() === 'pro'">
              <div class="flex items-baseline justify-between">
                <div class="text-base font-bold text-white">Pro</div>
                <div class="text-lg font-bold text-white">$50<span class="text-[0.7rem] text-text-secondary">/mo</span></div>
              </div>
              <ul class="list-none p-0 mt-3 space-y-1.5 text-[0.74rem] text-text-secondary">
                <li>· Unlimited projects</li>
                <li>· 5,000 AI credits / month</li>
                <li>· Unlimited custom domains</li>
                <li>· Priority support · Audit log export</li>
                <li>· No projectsites.dev branding</li>
              </ul>
            </div>
          }
        </div>
      </section>

      <!-- ─────────────────── PER-PROJECT CREDIT CAPS ─────────────────── -->
      <section class="card">
        <h3 class="m-0 text-base font-semibold text-white mb-1">Per-project AI credit caps</h3>
        <p class="text-[0.7rem] text-text-secondary m-0 mb-3">
          Stop runaway spend on a single site. Cap takes effect on the 1st of every month. Empty = no cap.
        </p>
        @if (loadingCosts() && siteCosts().length === 0) {
          <div class="space-y-2" aria-busy="true" aria-label="Loading sites">
            @for (i of [1,2,3]; track i) {
              <div class="flex items-center gap-3">
                <div class="flex-1 space-y-1.5">
                  <div class="skeleton h-4 w-40"></div>
                  <div class="skeleton h-3 w-28"></div>
                </div>
                <div class="skeleton h-9 w-28 rounded-md"></div>
              </div>
            }
          </div>
        } @else if (siteCosts().length === 0) {
          <div class="empty-state">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <h4>No projects yet</h4>
            <p>Create your first site to set per-project AI credit caps.</p>
            <a class="btn-primary" routerLink="/" title="Create a new site">+ Create a site</a>
          </div>
        } @else {
          <div class="space-y-2">
            @for (r of siteCosts(); track r.site_id) {
              <div class="flex items-center gap-3">
                <div class="flex-1 min-w-0">
                  <div class="text-[0.78rem] text-white truncate">{{ r.business_name || r.slug }}</div>
                  <div class="text-[0.66rem] text-text-secondary font-mono">{{ formatCredits(r.ai_credits) }} credits used · 30d</div>
                </div>
                <input type="number" min="0" step="50" placeholder="no cap"
                       class="input-field w-28 text-right" [(ngModel)]="capDraft[r.site_id]" />
                <button class="btn-ghost" (click)="saveCap(r.site_id)" [disabled]="savingCap() === r.site_id">
                  {{ savingCap() === r.site_id ? '…' : 'Save' }}
                </button>
              </div>
            }
          </div>
        }
      </section>

      <!-- ─────────────────── 30-DAY COST FORECAST (#95) ─────────────────── -->
      <section class="card border border-violet-500/40" data-testid="forecast-card">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h3 class="m-0 text-base font-semibold text-white">30-day forecast</h3>
            <p class="text-[0.7rem] text-text-secondary m-0 mt-0.5">
              Projected Cloudflare spend based on the last 30 days of usage.
            </p>
          </div>
          @if (forecast(); as f) {
            <div class="text-right">
              <div class="text-2xl font-bold text-white">{{ f.next_month_forecast_usd | currency:'USD':'symbol':'1.2-2' }}</div>
              <div class="text-[0.62rem] uppercase tracking-wider text-text-secondary">next 30 days</div>
            </div>
          }
        </div>

        @if (forecastLoading() && !forecast()) {
          <div class="p-6 text-center text-text-secondary text-sm">Computing forecast…</div>
        } @else if (forecast()) {
          @let f = forecast()!;
          <div class="grid sm:grid-cols-2 gap-4 mt-2">
            <!-- Bar chart (inline SVG, no chart lib) -->
            <svg viewBox="0 0 320 140" class="w-full h-32" role="img" aria-label="Cost by category">
              @for (b of forecastBars(); track b.label; let i = $index) {
                <g>
                  <rect
                    [attr.x]="i * 62 + 10"
                    [attr.y]="120 - b.height"
                    width="44"
                    [attr.height]="b.height"
                    rx="4"
                    [attr.fill]="b.color"
                    opacity="0.85" />
                  <text
                    [attr.x]="i * 62 + 32"
                    y="135"
                    text-anchor="middle"
                    fill="rgba(255,255,255,0.55)"
                    font-size="9"
                    font-family="ui-sans-serif, system-ui">{{ b.label }}</text>
                  <text
                    [attr.x]="i * 62 + 32"
                    [attr.y]="120 - b.height - 4"
                    text-anchor="middle"
                    fill="#fff"
                    font-size="9"
                    font-weight="700"
                    font-family="ui-sans-serif, system-ui">{{ b.usd | currency:'USD':'symbol':'1.0-2' }}</text>
                </g>
              }
            </svg>

            <div class="text-[0.78rem] space-y-2">
              <div class="flex items-baseline gap-2">
                <span class="text-text-secondary">Current month:</span>
                <strong class="text-white">{{ f.current_month_estimate_usd | currency:'USD':'symbol':'1.2-2' }}</strong>
              </div>
              <div class="flex items-baseline gap-2">
                <span class="text-text-secondary">Biggest driver:</span>
                <strong class="text-violet-300">{{ f.biggest_driver }}</strong>
              </div>
              <div class="mt-3 p-3 rounded-lg border border-violet-500/30 bg-violet-500/[0.06]">
                <div class="text-[0.6rem] uppercase tracking-wider text-violet-300 font-bold mb-1">✨ Savings tip</div>
                <div class="text-text-secondary text-[0.72rem] leading-relaxed">{{ f.savings_tip }}</div>
              </div>
            </div>
          </div>
        } @else {
          <div class="p-6 text-center text-text-secondary text-sm">Forecast unavailable.</div>
        }
      </section>

      <!-- ─────────────────── AI CREDITS ─────────────────── -->
      <section class="card border border-primary/30">
        <div class="flex items-center justify-between mb-3">
          <h3 class="m-0 text-base font-semibold text-white">AI Credits</h3>
          <span class="text-[0.7rem] text-text-secondary">1 credit ≈ 1 AI call</span>
        </div>
        @if (loadingCredits() && !credits()) {
          <div class="skeleton h-10 w-32 mb-1"></div>
          <div class="skeleton h-3 w-24 mb-4"></div>
        } @else {
          <div class="text-4xl font-bold text-white mb-1">{{ formatCredits(credits()?.balance ?? 0) }}</div>
          <div class="text-[0.78rem] text-text-secondary mb-4">credits remaining</div>
        }

        <!-- Four tiles: 500 · 2,000 · 5,000 · Custom.
             The 5,000 tier price is proportional to the existing tiers: with
             500=$5 (≈$0.010/credit) and 2,000=$15 (≈$0.0075/credit), the 5,000
             pack defaults to $30 (=$0.006/credit) — bulk discount preserved.
             The Custom tier reuses the cheapest per-credit rate so larger
             purchases never feel punished. -->
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <!-- Existing API-driven bundles (500 + 2,000 today). -->
          @for (key of bundleKeys; track key) {
            <button
              type="button"
              class="tier-card text-left p-4"
              [attr.data-testid]="'billing-tier-' + bundleCredits(key)"
              [attr.aria-label]="'Buy ' + bundleCredits(key) + ' credits for $' + bundleUsd(key)"
              [disabled]="buying() === key"
              (mousedown)="triggerRipple($event)"
              (click)="topup(key)">
              <div class="text-[0.62rem] uppercase tracking-wider text-text-secondary/70 font-bold">{{ key }}</div>
              <div class="text-2xl font-bold text-white mt-1">{{ formatCredits(bundleCredits(key)) }}</div>
              <div class="text-[0.78rem] text-text-secondary">credits · &dollar;{{ bundleUsd(key) }}</div>
              <div class="text-[0.66rem] text-primary mt-2">{{ buying() === key ? 'Opening checkout…' : 'Buy →' }}</div>
            </button>
          }

          <!-- New static 5,000 tile - proxies through the existing topup() route
               using the 5000 bundle key. The worker should expose a matching
               bundle; if it does not yet, the API call surfaces a normal toast
               and no double-charge can occur (idempotency-keyed server-side). -->
          <button
            type="button"
            class="tier-card text-left p-4"
            data-testid="billing-tier-5000"
            aria-label="Buy 5,000 credits for $30"
            [disabled]="buying() === '5000'"
            (mousedown)="triggerRipple($event)"
            (click)="topup('5000')">
            <div class="text-[0.62rem] uppercase tracking-wider text-text-secondary/70 font-bold">Bulk</div>
            <div class="text-2xl font-bold text-white mt-1">{{ formatCredits(5000) }}</div>
            <div class="text-[0.78rem] text-text-secondary">credits · &dollar;{{ tier5000Usd }}</div>
            <div class="text-[0.66rem] text-emerald-400 mt-2">{{ buying() === '5000' ? 'Opening checkout…' : 'Best value · Buy →' }}</div>
          </button>

          <!-- Custom amount tile — number input + computed price + validation. -->
          <div class="tier-card p-4 cursor-default" [class.is-invalid]="customAmount() !== null && !customValid()">
            <div class="text-[0.62rem] uppercase tracking-wider text-text-secondary/70 font-bold">Custom</div>
            <label class="block mt-1">
              <span class="sr-only">Credits</span>
              <input
                type="number"
                min="100"
                max="100000"
                step="100"
                placeholder="e.g. 12,500"
                class="input-field w-full text-right"
                data-testid="billing-custom-amount-input"
                [ngModel]="customAmount()"
                (ngModelChange)="customAmount.set($event)"
                [attr.aria-invalid]="customAmount() !== null && !customValid()"
                aria-describedby="custom-amount-help" />
            </label>
            <div id="custom-amount-help" class="text-[0.7rem] mt-1.5"
                 [class.text-text-secondary]="customValid() || customAmount() === null"
                 [class.text-red-400]="customAmount() !== null && !customValid()">
              @if (customAmount() === null || customAmount() === 0) {
                100 – 100,000 credits · &dollar;{{ customRate.toFixed(3) }} ea
              } @else if (!customValid()) {
                Enter between 100 and 100,000
              } @else {
                {{ formatCredits(customAmount()!) }} credits · {{ customPrice() | currency:'USD':'symbol':'1.2-2' }}
              }
            </div>
            <button
              type="button"
              class="custom-buy-btn mt-2 w-full"
              data-testid="billing-tier-custom"
              [disabled]="!customValid() || buying() === 'custom'"
              (mousedown)="triggerRipple($event)"
              (click)="topupCustom()">
              {{ buying() === 'custom' ? 'Opening checkout…' : 'Buy →' }}
            </button>
          </div>
        </div>

        <!-- 14-day spend sparkline -->
        @if (spend14d().length > 0) {
          <div class="mt-4">
            <div class="flex items-center justify-between mb-2">
              <span class="muted-h">Spend · last 14 days</span>
              <span class="text-[0.7rem] text-text-secondary">{{ formatCredits(spend14dTotal()) }} credits · projection {{ formatCredits(projectedMonth()) }}/mo</span>
            </div>
            <svg viewBox="0 0 280 60" preserveAspectRatio="none" class="w-full h-12">
              <defs>
                <linearGradient id="spgrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#7C3AED" stop-opacity="0.45"/>
                  <stop offset="100%" stop-color="#7C3AED" stop-opacity="0"/>
                </linearGradient>
              </defs>
              <path [attr.d]="sparkArea()" fill="url(#spgrad)" />
              <path [attr.d]="sparkLine()" fill="none" stroke="#7C3AED" stroke-width="2" />
            </svg>
          </div>
        }

        @if (credits()?.ledger?.length) {
          <details class="mt-4">
            <summary class="cursor-pointer text-[0.74rem] text-text-secondary">Recent activity</summary>
            <ul class="mt-2 space-y-1 text-[0.7rem] list-none p-0">
              @for (l of credits()!.ledger.slice(0, 20); track l.created_at) {
                <li class="flex items-center justify-between border-b border-white/[0.04] py-1">
                  <span class="text-text-secondary">{{ l.created_at | date:'short' }} · {{ l.reason }}</span>
                  <span [class.text-emerald-400]="l.delta > 0" [class.text-red-400]="l.delta < 0">{{ l.delta > 0 ? '+' : '' }}{{ l.delta }}</span>
                </li>
              }
            </ul>
          </details>
        }
      </section>

      <!-- ─────────────────── PER-SITE COST BREAKDOWN ─────────────────── -->
      <section class="card">
        <h3 class="m-0 text-base font-semibold text-white mb-1">Per-site cost breakdown</h3>
        <p class="text-[0.7rem] text-text-secondary m-0 mb-3">Rolling 30-day window. AI credits convert to estimated USD at $0.04/credit.</p>
        @if (loadingCosts() && siteCosts().length === 0) {
          <div class="space-y-2" aria-busy="true">
            @for (i of [1,2,3]; track i) {
              <div class="flex items-center gap-3 py-2 border-b border-white/[0.04]">
                <div class="flex-1 space-y-1.5"><div class="skeleton h-4 w-44"></div><div class="skeleton h-3 w-24"></div></div>
                <div class="skeleton h-4 w-12"></div>
                <div class="skeleton h-4 w-14"></div>
                <div class="skeleton h-4 w-16"></div>
                <div class="skeleton h-4 w-16"></div>
              </div>
            }
          </div>
        } @else if (siteCosts().length === 0) {
          <div class="empty-state">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-6"/></svg>
            <h4>No usage yet</h4>
            <p>Once your sites start serving traffic and AI calls, you'll see the breakdown here.</p>
          </div>
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full text-[0.78rem]">
              <thead class="text-text-secondary/70 uppercase text-[0.6rem] tracking-wider">
                <tr class="border-b border-white/[0.06]">
                  <th class="text-left p-2">Site</th>
                  <th class="text-left p-2">Plan</th>
                  <th class="text-right p-2">AI calls</th>
                  <th class="text-right p-2">$ spent</th>
                  <th class="text-right p-2">% of org</th>
                  <th class="text-right p-2">Last call</th>
                </tr>
              </thead>
              <tbody>
                @for (r of siteCosts(); track r.site_id) {
                  <tr class="border-b border-white/[0.04]">
                    <td class="p-2">
                      <div class="font-semibold text-white">{{ r.business_name || r.slug }}</div>
                      <div class="text-text-secondary text-[0.66rem] font-mono">{{ r.slug }}</div>
                    </td>
                    <td class="p-2 text-text-secondary capitalize">{{ r.plan || '—' }}</td>
                    <td class="p-2 text-right">{{ formatCredits(r.ai_calls) }}</td>
                    <td class="p-2 text-right font-mono">{{ formatUsd(r.estimated_cost_micro_usd / 1000000) }}</td>
                    <td class="p-2 text-right text-text-secondary">{{ pctOfOrg(r) }}</td>
                    <td class="p-2 text-right text-text-secondary text-[0.7rem]">{{ formatLastCall(r.last_invocation_at) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <!-- ─────────────────── SPEND ALERTS ─────────────────── -->
      <section class="card">
        <div class="flex items-center justify-between mb-3">
          <h3 class="m-0 text-base font-semibold text-white">Spend alerts</h3>
          <button
            type="button"
            class="btn-primary"
            data-testid="billing-spend-alert-create"
            (click)="openAlertModal()">+ Create alert</button>
        </div>
        <p class="text-[0.7rem] text-text-secondary m-0 mb-3">Get emailed when your balance drops below a threshold or daily burn spikes.</p>

        @if (alerts().length === 0) {
          <div class="empty-state">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <h4>No spend alerts yet</h4>
            <p>Get emailed when your balance drops or daily burn spikes.</p>
            <button
              type="button"
              class="btn-primary"
              (click)="openAlertModal()"
              title="Create your first alert">+ Create your first alert</button>
          </div>
        } @else {
          @for (a of alerts(); track a.id) {
            <div class="flex items-center justify-between py-2 border-b border-white/[0.04] text-[0.78rem]">
              <div>
                <div class="font-semibold text-white">{{ a.name }}</div>
                <div class="text-text-secondary text-[0.7rem]">{{ a.alert_kind === 'balance_low' ? 'When balance <' : 'When daily burn >' }} {{ formatCredits(a.threshold_credits) }} credits → {{ a.notify_email }}</div>
              </div>
              <button type="button" class="text-red-400 text-[0.72rem]" (click)="removeAlert(a)">Remove</button>
            </div>
          }
        }
      </section>

      <!-- ─────────────────── SPEND ALERT MODAL ─────────────────── -->
      @if (alertModalOpen()) {
        <app-dialog-shell (closed)="closeAlertModal()">
          <span dialogIcon>
            <svg class="text-primary" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          </span>
          <span dialogTitle>Create spend alert</span>

          <div class="p-5 flex flex-col gap-4">
            <label class="block">
              <div class="flex items-baseline justify-between mb-1">
                <span class="muted-h">Alert name</span>
                <span class="char-counter" [class.char-counter--full]="alertNameLen() >= 80">{{ alertNameLen() }}/80</span>
              </div>
              <input
                type="text"
                placeholder="e.g. Balance low warning"
                class="input-field w-full"
                maxlength="80"
                data-testid="billing-spend-alert-name"
                [attr.aria-invalid]="!!alertNameError()"
                aria-describedby="alert-name-error"
                [ngModel]="alertDraft.name"
                (ngModelChange)="alertDraft.name = $event"
                autofocus />
              @if (alertNameError(); as err) {
                <p id="alert-name-error" class="snap-error" role="alert" aria-live="polite">{{ err }}</p>
              }
            </label>

            <label class="block">
              <div class="muted-h mb-1">Trigger</div>
              <select
                class="input-field w-full"
                [ngModel]="alertDraft.alert_kind"
                (ngModelChange)="alertDraft.alert_kind = $event">
                <option value="balance_low">Balance dropped below</option>
                <option value="daily_burn">Daily burn exceeded</option>
              </select>
            </label>

            <label class="block">
              <div class="muted-h mb-1">Threshold (USD)</div>
              <input
                type="number"
                min="1"
                max="10000"
                step="1"
                placeholder="50"
                class="input-field w-full"
                data-testid="billing-spend-alert-threshold"
                [attr.aria-invalid]="!!alertThresholdError()"
                aria-describedby="alert-threshold-error"
                [ngModel]="alertDraft.threshold_credits"
                (ngModelChange)="alertDraft.threshold_credits = $event" />
              @if (alertThresholdError(); as err) {
                <p id="alert-threshold-error" class="snap-error" role="alert" aria-live="polite">{{ err }}</p>
              }
            </label>

            <label class="block">
              <div class="muted-h mb-1">Notify email</div>
              <input
                type="email"
                placeholder="alerts@yourdomain.com"
                class="input-field w-full"
                [attr.aria-invalid]="!!alertEmailError()"
                aria-describedby="alert-email-error"
                [ngModel]="alertDraft.notify_email"
                (ngModelChange)="alertDraft.notify_email = $event" />
              @if (alertEmailError(); as err) {
                <p id="alert-email-error" class="snap-error" role="alert" aria-live="polite">{{ err }}</p>
              }
            </label>

            <fieldset class="block">
              <legend class="muted-h mb-1">Channels</legend>
              <label class="flex items-center gap-2 text-[0.78rem] text-text-secondary">
                <input type="checkbox"
                       [ngModel]="alertDraft.notify_via_email"
                       (ngModelChange)="alertDraft.notify_via_email = $event" />
                <span>Email</span>
              </label>
              <label class="flex items-center gap-2 text-[0.78rem] text-text-secondary mt-1">
                <input type="checkbox"
                       [ngModel]="alertDraft.notify_via_slack"
                       (ngModelChange)="alertDraft.notify_via_slack = $event" />
                <span>Slack (if connected)</span>
              </label>
            </fieldset>
          </div>

          <div dialogFooter class="px-5 py-4 border-t border-white/[0.06] flex items-center justify-end gap-2">
            <button class="btn-ghost" type="button" (click)="closeAlertModal()" [disabled]="savingAlert()">Cancel</button>
            <button
              class="btn-primary"
              type="button"
              data-testid="billing-spend-alert-submit"
              [disabled]="savingAlert() || !canSaveAlert()"
              (click)="saveAlert()">
              {{ savingAlert() ? 'Creating…' : 'Create alert' }}
            </button>
          </div>
        </app-dialog-shell>
      }
    </div>
  `,
  styles: [`
    :host { display: block; --accent: #00E5FF; }
    h2, h3 { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; letter-spacing: -0.02em; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid color-mix(in oklch, var(--accent) 14%, transparent); border-radius: 14px; padding: 1.4rem; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02); transition: transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease; }
    .card:hover { transform: translateY(-1px); border-color: color-mix(in oklch, var(--accent) 28%, transparent); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04), 0 8px 24px -16px rgba(0,229,255,0.18); }
    .card-light { background: rgba(255,255,255,0.025); border: 1px solid color-mix(in oklch, var(--accent) 16%, transparent); border-radius: 12px; transition: transform 200ms ease, border-color 200ms ease; }
    .card-light:hover { transform: translateY(-1px); border-color: color-mix(in oklch, var(--accent) 30%, transparent); }
    .input-field { padding: 0.5rem 0.7rem; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; font: inherit; }
    .input-field[aria-invalid="true"] { border-color: oklch(0.78 0.18 25 / 0.75); }
    .btn-primary { padding: 0.5rem 1rem; border-radius: 8px; background: linear-gradient(135deg, #00ffc8, #00d4ff); color: #060610; font-weight: 700; border: 1px solid color-mix(in oklch, #00d4ff 40%, transparent); cursor: pointer; font-size: 0.78rem; transition: transform 200ms ease, box-shadow 200ms ease; }
    .btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px -10px rgba(0,229,255,0.45); }
    .btn-primary:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-ghost { padding: 0.45rem 0.95rem; border-radius: 8px; background: transparent; color: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 0.74rem; transition: transform 200ms ease, border-color 200ms ease; }
    .btn-ghost:hover { transform: translateY(-1px); border-color: color-mix(in oklch, var(--accent) 30%, transparent); }
    .tier-active { border-color: rgba(0,229,255,0.55); background: rgba(0,229,255,0.06); box-shadow: 0 0 0 3px rgba(0,229,255,0.08); }

    /* ─────── Plan-card-button (whole card clickable) ─────── */
    .plan-card-button {
      position: relative;
      overflow: hidden;
      isolation: isolate;
      width: 100%;
      cursor: pointer;
      background: rgba(255,255,255,0.025);
      border: 1px solid color-mix(in oklch, var(--accent) 28%, transparent);
      border-radius: var(--ps-radius-md, 12px);
      color: inherit;
      font: inherit;
      transition:
        transform var(--ps-dur-base, 220ms) var(--ps-ease-emphasized, cubic-bezier(0.16, 1, 0.3, 1)),
        border-color var(--ps-dur-base, 220ms) ease,
        box-shadow var(--ps-dur-base, 220ms) ease;
    }
    .plan-card-button:hover:not(:disabled) {
      transform: translateY(-2px);
      border-color: color-mix(in oklch, var(--accent) 55%, transparent);
      box-shadow: var(--ps-shadow-md, 0 6px 18px -8px rgba(0,0,0,0.42)), 0 12px 32px -16px rgba(0,229,255,0.35);
    }
    .plan-card-button:focus-visible {
      outline: var(--ps-ring-focus, 2px solid #00ffc8);
      outline-offset: var(--ps-ring-focus-offset, 2px);
    }
    .plan-card-button:disabled { opacity: 0.7; cursor: progress; }
    .plan-card-button.is-upgrading .plan-card-cta-text::after {
      content: '';
      display: inline-block;
      width: 8px; height: 8px;
      margin-left: 6px;
      border-radius: 999px;
      background: currentColor;
      animation: pulse-dot 1s ease-in-out infinite;
    }
    .plan-card-cta {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      margin-top: 0.85rem;
      padding: 0.45rem 0.75rem;
      border-radius: 8px;
      background: linear-gradient(135deg, rgba(0,255,200,0.18), rgba(0,212,255,0.18));
      color: #00E5FF;
      border: 1px solid rgba(0,229,255,0.4);
      font-size: 0.74rem;
      font-weight: 700;
      letter-spacing: 0.01em;
    }
    @keyframes pulse-dot {
      0%, 100% { opacity: 0.4; transform: scale(0.9); }
      50%      { opacity: 1; transform: scale(1.15); }
    }

    /* ─────── Ripple effect (shared across all clickable cards) ─────── */
    .ripple {
      position: absolute;
      border-radius: 999px;
      pointer-events: none;
      background: radial-gradient(circle, rgba(0,229,255,0.45) 0%, rgba(0,229,255,0) 70%);
      transform: translate(-50%, -50%) scale(0);
      animation: ripple-out var(--ps-dur-slow, 380ms) var(--ps-ease-out, cubic-bezier(0,0,0.2,1)) forwards;
      z-index: 0;
    }
    @keyframes ripple-out {
      to {
        transform: translate(-50%, -50%) scale(6);
        opacity: 0;
      }
    }

    /* ─────── Tier card (AI credit purchase tiles) ─────── */
    .tier-card {
      position: relative;
      overflow: hidden;
      isolation: isolate;
      width: 100%;
      background: rgba(255,255,255,0.025);
      border: 1px solid color-mix(in oklch, var(--accent) 16%, transparent);
      border-radius: 12px;
      color: inherit;
      font: inherit;
      cursor: pointer;
      transition: transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease;
    }
    .tier-card:hover:not(:disabled):not(.cursor-default) {
      transform: translateY(-1px);
      border-color: color-mix(in oklch, var(--accent) 50%, transparent);
      box-shadow: 0 8px 24px -10px rgba(0,229,255,0.35);
    }
    .tier-card:focus-visible {
      outline: var(--ps-ring-focus, 2px solid #00ffc8);
      outline-offset: var(--ps-ring-focus-offset, 2px);
    }
    .tier-card:disabled { opacity: 0.7; cursor: progress; }
    .tier-card.is-invalid { border-color: oklch(0.78 0.18 25 / 0.55); }

    .custom-buy-btn {
      padding: 0.45rem 0.85rem;
      border-radius: 8px;
      background: linear-gradient(135deg, #00ffc8, #00d4ff);
      color: #060610;
      font-weight: 700;
      font-size: 0.74rem;
      border: 1px solid color-mix(in oklch, #00d4ff 40%, transparent);
      cursor: pointer;
      transition: transform 200ms ease, box-shadow 200ms ease, opacity 200ms ease;
      position: relative;
      overflow: hidden;
      isolation: isolate;
    }
    .custom-buy-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px -10px rgba(0,229,255,0.45); }
    .custom-buy-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .custom-buy-btn:focus-visible {
      outline: var(--ps-ring-focus, 2px solid #00ffc8);
      outline-offset: var(--ps-ring-focus-offset, 2px);
    }

    .empty-state { display: flex; flex-direction: column; align-items: center; gap: 0.6rem; padding: 2rem 1rem; text-align: center; }
    .empty-state .icon { width: 36px; height: 36px; opacity: 0.45; }
    .empty-state h4 { margin: 0; font-family: 'Sora', system-ui, sans-serif; font-weight: 600; color: rgba(255,255,255,0.85); font-size: 0.86rem; letter-spacing: -0.01em; }
    .empty-state p { margin: 0; font-size: 0.74rem; color: rgba(255,255,255,0.5); max-width: 28ch; }
    .skeleton { background: linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08), rgba(255,255,255,0.04)); background-size: 200% 100%; animation: shimmer 1.4s linear infinite; border-radius: 8px; }

    .muted-h { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; }
    .char-counter { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 0.65rem; color: rgba(255,255,255,0.5); letter-spacing: 0.02em; }
    .char-counter--full { color: oklch(0.78 0.18 25); }
    .snap-error { margin: 6px 0 0; font-size: 0.72rem; color: oklch(0.78 0.18 25); line-height: 1.35; }

    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) {
      .card, .card-light, .btn-primary, .btn-ghost, .plan-card-button, .tier-card, .custom-buy-btn { transition: none; }
      .card:hover, .card-light:hover, .btn-primary:hover, .btn-ghost:hover, .plan-card-button:hover, .tier-card:hover, .custom-buy-btn:hover { transform: none; box-shadow: none; }
      .skeleton { animation: none; background: rgba(255,255,255,0.06); }
      .ripple { animation-duration: 0ms !important; display: none; }
      .plan-card-button.is-upgrading .plan-card-cta-text::after { animation: none; }
    }
    @media (max-width: 640px) {
      .btn-primary, .btn-ghost { width: 100%; }
    }
  `],
})
export class AdminBillingComponent implements OnInit {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  credits = signal<CreditState | null>(null);

  /** 30-day forecast loaded from `/admin/forecast/cost` (#95). */
  forecast = signal<CostForecastState | null>(null);
  forecastLoading = signal(false);

  /**
   * Static price for the new 5,000-credit bulk pack. Derived as the
   * cheapest-per-credit rate of the existing tiers (500=$5 / 2000=$15 →
   * implied $0.006/credit at 5k). Kept as a constant rather than fetched
   * from the worker so the UI ships even if the server bundle list lags.
   */
  readonly tier5000Usd = 30;

  /** Per-credit price used by the Custom tier — mirrors the 5,000 bulk rate
   *  so customers never pay more than the cheapest bundled tier. */
  readonly customRate = 0.006;

  /** Custom amount state — null = empty input, 0+ = entered. */
  customAmount = signal<number | null>(null);
  customValid = computed(() => {
    const v = this.customAmount();
    return typeof v === 'number' && Number.isFinite(v) && v >= 100 && v <= 100000;
  });
  customPrice = computed(() => {
    const v = this.customAmount() ?? 0;
    return v * this.customRate;
  });

  /**
   * Render-ready bars for the inline-SVG chart. Heights normalize to the
   * largest category and clamp at 92px so the chart always sits inside the
   * 140-tall viewBox. Colors carry brand semantics.
   */
  forecastBars = computed<ForecastBar[]>(() => {
    const f = this.forecast();
    if (!f) return [];
    const cats = f.by_category;
    const entries: ForecastBar[] = [
      { label: 'workers', usd: cats.workers, height: 0, color: '#00E5FF' },
      { label: 'ai',      usd: cats.ai,      height: 0, color: '#7C3AED' },
      { label: 'r2',      usd: cats.r2,      height: 0, color: '#50AAE3' },
      { label: 'd1',      usd: cats.d1,      height: 0, color: '#10b981' },
      { label: 'email',   usd: cats.email,   height: 0, color: '#f59e0b' },
    ];
    const peak = Math.max(0.01, ...entries.map((e) => e.usd));
    for (const e of entries) e.height = Math.max(4, Math.min(92, (e.usd / peak) * 92));
    return entries;
  });

  // 14-day spend roll-up from the credits ledger.
  spend14d = computed<{ day: string; spend: number }[]>(() => {
    const ledger = this.credits()?.ledger ?? [];
    const out: Record<string, number> = {};
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      out[d.toISOString().slice(0, 10)] = 0;
    }
    for (const e of ledger) {
      if (e.delta >= 0) continue;
      const day = e.created_at.slice(0, 10);
      if (day in out) out[day]! += -e.delta;
    }
    return Object.entries(out).map(([day, spend]) => ({ day, spend }));
  });
  spend14dTotal = computed(() => this.spend14d().reduce((a, r) => a + r.spend, 0));
  projectedMonth = computed(() => Math.round((this.spend14dTotal() / 14) * 30));
  sparkPoints = computed<{ x: number; y: number }[]>(() => {
    const days = this.spend14d();
    if (!days.length) return [];
    const peak = Math.max(1, ...days.map((d) => d.spend));
    const step = days.length > 1 ? 280 / (days.length - 1) : 0;
    return days.map((d, i) => ({ x: i * step, y: 55 - (d.spend / peak) * 50 }));
  });
  sparkLine = computed(() => this.sparkPoints().map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '));
  sparkArea = computed(() => {
    const pts = this.sparkPoints(); if (!pts.length) return '';
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    return `${line} L ${pts[pts.length - 1]!.x.toFixed(1)} 60 L ${pts[0]!.x.toFixed(1)} 60 Z`;
  });
  alerts = signal<Alert[]>([]);
  siteCosts = signal<CostRow[]>([]);
  buying = signal<string | null>(null);
  plan = signal<'free' | 'pro'>('free');
  upgrading = signal(false);
  savingCap = signal<string | null>(null);
  loadingCredits = signal(false);
  loadingCosts = signal(false);
  capDraft: Record<string, number | ''> = {};
  planLabel = computed(() => (this.plan() === 'pro' ? 'Pro · $50/mo' : 'Free'));

  /** Locale-aware credit/count formatter (`Intl.NumberFormat`). */
  private readonly numberFormatter = new Intl.NumberFormat(undefined);
  /** USD currency formatter — 2 fraction digits, locale-aware. */
  private readonly usdFormatter = new Intl.NumberFormat(undefined, {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  /** Percentage formatter — 1 fraction digit. */
  private readonly pctFormatter = new Intl.NumberFormat(undefined, {
    style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1,
  });
  /** Relative time formatter for "Last call" column (e.g. "3 hours ago"). */
  private readonly relTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  formatCredits(n: number | null | undefined): string {
    return this.numberFormatter.format(typeof n === 'number' && Number.isFinite(n) ? n : 0);
  }
  formatUsd(n: number | null | undefined): string {
    return this.usdFormatter.format(typeof n === 'number' && Number.isFinite(n) ? n : 0);
  }
  /**
   * Compute this row's share of total org spend across all sites in the
   * current 30-day window. Returns "—" when the denominator is zero so
   * users don't see a misleading "0.0%" on brand-new accounts.
   */
  pctOfOrg(r: CostRow): string {
    const total = this.siteCosts().reduce((a, x) => a + (x.estimated_cost_micro_usd || 0), 0);
    if (total <= 0) return '—';
    return this.pctFormatter.format((r.estimated_cost_micro_usd || 0) / total);
  }
  /**
   * Render the `last_invocation_at` timestamp as a human-friendly relative
   * string ("3 hours ago", "yesterday"). Falls back to an em-dash when the
   * server hasn't populated the field yet.
   */
  formatLastCall(iso: string | null | undefined): string {
    if (!iso) return '—';
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return '—';
    const diffMs = ts - Date.now();
    const diffMin = Math.round(diffMs / 60000);
    const absMin = Math.abs(diffMin);
    if (absMin < 60) return this.relTimeFormatter.format(diffMin, 'minute');
    const diffHr = Math.round(diffMin / 60);
    if (Math.abs(diffHr) < 24) return this.relTimeFormatter.format(diffHr, 'hour');
    const diffDay = Math.round(diffHr / 24);
    if (Math.abs(diffDay) < 30) return this.relTimeFormatter.format(diffDay, 'day');
    const diffMonth = Math.round(diffDay / 30);
    return this.relTimeFormatter.format(diffMonth, 'month');
  }

  /** ─────── Spend alert modal state ─────── */
  alertModalOpen = signal(false);
  savingAlert = signal(false);
  alertDraft: {
    name: string;
    alert_kind: string;
    threshold_credits: number | null;
    notify_email: string;
    notify_via_email: boolean;
    notify_via_slack: boolean;
  } = {
    name: '', alert_kind: 'balance_low', threshold_credits: null, notify_email: '',
    notify_via_email: true, notify_via_slack: false,
  };

  alertNameLen(): number { return (this.alertDraft.name ?? '').length; }

  /** Inline validators — return null when valid, else a user-safe message. */
  alertNameError(): string | null {
    const raw = (this.alertDraft.name ?? '').trim();
    if (raw.length === 0) return null;
    if (raw.length > 80) return 'Name must be 80 characters or fewer.';
    return null;
  }
  alertThresholdError(): string | null {
    const v = this.alertDraft.threshold_credits;
    if (v === null || v === undefined) return null;
    if (!Number.isFinite(v) || v <= 0) return 'Threshold must be a positive number.';
    if (v > 10000) return 'Threshold must be 10,000 or less.';
    return null;
  }
  alertEmailError(): string | null {
    const raw = (this.alertDraft.notify_email ?? '').trim();
    if (raw.length === 0) return null;
    // Lightweight RFC-5322 sanity check — full validation happens server-side.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return 'Enter a valid email address.';
    return null;
  }
  canSaveAlert(): boolean {
    const name = (this.alertDraft.name ?? '').trim();
    const email = (this.alertDraft.notify_email ?? '').trim();
    const threshold = this.alertDraft.threshold_credits;
    return (
      name.length > 0 &&
      this.alertNameError() === null &&
      threshold !== null && threshold !== undefined &&
      this.alertThresholdError() === null &&
      email.length > 0 &&
      this.alertEmailError() === null
    );
  }

  openAlertModal(): void {
    this.alertDraft = {
      name: '', alert_kind: 'balance_low', threshold_credits: null, notify_email: '',
      notify_via_email: true, notify_via_slack: false,
    };
    this.alertModalOpen.set(true);
  }
  closeAlertModal(): void {
    if (this.savingAlert()) return;
    this.alertModalOpen.set(false);
  }

  get bundleKeys(): string[] { return Object.keys(this.credits()?.bundles ?? {}); }
  bundleCredits(key: string): number {
    const v = this.credits()?.bundles?.[key]?.credits;
    return typeof v === 'number' ? v : Number(v) || 0;
  }
  bundleUsd(key: string): number {
    const v = this.credits()?.bundles?.[key]?.usd;
    return typeof v === 'number' ? v : Number(v) || 0;
  }

  ngOnInit(): void { this.loadAll(); }

  /**
   * Insert a ripple span at the click coordinates and remove it when the
   * animation finishes. Shared by every clickable card on the page so the
   * interaction language stays consistent (Pro card, tier tiles, custom-buy
   * button). Respects prefers-reduced-motion (CSS short-circuits the keyframes
   * and hides the element, so no visible ripple is emitted).
   */
  triggerRipple(event: MouseEvent): void {
    const host = event.currentTarget as HTMLElement | null;
    if (!host) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const rect = host.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    host.appendChild(ripple);
    const cleanup = (): void => { ripple.remove(); };
    ripple.addEventListener('animationend', cleanup, { once: true });
    // Safety net — guarantees cleanup if animationend never fires.
    window.setTimeout(cleanup, 800);
  }

  loadAll(): void {
    this.loadingCredits.set(true);
    this.loadingCosts.set(true);
    this.api.get<{ data: CreditState }>('/billing/credits').subscribe({
      next: (r) => { this.credits.set(r.data); this.loadingCredits.set(false); },
      error: () => { this.loadingCredits.set(false); /* api.service already toasted */ },
    });
    this.api.get<{ data: Alert[] }>('/billing/spend-alerts').subscribe({
      next: (r) => this.alerts.set(r.data ?? []),
      error: () => { /* api.service already toasted */ },
    });
    this.api.get<{ data: { rows: CostRow[] } }>('/billing/site-costs').subscribe({
      next: (r) => {
        const rows = r.data?.rows ?? [];
        this.siteCosts.set(rows);
        this.loadingCosts.set(false);
        for (const row of rows) {
          this.api.get<{ data: { monthly_credit_cap: number | null } }>(`/sites/${row.site_id}/credit-cap`).subscribe({
            next: (cap) => { this.capDraft[row.site_id] = cap.data?.monthly_credit_cap ?? ''; },
            error: () => { /* api.service already toasted */ },
          });
        }
      },
      error: () => { this.loadingCosts.set(false); /* api.service already toasted */ },
    });
    this.api.get<{ data: { subscription?: { status?: string } | null } }>('/billing/subscription').subscribe({
      next: (r) => this.plan.set(r.data?.subscription?.status === 'active' ? 'pro' : 'free'),
      error: () => this.plan.set('free'),
    });
    this.forecastLoading.set(true);
    this.api.get<{ data: CostForecastState }>('/admin/forecast/cost').subscribe({
      next: (r) => { this.forecast.set(r.data); this.forecastLoading.set(false); },
      error: () => { this.forecast.set(null); this.forecastLoading.set(false); },
    });
  }

  /**
   * Open the Stripe checkout flow in a NEW TAB so the admin context is
   * preserved (the user can keep tweaking caps / alerts while checkout
   * loads). Falls back to a same-tab redirect if the popup is blocked.
   */
  upgrade(): void {
    if (this.upgrading()) return;
    this.upgrading.set(true);
    this.api.post<{ data: { url?: string } }>('/billing/checkout', { plan: 'pro' }).subscribe({
      next: (r) => {
        this.upgrading.set(false);
        const url = r.data?.url;
        if (url) {
          const win = window.open(url, '_blank', 'noopener,noreferrer');
          if (!win) {
            // Popup blocked — fall back to a same-tab redirect rather than swallowing the click.
            window.location.href = url;
          }
        } else {
          this.toast.info('Checkout opened');
        }
      },
      error: () => { this.upgrading.set(false); this.toast.error('Could not start checkout'); },
    });
  }
  manage(): void {
    this.api.post<{ data: { url?: string } }>('/billing/portal', {}).subscribe({
      next: (r) => { if (r.data?.url) window.location.href = r.data.url; else this.toast.info('Portal opened'); },
      error: () => { /* api.service already toasted */ },
    });
  }
  saveCap(siteId: string): void {
    this.savingCap.set(siteId);
    const raw = this.capDraft[siteId];
    const cap = raw === '' || raw == null ? null : Math.max(0, Number(raw));
    this.api.put(`/sites/${siteId}/credit-cap`, { monthly_credit_cap: cap }).subscribe({
      next: () => { this.savingCap.set(null); this.toast.success(cap == null ? 'Cap removed' : `Saved — cap set to ${this.formatCredits(cap)} credits/mo`); },
      error: () => { this.savingCap.set(null); /* api.service already toasted */ },
    });
  }
  topup(bundle: string): void {
    this.buying.set(bundle);
    this.api.post<{ data: { mode: string; url?: string; balance?: number } }>('/billing/credits/topup', { bundle }).subscribe({
      next: (r) => {
        this.buying.set(null);
        const url = r.data?.url;
        if (r.data?.mode === 'stripe' && url) {
          const win = window.open(url, '_blank', 'noopener,noreferrer');
          if (!win) window.location.href = url;
        } else {
          this.toast.success(`Credits added — balance ${this.formatCredits(r.data?.balance ?? 0)}`);
          this.loadAll();
        }
      },
      error: () => { this.buying.set(null); /* api.service already toasted */ },
    });
  }
  /**
   * Custom-amount top-up. Pipes the validated amount through the same
   * `/billing/credits/topup` endpoint with a `custom` bundle key + the
   * `credits` count; the worker is expected to compute price using the
   * same per-credit rate displayed in the UI. If the worker doesn't yet
   * accept `custom`, the API error toast surfaces the gap to the user.
   */
  topupCustom(): void {
    if (!this.customValid() || this.buying() === 'custom') return;
    const credits = this.customAmount()!;
    this.buying.set('custom');
    this.api.post<{ data: { mode: string; url?: string; balance?: number } }>('/billing/credits/topup', { bundle: 'custom', credits }).subscribe({
      next: (r) => {
        this.buying.set(null);
        const url = r.data?.url;
        if (r.data?.mode === 'stripe' && url) {
          const win = window.open(url, '_blank', 'noopener,noreferrer');
          if (!win) window.location.href = url;
        } else {
          this.toast.success(`Credits added — balance ${this.formatCredits(r.data?.balance ?? 0)}`);
          this.customAmount.set(null);
          this.loadAll();
        }
      },
      error: () => { this.buying.set(null); /* api.service already toasted */ },
    });
  }

  /**
   * Persist the spend alert. Translates the modal's USD threshold input
   * into the credit-based threshold the worker stores (1 credit = $0.04
   * matches the rate shown in the per-site breakdown header).
   */
  saveAlert(): void {
    if (!this.canSaveAlert() || this.savingAlert()) return;
    this.savingAlert.set(true);
    const usdThreshold = this.alertDraft.threshold_credits ?? 0;
    const creditsThreshold = Math.max(1, Math.round(usdThreshold / 0.04));
    this.api.post('/billing/spend-alerts', {
      name: this.alertDraft.name.trim(),
      alert_kind: this.alertDraft.alert_kind,
      threshold_credits: creditsThreshold,
      notify_email: this.alertDraft.notify_email.trim(),
      notify_via_email: this.alertDraft.notify_via_email,
      notify_via_slack: this.alertDraft.notify_via_slack,
    }).subscribe({
      next: () => {
        this.savingAlert.set(false);
        this.toast.success('Saved — alert created');
        this.alertModalOpen.set(false);
        this.loadAll();
      },
      error: () => { this.savingAlert.set(false); /* api.service already toasted */ },
    });
  }
  removeAlert(a: Alert): void {
    this.api.delete(`/billing/spend-alerts/${a.id}`).subscribe({
      next: () => { this.toast.success('Alert removed'); this.loadAll(); },
      error: () => { /* api.service already toasted */ },
    });
  }
  bytes(n: number): string { if (n < 1024) return `${n} B`; if (n < 1024 * 1024) return `${(n/1024).toFixed(1)} KB`; if (n < Math.pow(1024, 3)) return `${(n/Math.pow(1024,2)).toFixed(1)} MB`; return `${(n/Math.pow(1024,3)).toFixed(2)} GB`; }
}
