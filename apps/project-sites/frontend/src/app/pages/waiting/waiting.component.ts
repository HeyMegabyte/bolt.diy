import {
  Component,
  type OnInit,
  type OnDestroy,
  ElementRef,
  inject,
  signal,
  computed,
  effect,
  viewChild,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { timer, takeWhile, switchMap, forkJoin } from 'rxjs';
import { ApiService, type LogEntry } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';

/** Ordered pipeline steps for progress display */
const PIPELINE_STEPS = [
  { action: 'workflow.started', label: 'Starting build pipeline...', step: 1 },
  {
    action: 'workflow.step.profile_research_started',
    label: 'Researching your business...',
    step: 2,
  },
  {
    action: 'workflow.step.profile_research_complete',
    label: 'Profile research complete',
    step: 2,
  },
  {
    action: 'workflow.step.parallel_research_started',
    label: 'Analyzing brand, social presence, and images...',
    step: 3,
  },
  { action: 'workflow.step.parallel_research_complete', label: 'Research complete', step: 3 },
  { action: 'workflow.step.structure_plan_started', label: 'Planning site structure...', step: 4 },
  { action: 'workflow.step.structure_plan_complete', label: 'Structure planned', step: 4 },
  { action: 'workflow.step.multipage_generation_started', label: 'Generating pages...', step: 5 },
  { action: 'workflow.step.multipage_generation_complete', label: 'Pages generated', step: 5 },
  { action: 'workflow.step.html_generation_started', label: 'Generating website...', step: 5 },
  { action: 'workflow.step.html_generation_complete', label: 'Website generated', step: 5 },
  { action: 'workflow.step.legal_scoring_started', label: 'Running quality checks...', step: 6 },
  { action: 'workflow.step.legal_and_scoring_complete', label: 'Quality checks passed', step: 6 },
  { action: 'workflow.step.optimization_started', label: 'Optimizing and uploading...', step: 7 },
  { action: 'workflow.step.upload_started', label: 'Uploading files...', step: 7 },
  { action: 'workflow.step.upload_to_r2_complete', label: 'Files uploaded', step: 7 },
  { action: 'workflow.completed', label: 'Your site is live!', step: 8 },
] as const;

const TOTAL_STEPS = 8;

/** The 8 build phases shown as live chips in the log widget header. */
const PHASES: readonly { step: number; label: string }[] = [
  { step: 1, label: 'Start' },
  { step: 2, label: 'Research' },
  { step: 3, label: 'Brand & media' },
  { step: 4, label: 'Structure' },
  { step: 5, label: 'Generate' },
  { step: 6, label: 'Quality' },
  { step: 7, label: 'Optimize' },
  { step: 8, label: 'Live' },
];

/** One rendered terminal line. */
export interface BuildLogLine {
  time: string;
  text: string;
  kind: 'phase' | 'info' | 'error';
}

/** One phase chip with its live state. */
export interface BuildPhaseChip {
  label: string;
  state: 'done' | 'active' | 'error' | 'pending';
}

/**
 * Scrub anything secret-shaped out of a build-log line BEFORE it reaches the DOM.
 * The container streams real Claude Code output; a leaked key/token must never be
 * rendered. Pure + exported for unit coverage.
 */
export function redactBuildLogSecrets(text: string): string {
  return text
    .replace(
      /(AUTH_TOKEN|API_KEY|ACCESS_KEY|SECRET(?:_KEY)?|PASSWORD|TOKEN)(\s*[=:]\s*)\S+/gi,
      '$1$2***REDACTED***',
    )
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, 'sk-***REDACTED***')
    .replace(/\bAKIA[0-9A-Z]{8,}\b/g, 'AKIA***REDACTED***')
    .replace(/\bphc_[A-Za-z0-9]{16,}\b/g, 'phc_***REDACTED***')
    .replace(/\bre_[A-Za-z0-9]{12,}\b/g, 're_***REDACTED***')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{10,}\b/gi, 'Bearer ***REDACTED***');
}

/** Humanize a raw event action (`workflow.step.upload_started` → `upload started`). */
function humanizeAction(action: string): string {
  return action
    .replace(/^workflow\.(step\.)?/, '')
    .replace(/^container\./, '')
    .replace(/[._]/g, ' ')
    .trim();
}

/**
 * Map a raw audit-log entry to a redacted terminal line. Prefers the raw
 * `metadata_json.message` (the actual container stdout) when present, else a
 * human label for the known pipeline action. Pure + exported for unit coverage.
 */
