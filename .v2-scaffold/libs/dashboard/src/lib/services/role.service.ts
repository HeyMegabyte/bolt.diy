import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, distinctUntilChanged, type Observable } from 'rxjs';
import type { ViewAs } from '../types/domain';

const COOKIE_KEY = 'view_as';
const COOKIE_MAX_AGE_DAYS = 30;
const VALID: readonly ViewAs[] = ['customer', 'crew', 'super_admin'] as const;

/**
 * Persists the active view-as role across reloads via cookie + URL query
 * param. URL `?view_as=` wins; cookie is the fallback; default is
 * `customer`.
 *
 * @remarks
 * RxJS-first per [[rxjs-first-angular]]: internal stream is a
 * `BehaviorSubject`; the signal is a thin `toSignal` projection for
 * template consumption.
 *
 * @example
 * ```ts
 * const role = inject(RoleService);
 * role.setViewAs('crew');
 * // template: @if (role.viewAs() === 'crew') { … }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class RoleService {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly viewAsSubject = new BehaviorSubject<ViewAs>(this.readInitial());

  /** Observable stream for downstream RxJS pipelines. */
  readonly viewAs$: Observable<ViewAs> = this.viewAsSubject.pipe(
    distinctUntilChanged(),
  );

  /** Template-friendly signal projection. */
  readonly viewAs = toSignal(this.viewAs$, { initialValue: this.viewAsSubject.value });

  /**
   * Updates the active view-as without reloading the route. URL stays
   * `/dashboard` (or whatever is active); only the `view_as` query
   * param is merged.
   */
  setViewAs(next: ViewAs): void {
    if (!VALID.includes(next) || this.viewAsSubject.value === next) {
      return;
    }
    this.viewAsSubject.next(next);
    this.persist(next);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view_as: next },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private readInitial(): ViewAs {
    if (typeof globalThis === 'undefined' || typeof document === 'undefined') {
      return 'customer';
    }
    const url = new URL(globalThis.location?.href ?? 'http://localhost/');
    const qp = url.searchParams.get('view_as');
    if (this.isViewAs(qp)) {
      this.persist(qp);
      return qp;
    }
    const fromCookie = this.readCookie();
    return fromCookie ?? 'customer';
  }

  private readCookie(): ViewAs | null {
    if (typeof document === 'undefined') return null;
    const raw = document.cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE_KEY}=`));
    if (!raw) return null;
    const value = decodeURIComponent(raw.slice(COOKIE_KEY.length + 1));
    return this.isViewAs(value) ? value : null;
  }

  private persist(value: ViewAs): void {
    if (typeof document === 'undefined') return;
    const expires = new Date(Date.now() + COOKIE_MAX_AGE_DAYS * 86400 * 1000).toUTCString();
    const secure = globalThis.location?.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(value)}; Path=/; Expires=${expires}; SameSite=Lax${secure}`;
  }

  private isViewAs(value: unknown): value is ViewAs {
    return typeof value === 'string' && (VALID as readonly string[]).includes(value);
  }
}
