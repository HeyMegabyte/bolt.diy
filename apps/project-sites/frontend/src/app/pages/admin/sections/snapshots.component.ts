import { Component, HostListener, inject, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../admin-state.service';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { TelemetryService } from '../../../services/telemetry.service';
import { DialogShellComponent } from '../../../components/dialog-shell/dialog-shell.component';

/**
 * Snapshot row shape. We expose ONE date — sourced from the underlying git
 * commit when the GitHub mirror has stamped it (`commit_iso`), else from the
 * row insertion timestamp (`created_at`). Showing both `created_at` AND
 * `updated_at` confused users — the snapshot moment is fundamentally a
 * version-control event, so the commit timestamp is the authoritative time.
 *
 * TODO(backend): `commit_iso` is not yet exposed on `GET /sites/:id/snapshots`.
 * Extend the worker to JOIN against the `gh_snapshot_commits` mirror table
 * (or read `ghStatus.last_commit_at` per snapshot_id) and surface
 * `commit_iso` on each row. Until that lands, every row falls back to
 * `created_at`, which is correct to within seconds for snapshots created via
 * the UI (the GitHub push fires right after the D1 insert).
 */
interface Snapshot {
  id: string;
  snapshot_name: string;
  build_version: string;
  description: string | null;
  created_at: string;
  /** Optional — set once the backend wires up the GitHub commit timestamp. */
  commit_iso?: string;
}

interface GhStatus {
  connected: boolean;
  repo_html_url?: string;
  repo_full_name?: string;
  default_branch?: string;
  last_commit_sha?: string;
  commit_count?: number;
  github_user?: string;
}

@Component({
  selector: 'app-admin-snapshots',
  standalone: true,
  imports: [FormsModule, DialogShellComponent],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6">

      <!-- Header -->
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 class="text-lg font-bold text-white m-0">Snapshots</h2>
          <p class="text-[0.78rem] text-text-secondary m-0 mt-1">
            Version history for
            <a
              class="text-primary font-mono no-underline hover:underline transition-colors duration-150 inline-flex items-center gap-1 group/sitelink"
              [href]="'https://' + state.selectedSite()?.slug + '.projectsites.dev'"
              target="_blank"
              rel="noopener noreferrer"
              [title]="'Open live site ' + state.selectedSite()?.slug + '.projectsites.dev in new tab'"
            >
              {{ state.selectedSite()?.slug }}.projectsites.dev
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="opacity-60 group-hover/sitelink:opacity-100 transition-opacity"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
          </p>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
        <button
          class="btn-create-snap btn-create-snap--primary"
          type="button"
          (click)="createOpen.set(true)"
          [disabled]="!state.selectedSite()"
          title="Open the create-snapshot dialog"
          data-testid="snapshot-create-button">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          <span>Create Snapshot</span>
        </button>

        <!-- GitHub link/sync — mirrors the isomorphic-git snapshot tree to GitHub on every build. -->
        @if (!ghStatus()?.connected) {
          <button class="btn-github-link" [disabled]="linkingGh() || !state.selectedSite()" (click)="linkGithub()"
                  title="Mirror snapshot history to a GitHub repo; every new snapshot will push automatically.">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
            <span>{{ linkingGh() ? 'Opening GitHub…' : 'Link GitHub' }}</span>
          </button>
        } @else {
          <div class="btn-github-linked-wrap">
            <a class="btn-github-linked" [href]="ghStatus()!.repo_html_url" target="_blank" rel="noopener noreferrer"
               [title]="'Open ' + ghStatus()!.repo_full_name + ' on GitHub'">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
              <span class="font-mono text-[0.7rem]">{{ ghStatus()!.repo_full_name }}</span>
              @if (pushingGh()) {
                <span class="text-[0.62rem] opacity-70">syncing…</span>
              } @else if (ghStatus()!.commit_count) {
                <span class="text-[0.62rem] opacity-70">{{ formatCount(ghStatus()!.commit_count) }} commits</span>
              }
            </a>
            <button class="btn-github-push" [disabled]="pushingGh()" (click)="pushToGithub(true)"
                    title="Push the latest build to GitHub now">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   [class.animate-spin]="pushingGh()">
                <path d="M12 5v14M19 12l-7 7-7-7"/>
              </svg>
            </button>
            <button class="btn-github-unlink" [disabled]="unlinkingGh()" (click)="unlinkGithub()"
                    title="Disconnect GitHub backup">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        }
        </div>
      </div>

      <!-- Create Snapshot — uses the standardized DialogShellComponent
           per the admin overhaul "one consistent modal primitive" rule. -->
      @if (createOpen()) {
        <app-dialog-shell (closed)="closeCreateDialog()">
          <span dialogIcon>
            <svg class="text-primary" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </span>
          <span dialogTitle>Create snapshot</span>

          <div class="p-5 flex flex-col gap-4">
            <label class="block">
              <div class="flex items-baseline justify-between mb-1">
                <span class="muted-h">Name</span>
                <span class="char-counter" [class.char-counter--full]="nameLen() >= 50">{{ nameLen() }}/50</span>
              </div>
              <input
                type="text"
                placeholder="v2, redesign, summer-2026"
                [ngModel]="newSnapshotName"
                (ngModelChange)="newSnapshotName = $event"
                class="input-field w-full"
                maxlength="50"
                [attr.aria-invalid]="!!nameError()"
                aria-describedby="snap-name-error"
                data-testid="snapshot-name-input"
                autofocus />
              @if (nameError(); as err) {
                <p id="snap-name-error" class="snap-error" role="alert" aria-live="polite">{{ err }}</p>
              }
            </label>

            <label class="block">
              <div class="flex items-baseline justify-between mb-1">
                <span class="muted-h">Description (optional)</span>
                <span class="char-counter" [class.char-counter--full]="descLen() >= 160">{{ descLen() }}/160</span>
              </div>
              <textarea
                placeholder="What changed since the last snapshot?"
                [ngModel]="newSnapshotDescription"
                (ngModelChange)="newSnapshotDescription = $event"
                class="input-field w-full"
                rows="3"
                maxlength="160"
                data-testid="snapshot-desc-input"></textarea>
            </label>
          </div>

          <div dialogFooter class="px-5 py-4 border-t border-white/[0.06] flex items-center justify-end gap-2">
            <button class="btn-ghost" type="button" (click)="closeCreateDialog()" [disabled]="creatingSnapshot()">Cancel</button>
            <button
              class="btn-accent"
              type="button"
              [disabled]="creatingSnapshot() || !canCreate()"
              data-testid="snapshot-create-submit"
              (click)="createSnapshot()">
              {{ creatingSnapshot() ? 'Creating…' : 'Create snapshot' }}
            </button>
          </div>
        </app-dialog-shell>
      }

      <!-- Snapshot Timeline -->
      <div class="snap-card">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold text-white m-0">Version History</h3>
          <span class="text-[0.72rem] text-text-secondary">{{ formatCount(snapshots().length) }} snapshot{{ snapshots().length === 1 ? '' : 's' }}</span>
        </div>

        @if (loadingSnapshots()) {
          <div class="relative pl-6" aria-busy="true" aria-label="Loading snapshots">
            <div class="absolute left-[11px] top-0 bottom-0 w-[2px] bg-gradient-to-b from-primary/30 via-primary/15 to-transparent"></div>
            @for (i of [1,2,3]; track i) {
              <div class="relative pb-5">
                <div class="absolute left-[-19px] top-1 w-[14px] h-[14px] rounded-full border-2 border-white/20 bg-dark"></div>
                <div class="ml-2 bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                  <div class="flex items-start gap-3">
                    <div class="flex-1 space-y-2">
                      <div class="skeleton h-4 w-40"></div>
                      <div class="skeleton h-3 w-56"></div>
                      <div class="skeleton h-3 w-32"></div>
                    </div>
                    <div class="skeleton h-7 w-16"></div>
                  </div>
                </div>
              </div>
            }
          </div>
        } @else if (snapshots().length === 0) {
          <div class="empty-state">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            <h4>No snapshots yet</h4>
            <p>The first snapshot is created automatically when your site is built. You can also create one manually.</p>
            <button class="btn-create-snap" (click)="createOpen.set(true)" [disabled]="!state.selectedSite()" title="Open the create-snapshot dialog">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>
              <span>Create your first snapshot</span>
            </button>
          </div>
        } @else {
          <!-- Timeline -->
          <div class="relative pl-6 max-h-[500px] overflow-y-auto sidebar-scrollbar">
            <!-- Timeline line -->
            <div class="absolute left-[11px] top-0 bottom-0 w-[2px] bg-gradient-to-b from-primary/30 via-primary/15 to-transparent"></div>

            @for (snap of snapshots(); track snap.id; let first = $first) {
              <div class="relative pb-5 last:pb-0">
                <!-- Timeline dot -->
                <div class="absolute left-[-19px] top-1 w-[14px] h-[14px] rounded-full border-2 flex items-center justify-center"
                     [class]="first ? 'border-primary bg-primary/20 shadow-[0_0_8px_rgba(0,229,255,0.3)]' : 'border-white/20 bg-dark'">
                  @if (first) {
                    <div class="w-1.5 h-1.5 rounded-full bg-primary"></div>
                  }
                </div>

                <!-- Snapshot Card — ONE LINE: title + Latest + date + description + View + More.
                     Description gets flex:1 so it fills remaining space and ellipsis-truncates.
                     On narrow viewports (<768px) the description hides via .snap-desc-inline
                     media query, leaving the row tight + scannable. -->
                <div class="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 transition-all hover:border-primary/[0.12] ml-2"
                     [class]="first ? 'border-primary/[0.15] bg-primary/[0.02]' : ''">
                  <div class="snap-row">
                    <a class="snap-title"
                       [href]="'https://' + state.selectedSite()!.slug + '-' + snap.snapshot_name + '.projectsites.dev'"
                       target="_blank" rel="noopener"
                       [attr.data-testid]="'snapshot-title-' + snap.id">
                      {{ snap.snapshot_name }}
                    </a>
                    @if (first) {
                      <span class="snap-latest-chip">Latest</span>
                    }
                    <span class="snap-date"
                          [title]="commitTooltip(snap)"
                          [attr.data-testid]="'snapshot-date-' + snap.id">
                      {{ commitRelative(snap) }}
                    </span>
                    @if (snap.description) {
                      <span class="snap-desc-inline"
                            [title]="snap.description"
                            [attr.data-testid]="'snapshot-desc-' + snap.id">
                        {{ snap.description }}
                      </span>
                    } @else {
                      <span class="snap-desc-inline snap-desc-inline--empty" aria-hidden="true"></span>
                    }

                    <!-- View + More dropdown -->
                    <div class="snap-actions">
                      <button class="btn-snap-view group"
                              type="button"
                              (click)="viewSnapshot(snap)"
                              title="Open this snapshot in a new tab"
                              [attr.aria-label]="'Open snapshot ' + snap.snapshot_name + ' in new tab'"
                              [attr.data-testid]="'snapshot-view-' + snap.id">
                        <span class="btn-snap-view-glow" aria-hidden="true"></span>
                        <svg class="btn-snap-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        <span class="btn-snap-label">View</span>
                      </button>
                      <button
                        class="btn-snap-more"
                        type="button"
                        [attr.aria-expanded]="moreOpenId() === snap.id"
                        [attr.aria-label]="'More actions for snapshot ' + snap.snapshot_name"
                        [attr.data-testid]="'snapshot-more-' + snap.id"
                        (click)="toggleMore(snap.id, $event)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                      </button>
                      @if (moreOpenId() === snap.id) {
                        <div class="snap-more-pop" role="menu" (click)="$event.stopPropagation()">
                          @if (!first) {
                            <button class="snap-more-item" type="button" [disabled]="reverting()" (click)="revertToSnapshot(snap); moreOpenId.set(null)" [attr.data-testid]="'snapshot-revert-' + snap.id">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                              {{ reverting() ? 'Reverting…' : 'Revert' }}
                            </button>
                          }
                          <button class="snap-more-item" type="button" (click)="downloadSnapshot(snap); moreOpenId.set(null)" [attr.data-testid]="'snapshot-download-' + snap.id">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Download
                          </button>
                          <button class="snap-more-item snap-more-danger" type="button" (click)="confirmDelete(snap); moreOpenId.set(null)" [attr.data-testid]="'snapshot-delete-' + snap.id">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            Delete
                          </button>
                        </div>
                      }
                    </div>
                  </div>
                </div>
              </div>
            }
          </div>
        }
      </div>

    </div>
  `,
  styles: [`
    :host { display: block; --accent: #00E5FF; }
    h2, h3 { font-family: 'Sora', system-ui, sans-serif; font-weight: 600; letter-spacing: -0.02em; }
    .snap-card { background: rgba(255,255,255,0.02); border: 1px solid color-mix(in oklch, var(--accent) 14%, transparent); border-radius: 14px; padding: 1.4rem; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02); transition: transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease; }
    .snap-card:hover { transform: translateY(-1px); border-color: color-mix(in oklch, var(--accent) 28%, transparent); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04), 0 8px 24px -16px rgba(0,229,255,0.18); }
    .empty-state { display: flex; flex-direction: column; align-items: center; gap: 0.6rem; padding: 2.5rem 1rem; text-align: center; }
    .empty-state .icon { width: 40px; height: 40px; opacity: 0.45; }
    .empty-state h4 { margin: 0; font-family: 'Sora', system-ui, sans-serif; font-weight: 600; color: rgba(255,255,255,0.85); font-size: 0.9rem; letter-spacing: -0.01em; }
    .empty-state p { margin: 0; font-size: 0.75rem; color: rgba(255,255,255,0.5); max-width: 36ch; }
    .skeleton { background: linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08), rgba(255,255,255,0.04)); background-size: 200% 100%; animation: shimmer 1.4s linear infinite; border-radius: 8px; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) {
      .snap-card, .btn-create-snap, .btn-github-link, .btn-github-linked { transition: none; }
      .snap-card:hover, .btn-create-snap:hover { transform: none; box-shadow: none; }
      .skeleton { animation: none; background: rgba(255,255,255,0.06); }
    }
    @media (max-width: 640px) {
      .btn-create-snap, .btn-github-link, .btn-github-linked-wrap { width: 100%; justify-content: center; }
    }
    .btn-github-link { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.75rem; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #e5e7eb; font-size: 0.72rem; font-weight: 600; cursor: pointer; transition: all 150ms ease; }
    .btn-github-link:hover:not(:disabled) { background: rgba(0,229,255,0.1); border-color: rgba(0,229,255,0.35); color: #00E5FF; transform: translateY(-1px); }
    .btn-github-link:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-github-linked-wrap { display: inline-flex; align-items: stretch; border-radius: 8px; border: 1px solid rgba(0,229,255,0.25); background: rgba(0,229,255,0.06); overflow: hidden; }
    .btn-github-linked { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.38rem 0.65rem; color: #00E5FF; text-decoration: none; font-size: 0.72rem; font-weight: 600; transition: background 150ms ease; }
    .btn-github-linked:hover { background: rgba(0,229,255,0.12); }
    .btn-github-push, .btn-github-unlink { display: inline-flex; align-items: center; justify-content: center; width: 26px; border: none; border-left: 1px solid rgba(0,229,255,0.18); background: transparent; color: #00E5FF; cursor: pointer; transition: background 150ms ease, color 150ms ease; }
    .btn-github-push:hover:not(:disabled) { background: rgba(0,229,255,0.16); }
    .btn-github-unlink:hover:not(:disabled) { background: rgba(248,113,113,0.16); color: #f87171; }
    .btn-github-push:disabled, .btn-github-unlink:disabled { opacity: 0.45; cursor: not-allowed; }

    .btn-create-snap { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.45rem 0.85rem; border-radius: 8px; background: linear-gradient(135deg, rgba(0,229,255,0.18), rgba(124,58,237,0.18)); color: #00E5FF; border: 1px solid rgba(0,229,255,0.4); font-size: 0.74rem; font-weight: 600; cursor: pointer; transition: all 160ms ease; pointer-events: auto; }
    .btn-create-snap:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px -8px rgba(0,229,255,0.4); }
    .btn-create-snap:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Primary variant — used by the headline "Create Snapshot" action in the
       page header. Bigger padding, stronger gradient, brighter ring, and a
       Sora 600 label so it reads as the dominant call-to-action on the page
       (no longer competes with the GitHub mirror chip for visual weight). */
    .btn-create-snap--primary {
      font-family: 'Sora', system-ui, sans-serif;
      font-size: 0.82rem;
      font-weight: 600;
      letter-spacing: -0.005em;
      padding: 0.55rem 1.05rem;
      border-radius: 10px;
      color: #06121A;
      background: linear-gradient(135deg, #00E5FF 0%, #7C3AED 100%);
      border: 1px solid rgba(0, 229, 255, 0.55);
      box-shadow: 0 6px 18px -8px rgba(0, 229, 255, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.25);
    }
    .btn-create-snap--primary:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 12px 28px -8px rgba(0, 229, 255, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.32);
      filter: brightness(1.05);
    }
    .btn-create-snap--primary:focus-visible {
      outline: 2px solid #00ffc8;
      outline-offset: 3px;
    }
    @media (prefers-reduced-motion: reduce) {
      .btn-create-snap--primary { transition: none; }
      .btn-create-snap--primary:hover:not(:disabled) { transform: none; filter: none; }
    }

    .muted-h { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); font-weight: 700; }

    /* Row 1: title + Latest chip + version + date — all on one line. */
    .snap-title {
      font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-feature-settings: "calt", "liga";
      font-size: 0.86rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: #00E5FF;
      text-decoration: none;
      text-transform: capitalize;
    }
    .snap-title:hover { text-decoration: underline; }
    .snap-latest-chip {
      font-size: 0.58rem; font-weight: 700;
      padding: 1px 7px; border-radius: 999px;
      text-transform: uppercase; letter-spacing: 0.06em;
      background: color-mix(in oklch, oklch(0.78 0.18 220) 18%, transparent);
      color: oklch(0.86 0.16 220);
      border: 1px solid color-mix(in oklch, oklch(0.78 0.18 220) 30%, transparent);
    }
    /* One-line row: title + Latest + date + description + actions.
       - title / date / actions: flex-shrink: 0 (keep their natural width)
       - description: flex: 1 1 0 + min-width:0 so it absorbs the remaining
         horizontal space and ellipsis-truncates rather than wrapping. */
    .snap-row {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      min-width: 0;
      width: 100%;
    }
    .snap-row .snap-title { flex-shrink: 0; }
    .snap-row .snap-latest-chip { flex-shrink: 0; }
    .snap-date {
      flex-shrink: 0;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.68rem;
      color: rgba(255, 255, 255, 0.5);
      letter-spacing: 0.01em;
      white-space: nowrap;
      cursor: help;
    }
    .snap-desc-inline {
      flex: 1 1 0;
      min-width: 0;
      font-size: 0.76rem;
      color: rgba(255, 255, 255, 0.62);
      line-height: 1.4;
      text-overflow: ellipsis;
      white-space: nowrap;
      overflow: hidden;
      opacity: 0.85;
    }
    .snap-desc-inline--empty { opacity: 0; pointer-events: none; }
    .snap-actions {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      position: relative;
      margin-left: auto;
    }

    /* Narrow viewports: hide the inline description so the row stays tight
       and scannable on phones/tablets. Title + date + actions still fit. */
    @media (max-width: 768px) {
      .snap-desc-inline { display: none; }
      .snap-row { gap: 0.45rem; }
    }

    /* More dropdown — three-dots → menu with Revert/Download/Delete. */
    .btn-snap-more {
      width: 30px; height: 30px;
      display: inline-flex; align-items: center; justify-content: center;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      color: rgba(255, 255, 255, 0.7);
      cursor: pointer;
      transition: background var(--ps-dur-fast, 140ms), color var(--ps-dur-fast, 140ms), border-color var(--ps-dur-fast, 140ms);
    }
    .btn-snap-more:hover { background: rgba(255, 255, 255, 0.08); color: #fff; border-color: rgba(255, 255, 255, 0.18); }
    .btn-snap-more:focus-visible {
      outline: var(--ps-ring-focus, 2px solid #00ffc8);
      outline-offset: var(--ps-ring-focus-offset, 2px);
    }
    .snap-more-pop {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      min-width: 168px;
      padding: 4px;
      background: linear-gradient(180deg, rgba(20, 20, 42, 0.97), rgba(10, 10, 28, 0.97));
      border: 1px solid rgba(0, 229, 255, 0.22);
      border-radius: 10px;
      box-shadow: 0 18px 48px -16px rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(12px) saturate(140%);
      z-index: 50;
      animation: snap-more-in 160ms var(--ps-ease-emphasized, cubic-bezier(0.16, 1, 0.3, 1));
    }
    @keyframes snap-more-in {
      from { opacity: 0; transform: translateY(-4px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .snap-more-item {
      display: flex; align-items: center; gap: 8px;
      width: 100%;
      padding: 7px 10px;
      background: transparent; border: 0;
      color: rgba(255, 255, 255, 0.82);
      font-size: 0.78rem;
      text-align: left;
      cursor: pointer;
      border-radius: 6px;
      transition: background var(--ps-dur-fast, 140ms), color var(--ps-dur-fast, 140ms);
    }
    .snap-more-item:hover { background: rgba(255, 255, 255, 0.06); color: #fff; }
    .snap-more-item:focus-visible {
      outline: 2px solid #00ffc8;
      outline-offset: -2px;
    }
    .snap-more-item:disabled { opacity: 0.5; cursor: not-allowed; }
    .snap-more-danger { color: oklch(0.78 0.18 25); }
    .snap-more-danger:hover { background: rgba(248, 113, 113, 0.12); color: oklch(0.86 0.16 25); }
    @media (prefers-reduced-motion: reduce) {
      .snap-more-pop { animation: none; }
      .btn-snap-more { transition: none; }
    }

    /* Create-modal inputs */
    .char-counter {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.65rem;
      color: rgba(255, 255, 255, 0.5);
      letter-spacing: 0.02em;
    }
    .char-counter--full { color: oklch(0.78 0.18 25); }
    .snap-error {
      margin: 6px 0 0;
      font-size: 0.72rem;
      color: oklch(0.78 0.18 25);
      line-height: 1.35;
    }
  `],
})
export class AdminSnapshotsComponent implements OnInit {
  state = inject(AdminStateService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private telemetry = inject(TelemetryService);

  snapshots = signal<Snapshot[]>([]);
  loadingSnapshots = signal(false);
  newSnapshotName = '';
  newSnapshotDescription = '';
  creatingSnapshot = signal(false);
  reverting = signal(false);

  /** Locale-aware count formatter for the "N snapshots" badge + commit-count chip. */
  private readonly numberFormatter = new Intl.NumberFormat(undefined);
  formatCount(n: number | null | undefined): string {
    return this.numberFormatter.format(typeof n === 'number' && Number.isFinite(n) ? n : 0);
  }

  /**
   * Relative-time formatter used by the inline row date ("3 hours ago",
   * "2 days ago", "just now"). Intl.RelativeTimeFormat is locale-aware and
   * cheap to instantiate once. We pick the largest unit whose absolute value
   * is >= 1, so "90 seconds" reads as "1 minute ago" not "90 seconds ago".
   */
  private readonly relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: 'auto',
    style: 'long',
  });
  private readonly absoluteDateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  /**
   * Pick the canonical "git commit" timestamp for a snapshot. Prefers
   * `commit_iso` (the real GitHub commit time, set once the backend wires
   * it up), falls back to `created_at` (the moment the snapshot row was
   * inserted in D1, which is within seconds of the commit for UI-created
   * snapshots).
   */
  private commitDate(snap: Snapshot): Date {
    const iso = snap.commit_iso ?? snap.created_at;
    return new Date(iso);
  }

  /** Inline relative time shown on the row ("3 hours ago"). */
  commitRelative(snap: Snapshot): string {
    const date = this.commitDate(snap);
    if (Number.isNaN(date.getTime())) return '';
    const diffMs = date.getTime() - Date.now();
    const seconds = Math.round(diffMs / 1000);
    const absSec = Math.abs(seconds);
    if (absSec < 45) return this.relativeTimeFormatter.format(0, 'second').replace('in 0 seconds', 'just now');
    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
      ['year', 60 * 60 * 24 * 365],
      ['month', 60 * 60 * 24 * 30],
      ['week', 60 * 60 * 24 * 7],
      ['day', 60 * 60 * 24],
      ['hour', 60 * 60],
      ['minute', 60],
      ['second', 1],
    ];
    for (const [unit, sec] of units) {
      if (Math.abs(seconds) >= sec) {
        return this.relativeTimeFormatter.format(Math.round(seconds / sec), unit);
      }
    }
    return this.relativeTimeFormatter.format(seconds, 'second');
  }

  /** ISO-style tooltip for the date chip ("May 23, 2026, 10:14 AM"). */
  commitTooltip(snap: Snapshot): string {
    const date = this.commitDate(snap);
    if (Number.isNaN(date.getTime())) return '';
    const sourceLabel = snap.commit_iso ? 'git commit' : 'snapshot created';
    return `${this.absoluteDateFormatter.format(date)} (${sourceLabel})`;
  }


  // GitHub mirror (replaces the standalone GitHub Backup nav item).
  ghStatus = signal<GhStatus | null>(null);
  linkingGh = signal(false);
  pushingGh = signal(false);
  unlinkingGh = signal(false);
  createOpen = signal(false);

  /** Which row's "More" dropdown is open (null = none). */
  moreOpenId = signal<string | null>(null);

  /** Live counters for the create-modal char limits. */
  nameLen(): number { return this.newSnapshotName.length; }
  descLen(): number { return this.newSnapshotDescription.length; }

  /**
   * Validate the snapshot name. Returns null when valid, else a user-safe
   * error message rendered inline + announced via aria-live. Plain method
   * (not `computed()`) because `newSnapshotName` is a non-signal field —
   * memoizing here would let the error go stale between keystrokes.
   */
  nameError(): string | null {
    const raw = this.newSnapshotName.trim();
    if (raw.length === 0) return null;
    if (raw.length > 50) return 'Name must be 50 characters or fewer.';
    const lowered = raw.toLowerCase();
    const dup = this.snapshots().some((s) => (s.snapshot_name ?? '').trim().toLowerCase() === lowered);
    if (dup) return 'A snapshot with this name already exists.';
    return null;
  }

  /** Submit enabled only when there's a name AND no validation error. */
  canCreate(): boolean {
    return this.newSnapshotName.trim().length > 0 && this.nameError() === null;
  }

  /**
   * Close the create-snapshot dialog and reset the draft state. Called from
   * Cancel, the X close button (via DialogShell's (closed) output), and the
   * success branch of createSnapshot().
   */
  closeCreateDialog(): void {
    if (this.creatingSnapshot()) return; // never close mid-request
    this.createOpen.set(false);
    this.newSnapshotName = '';
    this.newSnapshotDescription = '';
  }

  /** Toggle the per-row More dropdown. Click-outside is handled by the
   *  global document listener wired in {@link AdminSnapshotsComponent.ngOnInit}. */
  toggleMore(id: string, ev: MouseEvent): void {
    ev.stopPropagation();
    this.moreOpenId.update((curr) => (curr === id ? null : id));
  }

  /**
   * Stub download — the bundle-export endpoint is not yet wired server-side.
   * When `GET /sites/:id/snapshots/:snapId/download` lands, replace the toast
   * with an `<a href download>` anchor click. Until then we surface a clear
   * "coming soon" so the user isn't confused by a silent click.
   */
  downloadSnapshot(snap: Snapshot): void {
    // TODO(api): wire to `/api/sites/:id/snapshots/:snapId/download` once the
    // worker route ships the zipped bundle (manifest.json + all files).
    this.telemetry.track('snapshot.download_attempted', { snapshot_id: snap.id });
    this.toast.info('Download will be available shortly — full snapshot bundle export is on the roadmap.');
  }

  ngOnInit(): void {
    const site = this.state.selectedSite();
    if (site) {
      this.loadSnapshots(site.id);
      this.loadGhStatus(site.id);
    }
  }

  /**
   * Close the per-row "More" dropdown when the user clicks anywhere outside
   * a snap-more-pop or btn-snap-more. Bound on the host so the listener
   * tears down automatically with the component.
   */
  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (this.moreOpenId() === null) return;
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('.snap-more-pop, .btn-snap-more')) return;
    this.moreOpenId.set(null);
  }

  private loadGhStatus(siteId: string): void {
    this.api.get<{ data: GhStatus }>(`/sites/${siteId}/github/status`).subscribe({
      next: (r) => this.ghStatus.set(r.data),
      error: () => this.ghStatus.set({ connected: false }),
    });
  }

  linkGithub(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.linkingGh.set(true);
    // The /github/connect route requires Bearer auth — a raw browser
    // navigation drops the header and 401s. Fetch the OAuth URL via
    // ApiService (auth header attached), then redirect.
    this.api.get<{ url: string }>(`/sites/${site.id}/github/connect`, { return_url: '/admin/snapshots' }).subscribe({
      next: (r) => { if (r?.url) window.location.href = r.url; else this.linkingGh.set(false); },
      error: (err) => {
        this.linkingGh.set(false);
        const msg = err?.error?.error?.message || err?.error?.message || 'Could not start GitHub OAuth — check sign-in';
        this.toast.error(msg);
      },
    });
  }

  pushToGithub(manual: boolean): void {
    const site = this.state.selectedSite();
    const status = this.ghStatus();
    if (!site || !status?.connected) return;
    this.pushingGh.set(true);
    this.api.post<{ data: { commit_sha: string; html_url: string } }>(`/sites/${site.id}/github/backup`, {}).subscribe({
      next: () => {
        this.pushingGh.set(false);
        if (manual) this.toast.success('Mirrored to GitHub');
        this.loadGhStatus(site.id);
      },
      error: (err) => {
        this.pushingGh.set(false);
        const msg = err?.error?.error?.message || 'GitHub mirror failed';
        if (manual) this.toast.error(msg);
        else this.toast.error(`Snapshot saved · GitHub mirror failed: ${msg}`);
      },
    });
  }

  unlinkGithub(): void {
    const site = this.state.selectedSite();
    if (!site) return;
    if (!window.confirm('Disconnect GitHub mirror? The existing repo + commits stay; future snapshots will no longer push automatically.')) return;
    this.unlinkingGh.set(true);
    this.api.post(`/sites/${site.id}/github/disconnect`, {}).subscribe({
      next: () => {
        this.unlinkingGh.set(false);
        this.ghStatus.set({ connected: false });
        this.toast.success('GitHub mirror disconnected');
      },
      error: () => {
        this.unlinkingGh.set(false);
        this.toast.error('Failed to disconnect');
      },
    });
  }

  private loadSnapshots(siteId: string): void {
    this.loadingSnapshots.set(true);
    this.api.get<{ data: Snapshot[] }>(`/sites/${siteId}/snapshots`).subscribe({
      next: (res) => { this.snapshots.set(res.data || []); this.loadingSnapshots.set(false); },
      error: () => { this.loadingSnapshots.set(false); },
    });
  }

  createSnapshot(): void {
    const site = this.state.selectedSite();
    if (!site || !this.canCreate()) return;
    this.creatingSnapshot.set(true);
    this.api.post<{ data: { id: string; snapshot_name: string; build_version: string; url: string } }>(`/sites/${site.id}/snapshots`, {
      name: this.newSnapshotName.trim(),
      description: this.newSnapshotDescription.trim() || undefined,
    }).subscribe({
      next: (res) => {
        this.toast.success(`Snapshot created: ${res.data.snapshot_name}`);
        this.telemetry.track('snapshot.created', {
          site_id: site.id,
          snapshot_id: res.data.id,
          has_description: !!this.newSnapshotDescription.trim(),
        });
        this.creatingSnapshot.set(false);
        this.newSnapshotName = '';
        this.newSnapshotDescription = '';
        this.createOpen.set(false);
        this.loadSnapshots(site.id);
        if (this.ghStatus()?.connected) this.pushToGithub(false);
      },
      error: (err) => {
        this.toast.error(err?.error?.error?.message || 'Failed to create snapshot');
        this.creatingSnapshot.set(false);
      },
    });
  }

  viewSnapshot(snap: Snapshot): void {
    const site = this.state.selectedSite();
    if (!site) return;
    const url = `https://${site.slug}-${snap.snapshot_name}.projectsites.dev`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  confirmDelete(snap: Snapshot): void {
    if (!window.confirm(`Permanently delete snapshot "${snap.snapshot_name}"? This cannot be undone.`)) return;
    this.deleteSnapshot(snap.id);
  }

  deleteSnapshot(snapshotId: string): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.api.delete(`/sites/${site.id}/snapshots/${snapshotId}`).subscribe({
      next: () => {
        this.toast.success('Snapshot deleted');
        this.telemetry.track('snapshot.deleted', {
          site_id: site.id,
          snapshot_id: snapshotId,
        });
        this.loadSnapshots(site.id);
      },
      error: () => this.toast.error('Failed to delete snapshot'),
    });
  }

  revertToSnapshot(snap: Snapshot): void {
    const site = this.state.selectedSite();
    if (!site) return;
    this.reverting.set(true);
    this.api.revertSnapshot(site.id, snap.id).subscribe({
      next: () => {
        this.toast.success(`Reverted to "${snap.snapshot_name}"`);
        this.telemetry.track('snapshot.reverted', {
          site_id: site.id,
          snapshot_id: snap.id,
        });
        this.reverting.set(false);
        this.loadSnapshots(site.id);
        this.state.loadData();
      },
      error: (err) => {
        this.toast.error(err?.error?.error?.message || 'Failed to revert snapshot');
        this.reverting.set(false);
      },
    });
  }
}
