/**
 * @module pages/admin-v2/sections/site-ai-endpoints
 *
 * Per-site AI Endpoints EDITOR — the real tool, not a list. Driven by the topbar
 * Project dropdown. List view: cards of the site's endpoints (method · slug ·
 * kind · language · deploy badge) + "New endpoint". Editor view: pick an
 * endpoint → load its `files` map → edit code in an editable Monaco with a
 * file-tab strip → Save (`updateAiEndpoint`) + Deploy (`deployAiEndpoint`).
 * Mirrors the legacy admin endpoint editor. 4-state + no-site state on helm
 * primitives per [[spartan-ui-design-system]]; ToastService for action feedback.
 *
 * @example Routed as `site/ai-endpoints` under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { ApiService, type AiEndpointRow, type AiEndpointDetail } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
  HlmInputDirective,
  HlmBadgeDirective,
  type BadgeVariant,
} from '../../../ui';
import { RelativeDatePipe } from './relative-date.pipe';
import { V2CodeViewerComponent } from './code-viewer.component';
import { V2SiteContextService } from '../v2-site-context.service';

type EndpointsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: AiEndpointRow[] };

const LANG_MAP: Record<string, string> = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  'ai-prompt': 'markdown',
};

@Component({
  selector: 'app-v2-site-ai-endpoints',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    HlmInputDirective,
    HlmBadgeDirective,
    RelativeDatePipe,
    V2CodeViewerComponent,
  ],
  template: `
    @if (!ctx.selectedSite()) {
      <div hlmCard class="max-w-md mx-auto mt-16 text-center" data-testid="v2-site-ai-endpoints-nosite">
        <h3 hlmCardTitle>No site selected</h3>
        <p hlmCardDescription class="mt-1">Pick a project from the dropdown above to edit its AI endpoints.</p>
      </div>
    } @else {
      <!-- EDITOR VIEW -->
      @if (editing(); as ep) {
        <div class="mb-3 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 min-w-0">
            <button hlmBtn variant="ghost" size="sm" (click)="closeEditor()" data-testid="v2-ep-back">← Endpoints</button>
            <h2 class="text-lg font-semibold text-foreground truncate font-mono">/{{ ep.endpoint_slug }}</h2>
            <span hlmBadge variant="info" class="shrink-0">{{ ep.language || 'worker' }}</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button hlmBtn variant="secondary" size="sm" [disabled]="saving()" (click)="save(ep)" data-testid="v2-ep-save">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
            <button hlmBtn variant="primary" size="sm" [disabled]="deploying()" (click)="deploy(ep)" data-testid="v2-ep-deploy">
              {{ deploying() ? 'Deploying…' : 'Deploy' }}
            </button>
          </div>
        </div>

        <!-- file tab strip -->
        <div class="flex flex-wrap gap-1.5 mb-2" data-testid="v2-ep-files">
          @for (f of fileNames(); track f) {
            <button hlmBtn size="sm" [variant]="activeFile() === f ? 'primary' : 'ghost'"
                    (click)="activeFile.set(f)" class="font-mono text-xs"
                    [attr.data-testid]="'v2-ep-file-' + f">{{ f }}</button>
          }
        </div>

        <app-v2-code-viewer
          [value]="activeContent()"
          [language]="monacoLang(ep.language)"
          [readOnly]="false"
          (valueChange)="onCode($event)"
          [label]="'Editing ' + ep.endpoint_slug + ' / ' + activeFile()"
          data-testid="v2-ep-editor" />
        <p class="mt-2 text-xs text-muted-foreground">Save persists your edits; Deploy publishes them to the live endpoint.</p>
      } @else {
        <!-- LIST VIEW -->
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold text-foreground">AI Endpoints</h2>
            <p class="text-sm text-muted-foreground">Custom AI-backed API routes for {{ ctx.selectedSite()!.business_name }}</p>
          </div>
          <button hlmBtn variant="primary" size="sm" (click)="startCreate()" data-testid="v2-ep-new">+ New endpoint</button>
        </div>

        @if (showCreate()) {
          <div hlmCard class="mb-3 max-w-lg" data-testid="v2-ep-create">
            <h3 hlmCardTitle>New endpoint</h3>
            <div class="mt-3 flex flex-col gap-2">
              <input hlmInput class="h-8" placeholder="slug (a-z0-9-)" [value]="newSlug()"
                     (input)="newSlug.set(asInput($event))" data-testid="v2-ep-new-slug" aria-label="Endpoint slug" />
              <select hlmInput class="h-8" [value]="newLang()" (change)="newLang.set(asSelect($event))" aria-label="Language" data-testid="v2-ep-new-lang">
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
                <option value="python">Python</option>
                <option value="ai-prompt">AI prompt</option>
              </select>
              <div class="flex gap-2">
                <button hlmBtn variant="primary" size="sm" [disabled]="!newSlug() || creating()" (click)="create()" data-testid="v2-ep-create-go">
                  {{ creating() ? 'Creating…' : 'Create' }}
                </button>
                <button hlmBtn variant="ghost" size="sm" (click)="showCreate.set(false)">Cancel</button>
              </div>
            </div>
          </div>
        }

        @switch (state().status) {
          @case ('loading') {
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="v2-site-ai-endpoints-loading">
              @for (s of [0,1,2,3]; track s) { <div hlmCard class="h-20 animate-pulse opacity-60"></div> }
            </div>
          }
          @case ('error') {
            <div hlmCard class="max-w-md mx-auto mt-12 text-center" role="alert" data-testid="v2-site-ai-endpoints-error">
              <h3 hlmCardTitle>Couldn't load AI endpoints</h3>
              <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
              <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
            </div>
          }
          @case ('ready') {
            @if (rows().length === 0) {
              <div hlmCard class="text-center py-8" data-testid="v2-site-ai-endpoints-empty">
                <p hlmCardDescription>No AI endpoints yet — create one to expose a custom AI-backed route.</p>
              </div>
            } @else {
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="v2-site-ai-endpoints-grid">
                @for (ep of rows(); track ep.id) {
                  <button hlmCard class="text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                          (click)="openEditor(ep)" data-testid="v2-site-ai-endpoints-card">
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex items-center gap-2 min-w-0">
                        <span hlmBadge variant="neutral" class="shrink-0 font-mono">{{ ep.method || 'GET' }}</span>
                        <h4 class="text-sm font-medium text-foreground truncate">{{ ep.display_name || ep.endpoint_slug }}</h4>
                      </div>
                      <span hlmBadge [variant]="deployVariant(ep)" class="shrink-0">{{ deployLabel(ep) }}</span>
                    </div>
                    <p class="mt-1 font-mono text-xs text-muted-foreground truncate">/{{ ep.endpoint_slug }}</p>
                    <div class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      @if (ep.kind) { <span hlmBadge variant="info">{{ ep.kind }}</span> }
                      @if (lang(ep); as l) { <span hlmBadge variant="neutral">{{ l }}</span> }
                      <span class="flex-1"></span>
                      <span class="tabular-nums" [title]="ep.created_at">{{ ep.created_at | relativeDate }}</span>
                    </div>
                  </button>
                }
              </div>
            }
          }
        }
      }
    }
  `,
})
export class V2SiteAiEndpointsComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly ctx = inject(V2SiteContextService);

  protected readonly state = toSignal(
    toObservable(this.ctx.selectedSite).pipe(
      switchMap((site) =>
        site
          ? this.api.getAiEndpoints(site.id).pipe(
              map((r) => ({ status: 'ready', rows: r.data ?? [] }) as EndpointsState),
              startWith({ status: 'loading' } as EndpointsState),
              catchError((e: unknown) =>
                of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as EndpointsState),
              ),
            )
          : of({ status: 'ready', rows: [] } as EndpointsState),
      ),
    ),
    { initialValue: { status: 'loading' } as EndpointsState },
  );

  protected readonly rows = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.rows : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  // ── editor state ─────────────────────────────────────────────
  protected readonly editing = signal<AiEndpointDetail | null>(null);
  protected readonly activeFile = signal<string>('');
  protected readonly saving = signal(false);
  protected readonly deploying = signal(false);

  protected readonly fileNames = computed(() => Object.keys(this.editing()?.files ?? {}));
  protected readonly activeContent = computed(() => this.editing()?.files?.[this.activeFile()] ?? '');

  protected openEditor(ep: AiEndpointRow): void {
    const site = this.ctx.selectedSite();
    if (!site) return;
    this.api.getAiEndpointDetail(site.id, ep.id).subscribe({
      next: (r) => {
        const detail = r.data;
        this.editing.set(detail);
        this.activeFile.set(Object.keys(detail.files ?? {})[0] ?? '');
      },
      error: () => this.toast.error('Could not load the endpoint code.'),
    });
  }

  protected closeEditor(): void {
    this.editing.set(null);
  }

  protected onCode(code: string): void {
    const ep = this.editing();
    const f = this.activeFile();
    if (!ep || !f) return;
    this.editing.set({ ...ep, files: { ...ep.files, [f]: code } });
  }

  protected save(ep: AiEndpointDetail): void {
    const site = this.ctx.selectedSite();
    if (!site) return;
    this.saving.set(true);
    this.api.updateAiEndpoint(site.id, ep.id, { files: ep.files }).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Endpoint saved.');
      },
      error: () => {
        this.saving.set(false);
        this.toast.error('Save failed.');
      },
    });
  }

  protected deploy(ep: AiEndpointDetail): void {
    const site = this.ctx.selectedSite();
    if (!site) return;
    this.deploying.set(true);
    this.api.deployAiEndpoint(site.id, ep.id).subscribe({
      next: () => {
        this.deploying.set(false);
        this.toast.success('Deploy started.');
      },
      error: () => {
        this.deploying.set(false);
        this.toast.error('Deploy failed.');
      },
    });
  }

  // ── create flow ──────────────────────────────────────────────
  protected readonly showCreate = signal(false);
  protected readonly newSlug = signal('');
  protected readonly newLang = signal('javascript');
  protected readonly creating = signal(false);

  protected startCreate(): void {
    this.showCreate.set(true);
  }
  protected create(): void {
    const site = this.ctx.selectedSite();
    const slug = this.newSlug().trim();
    if (!site || !slug) return;
    this.creating.set(true);
    this.api.createAiEndpoint(site.id, { endpoint_slug: slug, language: this.newLang() }).subscribe({
      next: (r) => {
        this.creating.set(false);
        this.showCreate.set(false);
        this.newSlug.set('');
        this.toast.success('Endpoint created.');
        this.openEditor(r.data);
      },
      error: () => {
        this.creating.set(false);
        this.toast.error('Create failed — check the slug.');
      },
    });
  }

  protected asInput(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }
  protected asSelect(e: Event): string {
    return (e.target as HTMLSelectElement).value;
  }

  protected monacoLang(language: string | null | undefined): string {
    return LANG_MAP[language ?? 'javascript'] ?? 'javascript';
  }
  protected lang(ep: AiEndpointRow): string | null {
    return ep.language || ep.worker_language || null;
  }
  protected deployLabel(ep: AiEndpointRow): string {
    if (ep.enabled === 0 || ep.enabled === false) return 'disabled';
    return ep.deploy_status || (ep.deployed_at ? 'deployed' : 'draft');
  }
  protected deployVariant(ep: AiEndpointRow): BadgeVariant {
    if (ep.enabled === 0 || ep.enabled === false) return 'neutral';
    const s = (ep.deploy_status || (ep.deployed_at ? 'deployed' : 'draft')).toLowerCase();
    if (s.includes('deploy') || s.includes('live') || s.includes('active')) return 'success';
    if (s.includes('fail') || s.includes('error')) return 'danger';
    if (s.includes('pending') || s.includes('deploying')) return 'warning';
    return 'neutral';
  }

  protected reload(): void {
    location.reload();
  }
}
