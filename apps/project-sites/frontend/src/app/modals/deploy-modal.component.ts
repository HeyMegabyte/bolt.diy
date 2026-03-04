import { Component, inject, signal } from '@angular/core';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonSelect, IonSelectOption, IonSpinner,
  ModalController,
} from '@ionic/angular/standalone';
import { FormsModule } from '@angular/forms';
import { ApiService, Site } from '../services/api.service';
import { ToastService } from '../services/toast.service';

type DeployStep = 'idle' | 'uploading' | 'processing' | 'publishing' | 'done' | 'error';

@Component({
  selector: 'app-deploy-modal',
  standalone: true,
  imports: [
    FormsModule, IonHeader, IonToolbar, IonTitle, IonButtons,
    IonButton, IonContent, IonSpinner,
    IonSelect, IonSelectOption,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Deploy ZIP</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="deploy-zone" (dragover)="onDragOver($event)" (dragleave)="onDragLeave()" (drop)="onDrop($event)"
           [class.dragging]="dragging()">
        @if (!selectedFile()) {
          <div class="drop-content">
            <div class="drop-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <p class="drop-title">Drag & drop a ZIP file here</p>
            <span class="or-text">or</span>
            <button class="browse-btn" (click)="fileInput.click()">Browse Files</button>
            <input #fileInput type="file" accept=".zip" (change)="onFileSelect($event)" hidden />
          </div>
        } @else {
          <div class="selected-file-info">
            <div class="file-icon-wrap">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <path d="M14 2v6h6"/>
              </svg>
            </div>
            <div class="file-details">
              <span class="file-name">{{ selectedFile()!.name }}</span>
              <span class="file-meta">{{ formatSize(selectedFile()!.size) }}
                @if (fileCount() > 0) { &middot; {{ fileCount() }} files }
              </span>
            </div>
            <button class="remove-btn" (click)="clearFile()" [disabled]="deployStep() !== 'idle'" data-testid="remove-file-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          @if (folders().length > 1) {
            <div class="folder-select">
              <label>Select root folder:</label>
              <ion-select [(ngModel)]="selectedFolder" interface="popover">
                @for (folder of folders(); track folder) {
                  <ion-select-option [value]="folder">{{ folder || '(root)' }}</ion-select-option>
                }
              </ion-select>
            </div>
          }
        }
      </div>

      <!-- Deploy progress -->
      @if (deployStep() !== 'idle') {
        <div class="deploy-progress">
          <div class="progress-steps">
            <div class="progress-step" [class.active]="isStepActive('uploading')" [class.done]="isStepDone('uploading')">
              <div class="ps-icon">
                @if (isStepDone('uploading')) {
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                } @else if (isStepActive('uploading')) {
                  <ion-spinner name="dots" class="ps-spinner"></ion-spinner>
                } @else {
                  <span class="ps-number">1</span>
                }
              </div>
              <span class="ps-label">Uploading</span>
            </div>
            <div class="progress-connector" [class.done]="isStepDone('uploading')"></div>
            <div class="progress-step" [class.active]="isStepActive('processing')" [class.done]="isStepDone('processing')">
              <div class="ps-icon">
                @if (isStepDone('processing')) {
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                } @else if (isStepActive('processing')) {
                  <ion-spinner name="dots" class="ps-spinner"></ion-spinner>
                } @else {
                  <span class="ps-number">2</span>
                }
              </div>
              <span class="ps-label">Processing</span>
            </div>
            <div class="progress-connector" [class.done]="isStepDone('processing')"></div>
            <div class="progress-step" [class.active]="isStepActive('publishing')" [class.done]="isStepDone('publishing')">
              <div class="ps-icon">
                @if (isStepDone('publishing')) {
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                } @else if (isStepActive('publishing')) {
                  <ion-spinner name="dots" class="ps-spinner"></ion-spinner>
                } @else {
                  <span class="ps-number">3</span>
                }
              </div>
              <span class="ps-label">Publishing</span>
            </div>
          </div>
          @if (deployStep() === 'done') {
            <div class="deploy-success">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Deploy successful!
            </div>
          }
          @if (deployStep() === 'error') {
            <div class="deploy-error">Deploy failed. Please try again.</div>
          }
        </div>
      }

      <button class="deploy-submit-btn"
        [disabled]="!selectedFile() || deployStep() !== 'idle'"
        (click)="submitDeploy()"
        data-testid="deploy-submit-btn">
        @if (deployStep() !== 'idle' && deployStep() !== 'done' && deployStep() !== 'error') {
          <ion-spinner name="dots" class="btn-spinner"></ion-spinner>
          Deploying...
        } @else {
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Deploy
        }
      </button>
    </ion-content>
  `,
  styles: [`
    .deploy-zone {
      border: 2px dashed var(--border);
      border-radius: var(--radius-lg);
      padding: 40px 20px;
      text-align: center;
      transition: border-color 0.2s, background 0.2s;
      margin-bottom: 20px;

      &.dragging {
        border-color: var(--accent);
        background: var(--accent-dim);
      }
    }
    .drop-content {
      display: flex; flex-direction: column; align-items: center; gap: 12px;
    }
    .drop-icon {
      width: 80px; height: 80px; border-radius: 50%;
      background: var(--accent-dim);
      display: flex; align-items: center; justify-content: center;
      svg { color: var(--accent); opacity: 0.7; }
    }
    .drop-title { color: var(--text-secondary); font-size: 0.95rem; font-weight: 500; }
    .or-text { color: var(--text-muted); font-size: 0.8rem; }
    .browse-btn {
      padding: 8px 20px; border-radius: 8px; border: 1px solid var(--border);
      background: transparent; color: var(--text-primary); font-size: 0.85rem;
      font-weight: 500; cursor: pointer; transition: all 0.15s; font-family: var(--font);
      outline: none;
      &:hover { border-color: var(--accent); color: var(--accent); }
      &:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      &:active { transform: scale(0.97); background: rgba(0, 229, 255, 0.06); }
    }
    .selected-file-info {
      display: flex; align-items: center; gap: 12px; justify-content: center;
    }
    .file-icon-wrap { color: var(--accent); flex-shrink: 0; }
    .file-details { display: flex; flex-direction: column; text-align: left; }
    .file-name { font-size: 0.9rem; font-weight: 500; color: var(--text-primary); }
    .file-meta { font-size: 0.75rem; color: var(--text-muted); }
    .remove-btn {
      width: 28px; height: 28px; border-radius: 50%;
      border: none; background: var(--error-dim); color: var(--error);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: all 0.15s; outline: none;
      &:hover:not(:disabled) { background: rgba(239, 68, 68, 0.2); }
      &:focus-visible { outline: 2px solid var(--error); outline-offset: 2px; }
      &:active:not(:disabled) { transform: scale(0.9); background: rgba(239, 68, 68, 0.25); }
      &:disabled { opacity: 0.3; cursor: not-allowed; }
    }
    .folder-select {
      margin-top: 16px;
      label { font-size: 0.82rem; color: var(--text-secondary); display: block; margin-bottom: 4px; }
    }

    /* Deploy progress */
    .deploy-progress { margin-bottom: 20px; }
    .progress-steps {
      display: flex; align-items: center; justify-content: center;
      gap: 0; padding: 16px 0;
    }
    .progress-step {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
    }
    .ps-icon {
      width: 32px; height: 32px; border-radius: 50%;
      background: var(--bg-secondary); border: 2px solid var(--border);
      display: flex; align-items: center; justify-content: center;
      color: var(--text-muted); transition: all 0.3s;
    }
    .ps-number { font-size: 0.75rem; font-weight: 700; }
    .ps-spinner { width: 16px; height: 16px; }
    .ps-label { font-size: 0.72rem; color: var(--text-muted); font-weight: 500; }
    .progress-step.active {
      .ps-icon { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
      .ps-label { color: var(--accent); }
    }
    .progress-step.done {
      .ps-icon { border-color: #22c55e; color: #22c55e; background: rgba(34, 197, 94, 0.12); }
      .ps-label { color: #22c55e; }
    }
    .progress-connector {
      width: 40px; height: 2px; background: var(--border);
      margin: 0 4px; margin-bottom: 20px; transition: background 0.3s;
      &.done { background: #22c55e; }
    }
    .deploy-success {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      padding: 12px; background: rgba(34, 197, 94, 0.08); border-radius: 8px;
      color: #22c55e; font-size: 0.88rem; font-weight: 500; margin-top: 8px;
    }
    .deploy-error {
      padding: 12px; background: var(--error-dim); border-radius: 8px;
      color: var(--error); font-size: 0.88rem; text-align: center; margin-top: 8px;
    }

    /* Submit button */
    .deploy-submit-btn {
      width: 100%; padding: 14px; border-radius: var(--radius);
      border: none; background: linear-gradient(135deg, var(--accent), var(--secondary));
      color: var(--bg-primary); font-size: 0.95rem; font-weight: 600;
      font-family: var(--font); cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      transition: all 0.2s; outline: none;
      &:hover:not(:disabled) { filter: brightness(1.1); box-shadow: 0 4px 16px rgba(0, 229, 255, 0.3); }
      &:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; box-shadow: 0 0 0 4px var(--accent-dim); }
      &:active:not(:disabled) { transform: scale(0.97); filter: brightness(0.92); }
      &:disabled { opacity: 0.4; cursor: not-allowed; }
    }
    .btn-spinner { width: 16px; height: 16px; }
  `],
})
export class DeployModalComponent {
  private modalCtrl = inject(ModalController);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  site!: Site;
  selectedFile = signal<File | null>(null);
  folders = signal<string[]>([]);
  fileCount = signal(0);
  selectedFolder = '';
  dragging = signal(false);
  deployStep = signal<DeployStep>('idle');

  private readonly stepOrder: DeployStep[] = ['uploading', 'processing', 'publishing', 'done'];

  dismiss(): void {
    this.modalCtrl.dismiss(null, 'close');
  }

  isStepActive(step: DeployStep): boolean {
    return this.deployStep() === step;
  }

  isStepDone(step: DeployStep): boolean {
    const current = this.stepOrder.indexOf(this.deployStep());
    const target = this.stepOrder.indexOf(step);
    return current > target;
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDragLeave(): void {
    this.dragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files[0];
    if (file && file.name.endsWith('.zip')) {
      this.setFile(file);
    } else {
      this.toast.error('Please upload a ZIP file');
    }
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.setFile(file);
  }

  private async setFile(file: File): Promise<void> {
    this.selectedFile.set(file);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(file);
      const topFolders = new Set<string>();
      topFolders.add('');
      let count = 0;
      zip.forEach((relativePath, entry) => {
        if (!entry.dir) count++;
        const parts = relativePath.split('/');
        if (parts.length > 1) topFolders.add(parts[0]);
      });
      this.fileCount.set(count);
      this.folders.set(Array.from(topFolders));
      if (this.folders().length > 1) {
        this.selectedFolder = this.folders()[1] || '';
      }
    } catch {
      this.folders.set([]);
      this.fileCount.set(0);
    }
  }

  clearFile(): void {
    this.selectedFile.set(null);
    this.folders.set([]);
    this.fileCount.set(0);
    this.selectedFolder = '';
    this.deployStep.set('idle');
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  submitDeploy(): void {
    const file = this.selectedFile();
    if (!file) return;

    this.deployStep.set('uploading');

    const formData = new FormData();
    formData.append('file', file);
    if (this.selectedFolder) {
      formData.append('folder', this.selectedFolder);
    }

    // Simulate progress steps
    setTimeout(() => {
      if (this.deployStep() === 'uploading') {
        this.deployStep.set('processing');
      }
    }, 1500);

    this.api.deployZip(this.site.id, formData).subscribe({
      next: () => {
        this.deployStep.set('publishing');
        setTimeout(() => {
          this.deployStep.set('done');
          this.toast.success('Deploy successful!');
          setTimeout(() => {
            this.modalCtrl.dismiss(true, 'deployed');
          }, 1500);
        }, 800);
      },
      error: (err) => {
        this.deployStep.set('error');
        this.toast.error(err?.error?.message || 'Deploy failed');
      },
    });
  }
}
