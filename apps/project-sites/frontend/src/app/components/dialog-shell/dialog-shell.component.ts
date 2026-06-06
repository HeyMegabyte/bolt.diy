import { Component, inject, output, HostListener, type AfterViewInit, type OnDestroy, ElementRef } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { A11yModule, ConfigurableFocusTrapFactory, type ConfigurableFocusTrap } from '@angular/cdk/a11y';

@Component({
  selector: 'app-dialog-shell',
  standalone: true,
  imports: [A11yModule],
  template: `
    <div class="ps-dialog-root fixed inset-0 z-[2000] flex items-center justify-center p-4" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" (click)="onBackdropClick($event)">
      <!-- Backdrop: deeper blur + saturate for cinematic dim. -->
      <div class="ps-dialog-backdrop absolute inset-0" aria-hidden="true"></div>

      <!-- Dialog panel: cyan rim-light, gradient border highlight, scale-in. -->
      <div class="dialog-panel ps-dialog-panel relative w-full overflow-hidden flex flex-col"
           [style.max-width]="maxWidth">
        <!-- Header -->
        <div class="ps-dialog-head flex items-center justify-between flex-shrink-0">
          <div class="flex items-center gap-3 min-w-0">
            <ng-content select="[dialogIcon]"></ng-content>
            <h2 [id]="titleId" class="text-lg font-bold text-white m-0 truncate" style="font-family:'Sora',system-ui,sans-serif;letter-spacing:-0.02em;text-wrap:balance;">
              <ng-content select="[dialogTitle]"></ng-content>
            </h2>
            <ng-content select="[dialogBadge]"></ng-content>
          </div>
          <button
            class="ps-dialog-close flex items-center justify-center flex-shrink-0"
            (click)="close()"
            aria-label="Close dialog"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto">
          <ng-content></ng-content>
        </div>

        <!-- Footer (optional) -->
        <ng-content select="[dialogFooter]"></ng-content>
      </div>
    </div>
  `,
  styles: [`
    :host { display: contents; }

    .ps-dialog-root {
      animation: psDialogRootIn 220ms var(--ps-ease-emphasized, cubic-bezier(0.16, 1, 0.3, 1)) both;
    }
    .ps-dialog-backdrop {
      background: radial-gradient(ellipse 80% 60% at 50% 40%, rgba(6, 6, 16, 0.72), rgba(0, 0, 0, 0.78));
      backdrop-filter: blur(14px) saturate(140%);
      -webkit-backdrop-filter: blur(14px) saturate(140%);
    }
    .ps-dialog-panel {
      max-height: 90vh;
      border-radius: var(--ps-radius-xl, 22px);
      background:
        linear-gradient(180deg, rgba(14, 14, 36, 0.92) 0%, rgba(10, 10, 28, 0.98) 100%);
      border: 1px solid color-mix(in oklch, #00E5FF 18%, transparent);
      box-shadow:
        var(--ps-shadow-modal, 0 24px 64px rgba(0, 0, 0, 0.55), 0 0 80px rgba(0, 229, 255, 0.04)),
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        0 0 120px rgba(0, 229, 255, 0.06);
      animation: psDialogPanelIn 320ms var(--ps-ease-emphasized, cubic-bezier(0.16, 1, 0.3, 1)) both;
      transform-origin: center center;
      isolation: isolate;
    }
    /* Cyan/violet rim highlight at the top edge. */
    .ps-dialog-panel::before {
      content: ""; position: absolute; top: 0; left: 0; right: 0; height: 1px;
      background: linear-gradient(90deg,
        transparent 0%,
        rgba(0, 229, 255, 0.55) 22%,
        rgba(124, 58, 237, 0.45) 60%,
        transparent 100%);
      pointer-events: none; z-index: 1;
    }
    /* Soft inner ambient glow at the top. */
    .ps-dialog-panel::after {
      content: ""; position: absolute; inset: 0 0 auto 0; height: 60%;
      background: radial-gradient(ellipse 80% 60% at 50% -10%, rgba(0, 229, 255, 0.08), transparent 60%);
      pointer-events: none; z-index: -1;
    }

    .ps-dialog-head {
      padding: 18px 22px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0));
    }

    .ps-dialog-close {
      width: 32px; height: 32px;
      border-radius: var(--ps-radius-sm, 8px);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      color: rgba(255, 255, 255, 0.65);
      transition:
        background var(--ps-dur-fast, 140ms) var(--ps-ease-emphasized, cubic-bezier(0.16,1,0.3,1)),
        color var(--ps-dur-fast, 140ms),
        border-color var(--ps-dur-fast, 140ms),
        transform var(--ps-dur-fast, 140ms) var(--ps-ease-emphasized, cubic-bezier(0.16,1,0.3,1)),
        box-shadow var(--ps-dur-base, 220ms);
    }
    .ps-dialog-close:hover {
      color: #fff;
      background: rgba(0, 229, 255, 0.10);
      border-color: rgba(0, 229, 255, 0.30);
      transform: rotate(90deg) scale(1.05);
      box-shadow: 0 0 16px rgba(0, 229, 255, 0.22);
    }
    .ps-dialog-close:active { transform: rotate(90deg) scale(0.95); transition-duration: 80ms; }
    .ps-dialog-close:focus-visible {
      outline: 2px solid #00E5FF; outline-offset: 2px;
    }

    @keyframes psDialogRootIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes psDialogPanelIn {
      from { opacity: 0; transform: translateY(10px) scale(0.965); filter: blur(2px); }
      60%  { opacity: 1; filter: blur(0); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .ps-dialog-root, .ps-dialog-panel, .ps-dialog-close { animation: none !important; transition: none !important; }
      .ps-dialog-close:hover { transform: none; }
    }
  `],
})
export class DialogShellComponent implements AfterViewInit, OnDestroy {
  private dialogRef = inject(DialogRef, { optional: true });
  private el = inject(ElementRef);
  private focusTrapFactory = inject(ConfigurableFocusTrapFactory);
  private focusTrap?: ConfigurableFocusTrap;

