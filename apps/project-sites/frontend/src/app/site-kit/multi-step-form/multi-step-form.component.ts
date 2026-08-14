import { Component, Input, Output, EventEmitter, ViewChild, ElementRef } from '@angular/core';

import { FormsModule } from '@angular/forms';

export interface FormStep {
  title: string;
  fields: FormField[];
}

export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'textarea' | 'select';
  placeholder?: string;
  required?: boolean;
  options?: string[];
}

@Component({
  selector: 'sk-multi-step-form',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (steps.length) {
      <div
        style="
        background: var(--ps-surface-1, rgba(13,13,40,0.8));
        border: 1px solid rgba(0,229,255,0.15);
        border-radius: var(--ps-radius-xl, 22px);
        padding: 32px;
        max-width: 560px;
        margin: 0 auto;
        box-shadow: var(--ps-shadow-card, 0 4px 24px rgba(0,0,0,0.3));
      "
      >
        <!-- Screen-reader-only live region: announces step changes + validation summary. -->
        <p
          aria-live="polite"
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;"
        >
          {{ announcement }}
        </p>
        <!-- Progress -->
        <div
          style="margin-bottom:28px;"
          role="group"
          [attr.aria-label]="'Step ' + (stepIndex + 1) + ' of ' + steps.length"
        >
          <div style="display:flex;gap:8px;margin-bottom:12px;">
            @for (s of steps; track s; let i = $index) {
              <div
                style="flex:1;height:4px;border-radius:2px;transition:background 0.3s;"
                [style.background]="
                  i <= stepIndex ? 'var(--ps-accent,#00e5ff)' : 'rgba(244,244,255,0.1)'
                "
              ></div>
            }
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <p
              style="color:var(--ps-accent,#00e5ff);font-size:0.8rem;font-weight:700;margin:0;text-transform:uppercase;letter-spacing:.06em;"
            >
              Step {{ stepIndex + 1 }} of {{ steps.length }}
            </p>
            <h3 style="color:var(--ps-ink,#f4f4ff);font-size:1.1rem;font-weight:700;margin:0;">
              {{ currentStep.title }}
            </h3>
          </div>
        </div>
        <!-- Fields -->
        <div #fieldsWrap style="display:flex;flex-direction:column;gap:16px;">
          @for (field of currentStep.fields; track field) {
            <div style="display:flex;flex-direction:column;gap:6px;">
              <label
                [for]="'skf-' + field.key"
                style="color:var(--ps-ink,#f4f4ff);font-size:0.85rem;font-weight:600;"
                >{{ field.label }}
                @if (field.required) {
                  <span aria-hidden="true" style="color:var(--ps-accent,#00e5ff);margin-left:3px;"
                    >*</span
                  >
                }
              </label>
              @if (field.type === 'textarea') {
                <textarea
                  [id]="'skf-' + field.key"
                  [placeholder]="field.placeholder || ''"
                  [required]="!!field.required"
                  [attr.aria-invalid]="errors.has(field.key) || null"
                  [attr.aria-describedby]="errors.has(field.key) ? 'skf-err-' + field.key : null"
                  [(ngModel)]="formData[field.key]"
                  (ngModelChange)="clearError(field.key)"
                  rows="3"
                  style="
              background: rgba(244,244,255,0.05);
              border: 1px solid rgba(0,229,255,0.2);
              border-radius: var(--ps-radius-sm, 8px);
              color: var(--ps-ink, #f4f4ff);
              padding: 10px 14px;
              font-size: 0.9rem;
              width: 100%;
              box-sizing: border-box;
              resize: vertical;
              outline: none;
            "
                  onfocus="this.style.borderColor='var(--ps-accent,#00e5ff)'"
                  onblur="this.style.borderColor='rgba(0,229,255,0.2)'"
                ></textarea>
              }
              @if (field.type === 'select') {
                <select
                  [id]="'skf-' + field.key"
                  [required]="!!field.required"
                  [attr.aria-invalid]="errors.has(field.key) || null"
                  [attr.aria-describedby]="errors.has(field.key) ? 'skf-err-' + field.key : null"
                  [(ngModel)]="formData[field.key]"
                  (ngModelChange)="clearError(field.key)"
                  style="
              background: rgba(244,244,255,0.05);
              border: 1px solid rgba(0,229,255,0.2);
              border-radius: var(--ps-radius-sm, 8px);
              color: var(--ps-ink, #f4f4ff);
              padding: 10px 14px;
              font-size: 0.9rem;
              width: 100%;
              box-sizing: border-box;
              outline: none;
            "
                  onfocus="this.style.borderColor='var(--ps-accent,#00e5ff)'"
                  onblur="this.style.borderColor='rgba(0,229,255,0.2)'"
                >
                  <option value="">{{ field.placeholder || 'Select…' }}</option>
                  @for (opt of field.options; track opt) {
                    <option [value]="opt">{{ opt }}</option>
                  }
                </select>
              }
              @if (field.type !== 'textarea' && field.type !== 'select') {
                <input
                  [id]="'skf-' + field.key"
                  [type]="field.type"
                  [placeholder]="field.placeholder || ''"
                  [required]="!!field.required"
                  [attr.aria-invalid]="errors.has(field.key) || null"
                  [attr.aria-describedby]="errors.has(field.key) ? 'skf-err-' + field.key : null"
                  [(ngModel)]="formData[field.key]"
                  (ngModelChange)="clearError(field.key)"
                  style="
              background: rgba(244,244,255,0.05);
              border: 1px solid rgba(0,229,255,0.2);
              border-radius: var(--ps-radius-sm, 8px);
              color: var(--ps-ink, #f4f4ff);
              padding: 10px 14px;
              font-size: 0.9rem;
              width: 100%;
              box-sizing: border-box;
              outline: none;
            "
                  onfocus="this.style.borderColor='var(--ps-accent,#00e5ff)'"
                  onblur="this.style.borderColor='rgba(0,229,255,0.2)'"
                />
              }
              @if (errors.has(field.key)) {
                <p
                  [id]="'skf-err-' + field.key"
                  role="alert"
                  style="color:#ff8c8c;font-size:0.78rem;margin:0;"
                >
                  {{ field.label }} is required.
                </p>
              }
            </div>
          }
        </div>
        <!-- Navigation -->
        <div style="display:flex;justify-content:space-between;margin-top:28px;gap:12px;">
          @if (stepIndex > 0) {
            <button
              type="button"
              (click)="prev()"
              style="
            flex: 1;
            padding: 12px;
            border: 1px solid rgba(0,229,255,0.3);
            border-radius: var(--ps-radius-md,12px);
            background: transparent;
            color: var(--ps-ink, #f4f4ff);
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
          "
            >
              Back
            </button>
          }
          @if (!isLast) {
            <button
              type="button"
              (click)="next()"
              style="
            flex: 2;
            padding: 12px;
            border: none;
            border-radius: var(--ps-radius-md,12px);
            background: var(--ps-grad-primary, linear-gradient(135deg,#00E5FF,#00d4ff));
            color: var(--ps-bg, #060610);
            font-size: 0.9rem;
            font-weight: 700;
            cursor: pointer;
          "
            >
              Next →
            </button>
          }
          @if (isLast) {
            <button
              type="button"
              (click)="submit()"
              style="
            flex: 2;
            padding: 12px;
            border: none;
            border-radius: var(--ps-radius-md,12px);
            background: var(--ps-grad-primary, linear-gradient(135deg,#00E5FF,#00d4ff));
            color: var(--ps-bg, #060610);
            font-size: 0.9rem;
            font-weight: 700;
            cursor: pointer;
          "
            >
              {{ submitLabel }}
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class MultiStepFormComponent {
  // No fabricated defaults — a kit multi-step form must NEVER ship a hardcoded intake
  // flow to a real business site. Empty by default → the root <div> self-hides (via @if),
  // which also guards the `currentStep` getter from indexing an empty array. The
  // consumer defines the business's REAL intake steps/fields. (anti-fabrication mandate)
  @Input() steps: FormStep[] = [];
  @Input() submitLabel = 'Submit Request';
  @Output() formSubmit = new EventEmitter<Record<string, string>>();

  stepIndex = 0;
  formData: Record<string, string> = {};
  /** Keys of required fields left empty at the last next()/submit() attempt. */
  errors = new Set<string>();
  /** Screen-reader announcement (aria-live) — step changes + validation summaries. */
  announcement = '';

  @ViewChild('fieldsWrap') private fieldsWrap?: ElementRef<HTMLElement>;

  get currentStep(): FormStep {
    return this.steps[this.stepIndex];
  }
  get isLast(): boolean {
    return this.stepIndex === this.steps.length - 1;
  }

  /** Required fields in the current step whose value is blank (the gate for advancing). */
  private missingRequired(): string[] {
    return this.currentStep.fields
      .filter((f) => f.required && !(this.formData[f.key] ?? '').trim())
      .map((f) => f.key);
  }

  /** Block advance/submit when required fields are empty; announce + focus the first. */
  private failValidation(missing: string[]): void {
    this.errors = new Set(missing);
    this.announcement = `Please fill in ${missing.length} required field${missing.length > 1 ? 's' : ''} before continuing.`;
    this.focusField(missing[0]);
  }

  clearError(key: string): void {
    this.errors.delete(key);
  }

  next(): void {
    const missing = this.missingRequired();
    if (missing.length) {
      this.failValidation(missing);
      return;
    }
    this.errors.clear();
    if (this.stepIndex < this.steps.length - 1) {
      this.stepIndex++;
      this.announceStep();
      this.focusFirstField();
    }
  }
  prev(): void {
    if (this.stepIndex > 0) {
      this.errors.clear();
      this.stepIndex--;
      this.announceStep();
      this.focusFirstField();
    }
  }
  submit(): void {
    const missing = this.missingRequired();
    if (missing.length) {
      this.failValidation(missing);
      return;
    }
    this.formSubmit.emit({ ...this.formData });
  }

  private announceStep(): void {
    this.announcement = `Step ${this.stepIndex + 1} of ${this.steps.length}: ${this.currentStep.title}`;
  }

  private focusFirstField(): void {
    this.afterRender(() =>
      this.fieldsWrap?.nativeElement
        .querySelector<HTMLElement>('input, select, textarea')
        ?.focus(),
    );
  }
  private focusField(key: string): void {
    this.afterRender(() =>
      this.fieldsWrap?.nativeElement.querySelector<HTMLElement>(`[id="skf-${key}"]`)?.focus(),
    );
  }

  /** Run `fn` after the next paint so the (re-rendered) step fields exist to focus. */
  private afterRender(fn: () => void): void {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
    else queueMicrotask(fn);
  }
}
