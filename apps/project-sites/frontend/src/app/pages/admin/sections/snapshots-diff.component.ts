/**
 * Snapshot diff viewer (item #1 from the May 24 polish pass).
 *
 * Renders the side-by-side diff for two snapshots of the currently selected
 * site. Reads `?from=A&to=B` from the URL, fetches
 * `GET /api/sites/:siteId/snapshots/diff?from=A&to=B`, and renders:
 *  - An AI-summary banner at the top (one paragraph "what changed")
 *  - A file list grouped into Added / Removed / Modified
 *  - Per modified file: red/green-tinted line hunks via `diff.diffLines()`
 *    (computed server-side; we just paint the hunks)
 *  - An "Open in editor" CTA per file that deep-links bolt.diy:
 *    `https://editor.projectsites.dev/?file={path}&line=1`
 *
 * @see apps/project-sites/src/routes/api.ts  (GET /api/sites/:siteId/snapshots/diff)
 */
import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

interface DiffHunk {
  added: boolean;
  removed: boolean;
  value: string;
}

interface ModifiedFile {
  path: string;
  before: string;
  after: string;
  hunks: DiffHunk[];
  truncated: boolean;
}

interface PlainFile {
  path: string;
  contents: string;
  binary: boolean;
  truncated: boolean;
}

interface DiffResponse {
  from: { id: string; name: string; build_version: string };
  to: { id: string; name: string; build_version: string };
  added: PlainFile[];
  removed: PlainFile[];
  modified: ModifiedFile[];
  summary: string;
}

