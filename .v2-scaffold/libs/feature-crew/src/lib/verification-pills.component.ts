/**
 * VerificationPillsComponent — 4-pill background-check display (backlog item #20).
 *
 * Renders ID / Background / Insurance / Bonded status pills with checkmark
 * icons when verified. Polls `/api/crew/:id/verification` via
 * `CrewVerificationService.verification$()`.
 *
 * When all 4 are pending, shows a "Start verification" button that mints a
 * Persona inquiry URL and opens it in a new tab.
 */
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { take } from 'rxjs';
import {
  CrewVerificationService,
  type CrewVerificationSnapshot,
  type PillStatus,
} from '@org/data-access';

interface Pill {
  readonly key: keyof Omit<CrewVerificationSnapshot, 'verified_at'>;
  readonly label: string;
}

const PILLS: readonly Pill[] = [
  { key: 'id_status', label: 'ID' },
  { key: 'background_status', label: 'Background' },
  { key: 'insurance_status', label: 'Insurance' },
  { key: 'bonded_status', label: 'Bonded' },
] as const;

@Component({
  selector: 'lib-verification-pills',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ButtonModule, TagModule],
  template: `
    <div class="pills" data-testid="verification-pills">
      @for (pill of pillList; track pill.key) {
        <p-tag
          [value]="labelFor(pill)"
          [severity]="severityFor(snapshot()[pill.key])"
          [icon]="iconFor(snapshot()[pill.key])"
          [attr.data-testid]="'verif-pill-' + pill.key"
        ></p-tag>
      }
      @if (allPending()) {
        <button
          pButton
          type="button"
          icon="pi pi-shield"
          label="Start verification"
          (click)="start()"
          [disabled]="starting()"
          data-testid="verif-start"
        ></button>
      }
    </div>
  `,
  styles: [
    `
      .pills { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
      .pills p-tag { font-variant-numeric: tabular-nums; }
    `,
  ],
})
export class VerificationPillsComponent {
  @Input({ required: true }) crewUserId = '';

  private readonly verif = inject(CrewVerificationService);
  protected readonly pillList = PILLS;
  protected readonly starting = signal(false);

  protected readonly snapshot = toSignal(
    this.verif.verification$(this.crewUserId || 'unknown'),
    {
      initialValue: {
        id_status: 'pending',
        background_status: 'pending',
        insurance_status: 'pending',
        bonded_status: 'pending',
        verified_at: null,
      } satisfies CrewVerificationSnapshot,
    },
  );

  protected readonly allPending = computed(() => {
    const s = this.snapshot();
    return PILLS.every((p) => s[p.key] === 'pending');
  });

  protected labelFor(pill: Pill): string {
    const status = this.snapshot()[pill.key];
    return status === 'verified' ? `${pill.label} ✓` : pill.label;
  }

  protected severityFor(
    status: PillStatus,
  ): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
    switch (status) {
      case 'verified':
        return 'success';
      case 'in_review':
        return 'info';
      case 'failed':
        return 'danger';
      case 'pending':
      default:
        return 'secondary';
    }
  }

  protected iconFor(status: PillStatus): string {
    switch (status) {
      case 'verified':
        return 'pi pi-check-circle';
      case 'in_review':
        return 'pi pi-spinner pi-spin';
      case 'failed':
        return 'pi pi-times-circle';
      case 'pending':
      default:
        return 'pi pi-clock';
    }
  }

  protected start(): void {
    if (!this.crewUserId) return;
    this.starting.set(true);
    this.verif
      .startVerification$(this.crewUserId)
      .pipe(take(1))
      .subscribe({
        next: (r) => {
          this.starting.set(false);
          if (typeof window !== 'undefined') {
            window.open(r.inquiry_url, '_blank', 'noopener,noreferrer');
          }
        },
        error: () => this.starting.set(false),
      });
  }
}
