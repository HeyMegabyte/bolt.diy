import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';
import { MeStore } from '../services/me.store';
import { RoleService } from '../services/role.service';
import type { ViewAs } from '../types/domain';

interface RoleOption {
  label: string;
  value: ViewAs;
}

/**
 * Super-admin-only role switcher. Renders a PrimeNG `p-selectButton`
 * for `customer | crew | super_admin`. Persists via the
 * {@link RoleService} (cookie + URL `?view_as=`). Route never reloads.
 *
 * @example
 * ```html
 * <lib-role-switcher data-testid="role-switcher" />
 * ```
 */
@Component({
  selector: 'lib-role-switcher',
  standalone: true,
  imports: [FormsModule, SelectButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <p-selectButton
        data-testid="role-switcher"
        [options]="options"
        optionLabel="label"
        optionValue="value"
        [ngModel]="current()"
        (ngModelChange)="onChange($event)"
        [allowEmpty]="false"
        ariaLabelledBy="role-switcher-label"
      />
      <span id="role-switcher-label" class="sr-only">View dashboard as</span>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    `,
  ],
})
export class RoleSwitcherComponent {
  private readonly me = inject(MeStore);
  private readonly role = inject(RoleService);

  readonly options: RoleOption[] = [
    { label: 'Customer', value: 'customer' },
    { label: 'Crew', value: 'crew' },
    { label: 'Super Admin', value: 'super_admin' },
  ];

  readonly visible = computed(() => this.me.isSuperAdmin());
  readonly current = computed<ViewAs>(() => this.role.viewAs());

  onChange(next: ViewAs): void {
    this.role.setViewAs(next);
  }
}