@Component({
  selector: 'app-admin-snapshots-diff',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6" data-testid="snapshots-diff-section">
      <header class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-[1.4rem] font-semibold text-white">Snapshot diff</h1>
          @if (diff(); as d) {
            <p class="text-[0.85rem] text-white/60 mt-1">
              <span class="text-[var(--ps-accent)]">{{ d.from.name }}</span>
              <span class="mx-2 text-white/40">→</span>
              <span class="text-[var(--ps-accent)]">{{ d.to.name }}</span>
            </p>
          }
        </div>
        <a routerLink="/admin/snapshots"
           class="text-[0.82rem] text-white/70 hover:text-white px-3 py-1.5 rounded-md border border-white/10">
          ← Back to snapshots
        </a>
      </header>

      @if (loading()) {
        <div class="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center text-white/60">
          Computing diff…
        </div>
      } @else if (error()) {
        <div class="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-red-200 text-sm">
          {{ error() }}
        </div>
      } @else if (diff()) {
        @let d = diff()!;
        <!-- AI summary banner -->
        @if (d.summary) {
          <section class="rounded-xl border border-[var(--ps-accent)]/20 bg-[var(--ps-accent)]/[0.04] p-4">
            <div class="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--ps-accent)] mb-2">
              What changed (AI summary)
            </div>
            <p class="text-[0.92rem] text-white/85 leading-relaxed">{{ d.summary }}</p>
          </section>
        }

        <!-- Stat row -->
        <div class="grid grid-cols-3 gap-3">
          <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-3">
            <div class="text-[0.7rem] uppercase tracking-wide text-emerald-300/80">Added</div>
            <div class="text-2xl font-semibold text-emerald-200 mt-1">{{ d.added.length }}</div>
          </div>
          <div class="rounded-lg border border-red-500/20 bg-red-500/[0.05] p-3">
            <div class="text-[0.7rem] uppercase tracking-wide text-red-300/80">Removed</div>
            <div class="text-2xl font-semibold text-red-200 mt-1">{{ d.removed.length }}</div>
          </div>
          <div class="rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-3">
            <div class="text-[0.7rem] uppercase tracking-wide text-amber-300/80">Modified</div>
            <div class="text-2xl font-semibold text-amber-200 mt-1">{{ d.modified.length }}</div>
          </div>
        </div>

        <!-- Added files -->
        @if (d.added.length > 0) {
          <section>
            <h2 class="text-[0.95rem] font-semibold text-emerald-200 mb-2">Added files</h2>
            <ul class="rounded-xl border border-white/10 bg-white/[0.02] divide-y divide-white/[0.06]">
              @for (f of d.added; track f.path) {
                <li class="flex items-center justify-between gap-3 px-4 py-2.5">
                  <code class="text-[0.82rem] text-emerald-200 font-mono truncate">+ {{ f.path }}</code>
                  <a [href]="editorUrl(f.path)" target="_blank" rel="noopener"
                     class="text-[0.72rem] text-white/70 hover:text-white border border-white/15 px-2 py-1 rounded">
                    Open in editor
                  </a>
                </li>
              }
            </ul>
          </section>
        }

        <!-- Removed files -->
        @if (d.removed.length > 0) {
          <section>
            <h2 class="text-[0.95rem] font-semibold text-red-200 mb-2">Removed files</h2>
            <ul class="rounded-xl border border-white/10 bg-white/[0.02] divide-y divide-white/[0.06]">
              @for (f of d.removed; track f.path) {
                <li class="flex items-center justify-between gap-3 px-4 py-2.5">
                  <code class="text-[0.82rem] text-red-200 font-mono truncate">− {{ f.path }}</code>
                </li>
              }
            </ul>
          </section>
        }

        <!-- Modified files -->
        @if (d.modified.length > 0) {
          <section>
            <h2 class="text-[0.95rem] font-semibold text-amber-200 mb-2">Modified files</h2>
            <div class="space-y-4">
              @for (f of d.modified; track f.path) {
                <article class="rounded-xl border border-white/10 bg-[#0b0b18] overflow-hidden">
                  <header class="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-white/10 bg-white/[0.02]">
                    <code class="text-[0.82rem] text-amber-200 font-mono truncate">~ {{ f.path }}</code>
                    <div class="flex items-center gap-2">
                      @if (f.truncated) {
                        <span class="text-[0.65rem] text-amber-300/80 uppercase tracking-wide">Truncated 256KB</span>
                      }
                      <a [href]="editorUrl(f.path)" target="_blank" rel="noopener"
                         class="text-[0.72rem] text-white/70 hover:text-white border border-white/15 px-2 py-1 rounded">
                        Open in editor
                      </a>
                    </div>
                  </header>
                  <pre class="m-0 p-3 overflow-x-auto text-[0.78rem] leading-[1.55] font-mono"><!--
                  -->@for (h of f.hunks; track $index) {<!--
                    --><span [class.diff-add]="h.added"
                            [class.diff-rem]="h.removed"
                            [class.diff-ctx]="!h.added && !h.removed">{{ h.value }}</span><!--
                  -->}</pre>
                </article>
              }
            </div>
          </section>
        }

        @if (d.added.length === 0 && d.removed.length === 0 && d.modified.length === 0) {
          <div class="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center text-white/60">
            Snapshots are identical — no file changes detected.
          </div>
        }
      }
    </div>
  `,
  styles: [`
    /* Inline tints — kept here (not in _polish.scss, owned by another agent) */
    :host ::ng-deep .diff-add { display: block; background: rgba(16, 185, 129, 0.12); color: #b7f7d6; }
    :host ::ng-deep .diff-rem { display: block; background: rgba(239, 68, 68, 0.14); color: #fecaca; }
    :host ::ng-deep .diff-ctx { display: block; color: rgba(244, 244, 255, 0.7); }
    :host ::ng-deep pre { white-space: pre; }
  `],
})
export class AdminSnapshotsDiffComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  state = inject(AdminStateService);

  loading = signal(true);
  error = signal<string | null>(null);
  diff = signal<DiffResponse | null>(null);

  fromId = signal<string>('');
  toId = signal<string>('');

  /**
   * Editor deep-link template — bolt.diy accepts `?file=<path>&line=<n>`
   * to scroll the WebContainer to the right spot. We always pass `line=1`;
   * the upstream editor handles unknown paths with a friendly empty state.
   */
  editorUrl = (path: string): string => {
    const encoded = encodeURIComponent(path);
    return `https://editor.projectsites.dev/?file=${encoded}&line=1`;
  };

  selectedSiteId = computed(() => this.state.selectedSite()?.id ?? null);

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const from = params.get('from') ?? '';
      const to = params.get('to') ?? '';
      this.fromId.set(from);
      this.toId.set(to);
      this.load();
    });
  }

  private async load(): Promise<void> {
    const siteId = this.selectedSiteId();
    const from = this.fromId();
    const to = this.toId();
    if (!siteId) {
      this.error.set('No site selected. Pick a site from the sidebar.');
      this.loading.set(false);
      return;
    }
    if (!from || !to) {
      this.error.set('Both `from` and `to` snapshot ids are required in the URL.');
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const path = `/sites/${siteId}/snapshots/diff`;
      const res = await firstValueFrom(
        this.api.get<DiffResponse>(path, { from, to }),
      );
      this.diff.set(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('snapshot-diff load failed', { error: msg });
      this.error.set(`Could not load diff — ${msg}`);
      this.toast.error('Snapshot diff failed to load');
    } finally {
      this.loading.set(false);
    }
  }
}
