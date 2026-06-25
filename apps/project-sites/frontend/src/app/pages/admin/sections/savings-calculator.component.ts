/**
 * A12 — "Replace your SaaS" savings calculator. Frames the self-hostable app
 * catalog as a SaaS-bill teardown: tick the tools you'd run, see what the
 * equivalent paid SaaS would cost vs. self-hosting them here, and the monthly +
 * annual savings. Pure frontend — reads `estCostMonthly` from the catalog and a
 * curated SaaS-equivalent price map (cheapest comparable paid tier, USD/mo).
 */
import { Component, signal, computed } from '@angular/core';
import { APPS_CATALOG } from './apps-catalog.data';

/** Curated cheapest-comparable paid-SaaS equivalents (USD / month). */
const SAAS_EQUIVALENTS: Readonly<Record<string, { name: string; monthlyUsd: number }>> = {
  plausible: { name: 'Plausible Cloud', monthlyUsd: 9 },
  umami: { name: 'Fathom Analytics', monthlyUsd: 14 },
  matomo: { name: 'Matomo Cloud', monthlyUsd: 26 },
  ghost: { name: 'Ghost Pro', monthlyUsd: 25 },
  outline: { name: 'Notion', monthlyUsd: 10 },
  wikijs: { name: 'Confluence', monthlyUsd: 6 },
  nocodb: { name: 'Airtable', monthlyUsd: 20 },
  cal: { name: 'Calendly', monthlyUsd: 12 },
  vaultwarden: { name: '1Password', monthlyUsd: 36 },
  listmonk: { name: 'Mailchimp', monthlyUsd: 20 },
  mautic: { name: 'HubSpot Marketing', monthlyUsd: 20 },
  n8n: { name: 'Zapier', monthlyUsd: 29 },
  'uptime-kuma': { name: 'Pingdom', monthlyUsd: 15 },
  grafana: { name: 'Datadog', monthlyUsd: 15 },
  directus: { name: 'Contentful', monthlyUsd: 30 },
  nextcloud: { name: 'Dropbox', monthlyUsd: 12 },
  immich: { name: 'Google One', monthlyUsd: 10 },
  mattermost: { name: 'Slack', monthlyUsd: 9 },
  gitea: { name: 'GitHub Team', monthlyUsd: 4 },
  'open-webui': { name: 'ChatGPT Plus', monthlyUsd: 20 },
  langfuse: { name: 'LangSmith', monthlyUsd: 39 },
  freshrss: { name: 'Feedly Pro', monthlyUsd: 8 },
  postiz: { name: 'Buffer', monthlyUsd: 15 },
};

interface SavingsRow {
  id: string;
  name: string;
  saasName: string;
  saasUsd: number;
  selfHostUsd: number;
  savesUsd: number;
}

/** Build the comparison rows (only catalog apps with a SaaS equivalent + a real saving). */
export function buildSavingsRows(): SavingsRow[] {
  return APPS_CATALOG.flatMap((app) => {
    const eq = SAAS_EQUIVALENTS[app.id];
    if (!eq) return [];
    const saves = eq.monthlyUsd - app.estCostMonthly;
    if (saves <= 0) return [];
    return [
      {
        id: app.id,
        name: app.name,
        saasName: eq.name,
        saasUsd: eq.monthlyUsd,
        selfHostUsd: app.estCostMonthly,
        savesUsd: saves,
      },
    ];
  }).sort((a, b) => b.savesUsd - a.savesUsd);
}

