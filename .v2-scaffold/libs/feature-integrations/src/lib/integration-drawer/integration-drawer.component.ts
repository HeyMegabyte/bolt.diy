/**
 * IntegrationDrawerComponent — side-drawer configurator body. Shown
 * inside the parent `<p-drawer>` from the marketplace component.
 *
 * Renders the def's fields, masked secrets, "rotate" + "last-used"
 * controls. Each field is part of the registry-defined schema; users
 * never edit the registry — adding a new integration = one entry.
 */
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { take } from 'rxjs';
import {
  IntegrationsService,
} from '@org/data-access';
import type {
  IntegrationConfig,
  IntegrationProvider,
} from '@org/domain';
import type { IntegrationDef } from '../registry';

@Component({
  selector: 'lib-integration-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ButtonModule, DatePipe],
  template: `
    <section class="drawer" data-testid="integration-drawer-body">
      <header>
        <i [class]="def.icon" aria-hidden="true"></i>
        <div>
          <h2>{{ def.name }}</h2>
          <p>{{ def.description }}</p>
        </div>
      </header>

      <form class="fields" (ngSubmit)="save()">
        <label *ngFor="let f of def.fields" class="field">
          <span>{{ f.label }}</span>
          <input
            [type]="f.secret ? 'password' : (f.type ?? 'text')"
            [(ngModel)]="values[f.key]"
            [name]="f.key"
            [placeholder]="f.placeholder ?? ''"
            [attr.data-testid]="'integration-field-' + f.key"
            class="plain-input"
          />
          <small *ngIf="f.help">{{ f.help }}</small>
        </label>

        <div class="meta" *ngIf="connection as conn">
          <p>
            Last used:
            {{ conn.last_used_at ? (conn.last_used_at | date: 'medium') : 'never' }}
          </p>
          <button
            pButton
            type="button"
            severity="secondary"
            label="Rotate secret"
            (click)="rotate()"
            [disabled]="busy()"
            data-testid="integration-rotate"
          ></button>
        </div>

        <div class="actions">
          <button
            pButton
            type="button"
            severity="secondary"
            label="Cancel"
            (click)="closed.emit()"
          ></button>
          <button
            pButton
            type="submit"
            label="Save"
            [disabled]="busy()"
            data-testid="integration-save"
          ></button>
        </div>
      </form>
    </section>
  `,
  styles: [
    `
      .drawer { display: flex; flex-direction: column; gap: 1rem; padding: 1rem; }
      header { display: flex; gap: 0.75rem; align-items: flex-start; }
      header h2 { margin: 0; font-size: 1.25rem; }
      header p { color: var(--text-color-secondary, #999); margin: 0.25rem 0 0; }
      header i { font-size: 1.75rem; }
      .fields { display: flex; flex-direction: column; gap: 0.75rem; }
      .field { display: grid; gap: 0.25rem; }
      .field small { color: var(--text-color-secondary, #999); font-size: 0.75rem; }
      .plain-input { background: var(--surface-card, #15151f); border: 1px solid var(--border, #2a2a3a); color: var(--text-color, #fff); padding: 0.5rem 0.75rem; border-radius: 0.4rem; font: inherit; }
      .meta { display: flex; align-items: center; justify-content: space-between; padding-top: 0.5rem; border-top: 1px solid var(--border, #2a2a3a); }
      .actions { display: flex; justify-content: flex-end; gap: 0.5rem; padding-top: 0.5rem; }
    `,
  ],
})
export class IntegrationDrawerComponent {
  @Input({ required: true }) def!: IntegrationDef;
  @Input() connection: IntegrationConfig | null = null;
  @Output() readonly closed = new EventEmitter<void>();

  private readonly api = inject(IntegrationsService);

  protected values: Record<string, string> = {};
  protected readonly busy = signal(false);

  protected save(): void {
    if (this.busy()) return;
    const secret = this.values['secret'] ?? this.values['api_key'] ?? '';
    if (!secret) return;
    this.busy.set(true);
    this.api
      .connectPasteKey$(this.def.id as IntegrationProvider, {
        secret,
        label: this.values['label'],
      })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.closed.emit();
        },
        error: () => this.busy.set(false),
      });
  }

  protected rotate(): void {
    if (this.busy() || !this.connection) return;
    this.busy.set(true);
    this.api
      .rotateSecret$(this.connection.id)
      .pipe(take(1))
      .subscribe({
        next: () => this.busy.set(false),
        error: () => this.busy.set(false),
      });
  }
}
