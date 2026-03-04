import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonSpinner,
  ModalController,
} from '@ionic/angular/standalone';
import { ApiService, LogEntry } from '../services/api.service';
import { ToastService } from '../services/toast.service';

interface DisplayLog {
  action: string;
  rawAction: string;
  created_at: string;
  relativeTime: string;
  metadata?: string;
  color: string;
  icon: string;
}

const ACTION_STYLES: Record<string, { color: string; icon: string }> = {
  'site.created':       { color: '#22c55e', icon: 'plus' },
  'site.updated':       { color: '#3b82f6', icon: 'edit' },
  'site.deleted':       { color: '#ef4444', icon: 'trash' },
  'workflow.started':   { color: '#00b8d4', icon: 'play' },
  'workflow.completed': { color: '#22c55e', icon: 'check' },
  'workflow.failed':    { color: '#ef4444', icon: 'x' },
  'hostname.added':     { color: '#3b82f6', icon: 'globe' },
  'hostname.verified':  { color: '#22c55e', icon: 'globe' },
  'hostname.removed':   { color: '#ef4444', icon: 'globe' },
  'billing.checkout_created':   { color: '#00b8d4', icon: 'card' },
  'billing.subscription_active': { color: '#22c55e', icon: 'card' },
  'deploy.started':     { color: '#ffab00', icon: 'upload' },
  'deploy.completed':   { color: '#22c55e', icon: 'upload' },
};

function getActionStyle(action: string): { color: string; icon: string } {
  if (ACTION_STYLES[action]) return ACTION_STYLES[action];
  if (action.includes('create') || action.includes('added')) return { color: '#22c55e', icon: 'plus' };
  if (action.includes('delete') || action.includes('remove')) return { color: '#ef4444', icon: 'trash' };
  if (action.includes('update') || action.includes('edit')) return { color: '#3b82f6', icon: 'edit' };
  if (action.includes('deploy') || action.includes('upload')) return { color: '#00b8d4', icon: 'upload' };
  if (action.includes('workflow') || action.includes('build')) return { color: '#ffab00', icon: 'play' };
  return { color: '#607d8b', icon: 'dot' };
}

@Component({
  selector: 'app-logs-modal',
  standalone: true,
  imports: [
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonSpinner,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Build Logs</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="copyLogsForAI()" data-testid="copy-logs-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" slot="start">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Copy for AI
          </ion-button>
          <ion-button (click)="refresh()">Refresh</ion-button>
          <ion-button (click)="dismiss()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @if (loading()) {
        <div class="modal-loading"><ion-spinner name="crescent"></ion-spinner> Loading logs...</div>
      } @else if (logs().length === 0) {
        <div class="empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/>
          </svg>
          <p>No logs yet.</p>
        </div>
      } @else {
        <div class="timeline">
          @for (log of logs(); track log.created_at) {
            <div class="timeline-entry">
              <div class="timeline-dot" [style.--dot-color]="log.color">
                @switch (log.icon) {
                  @case ('plus') {
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 5v14M5 12h14"/></svg>
                  }
                  @case ('edit') {
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  }
                  @case ('trash') {
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                  }
                  @case ('check') {
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                  }
                  @case ('x') {
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  }
                  @case ('play') {
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  }
                  @case ('globe') {
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
                  }
                  @case ('upload') {
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  }
                  @case ('card') {
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                  }
                  @default {
                    <span class="dot-circle"></span>
                  }
                }
              </div>
              <div class="timeline-content">
                <span class="tl-action" [style.color]="log.color">{{ log.action }}</span>
                <span class="tl-time">{{ log.relativeTime }}</span>
              </div>
            </div>
          }
        </div>
      }
    </ion-content>
  `,
  styles: [`
    .modal-loading {
      text-align: center; padding: 40px; color: var(--text-muted);
      display: flex; align-items: center; justify-content: center; gap: 12px;
    }
    .empty-state {
      text-align: center; padding: 40px; color: var(--text-muted);
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      svg { opacity: 0.4; }
    }

    /* Timeline */
    .timeline {
      padding: 8px 0;
    }
    .timeline-entry {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 0 0 20px 0;
      position: relative;

      &:not(:last-child)::after {
        content: '';
        position: absolute;
        left: 13px;
        top: 28px;
        bottom: 0;
        width: 2px;
        background: var(--border);
      }
    }
    .timeline-dot {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--dot-color) 15%, transparent);
      color: var(--dot-color);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border: 2px solid color-mix(in srgb, var(--dot-color) 30%, transparent);
    }
    .dot-circle {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }
    .timeline-content {
      flex: 1;
      padding-top: 3px;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
    }
    .tl-action {
      font-size: 0.88rem;
      font-weight: 500;
    }
    .tl-time {
      font-size: 0.72rem;
      color: var(--text-muted);
      white-space: nowrap;
    }
  `],
})
export class LogsModalComponent implements OnInit, OnDestroy {
  private modalCtrl = inject(ModalController);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  siteId!: string;
  logs = signal<DisplayLog[]>([]);
  loading = signal(true);
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.loadLogs();
    this.timer = setInterval(() => this.updateRelativeTimes(), 30000);
    this.refreshTimer = setInterval(() => this.loadLogs(), 30000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'close');
  }

  refresh(): void {
    this.loadLogs();
  }

  copyLogsForAI(): void {
    const text = this.logs()
      .map((l) => `[${l.created_at}] ${l.action}${l.metadata ? ` | ${l.metadata}` : ''}`)
      .join('\n');
    navigator.clipboard.writeText(text).then(
      () => this.toast.success('Logs copied to clipboard'),
      () => this.toast.error('Failed to copy logs')
    );
  }

  private loadLogs(): void {
    this.loading.set(true);
    this.api.getSiteLogs(this.siteId).subscribe({
      next: (res) => {
        this.logs.set(
          (res.data || []).map((l) => {
            const style = getActionStyle(l.action);
            return {
              action: this.formatLogAction(l.action),
              rawAction: l.action,
              created_at: l.created_at,
              relativeTime: this.formatRelativeTime(l.created_at),
              metadata: l.metadata_json || undefined,
              color: style.color,
              icon: style.icon,
            };
          })
        );
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Failed to load logs');
      },
    });
  }

  private updateRelativeTimes(): void {
    this.logs.update((logs) =>
      logs.map((l) => ({ ...l, relativeTime: this.formatRelativeTime(l.created_at) }))
    );
  }

  private formatLogAction(action: string): string {
    const map: Record<string, string> = {
      'site.created': 'Site Created',
      'site.updated': 'Site Updated',
      'site.deleted': 'Site Deleted',
      'workflow.started': 'Build Started',
      'workflow.completed': 'Build Completed',
      'workflow.failed': 'Build Failed',
      'workflow.step.profile_research_complete': 'Profile Research Done',
      'workflow.step.generate_website_complete': 'Website Generated',
      'workflow.step.upload_complete': 'Upload Complete',
      'hostname.added': 'Domain Added',
      'hostname.verified': 'Domain Verified',
      'hostname.removed': 'Domain Removed',
      'billing.checkout_created': 'Checkout Started',
      'billing.subscription_active': 'Subscription Active',
      'deploy.started': 'Deploy Started',
      'deploy.completed': 'Deploy Completed',
    };
    return map[action] || action.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private formatRelativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }
}