export function toBuildLogLine(entry: LogEntry): BuildLogLine {
  let message = '';
  if (entry.metadata_json) {
    try {
      const meta = JSON.parse(entry.metadata_json) as Record<string, unknown>;
      message = String(meta['message'] ?? meta['msg'] ?? '');
    } catch {
      /* non-JSON metadata → fall back to the label */
    }
  }
  const label =
    PIPELINE_STEPS.find((s) => s.action === entry.action)?.label ?? humanizeAction(entry.action);
  const kind: BuildLogLine['kind'] = /error|fail/i.test(entry.action)
    ? 'error'
    : entry.action.startsWith('workflow.')
      ? 'phase'
      : 'info';
  let time = '';
  try {
    time = new Date(entry.created_at).toLocaleTimeString([], { hour12: false });
  } catch {
    /* keep empty on bad date */
  }
  return { time, text: redactBuildLogSecrets(message || label), kind };
}

@Component({
  selector: 'app-waiting',
  standalone: true,
  templateUrl: './waiting.component.html',
  styleUrl: './waiting.component.scss',
})
export class WaitingComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  siteId = '';
  slug = '';
  status = signal('building');
  statusMessage = signal('Preparing your project...');
  currentStep = signal(1);
  totalSteps = TOTAL_STEPS;
  alive = true;

  /** Raw build events, newest last — rendered live in the terminal widget. */
  logs = signal<LogEntry[]>([]);

  logScroll = viewChild<ElementRef<HTMLElement>>('logScroll');

  stepProgress = computed(() => `Step ${this.currentStep()} of ${this.totalSteps}`);

  /** Redacted, human/raw terminal lines for the live-logs widget. */
  logLines = computed<BuildLogLine[]>(() => this.logs().map(toBuildLogLine));

  /** Per-phase chips with live state derived from the current step + status. */
  phases = computed<BuildPhaseChip[]>(() => {
    const cur = this.currentStep();
    const errored = this.status() === 'error';
    return PHASES.map((p) => ({
      label: p.label,
      state: p.step < cur ? 'done' : p.step === cur ? (errored ? 'error' : 'active') : 'pending',
    }));
  });

  constructor() {
    // Tail the terminal to the newest line whenever the stream grows.
    effect(() => {
      this.logLines();
      const el = this.logScroll()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  ngOnInit(): void {
    this.siteId = this.route.snapshot.queryParams['id'] || '';
    this.slug = this.route.snapshot.queryParams['slug'] || '';

    if (!this.siteId) {
      this.router.navigate(['/']);
      return;
    }

    this.startPolling();
  }

  ngOnDestroy(): void {
    this.alive = false;
  }

  private startPolling(): void {
    // timer(0, …) fires immediately so the widget is never blank for the first tick.
    timer(0, 3000)
      .pipe(
        takeWhile(() => this.alive),
        switchMap(() =>
          forkJoin({
            site: this.api.getSite(this.siteId),
            logs: this.api.getSiteLogs(this.siteId, 200),
          }),
        ),
      )
      .subscribe({
        next: ({ site: siteRes, logs: logsRes }) => {
          const site = siteRes.data;
          this.status.set(site.status);

          const logs = logsRes?.data ?? [];
          this.logs.set(logs);
          this.updateStatusFromLogs(logs, site.status);

          if (site.status === 'published') {
            this.alive = false;
            this.statusMessage.set('Your site is live!');
            this.currentStep.set(TOTAL_STEPS);
            this.status.set('published');
            this.toast.success('Your site is live!');
            return;
          }

          if (site.status === 'error') {
            this.alive = false;
            this.statusMessage.set('Build failed. Please try again.');
            this.toast.error('Build failed.');
          }
        },
        error: () => {
          /* retry next interval */
        },
      });
  }

  private updateStatusFromLogs(logs: LogEntry[], siteStatus: string): void {
    const logActions = new Set(logs.map((l) => l.action));

    let latestStep = 1;
    let latestLabel = 'Preparing your project...';

    for (const pipelineStep of PIPELINE_STEPS) {
      if (logActions.has(pipelineStep.action) && pipelineStep.step >= latestStep) {
        latestStep = pipelineStep.step;
        latestLabel = pipelineStep.label;
      }
    }

    if (latestStep === 1 && siteStatus !== 'building') {
      const statusMap: Record<string, { step: number; label: string }> = {
        collecting: { step: 2, label: 'Researching your business...' },
        imaging: { step: 3, label: 'Generating images and assets...' },
        generating: { step: 5, label: 'Generating pages...' },
        uploading: { step: 7, label: 'Uploading files...' },
        published: { step: 8, label: 'Your site is live!' },
      };
      const mapped = statusMap[siteStatus];
      if (mapped) {
        latestStep = mapped.step;
        latestLabel = mapped.label;
      }
    }

    this.currentStep.set(latestStep);
    this.statusMessage.set(latestLabel);
  }

  goHome(): void {
    this.router.navigate(['/']);
  }

  goAdmin(): void {
    this.router.navigate(['/admin']);
  }

  viewSite(): void {
    window.location.href = `https://${this.slug}.projectsites.dev`;
  }

  editWithAI(): void {
    this.router.navigate(['/editor', this.slug]);
  }
}
