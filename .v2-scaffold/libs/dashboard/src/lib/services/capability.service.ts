import { Injectable, computed, inject } from '@angular/core';
import { MeStore } from './me.store';
import { RoleService } from './role.service';
import type { Capability } from '../types/domain';

/**
 * Capability gate. Drives `*ngIf="cap.has('billing:read')"` patterns in
 * the left rail + every feature shell.
 *
 * @remarks
 * Super-admins see every capability when `view_as === 'super_admin'`.
 * When a super-admin is viewing as `customer` or `crew`, only the
 * displayed-role's capability set applies — this is what makes the
 * view-as switcher honest.
 */
@Injectable({ providedIn: 'root' })
export class CapabilityService {
  private readonly me = inject(MeStore);
  private readonly role = inject(RoleService);

  /** Effective capability set after view-as collapse. */
  readonly effective = computed<readonly Capability[]>(() => {
    const all = this.me.capabilities();
    if (!this.me.isSuperAdmin()) return all;
    const view = this.role.viewAs();
    if (view === 'super_admin') return all;
    // Approximate role-down: drop super-admin-only flags so the UI hides
    // operator tools while previewing as customer/crew.
    return all.filter((c) => c !== 'super_admin' && c !== 'impersonate');
  });

  /** Pure predicate for template + guard use. */
  has(cap: Capability): boolean {
    return this.effective().includes(cap);
  }

  /** Reactive predicate, useful inside `computed()` chains. */
  has$(cap: Capability) {
    return computed(() => this.effective().includes(cap));
  }
}
