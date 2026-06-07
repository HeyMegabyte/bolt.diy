/**
 * Swarm Editor admin board — /admin/swarm/:siteId
 *
 * 7-column live progress grid for the Multi-Agent Swarm Editor (#5).
 * Also hosts an INLINE live-component-stream preview (#6) fed by the SSE
 * channel via EventSource. (NB: this is swarm's own inline panel — it does
 * NOT use the standalone `progressive-preview.component`, which is unrouted
 * + unimported dead code per [[dead-admin-section-components]].)
 *
 * Per [[cinematic-ui-patterns]]:
 *  - Every numeric stat uses <app-rolling-counter>
 *  - Every section uses appReveal directive
 *  - View Transitions hooks for agent-status swaps
 *  - JetBrains Mono for all numeric cells
 *  - ≤36px rows, ≤12px card padding
 *  - routerLink for all navigation (no bare href=)
 *
 * Flag: swarm_editor + multi_agent_concurrent (both must be on).
 */

import {
  Component, OnInit, OnDestroy, inject, signal, computed,
  ChangeDetectionStrategy, ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../../services/api.service';
import { catchError, of } from 'rxjs';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { ErrorCardComponent } from '../../../components/states';
import { ToastService } from '../../../services/toast.service';
import { RevealDirective } from '../../../directives/reveal.directive';
import { HlmInputDirective } from '../../../ui';

type AgentStatus = 'queued' | 'running' | 'done' | 'error';

interface AgentSlot {
  id: string;
  name: string;
  status: AgentStatus;
  file_glob: string;
  duration_ms?: number;
  output_preview?: string;
  conflict_detected?: boolean;
  started_at?: string;
  finished_at?: string;
}

interface SwarmRun {
  run_id: string;
  site_id: string;
  prompt: string;
  status: string;
  agents: AgentSlot[];
  started_at: string;
  sse_url?: string;
  conflict_detected?: boolean;
}

interface ProgressiveComponent {
  component: string;
  index: number;
  total: number;
  progress_pct: number;
  ts: string;
}

const SPECIALIST_ICONS: Record<string, string> = {
  visual: '🎨', copy: '✍️', seo: '🔍', a11y: '♿',
  motion: '✨', media: '🖼️', qa: '🧪',
};

// Per-specialist accent hues reference section-local CSS vars (declared on :host)
// so the palette stays tokenized + theme-swappable — never raw inline hex.
const SPECIALIST_COLORS: Record<string, string> = {
  visual: 'var(--sw-violet)', copy: 'var(--ps-accent, #00e5ff)', seo: 'var(--sw-ok)',
  a11y: 'var(--sw-warn)', motion: 'var(--sw-pink)', media: 'var(--sw-blue)',
  qa: 'var(--sw-indigo)',
};

@Component({
  selector: 'app-admin-swarm',
  standalone: true,
  imports: [RevealDirective, CommonModule, FormsModule, RouterLink, RollingCounterComponent, HlmInputDirective, ErrorCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="swarm-shell" appReveal>
  <!-- ── Header ──────────────────────────────────────────────────────────── -->
  <header class="swarm-header" appReveal>
    <div class="swarm-header__meta">
      <a [routerLink]="['/admin']" class="swarm-header__back">← Admin</a>
      <span class="swarm-header__sep">/</span>
      <span class="swarm-header__site">{{ siteId() }}</span>
    </div>
    <h1 class="swarm-header__title">Swarm Editor <span class="swarm-demo-badge" title="Runs are simulated — real multi-agent execution is on the roadmap">Simulated preview</span></h1>
    <p class="swarm-header__sub">Preview of the parallel-specialist editing UX — 7 agents each own a file partition. Runs are simulated for now; live execution is on the roadmap.</p>

    <div class="swarm-header__stats">
      <div class="swarm-stat">
        <app-rolling-counter [value]="agentsDone()" suffix="/" />
        <span class="swarm-stat__total">7</span>
        <span class="swarm-stat__label">complete</span>
      </div>
      <div class="swarm-stat">
        <span class="swarm-stat__num" [class.swarm-stat__num--conflict]="conflictsDetected() > 0">
          <app-rolling-counter [value]="conflictsDetected()" />
        </span>
        <span class="swarm-stat__label">conflicts</span>
      </div>
      <div class="swarm-stat">
        <app-rolling-counter [value]="progressPct()" suffix="%" />
        <span class="swarm-stat__label">progress</span>
      </div>
    </div>

    <div class="swarm-header__launch">
      <input
        hlmInput
        class="swarm-header__directive"
        [(ngModel)]="swarmPrompt"
        [disabled]="running()"
        maxlength="280"
        [placeholder]="DEFAULT_DIRECTIVE"
        aria-label="Swarm directive (optional — defaults to a full-site improvement pass)"
        (keydown.enter)="startSwarm()"
        data-testid="swarm-directive" />
      <button class="swarm-header__start" (click)="startSwarm()"
              [disabled]="running()" [attr.aria-busy]="running()" aria-label="Start new swarm run">
        @if (running()) {
          <svg class="sw-btn-ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Running…
        } @else {
          <svg class="sw-btn-ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg> Start Swarm
        }
      </button>
    </div>
  </header>

  <!-- ── 7-Column Agent Board ──────────────────────────────────────────── -->
  @if (currentRun()) {
    <section class="swarm-board" appReveal aria-label="Agent progress board">
      @for (agent of currentRun()!.agents; track agent.id) {
        <div class="swarm-agent"
             [class.swarm-agent--queued]="agent.status === 'queued'"
             [class.swarm-agent--running]="agent.status === 'running'"
             [class.swarm-agent--done]="agent.status === 'done'"
             [class.swarm-agent--error]="agent.status === 'error'"
             [class.swarm-agent--conflict]="agent.conflict_detected"
             [style.--agent-color]="agentColor(agent.name)"
             appReveal>
          <div class="swarm-agent__header">
            <span class="swarm-agent__icon" aria-hidden="true">{{ agentIcon(agent.name) }}</span>
            <span class="swarm-agent__name">{{ agent.name }}</span>
            <span class="swarm-agent__status-pill" [attr.data-status]="agent.status">
              {{ statusLabel(agent.status) }}
            </span>
          </div>
          <p class="swarm-agent__glob" title="File ownership">{{ agent.file_glob }}</p>
          @if (agent.output_preview) {
            <p class="swarm-agent__preview">{{ agent.output_preview }}</p>
          }
          @if (agent.duration_ms) {
            <div class="swarm-agent__duration">
              <app-rolling-counter [value]="agent.duration_ms / 1000" [decimals]="1" suffix="s" />
            </div>
          }
          @if (agent.conflict_detected) {
            <div class="swarm-agent__conflict-badge" role="alert"><svg class="sw-warn-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Conflict</div>
          }
        </div>
      }
    </section>
  } @else if (loadError() && loadErrorGated()) {
    <div class="swarm-gate-notice" data-testid="swarm-load-error" appReveal role="status">{{ loadError() }}</div>
  } @else if (loadError()) {
    <app-error-card data-testid="swarm-load-error" class="block" appReveal
      title="Couldn't load swarm runs"
      message="Check your connection and retry."
      [correlationId]="loadErrorRef()"
      (retry)="loadHistory()" />
  } @else if (!loading()) {
    <section class="swarm-empty" appReveal>
      <p>No swarm runs yet for this site.</p>
      <button class="swarm-empty__cta" (click)="startSwarm()">Start first swarm run →</button>
    </section>
  }

  <!-- ── Progressive Preview Panel (#6) ───────────────────────────────── -->
  <section class="swarm-preview" [class.swarm-preview--streaming]="isStreaming()" appReveal aria-label="Progressive component preview">
    <h2 class="swarm-preview__title">Live Component Stream</h2>
    <p class="swarm-preview__sub">Components stream in via SSE as specialists complete them</p>

    <div class="swarm-preview__progress-bar" role="progressbar"
         [attr.aria-valuenow]="progressPct()" aria-valuemin="0" aria-valuemax="100">
      <div class="swarm-preview__progress-fill" [style.width.%]="progressPct()"></div>
    </div>

    <div class="swarm-preview__grid">
      @for (comp of skeletonSlots; track comp) {
        <div class="swarm-preview__slot"
             [class.swarm-preview__slot--done]="isComponentDone(comp)"
             [class.swarm-preview__slot--active]="isComponentActive(comp)">
          <span class="swarm-preview__slot-name">{{ comp }}</span>
          @if (isComponentDone(comp)) {
            <span class="swarm-preview__slot-tick" aria-label="ready">✓</span>
          } @else if (isComponentActive(comp)) {
            <span class="swarm-preview__slot-spinner" aria-label="streaming" aria-live="polite">⟳</span>
          } @else {
            <span class="swarm-preview__slot-skeleton"></span>
          }
        </div>
      }
    </div>

    @if (!sseConnected()) {
      <button class="swarm-preview__connect" (click)="connectSse()">
        Connect live stream
      </button>
    }
  </section>

  <!-- ── Run History ──────────────────────────────────────────────────── -->
  @if (runHistory().length > 0) {
    <section class="swarm-history" appReveal aria-label="Run history">
      <h2>Recent Runs</h2>
      <!-- 6 cols (200px-capped prompt + 5) exceed a 320px screen — scroll the
           table in its own region instead of overflowing the page (WCAG 1.4.10). -->
      <div class="swarm-history__scroll" tabindex="0" role="region" aria-label="Run history — scroll horizontally">
      <table class="swarm-history__table" role="grid">
        <thead>
          <tr>
            <th scope="col">Run ID</th>
            <th scope="col">Prompt</th>
            <th scope="col">Status</th>
            <th scope="col">Agents done</th>
            <th scope="col">Started</th>
          </tr>
        </thead>
        <tbody>
          @for (run of runHistory(); track run.run_id) {
            <tr class="swarm-history__row" (click)="selectRun(run)" tabindex="0"
                role="button" [attr.aria-pressed]="currentRun()?.run_id === run.run_id"
                [attr.aria-label]="'Load swarm run ' + run.run_id.slice(0,8) + ' — ' + doneCount(run.agents) + ' of 7 agents complete'"
                (keydown.enter)="selectRun(run)"
                (keydown.space)="$event.preventDefault(); selectRun(run)">
              <td><code class="swarm-history__id">{{ run.run_id.slice(0,8) }}</code></td>
              <td class="swarm-history__prompt">{{ run.prompt }}</td>
              <td><span class="swarm-history__status-pill" [attr.data-status]="run.status">{{ run.status }}</span></td>
              <td><span class="swarm-history__count"><app-rolling-counter [value]="doneCount(run.agents)" suffix="/" />7</span></td>
              <td>{{ run.started_at | date:'HH:mm:ss' }}</td>
            </tr>
          }
        </tbody>
      </table>
      </div>
    </section>
  }
</div>
  `,
  styles: [`
    :host {
      display: block; color: var(--ps-ink, #f4f4ff);
      /* Section-local status palette — cyan/black-anchored, tokenized (no raw inline hex).
         Status semantics keep their hue but route through one declaration so a theme
         swap re-skins the whole board. */
      --sw-ok: #34d3a6;       /* done — teal-green, sits beside cyan */
      --sw-warn: #f5b544;     /* conflict — amber */
      --sw-err: #ff5d6c;      /* error — red */
      --sw-violet: #8b5cf6; --sw-pink: #ec4899; --sw-blue: #3b82f6; --sw-indigo: #6366f1;
      --sw-card: color-mix(in oklch, var(--ps-ink, #f4f4ff) 4%, transparent);
      --sw-line: color-mix(in oklch, var(--ps-ink, #f4f4ff) 9%, transparent);
      --sw-focus: var(--ps-accent, #00e5ff);
    }
    /* Cyan keyboard-focus ring on every interactive surface (WCAG 2.2 2.4.11). */
    .swarm-header__start:focus-visible,
    .swarm-empty__cta:focus-visible,
    .swarm-preview__connect:focus-visible,
    .swarm-header__back:focus-visible,
    .swarm-history__row:focus-visible {
      outline: 2px solid var(--sw-focus);
      outline-offset: 2px;
      border-radius: 6px;
    }
    .swarm-shell { padding: 0.75rem; max-width: 1200px; margin: 0 auto; }
    .swarm-header { margin-bottom: 1.5rem; }
    .swarm-header__meta { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; opacity: 0.6; margin-bottom: 0.75rem; }
    .swarm-header__back { color: var(--ps-accent, #00e5ff); text-decoration: none; }
    .swarm-header__title { font: 700 1.5rem/1.1 'Sora', sans-serif; margin: 0 0 0.25rem; }
    .swarm-demo-badge {
      display: inline-block; vertical-align: middle; margin-left: 0.5rem;
      font: 700 0.58rem/1 'JetBrains Mono', monospace; letter-spacing: 0.06em;
      text-transform: uppercase; padding: 0.2rem 0.5rem; border-radius: 6px;
      color: var(--sw-warn); background: color-mix(in oklch, var(--sw-warn) 12%, transparent);
      border: 1px solid color-mix(in oklch, var(--sw-warn) 30%, transparent);
    }
    .swarm-header__sub { font-size: 0.8rem; opacity: 0.6; margin: 0 0 1rem; }
    .swarm-header__stats { display: flex; gap: 1.5rem; margin-bottom: 1rem; }
    .swarm-stat { display: flex; align-items: baseline; gap: 0.25rem; font-family: 'JetBrains Mono', monospace; }
    .swarm-stat__label { font-size: 0.7rem; opacity: 0.6; }
    .swarm-stat__num--conflict { color: var(--sw-warn); }
    .swarm-header__start { background: var(--ps-accent, #00e5ff); color: var(--ps-bg, #060610); border: none; padding: 0.375rem 1rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: opacity 0.2s, box-shadow 0.2s; }
    .swarm-header__start:not(:disabled):hover { box-shadow: 0 0 0 4px color-mix(in oklch, var(--ps-accent, #00e5ff) 22%, transparent); }
    .swarm-header__start:disabled { opacity: 0.5; cursor: default; }
    .swarm-header__launch { display: flex; align-items: center; gap: 0.5rem; flex: 1 1 280px; min-width: 0; justify-content: flex-end; }
    .swarm-header__directive { flex: 1 1 auto; min-width: 0; max-width: 360px; height: 34px; font-size: 0.78rem; }
    @media (max-width: 640px) { .swarm-header__launch { flex-basis: 100%; } .swarm-header__directive { max-width: none; } }
    /* Board */
    .swarm-board { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.5rem; margin-bottom: 1.5rem; }
    @media (max-width: 900px) { .swarm-board { grid-template-columns: repeat(4, 1fr); } }
    @media (max-width: 600px) { .swarm-board { grid-template-columns: repeat(2, 1fr); } }
    .swarm-agent { background: var(--sw-card); border: 1px solid var(--sw-line); border-radius: 8px; padding: 0.625rem; min-height: 100px; display: flex; flex-direction: column; gap: 0.375rem; transition: border-color 0.3s, box-shadow 0.3s; }
    .swarm-agent--running { border-color: var(--agent-color, var(--ps-accent, #00e5ff)); box-shadow: 0 0 0 1px color-mix(in oklch, var(--agent-color, var(--ps-accent, #00e5ff)) 35%, transparent); animation: agent-pulse 2s ease-in-out infinite; }
    .swarm-agent--done { border-color: var(--sw-ok); }
    .swarm-agent--error { border-color: var(--sw-err); }
    .swarm-agent--conflict { border-color: var(--sw-warn); }
    /* Queued = waiting to start: a dashed, dimmed card so pending agents read as
       not-yet-active (vs the solid-bordered running/done/error states). */
    .swarm-agent--queued { border-style: dashed; opacity: 0.72; }
    @keyframes agent-pulse { 0%,100%{opacity:1} 50%{opacity:.7} }
    @media (prefers-reduced-motion: reduce) { .swarm-agent--running { animation: none; } }
    .swarm-agent__header { display: flex; align-items: center; gap: 0.375rem; }
    .swarm-agent__icon { font-size: 1rem; }
    .swarm-agent__name { font-size: 0.7rem; font-weight: 600; text-transform: capitalize; }
    .swarm-agent__status-pill { font-size: 0.6rem; padding: 0.1rem 0.4rem; border-radius: 9999px; margin-left: auto;
      background: var(--sw-line); }
    .swarm-agent__status-pill[data-status=running] { background: color-mix(in oklch, var(--ps-accent, #00e5ff) 20%, transparent); color: var(--ps-accent, #00e5ff); }
    .swarm-agent__status-pill[data-status=done] { background: color-mix(in oklch, var(--sw-ok) 20%, transparent); color: var(--sw-ok); }
    .swarm-agent__status-pill[data-status=error] { background: color-mix(in oklch, var(--sw-err) 20%, transparent); color: var(--sw-err); }
    .swarm-agent__status-pill[data-status=queued] { background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 9%, transparent); color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 58%, transparent); }
    .swarm-agent__glob { font: 0.6rem/1.3 'JetBrains Mono', monospace; opacity: 0.5; word-break: break-all; margin: 0; }
    .swarm-agent__preview { font-size: 0.65rem; opacity: 0.7; margin: 0; font-style: italic; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .swarm-agent__duration { font: 0.65rem 'JetBrains Mono', monospace; color: var(--ps-accent, #00e5ff); }
    .swarm-agent__conflict-badge { font-size: 0.6rem; background: color-mix(in oklch, var(--sw-warn) 15%, transparent); color: var(--sw-warn); padding: 0.1rem 0.4rem; border-radius: 4px; display: inline-flex; align-items: center; }
    .sw-warn-ic { width: 1em; height: 1em; margin-right: 0.25em; }
    .sw-btn-ic { width: 1em; height: 1em; margin-right: 0.3em; vertical-align: -0.12em; }
    /* Empty */
    .swarm-empty { text-align: center; padding: 3rem 1rem; opacity: 0.6; }
    .swarm-gate-notice { text-align: center; padding: 3rem 1rem; font-size: 0.9rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 68%, transparent); }
    .swarm-empty__cta { color: var(--ps-accent, #00e5ff); background: none; border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 40%, transparent); padding: 0.375rem 0.875rem; border-radius: 9999px; cursor: pointer; }
    /* Progressive preview */
    .swarm-preview { background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 2%, transparent); border: 1px solid var(--sw-line); border-radius: 10px; padding: 0.75rem; margin-bottom: 1.5rem; }
    .swarm-preview__title { font-size: 0.875rem; font-weight: 600; margin: 0 0 0.25rem; }
    .swarm-preview__sub { font-size: 0.7rem; opacity: 0.5; margin: 0 0 0.75rem; }
    .swarm-preview__progress-bar { background: var(--sw-line); border-radius: 9999px; height: 4px; margin-bottom: 0.75rem; overflow: hidden; }
    .swarm-preview__progress-fill { background: linear-gradient(90deg, color-mix(in oklch, var(--ps-accent, #00e5ff) 70%, var(--ps-ink, #f4f4ff)), var(--ps-accent, #00e5ff)); height: 100%; border-radius: 9999px; transition: width 0.4s ease; box-shadow: 0 0 8px color-mix(in oklch, var(--ps-accent, #00e5ff) 50%, transparent); }
    .swarm-preview__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 0.375rem; }
    .swarm-preview__slot { background: var(--sw-card); border: 1px solid var(--sw-line); border-radius: 6px; padding: 0.375rem 0.5rem; display: flex; align-items: center; justify-content: space-between; font-size: 0.65rem; min-height: 28px; transition: all 0.3s; }
    .swarm-preview__slot--done { border-color: var(--sw-ok); background: color-mix(in oklch, var(--sw-ok) 6%, transparent); }
    .swarm-preview__slot--active { border-color: var(--ps-accent, #00e5ff); animation: agent-pulse 1.5s ease-in-out infinite; }
    .swarm-preview__slot-name { opacity: 0.8; }
    .swarm-preview__slot-tick { color: var(--sw-ok); font-size: 0.75rem; }
    .swarm-preview__slot-spinner { color: var(--ps-accent, #00e5ff); animation: spin 1s linear infinite; display: inline-block; font-size: 0.75rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .swarm-preview__slot--active, .swarm-preview__slot-spinner, .swarm-preview__slot-skeleton { animation: none; } }
    .swarm-preview__slot-skeleton { width: 24px; height: 6px; background: var(--sw-line); border-radius: 3px; opacity: .45; }
    /* Shimmer ONLY while a run/stream is active — an idle panel must not read as "stuck loading". Reduced-motion users never get it. */
    @media (prefers-reduced-motion: no-preference) { .swarm-preview--streaming .swarm-preview__slot-skeleton { animation: shimmer 1.5s ease-in-out infinite; } }
    @keyframes shimmer { 0%,100%{opacity:.4} 50%{opacity:.8} }
    .swarm-preview__connect { margin-top: 0.75rem; background: color-mix(in oklch, var(--ps-accent, #00e5ff) 10%, transparent); border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 30%, transparent); color: var(--ps-accent, #00e5ff); padding: 0.375rem 0.875rem; border-radius: 9999px; font-size: 0.75rem; cursor: pointer; }
    /* History */
    .swarm-history h2 { font-size: 0.875rem; margin: 0 0 0.75rem; }
    .swarm-history__scroll { overflow-x: auto; max-width: 100%; }
    .swarm-history__scroll:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }
    .swarm-history__table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
    .swarm-history__table th { text-align: left; padding: 0.375rem 0.5rem; border-bottom: 1px solid var(--sw-line); font-size: 0.65rem; text-transform: uppercase; letter-spacing: .05em; opacity: 0.5; }
    .swarm-history__row { cursor: pointer; }
    .swarm-history__row:hover td { background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 3%, transparent); }
    .swarm-history__row[aria-pressed=true] td { background: color-mix(in oklch, var(--ps-accent, #00e5ff) 10%, transparent); box-shadow: inset 2px 0 0 var(--ps-accent, #00e5ff); }
    .swarm-history__row td { padding: 0.25rem 0.5rem; border-bottom: 1px solid color-mix(in oklch, var(--ps-ink, #f4f4ff) 5%, transparent); max-height: 36px; vertical-align: middle; }
    .swarm-history__id { font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; opacity: 0.7; }
    .swarm-history__prompt { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .swarm-history__count { font-family: 'JetBrains Mono', monospace; }
    .swarm-history__status-pill { font-size: 0.6rem; padding: 0.1rem 0.4rem; border-radius: 9999px; background: var(--sw-line); }
    .swarm-history__status-pill[data-status=done] { background: color-mix(in oklch, var(--sw-ok) 15%, transparent); color: var(--sw-ok); }
    .swarm-history__status-pill[data-status=running] { background: color-mix(in oklch, var(--ps-accent, #00e5ff) 15%, transparent); color: var(--ps-accent, #00e5ff); }
  `],
})
export class AdminSwarmComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  // ApiService (not raw HttpClient) so /api/swarm/* carries the auth bearer —
  // raw http sent no Authorization → 401 when the swarm flag is on. See
  // [[admin-raw-httpclient-auth-gap]]. (SSE log-stream stays its own EventSource.)
  private api = inject(ApiService);
  private cdr = inject(ChangeDetectorRef);
  private toast = inject(ToastService);

  readonly siteId = signal<string>('');
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  /** Worker request_id from a failed load → the copyable support reference on the error card. */
  readonly loadErrorRef = signal('');
  /** True when the failure is a 404 (swarm flag off / foreign site) → permanent, no Retry. */
  readonly loadErrorGated = signal(false);
  readonly running = signal(false);
  readonly currentRun = signal<SwarmRun | null>(null);
  readonly runHistory = signal<SwarmRun[]>([]);
  readonly sseConnected = signal(false);
  readonly componentsReady = signal<string[]>([]);
  readonly activeComponent = signal<string | null>(null);
  /** True while a run is live OR the SSE stream is connected — gates the
   *  preview skeleton shimmer so an idle panel never reads as "stuck loading". */
  readonly isStreaming = computed(() => this.running() || this.sseConnected());

  readonly skeletonSlots = ['nav', 'hero', 'features', 'social-proof', 'pricing', 'testimonials', 'faq', 'cta', 'footer'];

  readonly agentsDone = computed(() => {
    const run = this.currentRun();
    if (!run) return 0;
    return run.agents.filter((a: AgentSlot) => a.status === 'done').length;
  });

  readonly conflictsDetected = computed(() => {
    const run = this.currentRun();
    if (!run) return 0;
    return run.agents.filter((a: AgentSlot) => a.conflict_detected).length;
  });

  readonly progressPct = computed(() => {
    const run = this.currentRun();
    if (!run) return 0;
    return Math.round((this.agentsDone() / run.agents.length) * 100);
  });

  private sseSource: EventSource | null = null;

  ngOnInit() {
    this.siteId.set(this.route.snapshot.paramMap.get('siteId') ?? '');
    this.loadHistory();
  }

  ngOnDestroy() {
    this.disconnectSse();
  }

  loadHistory() {
    if (!this.siteId()) return;
    this.loading.set(true);
    this.loadError.set(null);
    this.loadErrorRef.set('');
    this.loadErrorGated.set(false);
    this.api.get<{ runs: SwarmRun[] }>(`/swarm/${this.siteId()}/runs`, undefined, { silent: true })
      // null sentinel on error so a failed load is NOT mistaken for "no runs
      // yet" — otherwise a network/server failure renders the empty-state CTA
      // ("Start first swarm run"), a silent failure. Capture the worker
      // request_id (support reference) + distinguish a 404 feature-gate
      // (swarm flag off / foreign site → retrying can't help) from a transient
      // failure (500/network → offer a Retry).
      .pipe(catchError((err: unknown) => {
        this.loadErrorRef.set(this.requestIdFrom(err));
        this.loadErrorGated.set((err as { status?: number })?.status === 404);
        return of(null);
      }))
      .subscribe((res: { runs: SwarmRun[] } | null) => {
        this.loading.set(false);
        // Treat both a null sentinel (catchError) AND a 200 whose body lacks a
        // runs array (a STALE route returning SPA/marketing HTML, not a 4xx) as
        // a load failure. `res.runs ?? []` would otherwise fake-empty a broken
        // route into a misleading "no runs yet" CTA. See [[stale-route-fake-empty]].
        if (!res || !Array.isArray(res.runs)) {
          this.loadError.set(this.loadErrorGated()
            ? "Swarm isn't available for this site."
            : 'Could not load swarm runs — check your connection and retry.');
          this.cdr.markForCheck();
          return;
        }
        this.runHistory.set(res.runs);
        if (res.runs[0]) this.currentRun.set(res.runs[0]);
        this.cdr.markForCheck();
      });
  }

  /** Pull the worker request_id from a failed response ({ error: { request_id } }) for the support reference. */
  private requestIdFrom(e: unknown): string {
    return ((e as { error?: { error?: { request_id?: string } } } | undefined)?.error?.error?.request_id) ?? '';
  }

  /** Default directive when the operator leaves the field blank. */
  readonly DEFAULT_DIRECTIVE = 'Improve all site sections with 7 parallel specialists';
  swarmPrompt = '';

  startSwarm() {
    if (this.running()) return;
    this.running.set(true);
    this.api.post<SwarmRun>(`/swarm/${this.siteId()}/start`, {
      prompt: this.swarmPrompt.trim() || this.DEFAULT_DIRECTIVE,
    }, { silent: true }).pipe(catchError((_e: unknown) => {
      this.running.set(false);
      this.toast.error('Could not start a swarm run — please try again.');
      return of(null as SwarmRun | null);
    })).subscribe((run: SwarmRun | null) => {
      if (run) {
        this.currentRun.set(run);
        this.runHistory.update((h: SwarmRun[]) => [run, ...h]);
        this.connectSse();
      } else {
        this.running.set(false);
      }
      this.cdr.markForCheck();
    });
  }

  connectSse() {
    if (this.sseConnected()) return;
    const run = this.currentRun();
    const url = `/api/swarm/${this.siteId()}/stream${run ? `?run_id=${run.run_id}` : ''}`;
    this.sseSource = new EventSource(url);
    this.sseConnected.set(true);

    this.sseSource.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data) as {
          type: string; agent?: string; component?: string; progress_pct?: number;
        };
        if (data.type === 'agent_done' && data.agent) {
          this.currentRun.update((r: SwarmRun | null) => {
            if (!r) return r;
            return {
              ...r,
              agents: r.agents.map((a: AgentSlot) =>
                a.name === data.agent ? { ...a, status: 'done' as AgentStatus } : a,
              ),
            };
          });
        }
        if (data.type === 'component_ready' && data.component) {
          this.componentsReady.update((prev) => [...prev, data.component!]);
          this.activeComponent.set(data.component ?? null);
        }
        if (data.type === 'swarm_complete' || data.type === 'all_components_ready') {
          this.running.set(false);
          this.disconnectSse();
        }
        this.cdr.markForCheck();
      } catch { /* ignore malformed */ }
    };

    this.sseSource.onerror = () => {
      this.sseConnected.set(false);
      this.running.set(false);
      this.cdr.markForCheck();
    };
  }

  disconnectSse() {
    this.sseSource?.close();
    this.sseSource = null;
    this.sseConnected.set(false);
  }

  selectRun(run: SwarmRun) {
    this.currentRun.set(run);
    this.cdr.markForCheck();
  }

  isComponentDone(name: string) { return this.componentsReady().includes(name); }
  isComponentActive(name: string) { return this.activeComponent() === name; }
  agentIcon(name: string) { return SPECIALIST_ICONS[name] ?? '🤖'; }
  agentColor(name: string) { return SPECIALIST_COLORS[name] ?? '#00e5ff'; }
  statusLabel(s: AgentStatus) {
    return { queued: 'Waiting', running: 'Running', done: 'Done', error: 'Error' }[s] ?? s;
  }
  doneCount(agents: AgentSlot[]) { return agents.filter((a: AgentSlot) => a.status === 'done').length; }
}
