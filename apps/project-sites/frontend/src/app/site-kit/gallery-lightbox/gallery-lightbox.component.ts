import { Component, Input, HostListener, ViewChild, ElementRef } from '@angular/core';

export interface GalleryImage {
  src: string;
  alt: string;
  caption?: string;
}

@Component({
  selector: 'sk-gallery-lightbox',
  standalone: true,
  imports: [],
  template: `
    <!-- Grid -->
    @if (images.length) {
      <section [attr.aria-label]="ariaLabel" style="padding: 0;">
        <ul
          role="list"
          style="
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 12px;
        "
        >
          @for (img of images; track img; let i = $index) {
            <li
              style="aspect-ratio:1;overflow:hidden;border-radius:var(--ps-radius-lg,16px);cursor:zoom-in;"
            >
              <button
                type="button"
                (click)="open(i)"
                style="
              width:100%;height:100%;padding:0;border:none;background:none;cursor:zoom-in;
              display:block;overflow:hidden;border-radius:inherit;
            "
                [attr.aria-label]="'View ' + img.alt"
              >
                <img
                  [src]="img.src"
                  [alt]="img.alt"
                  loading="lazy"
                  style="
                width:100%;height:100%;object-fit:cover;
                transition:transform var(--ps-dur-slow,380ms) var(--ps-ease-out,ease-out);
                display:block;
              "
                  onmouseenter="this.style.transform='scale(1.05)'"
                  onmouseleave="this.style.transform=''"
                />
              </button>
            </li>
          }
        </ul>
      </section>
    }

    <!-- Lightbox overlay -->
    @if (activeIndex !== null) {
      <div
        #dialogRoot
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="activeImage?.alt || 'Image viewer'"
        style="
        position: fixed;
        inset: 0;
        z-index: var(--ps-z-modal, 2000);
        background: rgba(6,6,16,0.96);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      "
        (click)="close()"
      >
        <div
          style="
          position: relative;
          max-width: min(90vw, 1000px);
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        "
          (click)="$event.stopPropagation()"
        >
          @if (activeImage) {
            <img
              [src]="activeImage.src"
              [alt]="activeImage.alt"
              style="max-width:100%;max-height:80vh;object-fit:contain;border-radius:var(--ps-radius-lg,16px);"
            />
          }
          @if (activeImage?.caption) {
            <p style="color:rgba(244,244,255,0.7);font-size:0.875rem;text-align:center;margin:0;">
              {{ activeImage?.caption }}
            </p>
          }
          <!-- Nav -->
          <div style="display:flex;gap:16px;align-items:center;">
            <button
              type="button"
              (click)="prev()"
              aria-label="Previous image"
              style="background:rgba(244,244,255,0.1);border:1px solid rgba(244,244,255,0.2);border-radius:50%;width:44px;height:44px;color:var(--ps-ink,#f4f4ff);cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center;"
            >
              &#8592;
            </button>
            <span style="color:rgba(244,244,255,0.5);font-size:0.85rem;"
              >{{ (activeIndex ?? 0) + 1 }} / {{ images.length }}</span
            >
            <button
              type="button"
              (click)="next()"
              aria-label="Next image"
              style="background:rgba(244,244,255,0.1);border:1px solid rgba(244,244,255,0.2);border-radius:50%;width:44px;height:44px;color:var(--ps-ink,#f4f4ff);cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center;"
            >
              &#8594;
            </button>
          </div>
          <button
            #closeBtn
            type="button"
            (click)="close()"
            aria-label="Close image viewer"
            style="
            position:absolute;top:-8px;right:-8px;
            background:rgba(244,244,255,0.1);
            border:1px solid rgba(244,244,255,0.2);
            border-radius:50%;
            width:36px;height:36px;
            color:var(--ps-ink,#f4f4ff);
            cursor:pointer;
            display:flex;align-items:center;justify-content:center;
            font-size:1.2rem;
          "
          >
            &#x2715;
          </button>
        </div>
      </div>
    }
  `,
})
export class GalleryLightboxComponent {
  // No fabricated defaults — a kit gallery must NEVER ship placeholder "Photo 1/2/3"
  // images to a real business site. Empty by default → the grid <section> self-hides
  // (via @if); the getter stays guarded (activeIndex starts null). The consumer passes
  // the business's REAL photos. (anti-fabrication mandate)
  @Input() images: GalleryImage[] = [];
  @Input() ariaLabel = 'Photo gallery';

  activeIndex: number | null = null;

  /** The dialog root — queried for its focusable controls to trap Tab within the modal. */
  @ViewChild('dialogRoot') private dialogRoot?: ElementRef<HTMLElement>;
  /** The close button — focus lands here when the lightbox opens. */
  @ViewChild('closeBtn') private closeBtn?: ElementRef<HTMLButtonElement>;
  /** The element focused before open, so focus can be RESTORED to it on close (WCAG 2.4.3). */
  private triggerEl: HTMLElement | null = null;

  get activeImage(): GalleryImage | null {
    return this.activeIndex !== null ? this.images[this.activeIndex] : null;
  }

  open(i: number): void {
    // Remember what had focus (the thumbnail button) so close() can restore it.
    this.triggerEl = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
    this.activeIndex = i;
    // Move focus INTO the dialog once it renders — otherwise a keyboard/SR user is
    // left focused on the now-obscured thumbnail behind the overlay.
    this.focusAfterRender(() => this.closeBtn?.nativeElement.focus());
  }
  close(): void {
    this.activeIndex = null;
    // Return focus to the trigger so keyboard flow continues where it left off.
    this.triggerEl?.focus?.();
    this.triggerEl = null;
  }
  prev(): void {
    if (this.activeIndex === null) return;
    this.activeIndex = (this.activeIndex - 1 + this.images.length) % this.images.length;
  }
  next(): void {
    if (this.activeIndex === null) return;
    this.activeIndex = (this.activeIndex + 1) % this.images.length;
  }

  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (this.activeIndex === null) return;
    if (e.key === 'Escape') this.close();
    else if (e.key === 'ArrowLeft') this.prev();
    else if (e.key === 'ArrowRight') this.next();
    else if (e.key === 'Home') {
      e.preventDefault();
      this.activeIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      this.activeIndex = this.images.length - 1;
    } else if (e.key === 'Tab') {
      this.trapTab(e);
    }
  }

  /** Cycle Tab focus among the dialog's controls so it never escapes to the page behind. */
  private trapTab(e: KeyboardEvent): void {
    const root = this.dialogRoot?.nativeElement;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>('button:not([disabled])'),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null;
    if (!active || !root.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /** Run `fn` after the next paint (the @if dialog has rendered by then). */
  private focusAfterRender(fn: () => void): void {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
    else queueMicrotask(fn);
  }
}
