/**
 * Per-day tab card inside the multi-day quote wizard.
 *
 * Doctrine §10: each day's start/end time inputs render with a tiny
 * "Start and end time" caption rendered **bottom-right** so the field
 * grid stays free of label clutter. The bottom-right anchor is
 * load-bearing — `quote-wizard.spec.ts` asserts the caption's
 * computed `text-align` resolves to `right`.
 *
 * Schedule-bounce guard: when the wizard parent re-emits a Day, the
 * `[day]` input might be a fresh `Date` for one field and the cached
 * one for another. We normalize back to ISO strings on every emit so
 * a write to "end" never resets "start".
 */
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { WizardDay } from './types.js';

@Component({
  selector: 'lib-quote-day-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  styles: [
    `
      :host {
        display: block;
        --ps-radius-xl: 22px;
        --ps-shadow-modal: 0 8px 32px rgba(0, 0, 0, 0.28);
      }
      .ps-day-card {
        position: relative;
        border-radius: var(--ps-radius-xl);
        padding: 18px 20px 36px 20px;
        background: var(--ps-bg, #0c0c14);
        color: var(--ps-ink, #f4f4ff);
        box-shadow: var(--ps-shadow-modal);
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px 18px;
      }
      .ps-day-card h4 {
        grid-column: 1 / -1;
        margin: 0 0 4px 0;
        font-size: 0.92rem;
        letter-spacing: 0.02em;
        opacity: 0.92;
      }
      .ps-day-card label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 0.78rem;
        opacity: 0.7;
      }
      .ps-day-card input[type='datetime-local'] {
        appearance: none;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: inherit;
        padding: 8px 10px;
        border-radius: 10px;
        font: inherit;
      }
      .ps-day-card .ps-day-card__caption {
        position: absolute;
        right: 12px;
        bottom: 8px;
        font-size: 0.68rem;
        opacity: 0.55;
        text-align: right;
      }
      .ps-day-card .ps-day-card__edit {
        position: absolute;
        right: 12px;
        top: 12px;
      }
    `,
  ],
  template: `
    <div class="ps-day-card" [attr.data-testid]="'day-card-' + day.label">
      <h4>{{ day.label }}<span *ngIf="day.note">&nbsp;· {{ day.note }}</span></h4>

      <label>
        Start
        <input
          type="datetime-local"
          [attr.data-testid]="'day-' + day.label + '-start'"
          [ngModel]="startLocal()"
          (ngModelChange)="onStartChange($event)"
        />
      </label>

      <label>
        End
        <input
          type="datetime-local"
          [attr.data-testid]="'day-' + day.label + '-end'"
          [ngModel]="endLocal()"
          (ngModelChange)="onEndChange($event)"
        />
      </label>

      <button
        *ngIf="multiDay"
        type="button"
        class="ps-day-card__edit p-button p-button-text p-button-sm"
        [attr.data-testid]="'day-' + day.label + '-edit'"
        (click)="emitEdit()"
      >
        Edit
      </button>

      <span class="ps-day-card__caption" data-testid="day-card-caption">
        Start and end time
      </span>
    </div>
  `,
})
export class QuoteDayCardComponent {
  @Input({ required: true }) day!: WizardDay;
  @Input() multiDay = false;
  @Output() readonly dayChange = new EventEmitter<WizardDay>();
  @Output() readonly editRequested = new EventEmitter<void>();

  private readonly localStart = signal<string | null>(null);
  private readonly localEnd = signal<string | null>(null);

  readonly startLocal = computed(
    () => this.localStart() ?? toLocalInput(this.day.start)
  );
  readonly endLocal = computed(
    () => this.localEnd() ?? toLocalInput(this.day.end)
  );

  onStartChange(local: string): void {
    this.localStart.set(local);
    const iso = fromLocalInput(local);
    if (!iso) return;
    this.dayChange.emit({ ...this.day, start: iso });
  }

  onEndChange(local: string): void {
    this.localEnd.set(local);
    const iso = fromLocalInput(local);
    if (!iso) return;
    this.dayChange.emit({ ...this.day, end: iso });
  }

  emitEdit(): void {
    this.editRequested.emit();
  }
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => `${n}`.padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
