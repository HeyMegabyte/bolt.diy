import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonBadge, IonSpinner,
  IonSegment, IonSegmentButton,
  ModalController,
} from '@ionic/angular/standalone';
import { ApiService, Hostname } from '../services/api.service';
import { ToastService } from '../services/toast.service';

@Component({
  selector: 'app-domain-modal',
  standalone: true,
  imports: [
    FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonBadge, IonSpinner,
    IonSegment, IonSegmentButton,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Domain Management</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-segment [value]="tab()" (ionChange)="tab.set($any($event).detail.value)">
        <ion-segment-button value="hostnames">Your Domains</ion-segment-button>
        <ion-segment-button value="connect">Connect Domain</ion-segment-button>
        <ion-segment-button value="search">Domain Search</ion-segment-button>
      </ion-segment>

      <!-- Tab 1: Your Domains -->
      @if (tab() === 'hostnames') {
        @if (loading()) {
          <div class="modal-loading"><ion-spinner name="crescent"></ion-spinner> Loading domains...</div>
        } @else {
          @if (hostnames().length > 0) {
            <div class="hostname-list">
              @for (hn of hostnames(); track hn.id) {
                <div class="hostname-card" [class.hostname-active]="hn.status === 'active'" [class.hostname-pending]="hn.status === 'pending'" [class.hostname-error]="hn.status !== 'active' && hn.status !== 'pending'">
                  <div class="hn-main">
                    <div class="hn-status-icon">
                      @if (hn.status === 'active') {
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      } @else if (hn.status === 'pending') {
                        <ion-spinner name="dots" class="hn-spinner"></ion-spinner>
                      } @else {
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="3">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      }
                    </div>
                    <div class="hn-info">
                      <span class="hn-name">
                        {{ hn.hostname }}
                        @if (hn.is_primary) {
                          <ion-badge color="primary" class="hn-primary-badge">Primary</ion-badge>
                        }
                      </span>
                      <span class="hn-status-label" [class]="'hn-status-' + hn.status">
                        {{ hn.status === 'active' ? 'Connected' : hn.status === 'pending' ? 'Verifying DNS...' : 'Error' }}
                      </span>
                    </div>
                  </div>
                  <div class="hn-actions">
                    @if (!hn.is_primary && hn.status === 'active') {
                      <button class="hn-btn" (click)="setPrimary(hn.id)">Set Primary</button>
                    }
                    <button class="hn-btn hn-btn-danger" (click)="deleteHostname(hn.id)">Remove</button>
                  </div>
                </div>
              }
            </div>
          } @else {
            <div class="empty-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
              <p>No custom domains configured.</p>
              <p class="empty-hint">Switch to the "Connect Domain" tab to add one.</p>
            </div>
          }

          <div class="add-domain-row">
            <input
              type="text"
              class="input-field"
              placeholder="yourdomain.com"
              [(ngModel)]="newHostname"
              (keyup.enter)="addHostname()"
              data-testid="domain-input"
            />
            <ion-button fill="solid" [disabled]="!newHostname.trim() || adding()" (click)="addHostname()" data-testid="add-domain-btn">
              @if (adding()) { Adding... } @else { Add Domain }
            </ion-button>
          </div>
        }
      }

      <!-- Tab 2: Connect Domain (CNAME instructions) -->
      @if (tab() === 'connect') {
        <div class="connect-steps">
          <h4>How to connect your domain</h4>

          <div class="step-card">
            <div class="step-number">1</div>
            <div class="step-content">
              <h5>Log in to your domain registrar</h5>
              <p>Go to your registrar's DNS management panel (GoDaddy, Namecheap, Cloudflare, etc.)</p>
            </div>
          </div>

          <div class="step-card">
            <div class="step-number">2</div>
            <div class="step-content">
              <h5>Add a CNAME record</h5>
              <p>Create a new DNS record with these values:</p>
              <div class="dns-record">
                <div class="dns-field">
                  <span class="dns-label">Type</span>
                  <span class="dns-value">CNAME</span>
                </div>
                <div class="dns-field">
                  <span class="dns-label">Name / Host</span>
                  <span class="dns-value dns-copiable" (click)="copyText('www')">
                    www
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </span>
                </div>
                <div class="dns-field">
                  <span class="dns-label">Value / Target</span>
                  <span class="dns-value dns-copiable" (click)="copyText('projectsites.dev')">
                    projectsites.dev
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="step-card">
            <div class="step-number">3</div>
            <div class="step-content">
              <h5>Wait for DNS propagation</h5>
              <p>DNS changes usually take 5-30 minutes. We check automatically every 15 seconds while this modal is open.</p>
            </div>
          </div>

          <div class="dns-note">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            For root domains (apex), use an ALIAS or ANAME record if your registrar supports it, or use Cloudflare's CNAME flattening.
          </div>
        </div>
      }

      <!-- Tab 3: Domain Search (placeholder) -->
      @if (tab() === 'search') {
        <div class="search-placeholder">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <h4>Domain Search</h4>
          <p>Search for available domain names to register for your site.</p>
          <p class="coming-soon">Coming Soon</p>
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
      text-align: center; padding: 32px; color: var(--text-muted);
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      svg { opacity: 0.4; }
    }
    .empty-hint { font-size: 0.8rem; }
    ion-segment { margin-bottom: 16px; }

    /* Hostname list */
    .hostname-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
    .hostname-card {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-radius: 10px;
      background: var(--bg-input); border: 1px solid var(--border);
      transition: border-color 0.2s;
    }
    .hostname-active { border-color: rgba(0, 230, 118, 0.2); }
    .hostname-pending { border-color: rgba(255, 171, 0, 0.2); }
    .hostname-error { border-color: rgba(255, 23, 68, 0.15); }
    .hn-main { display: flex; align-items: center; gap: 12px; }
    .hn-status-icon { flex-shrink: 0; width: 20px; display: flex; align-items: center; justify-content: center; }
    .hn-spinner { width: 16px; height: 16px; color: #ffab00; }
    .hn-info { display: flex; flex-direction: column; gap: 2px; }
    .hn-name { font-size: 0.9rem; font-weight: 500; color: var(--text-primary); display: flex; align-items: center; gap: 8px; }
    .hn-primary-badge { font-size: 0.6rem; }
    .hn-status-label { font-size: 0.75rem; }
    .hn-status-active { color: var(--success); }
    .hn-status-pending { color: #ffab00; }
    .hn-actions { display: flex; gap: 6px; }
    .hn-btn {
      padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border);
      background: transparent; color: var(--text-secondary); font-size: 0.72rem;
      font-weight: 500; cursor: pointer; transition: all 0.15s; outline: none;
      font-family: var(--font);
      &:hover { border-color: var(--accent); color: var(--accent); }
      &:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
      &:active { transform: scale(0.95); }
    }
    .hn-btn-danger {
      &:hover { border-color: var(--error); color: var(--error); }
      &:focus-visible { outline-color: var(--error); }
      &:active { background: var(--error-dim); }
    }

    /* Add domain row */
    .add-domain-row {
      display: flex; gap: 12px; margin-top: 8px;
      .input-field { flex: 1; }
    }

    /* Connect domain steps */
    .connect-steps { padding: 8px 0; }
    .connect-steps h4 { font-size: 1rem; font-weight: 600; margin-bottom: 16px; color: var(--text-primary); }
    .step-card {
      display: flex; gap: 16px; padding: 16px 0;
      &:not(:last-of-type) { border-bottom: 1px solid var(--border); }
    }
    .step-number {
      width: 32px; height: 32px; border-radius: 50%;
      background: var(--accent-dim); color: var(--accent);
      display: flex; align-items: center; justify-content: center;
      font-size: 0.85rem; font-weight: 700; flex-shrink: 0;
    }
    .step-content { flex: 1; }
    .step-content h5 { font-size: 0.92rem; font-weight: 600; margin-bottom: 4px; color: var(--text-primary); }
    .step-content p { font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; }
    .dns-record {
      margin-top: 12px; padding: 12px 16px; background: var(--bg-input);
      border-radius: 8px; border: 1px solid var(--border);
      display: flex; flex-direction: column; gap: 8px;
    }
    .dns-field { display: flex; align-items: center; gap: 12px; }
    .dns-label { font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; width: 100px; }
    .dns-value {
      font-family: 'Menlo', 'Consolas', monospace; font-size: 0.85rem; color: var(--accent);
      padding: 2px 8px; background: rgba(0, 229, 255, 0.06); border-radius: 4px;
    }
    .dns-copiable {
      cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
      transition: background 0.15s; outline: none; border-radius: 4px;
      svg { opacity: 0.5; transition: opacity 0.15s; }
      &:hover { background: rgba(0, 229, 255, 0.12); svg { opacity: 1; } }
      &:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
      &:active { background: rgba(0, 229, 255, 0.18); }
    }
    .dns-note {
      display: flex; align-items: flex-start; gap: 8px; margin-top: 16px;
      padding: 12px; background: var(--accent-dim); border-radius: 8px;
      font-size: 0.82rem; color: var(--text-secondary); line-height: 1.5;
      svg { flex-shrink: 0; margin-top: 2px; color: var(--accent); }
    }

    /* Domain search placeholder */
    .search-placeholder {
      text-align: center; padding: 48px 20px; color: var(--text-muted);
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      svg { opacity: 0.3; }
      h4 { font-size: 1rem; color: var(--text-secondary); }
      p { font-size: 0.88rem; }
    }
    .coming-soon {
      margin-top: 8px; padding: 4px 14px; border-radius: 20px;
      background: var(--secondary-dim); color: var(--secondary);
      font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.06em;
    }
  `],
})
export class DomainModalComponent implements OnInit, OnDestroy {
  private modalCtrl = inject(ModalController);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  siteId!: string;
  hostnames = signal<Hostname[]>([]);
  loading = signal(true);
  adding = signal(false);
  tab = signal<'hostnames' | 'connect' | 'search'>('hostnames');
  newHostname = '';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.loadHostnames();
    this.refreshTimer = setInterval(() => {
      if (this.hostnames().some((h) => h.status === 'pending')) {
        this.loadHostnames();
      }
    }, 15000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'close');
  }

  copyText(text: string): void {
    navigator.clipboard.writeText(text).then(
      () => this.toast.success(`"${text}" copied`),
      () => this.toast.error('Failed to copy')
    );
  }

  private loadHostnames(): void {
    this.api.getHostnames(this.siteId).subscribe({
      next: (res) => {
        this.hostnames.set(res.data || []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Failed to load domains');
      },
    });
  }

  addHostname(): void {
    if (!this.newHostname.trim()) return;
    this.adding.set(true);
    this.api.addHostname(this.siteId, this.newHostname.trim()).subscribe({
      next: (res) => {
        this.hostnames.update((h) => [...h, res.data]);
        this.newHostname = '';
        this.adding.set(false);
        this.toast.success('Domain added');
      },
      error: (err) => {
        this.adding.set(false);
        this.toast.error(err?.error?.message || 'Failed to add domain');
      },
    });
  }

  setPrimary(hostnameId: string): void {
    this.api.setPrimaryHostname(this.siteId, hostnameId).subscribe({
      next: () => {
        this.hostnames.update((h) =>
          h.map((hn) => ({ ...hn, is_primary: hn.id === hostnameId }))
        );
        this.toast.success('Primary domain updated');
      },
      error: () => this.toast.error('Failed to set primary'),
    });
  }

  deleteHostname(hostnameId: string): void {
    this.api.deleteHostname(this.siteId, hostnameId).subscribe({
      next: () => {
        this.hostnames.update((h) => h.filter((hn) => hn.id !== hostnameId));
        this.toast.success('Domain removed');
      },
      error: () => this.toast.error('Failed to remove domain'),
    });
  }
}