  /** Unique id linking the dialog's <h2> title to aria-labelledby (WCAG 4.1.2 —
   *  a role="dialog" must have an accessible name). */
  private static seq = 0;
  protected readonly titleId = `ps-dialog-title-${DialogShellComponent.seq++}`;

  /** The element focused before the dialog opened — captured at construction
   *  (before the focus trap steals focus) so it can be restored on close
   *  (WCAG 2.4.3 — focus returns to the trigger). */
  private readonly previouslyFocused: HTMLElement | null =
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

  maxWidth = '640px';
  closed = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  ngAfterViewInit(): void {
    const panel = this.el.nativeElement.querySelector('.dialog-panel') as HTMLElement | null;
    if (!panel) return;
    this.focusTrap = this.focusTrapFactory.create(panel);
    // CDK focuses [cdkFocusInitial] if present, else the FIRST tabbable element —
    // which here is the ✕ close button (it precedes the body). For a form dialog
    // that lands focus on "close" instead of the first field. Prefer the first
    // real body control so a create/edit dialog opens ready to type (autofocus UX).
    // (Promise.resolve wraps the real Promise<boolean> AND the test mock's void.)
    void Promise.resolve(this.focusTrap.focusInitialElementWhenReady()).then(() => this.focusFirstBodyField(panel));
  }

  /** Focus the first enabled form control in the dialog body, unless the consumer
   *  explicitly marked an element with [cdkFocusInitial] (then CDK already did). */
  private focusFirstBodyField(panel: HTMLElement): void {
    if (panel.querySelector('[cdkFocusInitial]')) return;
    const body = panel.querySelector('.flex-1');
    const first = body?.querySelector(
      'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"]',
    ) as HTMLElement | null;
    first?.focus({ preventScroll: true });
  }

  ngOnDestroy(): void {
    this.focusTrap?.destroy();
    // Return focus to the element that opened the dialog (the trap doesn't auto-restore).
    if (this.previouslyFocused && typeof this.previouslyFocused.focus === 'function') {
      try { this.previouslyFocused.focus({ preventScroll: true }); } catch { /* detached/unfocusable — ignore */ }
    }
  }

  close(): void {
    this.closed.emit();
    this.dialogRef?.close();
  }

  onBackdropClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    // Click on the root container or backdrop closes; clicks inside the panel don't.
    if (target.classList.contains('ps-dialog-root') || target.classList.contains('ps-dialog-backdrop')) {
      this.close();
    }
  }
}
