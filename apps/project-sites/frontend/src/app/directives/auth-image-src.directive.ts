import { Directive, ElementRef, inject, Input, type OnChanges, type OnDestroy } from '@angular/core';
import { ApiService } from '../services/api.service';

/**
 * Apply `appAuthImageSrc` to an `img` to load it from a BEARER-authenticated
 * same-origin endpoint.
 *
 * A plain `img` element whose `src` is an `/api/…` route triggers a browser
 * navigation that sends NO `Authorization` header (auth here is bearer-only, not
 * cookie) → the request 401s →
 * a broken image. This directive fetches the bytes WITH auth via
 * {@link ApiService.getBlobAbsolute}, binds an object URL to the element, and revokes
 * it on input-change / destroy so no object URL leaks.
 *
 * The fetch is `silent` (no toast) — a failed thumbnail should degrade to a blank
 * image, not nag the user. See the `plain-navigation-cant-carry-bearer` project memory.
 *
 * @example
 * ```html
 * <img [appAuthImageSrc]="screenshotUrl(snap, m)" alt="…" width="320" height="180" />
 * ```
 */
@Directive({ selector: 'img[appAuthImageSrc]', standalone: true })
export class AuthImageSrcDirective implements OnChanges, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly el: ElementRef<HTMLImageElement> = inject(ElementRef);

  /** The authed absolute path to load (e.g. `/api/sites/…/screenshot.png`). */
  @Input('appAuthImageSrc') appAuthImageSrc: string | null = null;

  private objectUrl: string | null = null;

  ngOnChanges(): void {
    this.revoke();
    const src = this.appAuthImageSrc;
    if (!src) {
      this.el.nativeElement.removeAttribute('src');
      return;
    }
    this.api.getBlobAbsolute(src, { silent: true }).subscribe({
      next: (blob) => {
        this.objectUrl = URL.createObjectURL(blob);
        this.el.nativeElement.src = this.objectUrl;
      },
      error: () => {
        // Leave the element blank — a broken authed thumbnail is not user-actionable.
      },
    });
  }

  private revoke(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  ngOnDestroy(): void {
    this.revoke();
  }
}
