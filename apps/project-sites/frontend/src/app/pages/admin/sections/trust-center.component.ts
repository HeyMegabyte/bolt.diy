/**
 * @module pages/admin/sections/trust-center
 *
 * @description
 * Trust Center admin surface — idea #50.
 *
 * Org-level admin route at `/admin/trust`. Surfaces:
 *   - AI models used (vendor / model / version / purpose)
 *   - Data residency
 *   - Audit-log access policy
 *   - Content provenance
 *   - AI-outage behavior
 *   - Custom disclosures (Markdown)
 *   - Publish toggle (exposes /trust on every published site)
 *
 * Routes to GET/PUT /api/trust/profile + POST /api/trust/profile/publish.
 *
 * Design tokens per `_polish.scss`: --ps-bg, --ps-ink, --ps-accent.
 *
 * @packageDocumentation
 */
import {
  Component,
  inject,
  signal,
  computed,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HlmInputDirective, HlmSelectDirective } from '../../../ui';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { FeatureFlagService } from '../../../services/feature-flag.service';
import { RevealDirective } from '../../../directives/reveal.directive';

type DataResidency = 'global' | 'us' | 'eu' | 'apac';
type AuditLogPolicy = 'on-request' | 'self-serve' | 'realtime-stream';
type AiOutageBehavior =
  | 'graceful-degradation'
  | 'queue-and-retry'
  | 'manual-fallback';

interface AiModelEntry {
  vendor: string;
  model: string;
  version?: string;
  purpose: string;
  policy_url?: string;
}

interface ContentProvenanceEntry {
  area: string;
  origin: 'ai-generated' | 'human-authored' | 'ai-assisted';
  reviewed_by?: string;
  notes?: string;
}

interface TrustProfile {
  id: string;
  org_id: string;
  site_id: string | null;
  ai_models: AiModelEntry[];
  data_residency: DataResidency;
  audit_log_policy: AuditLogPolicy;
  content_provenance: ContentProvenanceEntry[];
  ai_outage_behavior: AiOutageBehavior;
  custom_disclosures: string | null;
  published: boolean;
  published_at: string | null;
  updated_at: string;
}

interface ProfileEnvelope {
  data: TrustProfile | null;
}

