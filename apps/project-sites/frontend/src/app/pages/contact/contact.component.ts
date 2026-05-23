import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { emailError } from '../../utils/validators/email';

/**
 * Public contact page — collects name / email / phone? / message and POSTs
 * to `/api/contact`. On success the form is replaced by a thank-you card
 * with a `Send another` action; an `aria-live="polite"` region announces
 * the success to screen readers.
 *
 * @remarks
 * - Per-field validation uses Zod-style human messages rendered below each
 *   input with `aria-live="polite"` + `aria-invalid` on the input.
 * - Errors from the API are toasted by `ApiService.handleError` already;
 *   this component completes the stream without re-toasting on `error:`.
 */
@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './contact.component.html',
})
export class ContactComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);

  name = '';
  email = '';
  phone = '';
  message = '';
  submitting = signal(false);
  submitted = signal(false);
  attempted = signal(false);

  /** Snapshot of submitted values so the thank-you card can echo what the user typed. */
  submittedSnapshot = signal<{ name: string; email: string; phone: string; message: string } | null>(null);

  /** Zod-style human-readable validators. Null = valid. */
  private validateName(value: string): string | null {
    const v = value.trim();
    if (!v) return 'Name is required so we know who to reply to.';
    if (v.length > 200) return 'Name is too long (max 200 characters).';
    return null;
  }

  private validateEmail(value: string): string | null {
    const v = value.trim();
    if (!v) return 'Email is required so we can write back.';
    return emailError(v);
  }

  private validatePhone(value: string): string | null {
    const v = value.trim();
    if (!v) return null; // optional
    if (v.length > 20) return 'Phone number is too long (max 20 characters).';
    return null;
  }

  private validateMessage(value: string): string | null {
    const v = value.trim();
    if (!v) return 'A short message helps us route your note to the right person.';
    if (v.length < 10) return 'A few more words please (at least 10 characters).';
    if (v.length > 5000) return 'Message is too long (max 5000 characters).';
    return null;
  }

  get nameError(): string | null { return this.attempted() ? this.validateName(this.name) : null; }
  get emailError(): string | null { return this.attempted() ? this.validateEmail(this.email) : null; }
  get phoneError(): string | null { return this.attempted() ? this.validatePhone(this.phone) : null; }
  get messageError(): string | null { return this.attempted() ? this.validateMessage(this.message) : null; }

  get nameInvalid(): boolean { return this.nameError !== null; }
  get emailInvalid(): boolean { return this.emailError !== null; }
  get phoneInvalid(): boolean { return this.phoneError !== null; }
  get messageInvalid(): boolean { return this.messageError !== null; }

  goHome(): void {
    this.router.navigate(['/']);
  }

  /** Reset the form for a follow-up submission. */
  sendAnother(): void {
    this.name = '';
    this.email = '';
    this.phone = '';
    this.message = '';
    this.attempted.set(false);
    this.submitted.set(false);
    this.submittedSnapshot.set(null);
  }

  submit(): void {
    this.attempted.set(true);

    // Run all validators. First-failure focus is handled by `aria-describedby` + browser.
    const errors = [
      this.validateName(this.name),
      this.validateEmail(this.email),
      this.validatePhone(this.phone),
      this.validateMessage(this.message),
    ].filter((e): e is string => e !== null);

    if (errors.length > 0) {
      this.toast.error(errors[0]);
      return;
    }

    const snapshot = {
      name: this.name.trim(),
      email: this.email.trim(),
      phone: this.phone.trim(),
      message: this.message.trim(),
    };

    this.submitting.set(true);
    this.api.submitContact({
      name: snapshot.name,
      email: snapshot.email,
      phone: snapshot.phone || undefined,
      message: snapshot.message,
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.submittedSnapshot.set(snapshot);
        this.submitted.set(true);
      },
      error: () => {
        // ApiService already toasted a human-readable message — just complete.
        this.submitting.set(false);
      },
    });
  }
}
