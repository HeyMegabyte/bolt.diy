/**
 * @module pages/admin/sections/enterprise
 *
 * @description
 * Enterprise Plan admin surface — idea #44.
 *
 * Mounted at `/admin/enterprise`. Reads + writes the enterprise contract
 * row, surfaces SLA snapshots + rolling uptime, lists recent audit-log
 * exports, and shows the SSO config (SAML / OIDC / Cloudflare Access).
 *
 * Stripe + Cloudflare Access provisioning is operational — the README
 * for the feature module explains what Brian still needs to do.
 *
 * @packageDocumentation
 */
import {
  Component,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { HlmCheckboxDirective, HlmInputDirective, HlmSelectDirective } from '../../../ui';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { FeatureFlagService } from '../../../services/feature-flag.service';
import { RevealDirective } from '../../../directives/reveal.directive';

type PlanTier =
  | 'enterprise-small'
  | 'enterprise-mid'
  | 'enterprise-large';
type SsoProvider = 'saml' | 'oidc' | 'cloudflare-access';
type ContractStatus = 'pending' | 'active' | 'churned' | 'cancelled';

interface Contract {
  id: string;
  org_id: string;
  plan_tier: PlanTier;
  sla_pct: number;
  sso_enabled: boolean;
  sso_provider: SsoProvider | null;
  sso_metadata_url: string | null;
  custom_terms_md: string | null;
  dedicated_slack_channel: string | null;
  annual_value_cents: number;
  status: ContractStatus;
}

interface SlaResponse {
  contract_sla_pct: number;
  rolling_uptime_pct: number | null;
  breached: boolean;
  snapshots: Array<{
    measured_on: string;
    uptime_pct: number;
    incidents_count: number;
  }>;
}

interface AuditExport {
  id: string;
  range_start: string;
  range_end: string;
  status: 'pending' | 'ready' | 'expired' | 'failed';
  r2_key: string | null;
  created_at: string;
}

@Component({
  selector: 'app-admin-enterprise',
  standalone: true,
  imports: [RevealDirective, CommonModule, FormsModule, RouterLink, RollingCounterComponent, HlmCheckboxDirective, HlmInputDirective, HlmSelectDirective],
  template: `
    <div class="p-7 flex-1 overflow-y-auto max-md:p-4 space-y-6">
      <header class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div class="kicker">Enterprise Plan</div>
          <h2 class="section-h text-lg font-bold text-white m-0">
            Contract · SLA · SSO · Audit
          </h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            $500-$2000/mo enterprise tier. Stripe products + Cloudflare
            Access SSO are provisioned by Brian — admin surfaces are
            flag-gated until then.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <a routerLink="/admin" class="btn-ghost text-xs">← Admin</a>
          <button class="btn-ghost text-xs" (click)="refresh()" [disabled]="loading()">Refresh</button>
          <!-- Only offer Save when the contract editor is actually rendered. When the
               plan is flag-disabled (notFound) or the load failed, there's no form to
               save — a visible Save here would POST to a gated/404 route (dead button). -->
          @if (!notFound() && !loadError()) {
            <button class="btn-primary text-xs" data-testid="enterprise-save" (click)="saveContract()" [disabled]="saving()">
              {{ saving() ? 'Saving…' : 'Save contract' }}
            </button>
          }
        </div>
      </header>

      @if (notFound()) {
        <div class="empty-card">
          <p class="text-text-secondary text-sm">
            Enterprise plan is disabled for your org. Enable
            <code>enterprise_plan</code> in
            <a routerLink="/admin/feature-flags" class="text-[#00E5FF] underline underline-offset-2 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF] rounded-sm">Feature&nbsp;Flags</a>.
          </p>
        </div>
      }

      @if (loadError() && !loading()) {
        <div class="empty-card" data-testid="enterprise-load-error" role="alert">
          <p class="err-text text-sm mb-2">{{ loadError() }}</p>
          <button class="btn-ghost text-xs" data-testid="enterprise-retry" (click)="refresh()">Retry</button>
        </div>
      }

      @if (!notFound() && !loadError()) {
        <!-- KPIs -->
        <section class="grid grid-cols-1 md:grid-cols-4 gap-3" appReveal>
          <div class="kpi">
            <div class="kpi-label">Plan tier</div>
            <div class="kpi-value">{{ planLabel(planTier()) }}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">ACV (USD)</div>
            <div class="kpi-value">
              $<app-rolling-counter [value]="annualValueDollars()" />
            </div>
          </div>
          <div class="kpi">
            <div class="kpi-label">SLA target</div>
            <div class="kpi-value">
              <app-rolling-counter [value]="slaPct()" [decimals]="2" suffix="%" />
            </div>
          </div>
          <div class="kpi" [class.kpi-bad]="slaBreached()">
            <div class="kpi-label">Rolling uptime (90d)</div>
            <div class="kpi-value">
              @if (rollingUptime() !== null) {
                <app-rolling-counter [value]="rollingUptime()!" [decimals]="2" suffix="%" />
              } @else {
                <span class="text-text-secondary">—</span>
              }
            </div>
          </div>
        </section>

        <!-- SLA headroom gauge — cyan when met, amber within margin, red when breached -->
        @if (rollingUptime() !== null) {
          <section
            class="sla-gauge"
            [class.is-breached]="slaBreached()"
            [class.is-tight]="!slaBreached() && slaHeadroom() < 0.05"
            appReveal
            role="meter"
            aria-label="Rolling 90-day uptime against the contract SLA target"
            [attr.aria-valuenow]="rollingUptime()"
            [attr.aria-valuemin]="slaFloor()"
            aria-valuemax="100"
            [attr.aria-valuetext]="gaugeAriaText()"
          >
            <div class="sla-gauge__head">
              <span class="sla-gauge__title">Uptime vs SLA</span>
              <span class="sla-gauge__verdict">
                {{ slaBreached() ? 'SLA breached' : 'Within SLA' }} ·
                {{ slaHeadroom() >= 0 ? '+' : '' }}{{ slaHeadroom().toFixed(2) }}% headroom
              </span>
            </div>
            <div class="sla-gauge__track" aria-hidden="true">
              <div class="sla-gauge__fill" [style.width.%]="gaugeFillPct()"></div>
              <div class="sla-gauge__marker" [style.left.%]="gaugeMarkerPct()"></div>
            </div>
            <div class="sla-gauge__scale" aria-hidden="true">
              <span>{{ slaFloor().toFixed(1) }}%</span>
              <span class="sla-gauge__marker-label">SLA {{ slaPct().toFixed(2) }}%</span>
              <span>100%</span>
            </div>
          </section>
        }

        <!-- Contract editor -->
        <section class="card" appReveal>
          <h3 class="card-h">Contract</h3>
          <div class="grid-2">
            <label>
              Plan tier
              <select hlmSelect [ngModel]="planTier()" (ngModelChange)="planTier.set($event)">
                <option value="enterprise-small">Enterprise Small ($500/mo)</option>
                <option value="enterprise-mid">Enterprise Mid ($1,000/mo)</option>
                <option value="enterprise-large">Enterprise Large ($2,000/mo)</option>
              </select>
            </label>
            <label>
              SLA %
              <input
                hlmInput
                type="number"
                step="0.01"
                min="0"
                max="100"
                [ngModel]="slaPct()"
                (ngModelChange)="slaPct.set($event)"
              />
            </label>
            <label>
              ACV (cents)
              <input
                hlmInput
                type="number"
                [ngModel]="annualValueCents()"
                (ngModelChange)="annualValueCents.set($event)"
              />
            </label>
            <label>
              Status
              <select hlmSelect [ngModel]="status()" (ngModelChange)="status.set($event)">
                <option value="pending">Pending</option>
                <option value="active">Active</option>
                <option value="churned">Churned</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label>
              Dedicated Slack channel
              <input
                hlmInput
                placeholder="#cust-acme"
                [ngModel]="dedicatedSlack()"
                (ngModelChange)="dedicatedSlack.set($event)"
              />
            </label>
            <label>
              Audit-log export enabled
              <input hlmCheckbox type="checkbox" [ngModel]="auditEnabled()" (ngModelChange)="auditEnabled.set($event)" />
            </label>
          </div>
          <label class="block mt-3">
            Custom terms (Markdown)
            <textarea
              hlmInput [multiline]="true"
              rows="5"
              [ngModel]="customTerms() ?? ''"
              (ngModelChange)="customTerms.set($event)"
            ></textarea>
          </label>
        </section>

        <!-- SSO -->
        <section class="card" appReveal>
          <h3 class="card-h">SSO (SAML / OIDC / Cloudflare Access)</h3>
          <div class="grid-2">
            <label>
              SSO enabled
              <input hlmCheckbox type="checkbox" [ngModel]="ssoEnabled()" (ngModelChange)="ssoEnabled.set($event)" />
            </label>
            <label>
              Provider
              <select hlmSelect [ngModel]="ssoProvider() ?? ''"
                (ngModelChange)="ssoProvider.set($event || null)">
                <option value="">— None —</option>
                <option value="saml">SAML 2.0</option>
                <option value="oidc">OpenID Connect</option>
                <option value="cloudflare-access">Cloudflare Access</option>
              </select>
            </label>
            <label class="md:col-span-2">
              Metadata URL
              <input
                hlmInput
                placeholder="https://idp.example.com/metadata"
                [ngModel]="ssoMetadataUrl() ?? ''"
                (ngModelChange)="ssoMetadataUrl.set($event || null)"
              />
            </label>
          </div>
          <p class="hint">
            Requires Brian to provision the Cloudflare Access application
            before SSO traffic completes the handshake.
          </p>
        </section>

        <!-- Audit exports -->
        <section class="card" appReveal>
          <h3 class="card-h">Audit-log exports</h3>
          <div class="grid-2 mb-3">
            <label>
              Range start
              <input hlmInput type="date" [ngModel]="rangeStart()" (ngModelChange)="rangeStart.set($event)" />
            </label>
            <label>
              Range end
              <input hlmInput type="date" [ngModel]="rangeEnd()" (ngModelChange)="rangeEnd.set($event)" />
            </label>
          </div>
          <button class="btn-primary text-xs" (click)="enqueueExport()" [disabled]="enqueueing()">
            {{ enqueueing() ? 'Enqueueing…' : 'Enqueue export' }}
          </button>

          @if (exports().length > 0) {
            <ul class="export-list mt-4" aria-label="Recent audit-log exports">
              @for (e of exports(); track e.id) {
                <li>
                  <span class="font-mono text-[0.7rem]">{{ e.range_start }} → {{ e.range_end }}</span>
                  <span class="status status-{{ e.status }}" [attr.aria-label]="'Status: ' + e.status">{{ e.status }}</span>
                  <span class="text-text-secondary text-[0.7rem]">{{ e.created_at | date:'short' }}</span>
                </li>
              }
            </ul>
          }
        </section>
      }
    </div>
  `,
  styles: [
    `
      :host {
        /* Section-local semantic tokens derived from the cyan/black brand palette.
           --ent-warn / --ent-danger keep amber+red status semantics WCAG-AA legible
           on the dark canvas without hardcoding raw hex. */
        --ent-warn: #ffc24d;
        --ent-danger: #ff8585;
      }
      .card { background: var(--ps-elev-1, rgba(255,255,255,.02)); border: 1px solid var(--ps-hairline, rgba(255,255,255,.06)); border-radius: 14px; padding: 16px 18px; }
      .card-h { font-size: 0.92rem; color: var(--ps-ink, #f4f4ff); margin: 0 0 10px; font-weight: 600; }
      .hint { font-size: 0.72rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); margin: 10px 0 0; }
      .err-text { color: var(--ent-danger); }
      .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      label { display: block; font-size: 0.72rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 70%, transparent); }
      /* .input/.select/.textarea removed — all controls now Spartan hlmInput/hlmSelect. */
      .kpi { background: var(--ps-elev-1, rgba(255,255,255,.02)); border: 1px solid var(--ps-hairline, rgba(255,255,255,.06)); border-radius: 12px; padding: 14px 16px; }
      .kpi-label { font-size: 0.7rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); }
      .kpi-value { font-size: 1.15rem; color: var(--ps-ink, #f4f4ff); font-weight: 600; margin-top: 4px; }
      .kpi-bad { border-color: color-mix(in oklch, var(--ent-danger) 45%, transparent); }
      .empty-card { background: var(--ps-elev-1, rgba(255,255,255,.02)); border: 1px dashed var(--ps-hairline-hi, rgba(255,255,255,.08)); border-radius: 12px; padding: 16px 18px; }
      .export-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
      .export-list li { display: flex; gap: 12px; align-items: center; padding: 6px 0; border-top: 1px solid var(--ps-hairline, rgba(255,255,255,.04)); }
      .status { font-size: 0.68rem; padding: 2px 8px; border-radius: 999px; }
      .status-pending { background: color-mix(in oklch, var(--ent-warn) 14%, transparent); color: var(--ent-warn); }
      .status-ready   { background: var(--ps-accent-soft, color-mix(in oklch, var(--ps-accent, #00e5ff) 14%, transparent)); color: var(--ps-accent, #00e5ff); }
      .status-failed  { background: color-mix(in oklch, var(--ent-danger) 14%, transparent); color: var(--ent-danger); }
      .status-expired { background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 6%, transparent); color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 50%, transparent); }

      /* SLA headroom gauge — the cyan UX win. A linear track with the accent fill
         showing rolling uptime, plus a marker at the SLA target line. */
      .sla-gauge { background: var(--ps-elev-1, rgba(255,255,255,.02)); border: 1px solid var(--ps-accent-line, color-mix(in oklch, var(--ps-accent, #00e5ff) 28%, transparent)); border-radius: 14px; padding: 16px 18px; }
      .sla-gauge.is-tight { border-color: color-mix(in oklch, var(--ent-warn) 40%, transparent); }
      .sla-gauge.is-breached { border-color: color-mix(in oklch, var(--ent-danger) 45%, transparent); }
      .sla-gauge__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
      .sla-gauge__title { font-size: 0.82rem; font-weight: 600; color: var(--ps-ink, #f4f4ff); }
      .sla-gauge__verdict { font-size: 0.72rem; font-variant-numeric: tabular-nums; color: var(--ps-accent, #00e5ff); }
      .is-tight .sla-gauge__verdict { color: var(--ent-warn); }
      .is-breached .sla-gauge__verdict { color: var(--ent-danger); }
      .sla-gauge__track { position: relative; height: 10px; border-radius: 999px; background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 8%, transparent); overflow: visible; }
      .sla-gauge__fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, color-mix(in oklch, var(--ps-accent, #00e5ff) 55%, transparent), var(--ps-accent, #00e5ff)); transition: width .6s cubic-bezier(.22,1,.36,1); }
      .is-tight .sla-gauge__fill { background: linear-gradient(90deg, color-mix(in oklch, var(--ent-warn) 55%, transparent), var(--ent-warn)); }
      .is-breached .sla-gauge__fill { background: linear-gradient(90deg, color-mix(in oklch, var(--ent-danger) 55%, transparent), var(--ent-danger)); }
      .sla-gauge__marker { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--ps-ink, #f4f4ff); border-radius: 2px; box-shadow: 0 0 0 1px color-mix(in oklch, var(--ps-bg, #060610) 70%, transparent); }
      .sla-gauge__scale { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; font-size: 0.66rem; font-variant-numeric: tabular-nums; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 55%, transparent); }
      .sla-gauge__marker-label { color: var(--ps-accent, #00e5ff); }
      @media (prefers-reduced-motion: reduce) { .sla-gauge__fill { transition: none; } }
    `,
  ],
})
export class AdminEnterpriseComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly flags = inject(FeatureFlagService);

  readonly contract = signal<Contract | null>(null);
  readonly sla = signal<SlaResponse | null>(null);
  readonly exports = signal<AuditExport[]>([]);
  readonly loading = signal(false);
  /** Persistent non-404 contract load failure — gates the editor so a failed fetch never presents a default-valued, savable form. */
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly enqueueing = signal(false);
  // Pessimistic: assume the enterprise_plan flag is OFF until the client-side
  // check confirms it's on. This shows the disabled-state card immediately and
  // — critically — prevents the unconditional /api/enterprise/* fetch from
  // firing when the feature is disabled (which surfaced a misleading
  // "Can't reach the server" toast instead of the disabled message).
  readonly notFound = signal(true);

  // Editable signals
  readonly planTier = signal<PlanTier>('enterprise-small');
  readonly slaPct = signal<number>(99.9);
  readonly annualValueCents = signal<number>(500 * 12 * 100);
  readonly status = signal<ContractStatus>('pending');
  readonly dedicatedSlack = signal<string>('');
  readonly auditEnabled = signal<boolean>(true);
  readonly customTerms = signal<string | null>(null);
  readonly ssoEnabled = signal<boolean>(false);
  readonly ssoProvider = signal<SsoProvider | null>(null);
  readonly ssoMetadataUrl = signal<string | null>(null);
  readonly rangeStart = signal<string>('');
  readonly rangeEnd = signal<string>('');

  readonly annualValueDollars = (): number =>
    Math.round(this.annualValueCents() / 100);
  readonly slaBreached = (): boolean => this.sla()?.breached === true;

  /** Rolling 90-day uptime %, or null when no SLA snapshot has loaded yet. */
  readonly rollingUptime = (): number | null => {
    const v = this.sla()?.rolling_uptime_pct;
    return v === null || v === undefined ? null : v;
  };

  /** Headroom = measured uptime minus the contract SLA target (negative = breach). */
  readonly slaHeadroom = (): number => {
    const up = this.rollingUptime();
    return up === null ? 0 : up - this.slaPct();
  };

  /**
   * Gauge floor — the left edge of the track. We zoom into the high-uptime band
   * (SLA targets sit at 99-99.99%) so a 0.1% swing is visually legible: the
   * floor is the lower of the SLA target and the measured uptime, minus a 1%
   * margin, clamped to [90, 99.9].
   */
  readonly slaFloor = (): number => {
    const up = this.rollingUptime();
    const lowest = up === null ? this.slaPct() : Math.min(this.slaPct(), up);
    return Math.min(99.9, Math.max(90, lowest - 1));
  };

  private gaugePct(value: number): number {
    const floor = this.slaFloor();
    const span = 100 - floor;
    if (span <= 0) return 100;
    return Math.max(0, Math.min(100, ((value - floor) / span) * 100));
  }

  readonly gaugeFillPct = (): number => {
    const up = this.rollingUptime();
    return up === null ? 0 : this.gaugePct(up);
  };

  readonly gaugeMarkerPct = (): number => this.gaugePct(this.slaPct());

  readonly gaugeAriaText = (): string => {
    const up = this.rollingUptime();
    if (up === null) return 'No uptime data yet';
    const verb = this.slaBreached() ? 'below' : 'meeting';
    return `${up.toFixed(2)}% rolling uptime, ${verb} the ${this.slaPct().toFixed(2)}% SLA target`;
  };

  constructor() {
    // Gate the org-scoped fetch on the actual flag (toast-safe public probe),
    // mirroring inbox/site-dna. When enterprise_plan is off we keep the
    // disabled-state card (notFound stays true) and never fire the
    // /api/enterprise/* requests — so no spurious 404 → no error toast.
    this.flags
      .isOn('enterprise_plan')
      .pipe(takeUntilDestroyed())
      .subscribe((on) => {
        if (on) {
          this.notFound.set(false);
          this.refresh();
        }
      });
  }

  planLabel(tier: PlanTier): string {
    return {
      'enterprise-small': 'Small',
      'enterprise-mid': 'Mid',
      'enterprise-large': 'Large',
    }[tier];
  }

  refresh(): void {
    this.loading.set(true);
    this.notFound.set(false);
    this.loadError.set(null);
    this.api.get<{ data: Contract | null }>('/enterprise/contract', undefined, { silent: true }).subscribe({
      next: (res) => {
        this.loadError.set(null);
        this.contract.set(res.data);
        if (res.data) {
          this.planTier.set(res.data.plan_tier);
          this.slaPct.set(res.data.sla_pct);
          this.annualValueCents.set(res.data.annual_value_cents);
          this.status.set(res.data.status);
          this.dedicatedSlack.set(res.data.dedicated_slack_channel ?? '');
          this.auditEnabled.set(res.data.id !== undefined);
          this.customTerms.set(res.data.custom_terms_md);
          this.ssoEnabled.set(res.data.sso_enabled);
          this.ssoProvider.set(res.data.sso_provider);
          this.ssoMetadataUrl.set(res.data.sso_metadata_url);
        }
        this.loading.set(false);
      },
      error: (err) => {
        if (err?.status === 404) {
          this.notFound.set(true);
        } else {
          // Persistent in-panel error gates the editor — a failed load must not
          // present a default-valued contract form the operator could save over real data.
          this.loadError.set("Couldn't load your enterprise contract — retry before editing.");
          this.toast.error('Failed to load enterprise contract');
        }
        this.loading.set(false);
      },
    });

    this.api.get<{ data: SlaResponse }>('/enterprise/sla').subscribe({
      next: (res) => this.sla.set(res.data),
      error: () => undefined,
    });

    this.api
      .get<{ data: AuditExport[] }>('/enterprise/audit-exports')
      .subscribe({
        next: (res) => this.exports.set(res.data ?? []),
        error: () => undefined,
      });
  }

  saveContract(): void {
    // Defense-in-depth: never PUT when there's no editor (plan disabled / load failed).
    if (this.notFound() || this.loadError()) return;
    this.saving.set(true);
    const body = {
      plan_tier: this.planTier(),
      sla_pct: this.slaPct(),
      annual_value_cents: this.annualValueCents(),
      status: this.status(),
      dedicated_slack_channel: this.dedicatedSlack() || null,
      audit_export_enabled: this.auditEnabled(),
      custom_terms_md: this.customTerms(),
      sso_enabled: this.ssoEnabled(),
      sso_provider: this.ssoProvider(),
      sso_metadata_url: this.ssoMetadataUrl(),
    };
    this.api.put<{ data: Contract }>('/enterprise/contract', body, { silent: true }).subscribe({
      next: (res) => {
        this.contract.set(res.data);
        this.toast.success('Contract saved');
        this.saving.set(false);
      },
      error: () => {
        this.toast.error('Failed to save contract');
        this.saving.set(false);
      },
    });
  }

  enqueueExport(): void {
    if (!this.rangeStart() || !this.rangeEnd()) {
      this.toast.error('Pick a start + end date');
      return;
    }
    this.enqueueing.set(true);
    this.api
      .post<{ data: AuditExport }>(
        '/enterprise/audit-exports',
        { range_start: this.rangeStart(), range_end: this.rangeEnd() },
        { silent: true },
      )
      .subscribe({
        next: (res) => {
          this.exports.update((rows) => [res.data, ...rows]);
          this.toast.success('Audit export enqueued');
          this.enqueueing.set(false);
        },
        error: () => {
          this.toast.error('Failed to enqueue export');
          this.enqueueing.set(false);
        },
      });
  }
}
