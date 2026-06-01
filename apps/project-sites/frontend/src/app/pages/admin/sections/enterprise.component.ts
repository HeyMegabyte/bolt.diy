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
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { HlmCheckboxDirective, HlmInputDirective, HlmSelectDirective } from '../../../ui';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
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
          <button class="btn-primary text-xs" (click)="saveContract()" [disabled]="saving()">
            {{ saving() ? 'Saving…' : 'Save contract' }}
          </button>
        </div>
      </header>

      @if (notFound()) {
        <div class="empty-card">
          <p class="text-text-secondary text-sm">
            Enterprise plan is disabled for your org. Enable
            <code>enterprise_plan</code> in /admin/feature-flags.
          </p>
        </div>
      }

      @if (!notFound()) {
        <!-- KPIs -->
        <section class="grid grid-cols-1 md:grid-cols-4 gap-3">
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
            <div class="kpi-label">SLA</div>
            <div class="kpi-value">
              <app-rolling-counter [value]="slaPct()" [decimals]="2" suffix="%" />
            </div>
          </div>
          <div class="kpi" [class.kpi-bad]="slaBreached()">
            <div class="kpi-label">Rolling uptime (90d)</div>
            <div class="kpi-value">
              @if (sla()?.rolling_uptime_pct !== null && sla()?.rolling_uptime_pct !== undefined) {
                <app-rolling-counter [value]="sla()!.rolling_uptime_pct!" [decimals]="2" suffix="%" />
              } @else {
                <span class="text-text-secondary">—</span>
              }
            </div>
          </div>
        </section>

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
            <ul class="export-list mt-4">
              @for (e of exports(); track e.id) {
                <li>
                  <span class="font-mono text-[0.7rem]">{{ e.range_start }} → {{ e.range_end }}</span>
                  <span class="status status-{{ e.status }}">{{ e.status }}</span>
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
      .card { background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.06); border-radius: 14px; padding: 16px 18px; }
      .card-h { font-size: 0.92rem; color: var(--ps-ink, #f4f4ff); margin: 0 0 10px; font-weight: 600; }
      .hint { font-size: 0.72rem; color: rgba(244,244,255,.55); margin: 10px 0 0; }
      .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      label { display: block; font-size: 0.72rem; color: rgba(244,244,255,.7); }
      /* .input/.select/.textarea removed — all controls now Spartan hlmInput/hlmSelect. */
      .kpi { background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.06); border-radius: 12px; padding: 14px 16px; }
      .kpi-label { font-size: 0.7rem; color: rgba(244,244,255,.55); }
      .kpi-value { font-size: 1.15rem; color: var(--ps-ink, #f4f4ff); font-weight: 600; margin-top: 4px; }
      .kpi-bad { border-color: rgba(255,80,80,.4); }
      .empty-card { background: rgba(255,255,255,.02); border: 1px dashed rgba(255,255,255,.08); border-radius: 12px; padding: 16px 18px; }
      .export-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
      .export-list li { display: flex; gap: 12px; align-items: center; padding: 6px 0; border-top: 1px solid rgba(255,255,255,.04); }
      .status { font-size: 0.68rem; padding: 2px 8px; border-radius: 999px; }
      .status-pending { background: rgba(255,200,0,.12); color: #ffc800; }
      .status-ready   { background: rgba(0,229,255,.12); color: var(--ps-accent, #00e5ff); }
      .status-failed  { background: rgba(255,80,80,.12); color: #f87171; }
      .status-expired { background: rgba(255,255,255,.06); color: rgba(244,244,255,.5); }
    `,
  ],
})
export class AdminEnterpriseComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly contract = signal<Contract | null>(null);
  readonly sla = signal<SlaResponse | null>(null);
  readonly exports = signal<AuditExport[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly enqueueing = signal(false);
  readonly notFound = signal(false);

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

  constructor() {
    this.refresh();
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
    this.api.get<{ data: Contract | null }>('/api/enterprise/contract').subscribe({
      next: (res) => {
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
        if (err?.status === 404) this.notFound.set(true);
        else this.toast.error('Failed to load enterprise contract');
        this.loading.set(false);
      },
    });

    this.api.get<{ data: SlaResponse }>('/api/enterprise/sla').subscribe({
      next: (res) => this.sla.set(res.data),
      error: () => undefined,
    });

    this.api
      .get<{ data: AuditExport[] }>('/api/enterprise/audit-exports')
      .subscribe({
        next: (res) => this.exports.set(res.data ?? []),
        error: () => undefined,
      });
  }

  saveContract(): void {
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
    this.api.put<{ data: Contract }>('/api/enterprise/contract', body).subscribe({
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
      .post<{ data: AuditExport }>('/api/enterprise/audit-exports', {
        range_start: this.rangeStart(),
        range_end: this.rangeEnd(),
      })
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
