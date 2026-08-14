import { Component, Input, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';

@Component({
  selector: 'sk-newsletter-signup',
  standalone: true,
  imports: [FormsModule],
  styles: [
    `
      .ns-input:focus {
        outline: 2px solid var(--ps-accent, #00e5ff);
        outline-offset: 2px;
      }
      .ns-btn:hover:not(:disabled) {
        opacity: 0.88;
      }
      .ns-btn:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }
      @media (prefers-reduced-motion: reduce) {
        .ns-btn {
          transition: none !important;
        }
      }
    `,
  ],
  template: `
    <section
      [style.background]="'var(--ps-surface-1,rgba(255,255,255,.04))'"
      [style.color]="'var(--ps-ink,#f4f4ff)'"
      [style.borderTop]="'1px solid var(--ps-hairline,rgba(255,255,255,.08))'"
      [style.borderBottom]="'1px solid var(--ps-hairline,rgba(255,255,255,.08))'"
      style="padding:5rem 1.5rem;"
    >
      <div style="max-width:600px;margin:0 auto;text-align:center;">
        <!-- Header -->
        @if (eyebrow) {
          <p
            [style.color]="'var(--ps-accent,#00e5ff)'"
            style="font-size:.8rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:0 0 .75rem;"
          >
            {{ eyebrow }}
          </p>
        }
        <h2
          style="font-size:clamp(1.75rem,3.5vw,2.5rem);font-weight:700;
                   margin:0 0 .875rem;letter-spacing:-.02em;text-wrap:balance;"
        >
          {{ heading }}
        </h2>
        @if (subheading) {
          <p
            style="opacity:.65;font-size:1rem;line-height:1.7;margin:0 0 2rem;max-width:48ch;margin-inline:auto;"
          >
            {{ subheading }}
          </p>
        }

        <!-- Success state -->
        @if (submitted()) {
          <div
            [style.color]="'var(--ps-accent,#00e5ff)'"
            style="padding:1.25rem;border-radius:var(--ps-radius-md,12px);
                    border:1px solid var(--ps-accent,#00e5ff);
                    background:rgba(0,229,255,.06);font-weight:600;"
          >
            {{ successMessage }}
          </div>
        }

        <!-- Form -->
        @if (!submitted()) {
          <form (ngSubmit)="onSubmit()" #nsForm="ngForm" novalidate>
            <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
              <input
                class="ns-input"
                type="email"
                name="email"
                [(ngModel)]="email"
                required
                [attr.placeholder]="placeholder"
                [attr.aria-label]="placeholder"
                style="flex:1;min-width:220px;padding:.875rem 1rem;
                     border-radius:var(--ps-radius-sm,8px);border:none;
                     background:var(--ps-surface-2,rgba(255,255,255,.08));
                     color:var(--ps-ink,#f4f4ff);font-size:1rem;"
                [style.border]="'1px solid var(--ps-hairline,rgba(255,255,255,.2))'"
              />
              <button
                class="ns-btn"
                type="submit"
                [disabled]="!nsForm.valid || loading()"
                [style.background]="'var(--ps-grad-primary,linear-gradient(135deg,#00e5ff,#00d4ff))'"
                [style.color]="'var(--ps-bg,#060610)'"
                style="padding:.875rem 1.75rem;border:none;border-radius:var(--ps-radius-sm,8px);
                     font-weight:700;font-size:1rem;cursor:pointer;white-space:nowrap;
                     transition:opacity .15s;"
              >
                {{ loading() ? 'Subscribing…' : buttonLabel }}
              </button>
            </div>
            @if (disclaimer) {
              <p style="margin:.875rem 0 0;font-size:.8rem;opacity:.45;">
                {{ disclaimer }}
              </p>
            }
          </form>
        }
      </div>
    </section>
  `,
})
export class SkNewsletterSignupComponent {
  @Input() heading = 'Stay in the loop';
  @Input() subheading = 'Get the latest updates, tutorials, and product news — no spam, ever.';
  @Input() eyebrow = 'Newsletter';
  @Input() placeholder = 'Enter your email';
  @Input() buttonLabel = 'Subscribe';
  @Input() successMessage = "You're subscribed! Check your inbox for a confirmation.";
  @Input() disclaimer = 'By subscribing you agree to our Privacy Policy. Unsubscribe anytime.';

  email = '';
  submitted = signal(false);
  loading = signal(false);

  onSubmit(): void {
    if (!this.email || this.loading()) return;
    this.loading.set(true);
    // Simulated async — real impl would POST to an endpoint
    setTimeout(() => {
      this.loading.set(false);
      this.submitted.set(true);
    }, 800);
  }
}
