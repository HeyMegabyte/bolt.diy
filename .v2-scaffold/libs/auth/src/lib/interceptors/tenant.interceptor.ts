/**
 * tenantInterceptor — attaches the `X-Tenant-Id` header so the control-plane
 * scopes the request to the user's active tenant.
 *
 * @remarks
 * Server-side membership check is the security boundary — this header is
 * a hint that drives scoping in the multi-tenant control-plane.
 */
import { type HttpHandlerFn, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { TenantService } from '../services/tenant.service.js';

export const tenantInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  const tenantService = inject(TenantService);
  const tenantId = tenantService.currentTenantId();

  if (!tenantId) {
    return next(req);
  }

  return next(
    req.clone({
      setHeaders: { 'X-Tenant-Id': tenantId },
    }),
  );
};
