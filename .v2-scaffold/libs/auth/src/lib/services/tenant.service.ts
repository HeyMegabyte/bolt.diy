/**
 * TenantService — currently-active tenant + tenant switching.
 *
 * @remarks
 * The current tenant is sourced from `Me.currentTenant` server-side. The
 * UI may temporarily switch via {@link setTenant}; the server validates
 * membership on every request via the `X-Tenant-Id` header (see
 * {@link TenantInterceptor}).
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth.service.js';

@Injectable({ providedIn: 'root' })
export class TenantService {
  private readonly auth = inject(AuthService);

  private readonly override = signal<string | null>(null);

  /** ID of the currently-active tenant, or `null` for personal-scope. */
  readonly currentTenantId = computed<string | null>(
    () => this.override() ?? this.auth.currentUser()?.currentTenant?.id ?? null,
  );

  /** Membership list from the current `Me` shape. */
  readonly tenants = computed(
    () => this.auth.currentUser()?.tenants ?? [],
  );

  setTenant(id: string | null): void {
    this.override.set(id);
  }
}
