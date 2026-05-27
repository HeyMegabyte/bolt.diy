/**
 * viewAsInterceptor — attaches the `X-View-As` header for super-admin
 * preview mode.
 *
 * @remarks
 * The server is the source of truth: an unauthorized view-as request
 * gets a 403 from the control-plane regardless of what header we send.
 * This interceptor just communicates intent.
 */
import { type HttpHandlerFn, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { RoleService } from '../services/role.service.js';

export const viewAsInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  const roleService = inject(RoleService);
  const viewAs = roleService.viewAs();

  if (!viewAs) {
    return next(req);
  }

  return next(
    req.clone({
      setHeaders: { 'X-View-As': viewAs },
    }),
  );
};
