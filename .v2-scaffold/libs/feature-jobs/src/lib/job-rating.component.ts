/**
 * JobRatingComponent — 1-5 stars + tags + free-text feedback.
 */
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { RatingModule } from 'primeng/rating';
import { take } from 'rxjs';
import { JobsService, type JobRating } from './services/jobs.service';

@Component({
  selector: 'lib-job-rating',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ButtonModule, RatingModule],
  template: `
    <section class="rating" data-testid="job-rating">
      <h3>Rate this job</h3>
      <p-rating [(ngModel)]="stars" [stars]="5" data-testid="rating-stars"></p-rating>
      <input
        type="text"
        [(ngModel)]="tagsInput"
        placeholder="Add tags, comma-separated"
        (blur)="syncTags()"
        data-testid="rating-tags"
        class="plain-input"
      />
      <textarea
        [(ngModel)]="freeText"
        rows="3"
        placeholder="Anything else?"
        data-testid="rating-text"
        class="plain-input"
      ></textarea>
      <button
        pButton
        label="Submit rating"
        (click)="submit()"
        [disabled]="stars < 1 || busy()"
        data-testid="rating-submit"
      ></button>
    </section>
  `,
  styles: [
    `
      .rating { display: flex; flex-direction: column; gap: 0.5rem; padding: 1rem; border: 1px solid var(--border, #2a2a3a); border-radius: 0.5rem; }
      h3 { margin: 0 0 0.5rem; font-size: 1rem; }
      .plain-input { background: var(--surface-card, #15151f); border: 1px solid var(--border, #2a2a3a); color: var(--text-color, #fff); padding: 0.45rem 0.6rem; border-radius: 0.4rem; font: inherit; }
    `,
  ],
})
export class JobRatingComponent {
  @Input({ required: true }) jobId = '';
  private readonly api = inject(JobsService);

  protected stars = 0;
  protected tags: string[] = [];
  protected tagsInput = '';
  protected freeText = '';
  protected readonly busy = signal(false);

  protected syncTags(): void {
    this.tags = this.tagsInput
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  protected submit(): void {
    if (this.stars < 1 || !this.jobId) return;
    this.busy.set(true);
    const rating: JobRating = {
      stars: this.stars,
      tags: this.tags,
      free_text: this.freeText,
    };
    this.api
      .rate$(this.jobId, rating)
      .pipe(take(1))
      .subscribe({
        next: () => this.busy.set(false),
        error: () => this.busy.set(false),
      });
  }
}