@Component({
  selector: 'app-admin-trust-center',
  standalone: true,
  imports: [RevealDirective, CommonModule, FormsModule, RouterLink, HlmInputDirective, HlmSelectDirective],
  template: `
    <div class="p-7 flex-1 overflow-y-auto max-md:p-4 space-y-6">
      <header class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div class="kicker">Trust Center</div>
          <h2 class="section-h text-lg font-bold text-white m-0">
            AI transparency + data handling
          </h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            Surfaces on the public <code>/trust</code> page of every
            published site. EU AI Act high-risk obligations launch
            Aug 2 2026 — this is a compliance + sales asset.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <a routerLink="/admin" class="btn-ghost text-xs">← Admin</a>
          <button class="btn-ghost text-xs" (click)="refresh()" [disabled]="loading()">
            {{ loading() ? 'Loading…' : 'Refresh' }}
          </button>
          <button class="btn-primary text-xs" (click)="save()" [disabled]="saving()">
            {{ saving() ? 'Saving…' : 'Save' }}
          </button>
          @if (profile()?.published) {
            <span class="badge-pub" title="Profile is live on public /trust">Live</span>
          } @else {
            <button class="btn-primary text-xs" (click)="publish()" [disabled]="publishing()">
              {{ publishing() ? 'Publishing…' : 'Publish' }}
            </button>
          }
        </div>
      </header>

      @if (notFound()) {
        <div class="empty-card">
          <p class="text-text-secondary text-sm">
            Trust Center is disabled for your org. Ask an admin to enable
            the <code>trust_center</code> feature flag.
          </p>
        </div>
      }

      @if (loadError() && !loading()) {
        <div class="empty-card" data-testid="trust-load-error" role="alert">
          <p class="text-red-300 text-sm mb-2">{{ loadError() }}</p>
          <button class="btn-ghost text-xs" data-testid="trust-retry" (click)="refresh()">Retry</button>
        </div>
      }

      @if (!notFound() && !loadError()) {
        <section class="card" appReveal>
          <h3 class="card-h">Data residency</h3>
          <select
            hlmSelect
            aria-label="Data residency"
            [ngModel]="dataResidency()"
            (ngModelChange)="dataResidency.set($event)"
          >
            <option value="global">Global</option>
            <option value="us">United States</option>
            <option value="eu">European Union</option>
            <option value="apac">Asia-Pacific</option>
          </select>
        </section>

        <section class="card" appReveal>
          <h3 class="card-h">Audit-log access policy</h3>
          <select
            hlmSelect
            aria-label="Audit-log access policy"
            [ngModel]="auditPolicy()"
            (ngModelChange)="auditPolicy.set($event)"
          >
            <option value="on-request">On request (support email)</option>
            <option value="self-serve">Self-serve (admin export)</option>
            <option value="realtime-stream">Realtime stream (OTLP)</option>
          </select>
        </section>

        <section class="card" appReveal>
          <h3 class="card-h">AI-outage behavior</h3>
          <select
            hlmSelect
            aria-label="AI-outage behavior"
            [ngModel]="aiOutage()"
            (ngModelChange)="aiOutage.set($event)"
          >
            <option value="graceful-degradation">Graceful degradation</option>
            <option value="queue-and-retry">Queue + retry</option>
            <option value="manual-fallback">Manual fallback</option>
          </select>
        </section>

        <section class="card" appReveal>
          <h3 class="card-h">AI models used ({{ aiModels().length }})</h3>
          <p class="hint">
            Each row appears on the public /trust page with vendor + model
            + purpose + (optional) link to the provider's policy.
          </p>
          @for (m of aiModels(); let i = $index; track i) {
            <div class="row">
              <input hlmInput placeholder="Vendor" [value]="m.vendor"
                (input)="patchModel(i, 'vendor', $any($event.target).value)" />
              <input hlmInput placeholder="Model" [value]="m.model"
                (input)="patchModel(i, 'model', $any($event.target).value)" />
              <input hlmInput placeholder="Purpose" [value]="m.purpose"
                (input)="patchModel(i, 'purpose', $any($event.target).value)" />
              <button class="btn-ghost-sm" (click)="removeModel(i)" aria-label="Remove">×</button>
            </div>
          }
          <button class="btn-ghost-sm" (click)="addModel()">+ Add model</button>
        </section>

        <section class="card" appReveal>
          <h3 class="card-h">Content provenance ({{ provenance().length }})</h3>
          <p class="hint">
            Describe which page areas are AI-generated, AI-assisted, or
            human-authored.
          </p>
          @for (p of provenance(); let i = $index; track i) {
            <div class="row">
              <input hlmInput placeholder="Area (e.g. homepage hero)" [value]="p.area"
                (input)="patchProv(i, 'area', $any($event.target).value)" />
              <select hlmSelect aria-label="AI provenance origin" [value]="p.origin"
                (change)="patchProv(i, 'origin', $any($event.target).value)">
                <option value="ai-generated">AI-generated</option>
                <option value="ai-assisted">AI-assisted</option>
                <option value="human-authored">Human-authored</option>
              </select>
              <input hlmInput placeholder="Reviewed by (optional)" [value]="p.reviewed_by ?? ''"
                (input)="patchProv(i, 'reviewed_by', $any($event.target).value)" />
              <button class="btn-ghost-sm" (click)="removeProv(i)" aria-label="Remove">×</button>
            </div>
          }
          <button class="btn-ghost-sm" (click)="addProv()">+ Add area</button>
        </section>

        <section class="card" appReveal>
          <h3 class="card-h">Custom disclosures</h3>
          <p class="hint">Markdown. Renders above auto-generated sections on /trust.</p>
          <textarea
            hlmInput [multiline]="true"
            rows="6"
            [ngModel]="customDisclosures() ?? ''"
            (ngModelChange)="customDisclosures.set($event)"
            placeholder="### Additional disclosures…"
          ></textarea>
        </section>

        @if (publishedAt()) {
          <p class="text-text-secondary text-xs">
            Last published {{ publishedAt() | date: 'medium' }}.
          </p>
        }
      }
    </div>
  `,
  styles: [
    `
      .card { background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.06); border-radius: 14px; padding: 16px 18px; }
      .card-h { font-size: 0.92rem; color: var(--ps-ink, #f4f4ff); margin: 0 0 10px; font-weight: 600; }
      .hint { font-size: 0.72rem; color: rgba(244,244,255,.55); margin: 0 0 10px; }
      .row { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 8px; margin-bottom: 8px; align-items: center; }
      /* .input/.select/.textarea removed — all controls now Spartan hlmInput/hlmSelect. */
      .badge-pub { font-size: 0.7rem; padding: 4px 10px; border-radius: 999px; background: rgba(0,229,255,.12); border: 1px solid rgba(0,229,255,.35); color: var(--ps-accent, #00e5ff); }
      .empty-card { background: rgba(255,255,255,.02); border: 1px dashed rgba(255,255,255,.08); border-radius: 12px; padding: 16px 18px; }
      .btn-ghost-sm { font-size: 0.72rem; padding: 4px 10px; border-radius: 6px; background: transparent; border: 1px solid rgba(255,255,255,.12); color: rgba(244,244,255,.7); cursor: pointer; }
      .btn-ghost-sm:hover { color: var(--ps-ink); border-color: rgba(255,255,255,.2); }
    `,
  ],
})
export class AdminTrustCenterComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly flags = inject(FeatureFlagService);

  readonly profile = signal<TrustProfile | null>(null);
  readonly loading = signal(false);
  /** Persistent non-404 load failure — gates the editor so a failed fetch never presents a default-valued, publishable form. */
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly publishing = signal(false);
  // Pessimistic: assume trust_center is OFF until the client-side flag check
  // confirms it's on — shows the disabled card first and prevents the
  // unconditional /trust/* fetch from firing (which would auto-toast on the
  // intentional 404 of a disabled feature).
  readonly notFound = signal(true);

  // Editable signals so the form binds to mutable state.
  readonly dataResidency = signal<DataResidency>('global');
  readonly auditPolicy = signal<AuditLogPolicy>('on-request');
  readonly aiOutage = signal<AiOutageBehavior>('graceful-degradation');
  readonly customDisclosures = signal<string | null>(null);
  readonly aiModels = signal<AiModelEntry[]>([]);
  readonly provenance = signal<ContentProvenanceEntry[]>([]);

  readonly publishedAt = computed(
    () => this.profile()?.published_at ?? null,
  );

  constructor() {
    // Gate the org-scoped fetch on the actual flag (mirrors inbox/enterprise).
    // Flag off → keep the disabled card (notFound stays true) and never fire
    // /trust/* → no spurious 404 → no error toast.
    this.flags
      .isOn('trust_center')
      .pipe(takeUntilDestroyed())
      .subscribe((on) => {
        if (on) {
          this.notFound.set(false);
          this.refresh();
        }
      });
  }

  refresh(): void {
    this.loading.set(true);
    this.notFound.set(false);
    this.loadError.set(null);
    this.api.get<ProfileEnvelope>('/trust/profile').subscribe({
      next: (res) => {
        this.loadError.set(null);
        this.profile.set(res.data);
        if (res.data) {
          this.dataResidency.set(res.data.data_residency);
          this.auditPolicy.set(res.data.audit_log_policy);
          this.aiOutage.set(res.data.ai_outage_behavior);
          this.customDisclosures.set(res.data.custom_disclosures);
          this.aiModels.set([...res.data.ai_models]);
          this.provenance.set([...res.data.content_provenance]);
        }
        this.loading.set(false);
      },
      error: (err) => {
        if (err?.status === 404) {
          this.notFound.set(true);
        } else {
          // Persistent in-panel error gates the editor — a failed load must not
          // present a default-valued form the operator could publish over real data.
          this.loadError.set("Couldn't load your Trust Center profile — retry before editing.");
          this.toast.error('Failed to load Trust Center profile');
        }
        this.loading.set(false);
      },
    });
  }

  save(): void {
    this.saving.set(true);
    const body = {
      data_residency: this.dataResidency(),
      audit_log_policy: this.auditPolicy(),
      ai_outage_behavior: this.aiOutage(),
      custom_disclosures: this.customDisclosures(),
      ai_models: this.aiModels().filter((m) => m.vendor && m.model && m.purpose),
      content_provenance: this.provenance().filter((p) => p.area),
    };
    this.api
      .put<{ data: TrustProfile }>('/trust/profile', body)
      .subscribe({
        next: (res) => {
          this.profile.set(res.data);
          this.toast.success('Trust profile saved');
          this.saving.set(false);
        },
        error: () => {
          this.toast.error('Failed to save Trust profile');
          this.saving.set(false);
        },
      });
  }

  publish(): void {
    this.publishing.set(true);
    this.api
      .post<{ data: TrustProfile }>('/trust/profile/publish', {})
      .subscribe({
        next: (res) => {
          this.profile.set(res.data);
          this.toast.success('Trust profile published');
          this.publishing.set(false);
        },
        error: () => {
          this.toast.error('Failed to publish Trust profile');
          this.publishing.set(false);
        },
      });
  }

  addModel(): void {
    this.aiModels.update((rows) => [
      ...rows,
      { vendor: '', model: '', purpose: '' },
    ]);
  }
  removeModel(i: number): void {
    this.aiModels.update((rows) => rows.filter((_, idx) => idx !== i));
  }
  patchModel(i: number, field: keyof AiModelEntry, value: string): void {
    this.aiModels.update((rows) =>
      rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)),
    );
  }

  addProv(): void {
    this.provenance.update((rows) => [
      ...rows,
      { area: '', origin: 'ai-assisted' },
    ]);
  }
  removeProv(i: number): void {
    this.provenance.update((rows) => rows.filter((_, idx) => idx !== i));
  }
  patchProv(
    i: number,
    field: keyof ContentProvenanceEntry,
    value: string,
  ): void {
    this.provenance.update((rows) =>
      rows.map((r, idx) =>
        idx === i ? { ...r, [field]: value as never } : r,
      ),
    );
  }
}
