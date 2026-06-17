import { Component, Input, Output, EventEmitter } from '@angular/core';
import { NgIf, NgFor } from '@angular/common';
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
  imports: [NgIf, NgFor, FormsModule],
  template: `
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
      <!-- Progress -->
      <div style="margin-bottom:28px;" role="group" [attr.aria-label]="'Step ' + (stepIndex + 1) + ' of ' + steps.length">
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <div
            *ngFor="let s of steps; let i = index"
            style="flex:1;height:4px;border-radius:2px;transition:background 0.3s;"
            [style.background]="i <= stepIndex ? 'var(--ps-accent,#00e5ff)' : 'rgba(244,244,255,0.1)'"
          ></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <p style="color:var(--ps-accent,#00e5ff);font-size:0.8rem;font-weight:700;margin:0;text-transform:uppercase;letter-spacing:.06em;">
            Step {{ stepIndex + 1 }} of {{ steps.length }}
          </p>
          <h3 style="color:var(--ps-ink,#f4f4ff);font-size:1.1rem;font-weight:700;margin:0;">
            {{ currentStep.title }}
          </h3>
        </div>
      </div>

      <!-- Fields -->
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div *ngFor="let field of currentStep.fields" style="display:flex;flex-direction:column;gap:6px;">
          <label
            [for]="'skf-' + field.key"
            style="color:var(--ps-ink,#f4f4ff);font-size:0.85rem;font-weight:600;"
          >{{ field.label }}<span *ngIf="field.required" aria-hidden="true" style="color:var(--ps-accent,#00e5ff);margin-left:3px;">*</span></label>
          <textarea
            *ngIf="field.type === 'textarea'"
            [id]="'skf-' + field.key"
            [placeholder]="field.placeholder || ''"
            [required]="!!field.required"
            [(ngModel)]="formData[field.key]"
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
          <select
            *ngIf="field.type === 'select'"
            [id]="'skf-' + field.key"
            [required]="!!field.required"
            [(ngModel)]="formData[field.key]"
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
            <option *ngFor="let opt of field.options" [value]="opt">{{ opt }}</option>
          </select>
          <input
            *ngIf="field.type !== 'textarea' && field.type !== 'select'"
            [id]="'skf-' + field.key"
            [type]="field.type"
            [placeholder]="field.placeholder || ''"
            [required]="!!field.required"
            [(ngModel)]="formData[field.key]"
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
        </div>
      </div>

      <!-- Navigation -->
      <div style="display:flex;justify-content:space-between;margin-top:28px;gap:12px;">
        <button
          *ngIf="stepIndex > 0"
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
        >Back</button>
        <button
          *ngIf="!isLast"
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
        >Next →</button>
        <button
          *ngIf="isLast"
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
        >{{ submitLabel }}</button>
      </div>
    </div>
  `,
})
export class MultiStepFormComponent {
  @Input() steps: FormStep[] = [
    {
      title: 'About You',
      fields: [
        { key: 'name', label: 'Full Name', type: 'text', placeholder: 'Jane Smith', required: true },
        { key: 'email', label: 'Email', type: 'email', placeholder: 'jane@example.com', required: true },
      ],
    },
    {
      title: 'Your Project',
      fields: [
        { key: 'service', label: 'Service Needed', type: 'select', options: ['Repair', 'Installation', 'Inspection'], required: true },
        { key: 'notes', label: 'Tell us more', type: 'textarea', placeholder: 'Any details that help us prepare…' },
      ],
    },
    {
      title: 'Contact Preference',
      fields: [
        { key: 'phone', label: 'Phone', type: 'tel', placeholder: '(555) 555-0100' },
        { key: 'bestTime', label: 'Best time to reach you', type: 'select', options: ['Morning', 'Afternoon', 'Evening'] },
      ],
    },
  ];
  @Input() submitLabel = 'Submit Request';
  @Output() formSubmit = new EventEmitter<Record<string, string>>();

  stepIndex = 0;
  formData: Record<string, string> = {};

  get currentStep(): FormStep { return this.steps[this.stepIndex]; }
  get isLast(): boolean { return this.stepIndex === this.steps.length - 1; }

  next(): void { if (this.stepIndex < this.steps.length - 1) this.stepIndex++; }
  prev(): void { if (this.stepIndex > 0) this.stepIndex--; }
  submit(): void { this.formSubmit.emit({ ...this.formData }); }
}