@Component({
  selector: 'app-savings-calculator',
  standalone: true,
  template: `
    <section class="sav" data-testid="savings-calculator">
      <header class="sav-head">
        <h2 class="sav-title">Replace your SaaS bill</h2>
        <p class="sav-sub">
          Tick the tools you'd run. See what the paid SaaS would cost vs. self-hosting here.
        </p>
      </header>

      <ul class="sav-list">
        @for (r of rows; track r.id) {
          <li class="sav-row" [class.sav-row--on]="picked().has(r.id)">
            <label class="sav-pick">
              <input
                type="checkbox"
                [checked]="picked().has(r.id)"
                (change)="toggle(r.id)"
                [attr.data-testid]="'sav-pick-' + r.id"
                [attr.aria-label]="'Include ' + r.name" />
              <span class="sav-name">{{ r.name }}</span>
            </label>
            <span class="sav-vs">replaces {{ r.saasName }}</span>
            <span class="sav-amt">
              <s class="sav-was">\${{ r.saasUsd }}</s>
              <span class="sav-now">\${{ r.selfHostUsd }}/mo</span>
            </span>
          </li>
        }
      </ul>

      <footer class="sav-foot" data-testid="sav-total">
        <div class="sav-line">
          <span>SaaS cost</span><span class="sav-strike">\${{ saasTotal() }}/mo</span>
        </div>
        <div class="sav-line">
          <span>Self-hosted here</span><span>\${{ selfTotal() }}/mo</span>
        </div>
        <div class="sav-save">
          You'd save <strong data-testid="sav-monthly">\${{ savedMonthly() }}/mo</strong>
          <span class="sav-year">(~\${{ savedAnnual() }}/yr)</span>
          across {{ picked().size }} {{ picked().size === 1 ? 'app' : 'apps' }}.
        </div>
      </footer>
    </section>
  `,
  styles: [
    `
      .sav {
        padding: 1rem 1.1rem 1.2rem;
        border-radius: 16px;
        border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 22%, transparent);
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 5%, transparent);
        margin-bottom: 1.25rem;
      }
      .sav-title {
        font-size: 1.05rem;
        font-weight: 800;
        color: #fff;
        margin: 0;
      }
      .sav-sub {
        font-size: 0.78rem;
        color: var(--text-secondary, #9aa);
        margin: 0.15rem 0 0.85rem;
      }
      .sav-list {
        list-style: none;
        margin: 0 0 0.85rem;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .sav-row {
        display: grid;
        grid-template-columns: 1fr auto auto;
        align-items: center;
        gap: 0.6rem;
        padding: 0.4rem 0.55rem;
        border-radius: 9px;
        font-size: 0.83rem;
      }
      .sav-row--on {
        background: rgba(255, 255, 255, 0.03);
      }
      .sav-pick {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        cursor: pointer;
      }
      .sav-name {
        color: #fff;
        font-weight: 600;
      }
      .sav-vs {
        font-size: 0.72rem;
        color: var(--text-secondary, #9aa);
      }
      .sav-amt {
        display: inline-flex;
        align-items: baseline;
        gap: 0.4rem;
        font-variant-numeric: tabular-nums;
      }
      .sav-was {
        color: #ff9b9b;
        font-size: 0.72rem;
      }
      .sav-now {
        color: var(--ps-accent, #00e5ff);
        font-weight: 700;
      }
      .sav-foot {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 0.7rem;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .sav-line {
        display: flex;
        justify-content: space-between;
        font-size: 0.78rem;
        color: var(--text-secondary, #9aa);
        font-variant-numeric: tabular-nums;
      }
      .sav-strike {
        color: #ff9b9b;
      }
      .sav-save {
        margin-top: 0.35rem;
        font-size: 0.92rem;
        color: #fff;
      }
      .sav-save strong {
        color: var(--ps-accent, #00e5ff);
        font-size: 1.05rem;
      }
      .sav-year {
        color: var(--text-secondary, #9aa);
        font-size: 0.78rem;
      }
    `,
  ],
})
export class SavingsCalculatorComponent {
  readonly rows = buildSavingsRows();
  /** Selected app ids — preselect all so the headline shows max savings instantly. */
  readonly picked = signal<ReadonlySet<string>>(new Set(this.rows.map((r) => r.id)));

  private selectedRows(): SavingsRow[] {
    const set = this.picked();
    return this.rows.filter((r) => set.has(r.id));
  }
  readonly saasTotal = computed(() => this.selectedRows().reduce((s, r) => s + r.saasUsd, 0));
  readonly selfTotal = computed(() => this.selectedRows().reduce((s, r) => s + r.selfHostUsd, 0));
  readonly savedMonthly = computed(() => this.saasTotal() - this.selfTotal());
  readonly savedAnnual = computed(() => this.savedMonthly() * 12);

  toggle(id: string): void {
    const next = new Set(this.picked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.picked.set(next);
  }
}
