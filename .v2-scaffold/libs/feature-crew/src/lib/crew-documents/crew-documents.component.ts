/**
 * CrewDocumentsComponent — license / insurance / W9 / I9 uploads, with
 * verification status + expiry warnings.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { take } from 'rxjs';
import { CrewService } from '@org/data-access';
import type { CrewDocument } from '@org/domain';

@Component({
  selector: 'lib-crew-documents',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ButtonModule, TagModule, DatePipe],
  template: `
    <div class="docs" data-testid="crew-documents">
      <ng-container *ngIf="documents$ | async as docs">
        <article *ngFor="let doc of docs" class="doc">
          <header>
            <strong>{{ doc.kind | uppercase }}</strong>
            <p-tag
              [value]="doc.verified_at ? 'verified' : 'pending'"
              [severity]="doc.verified_at ? 'success' : 'warning'"
            />
          </header>
          <p *ngIf="doc.expires_at">Expires {{ doc.expires_at | date: 'mediumDate' }}</p>
          <a [href]="doc.url" target="_blank" rel="noopener">View document</a>
        </article>

        <label class="upload">
          <span>Upload new document</span>
          <select [(ngModel)]="kind" name="kind">
            <option value="license">License</option>
            <option value="insurance">Insurance</option>
            <option value="w9">W-9</option>
            <option value="i9">I-9</option>
            <option value="other">Other</option>
          </select>
          <input
            type="file"
            (change)="onFile($event)"
            data-testid="crew-doc-upload"
            accept="application/pdf,image/*"
          />
        </label>
      </ng-container>
    </div>
  `,
  styles: [
    `
      .docs { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem 0; }
      .doc { border: 1px solid var(--border, #2a2a3a); padding: 0.75rem 1rem; border-radius: 0.5rem; }
      .doc header { display: flex; justify-content: space-between; align-items: center; }
      .upload { display: grid; gap: 0.5rem; padding: 1rem; border: 1px dashed var(--border, #2a2a3a); border-radius: 0.5rem; }
    `,
  ],
})
export class CrewDocumentsComponent {
  private readonly crew = inject(CrewService);
  protected readonly documents$ = this.crew.documents$();
  protected kind: CrewDocument['kind'] = 'license';
  protected readonly uploading = signal(false);

  protected onFile(ev: Event): void {
    const target = ev.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    this.uploading.set(true);
    this.crew
      .uploadDocument$(this.kind, file)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.uploading.set(false);
          target.value = '';
        },
        error: () => this.uploading.set(false),
      });
  }
}
