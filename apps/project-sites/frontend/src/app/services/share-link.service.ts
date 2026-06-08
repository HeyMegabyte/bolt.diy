import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * @service ShareLinkService
 * @description Decoupled trigger for the global "Share link" dialog. The dialog
 * itself is rendered inline in the admin shell (`AdminComponent`); any surface
 * that wants to open it — the navbar Actions menu, the Cmd+K command palette —
 * calls {@link open}. The shell subscribes to {@link open$} and flips the dialog
 * on. This avoids threading an `@Output`/signal through unrelated components.
 *
 * @example
 * // From the command palette:
 * inject(ShareLinkService).open();
 */
@Injectable({ providedIn: 'root' })
export class ShareLinkService {
  private readonly openSubject = new Subject<void>();

  /** Emits each time a surface requests the Share-link dialog be opened. */
  readonly open$ = this.openSubject.asObservable();

  /** Request the Share-link dialog to open. */
  open(): void {
    this.openSubject.next();
  }
}
