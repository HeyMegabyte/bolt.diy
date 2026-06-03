/**
 * Admin → Sites → MCP Server
 *
 * Per-site MCP server management (#29).
 * Accessible via `/admin/sites/:id/mcp-server`.
 *
 * Features:
 * - Token management (mint, copy, revoke)
 * - Tool list with per-tool inline "test" playground runner
 * - Per-tool usage chart (call_count last 30d)
 *
 * Design: cyan/black compact per [[cyan-black-compact-progression]].
 * Stats use `<app-rolling-counter>`.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { ToastService } from '../../../services/toast.service';
import { ConfirmService } from '../../../services/confirm.service';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { ErrorCardComponent } from '../../../components/states';
import { HlmInputDirective } from '../../../ui';
import { RevealDirective } from '../../../directives/reveal.directive';

interface McpToken {
  id: string;
  label: string;
  last_used: string | null;
  created_at: string;
}

interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  requiresAuth?: boolean;
}

interface ToolUsage {
  tool_name: string;
  day: string;
  call_count: number;
  error_count: number;
}

@Component({
  selector: 'app-site-mcp-server',
  standalone: true,
  imports: [FormsModule, RouterModule, RollingCounterComponent, ErrorCardComponent, RevealDirective, HlmInputDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-5 flex-1 overflow-y-auto space-y-5 animate-fade-in" data-testid="site-mcp-server">

      <!-- Header -->
      <header appReveal>
        <div class="kicker">External Agents</div>
        <h2 class="section-h m-0 mt-1 flex items-center gap-2">
          MCP Server
          <span class="header-pill">
            <span class="header-pill-dot" aria-hidden="true"></span>
            <app-rolling-counter [value]="totalCallsToday()" suffix=" calls today" />
          </span>
        </h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1 max-w-prose">
          External agents (Claude, GPT, Cursor) can read and write site content via the MCP CRUD
          tools. Authenticate with a per-site Bearer token minted below.
        </p>
        @if (siteSlug()) {
          <p class="text-[0.75rem] text-text-secondary m-0 mt-1 font-mono">
            Endpoint: <span class="text-accent">https://{{ siteSlug() }}.projectsites.dev/mcp</span>
          </p>
        }
      </header>

      <!-- Stats -->
      <div class="grid grid-cols-3 gap-3" appReveal>
        @for (stat of stats(); track stat.label) {
          <div class="card p-3 text-center">
            <app-rolling-counter [value]="stat.value" class="text-xl font-bold text-accent" />
            <div class="text-[0.7rem] text-text-secondary mt-0.5">{{ stat.label }}</div>
          </div>
        }
      </div>

      <!-- Tokens -->
      <section class="space-y-3" appReveal>
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold m-0">API Tokens</h3>
          <button
            class="btn-ghost text-xs px-2 py-1"
            data-testid="mint-token-btn"
            (click)="mintToken()"
            [disabled]="minting()"
          >{{ minting() ? 'Generating…' : '+ New Token' }}</button>
        </div>

        <!-- Newly minted token — show once -->
        @if (newTokenRaw()) {
          <div class="card p-3 border-accent/30 space-y-2" data-testid="new-token-banner">
            <p class="text-xs text-amber-400 font-semibold m-0">Copy this token now — it won't be shown again.</p>
            <div class="flex items-center gap-2">
              <code class="flex-1 text-accent text-[0.72rem] break-all bg-white/5 px-2 py-1.5 rounded">{{ newTokenRaw() }}</code>
              <button class="btn-ghost text-xs px-2" (click)="copyToken(newTokenRaw()!)">Copy</button>
            </div>
            <button class="btn-ghost text-xs text-text-secondary" (click)="newTokenRaw.set(null)">Dismiss</button>
          </div>
        }

        @if (tokensError() && tokens().length === 0) {
          <app-error-card
            title="Couldn't load tokens"
            [message]="tokensError()!"
            (retry)="loadTokens()" />
        } @else if (tokensLoading() && tokens().length === 0) {
          <div class="space-y-1.5">
            @for (i of [0,1]; track i) { <div class="skel h-9 rounded w-full"></div> }
          </div>
        } @else if (tokens().length === 0) {
          <div class="card p-4 text-center text-text-secondary text-xs">No tokens yet.</div>
        } @else {
          <div class="card overflow-hidden">
            <table class="w-full text-xs" data-testid="tokens-table">
              <thead>
                <tr class="border-b border-white/5 text-text-secondary text-[0.65rem] uppercase tracking-wider">
                  <th class="px-3 py-2 text-left font-medium">Label</th>
                  <th class="px-3 py-2 text-left font-medium">Last Used</th>
                  <th class="px-3 py-2 text-left font-medium">Created</th>
                  <th class="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (t of tokens(); track t.id) {
                  <tr class="border-b border-white/5 hover:bg-white/[0.02]" [attr.data-testid]="'token-row-' + t.id">
                    <td class="px-3 py-2 font-semibold">{{ t.label }}</td>
                    <td class="px-3 py-2 text-text-secondary">{{ t.last_used ? formatDate(t.last_used) : 'Never' }}</td>
                    <td class="px-3 py-2 text-text-secondary">{{ formatDate(t.created_at) }}</td>
                    <td class="px-3 py-2 text-right">
                      <button
                        class="btn-ghost text-[0.68rem] px-2 py-0.5 text-red-400"
                        data-testid="revoke-token-btn"
                        (click)="revokeToken(t.id)"
                        [disabled]="revoking() === t.id"
                      >Revoke</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <!-- Tool list -->
      <section class="space-y-3" appReveal>
        <h3 class="text-sm font-semibold m-0">Available Tools</h3>
        @if (toolsError() && tools().length === 0) {
          <app-error-card
            title="Couldn't load tools"
            [message]="toolsError()!"
            (retry)="loadTools()" />
        } @else if (toolsLoading() && tools().length === 0) {
          <div class="space-y-1.5">
            @for (i of [0,1,2,3]; track i) { <div class="skel h-9 rounded w-full"></div> }
          </div>
        } @else {
          <div class="card overflow-hidden">
            @for (tool of tools(); track tool.name; let last = $last) {
              <div
                class="px-3 py-2 flex items-center justify-between gap-3"
                [class.border-b]="!last"
                [class.border-white/5]="!last"
                [attr.data-testid]="'tool-row-' + tool.name"
              >
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <code class="text-accent text-[0.75rem] font-semibold">{{ tool.name }}</code>
                    @if (tool.requiresAuth) {
                      <span class="text-[0.62rem] bg-accent/10 text-accent px-1.5 rounded">auth required</span>
                    }
                    <span class="text-[0.65rem] text-text-secondary ml-auto">
                      {{ callsForTool(tool.name) }} calls (30d)
                    </span>
                  </div>
                  @if (tool.description) {
                    <p class="text-[0.72rem] text-text-secondary m-0 mt-0.5 truncate">{{ tool.description }}</p>
                  }
                </div>
                <button
                  class="btn-ghost text-[0.68rem] px-2 py-1 shrink-0"
                  data-testid="test-tool-btn"
                  (click)="openPlayground(tool)"
                >Test</button>
              </div>
            }
          </div>
        }
      </section>

      <!-- Inline playground -->
      @if (playgroundTool()) {
        <section class="card p-4 space-y-3" data-testid="tool-playground" appReveal>
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold m-0 font-mono text-accent">{{ playgroundTool()!.name }}</h3>
            <button class="btn-ghost text-xs" (click)="playgroundTool.set(null)">Close</button>
          </div>
          <div class="space-y-2">
            <label for="mcp-pg-args" class="text-[0.72rem] text-text-secondary font-medium">Arguments (JSON)</label>
            <textarea
              id="mcp-pg-args"
              hlmInput
              [multiline]="true"
              class="w-full font-mono text-xs min-h-[80px] resize-y"
              [(ngModel)]="playgroundArgs"
              placeholder="{}"
              data-testid="playground-args"
            ></textarea>
          </div>
          <div class="flex gap-2">
            <button
              class="btn-primary text-xs px-3"
              data-testid="playground-run-btn"
              (click)="runPlayground()"
              [disabled]="playgroundRunning()"
            >{{ playgroundRunning() ? 'Running…' : 'Run' }}</button>
          </div>
          @if (playgroundResult()) {
            <div class="space-y-1">
              <div class="text-[0.7rem] text-text-secondary font-medium">Result</div>
              <pre class="bg-white/5 rounded p-2 text-[0.72rem] overflow-x-auto whitespace-pre-wrap text-accent" data-testid="playground-result">{{ playgroundResult() }}</pre>
            </div>
          }
        </section>
      }

    </div>
  `,
})
export class SiteMcpServerComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly confirmSvc = inject(ConfirmService);

  readonly tokens = signal<McpToken[]>([]);
  readonly tools = signal<ToolDef[]>([]);
  readonly usage = signal<ToolUsage[]>([]);
  readonly tokensLoading = signal(true);
  readonly toolsLoading = signal(true);
  readonly tokensError = signal<string | null>(null);
  readonly toolsError = signal<string | null>(null);
  readonly minting = signal(false);
  readonly revoking = signal<string | null>(null);
  readonly newTokenRaw = signal<string | null>(null);
  readonly playgroundTool = signal<ToolDef | null>(null);
  readonly playgroundRunning = signal(false);
  readonly playgroundResult = signal<string | null>(null);
  readonly siteSlug = signal<string | null>(null);

  playgroundArgs = '{}';

  private siteId = '';

  readonly totalCallsToday = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    return this.usage()
      .filter((u) => u.day === today)
      .reduce((sum, u) => sum + u.call_count, 0);
  });

  readonly stats = computed(() => [
    { label: 'Tools', value: this.tools().length },
    { label: 'Tokens', value: this.tokens().length },
    { label: 'Calls Today', value: this.totalCallsToday() },
  ]);

  ngOnInit(): void {
    this.siteId = this.route.parent?.snapshot.params['id'] ?? this.route.snapshot.params['id'] ?? '';
    this.loadTokens();
    this.loadTools();
    this.loadUsage();
    this.loadSiteSlug();
  }

  private loadSiteSlug(): void {
    if (!this.siteId) return;
    this.http
      .get<{ data: { slug: string } }>(`/api/sites/${this.siteId}`)
      .pipe(catchError(() => of(null)))
      .subscribe((res) => {
        if (res?.data?.slug) this.siteSlug.set(res.data.slug);
      });
  }

  loadTokens(): void {
    this.tokensLoading.set(true);
    this.tokensError.set(null);
    this.http
      .get<{ tokens: McpToken[] }>(`/api/sites/${this.siteId}/mcp/tokens`)
      .pipe(catchError(() => { this.tokensError.set('The MCP token service did not respond.'); return of(null); }))
      .subscribe((res) => {
        if (res) this.tokens.set(res.tokens);
        this.tokensLoading.set(false);
      });
  }

  loadTools(): void {
    this.toolsLoading.set(true);
    this.toolsError.set(null);
    this.http
      .get<{ tools: ToolDef[] }>(`/api/sites/${this.siteId}/mcp/tools`)
      .pipe(catchError(() => { this.toolsError.set('The MCP tool registry did not respond.'); return of(null); }))
      .subscribe((res) => {
        if (res) this.tools.set(res.tools);
        this.toolsLoading.set(false);
      });
  }

  private loadUsage(): void {
    this.http
      .get<{ usage: ToolUsage[] }>(`/api/sites/${this.siteId}/mcp/tool-usage`)
      .pipe(catchError(() => of({ usage: [] as ToolUsage[] })))
      .subscribe((res) => this.usage.set(res.usage));
  }

  mintToken(): void {
    this.minting.set(true);
    this.http
      .post<{ id: string; token: string }>(`/api/sites/${this.siteId}/mcp/tokens`, { label: 'Default' })
      .pipe(catchError((err) => { this.toast.error(err?.error?.error ?? 'Failed to mint token'); return of(null); }))
      .subscribe((res) => {
        if (res) {
          this.newTokenRaw.set(res.token);
          this.loadTokens(); // refresh list (hash only)
        }
        this.minting.set(false);
      });
  }

  copyToken(token: string): void {
    navigator.clipboard.writeText(token).then(
      () => this.toast.success('Token copied'),
      () => this.toast.error('Copy failed'),
    );
  }

  async revokeToken(tokenId: string): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      title: 'Revoke MCP token',
      message: 'Revoke this MCP access token? Any MCP client or integration using it stops working immediately and cannot be restored — you would issue a new token.',
      confirmLabel: 'Revoke',
      danger: true,
    });
    if (!ok) return;
    this.revoking.set(tokenId);
    this.http
      .delete(`/api/sites/${this.siteId}/mcp/tokens/${tokenId}`)
      .pipe(catchError((err) => { this.toast.error(err?.error?.error ?? 'Failed'); return of(null); }))
      .subscribe(() => {
        this.tokens.update((ts) => ts.filter((t) => t.id !== tokenId));
        this.revoking.set(null);
      });
  }

  openPlayground(tool: ToolDef): void {
    this.playgroundTool.set(tool);
    this.playgroundArgs = '{}';
    this.playgroundResult.set(null);
  }

  runPlayground(): void {
    const tool = this.playgroundTool();
    if (!tool) return;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(this.playgroundArgs || '{}') as Record<string, unknown>;
    } catch {
      this.toast.error('Invalid JSON arguments');
      return;
    }
    this.playgroundRunning.set(true);
    this.playgroundResult.set(null);

    // Call via the path-based admin MCP endpoint.
    const slug = this.siteSlug() ?? this.siteId;
    this.http
      .post<unknown>(`/${slug}/mcp`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool.name, arguments: args },
      })
      .pipe(catchError((err) => of({ error: err?.message ?? 'Request failed' })))
      .subscribe((res) => {
        this.playgroundResult.set(JSON.stringify(res, null, 2));
        this.playgroundRunning.set(false);
      });
  }

  callsForTool(name: string): number {
    return this.usage()
      .filter((u) => u.tool_name === name)
      .reduce((sum, u) => sum + u.call_count, 0);
  }

  formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    } catch {
      return iso;
    }
  }
}
