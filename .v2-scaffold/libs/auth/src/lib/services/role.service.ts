/**
 * RoleService — surfaces the user's effective role + view-as override.
 *
 * @remarks
 * `actualRole` reflects what the server says (`Me.user.role`); `viewAs`
 * is a UI-only override that super-admins use to preview the product
 * from a customer/crew perspective. The server is responsible for
 * enforcing privilege boundaries — the view-as header is a hint, NEVER
 * a security boundary.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { type Observable, map } from 'rxjs';
// TODO: lock in once domain agent lands the Zod runtime exports on @org/domain.
import type { Capability, Role } from '@org/domain';
import { AuthService } from './auth.service.js';

@Injectable({ providedIn: 'root' })
export class RoleService {
  private readonly auth = inject(AuthService);

  /** UI-only override. Settable via the super-admin role switcher. */
  readonly viewAs = signal<Role | null>(null);

  /** Server-declared role from the current `Me` shape. */
  readonly actualRole = computed<Role | null>(
    () => this.auth.currentUser()?.user.role ?? null,
  );

  /** What the UI should actually render through. */
  readonly effectiveRole = computed<Role | null>(
    () => this.viewAs() ?? this.actualRole(),
  );

  /** `true` iff the underlying user is a super-admin (NOT view-as). */
  readonly isSuperAdmin = computed<boolean>(
    () => this.auth.currentUser()?.isSuperAdmin === true,
  );

  /** Capability set as declared by the server, post-view-as. */
  readonly capabilities = computed<readonly Capability[]>(
    () => this.auth.currentUser()?.capabilities ?? [],
  );

  /**
   * Observable shape of the effective role for places that prefer
   * Observable composition (HTTP interceptors, RxJS pipelines).
   */
  effectiveRole$(): Observable<Role | null> {
    return this.auth.me$.pipe(
      map((me) => this.viewAs() ?? me?.user.role ?? null),
    );
  }

  /** Set view-as. Server still rejects forbidden requests. */
  setViewAs(role: Role | null): void {
    this.viewAs.set(role);
  }
}
