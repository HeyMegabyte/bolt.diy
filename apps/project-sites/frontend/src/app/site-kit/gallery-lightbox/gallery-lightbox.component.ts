import { Component, Input, HostListener } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';

export interface GalleryImage {
  src: string;
  alt: string;
  caption?: string;
}

@Component({
  selector: 'sk-gallery-lightbox',
  standalone: true,
  imports: [NgFor, NgIf],
  template: `
    <!-- Grid -->
    <section *ngIf="images.length" [attr.aria-label]="ariaLabel" style="padding: 0;">
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
        <li
          *ngFor="let img of images; let i = index"
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
      </ul>
    </section>

    <!-- Lightbox overlay -->
    <div
      *ngIf="activeIndex !== null"
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
        <img
          *ngIf="activeImage"
          [src]="activeImage.src"
          [alt]="activeImage.alt"
          style="max-width:100%;max-height:80vh;object-fit:contain;border-radius:var(--ps-radius-lg,16px);"
        />
        <p
          *ngIf="activeImage?.caption"
          style="color:rgba(244,244,255,0.7);font-size:0.875rem;text-align:center;margin:0;"
        >{{ activeImage?.caption }}</p>
        <!-- Nav -->
        <div style="display:flex;gap:16px;align-items:center;">
          <button type="button" (click)="prev()" aria-label="Previous image"
            style="background:rgba(244,244,255,0.1);border:1px solid rgba(244,244,255,0.2);border-radius:50%;width:44px;height:44px;color:var(--ps-ink,#f4f4ff);cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center;">&#8592;</button>
          <span style="color:rgba(244,244,255,0.5);font-size:0.85rem;">{{ (activeIndex ?? 0) + 1 }} / {{ images.length }}</span>
          <button type="button" (click)="next()" aria-label="Next image"
            style="background:rgba(244,244,255,0.1);border:1px solid rgba(244,244,255,0.2);border-radius:50%;width:44px;height:44px;color:var(--ps-ink,#f4f4ff);cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center;">&#8594;</button>
        </div>
        <button type="button" (click)="close()" aria-label="Close image viewer"
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
          ">&#x2715;</button>
      </div>
    </div>
  `,
})
export class GalleryLightboxComponent {
  // No fabricated defaults — a kit gallery must NEVER ship placeholder "Photo 1/2/3"
  // images to a real business site. Empty by default → the grid <section> self-hides
  // (*ngIf); the getter stays guarded (activeIndex starts null). The consumer passes
  // the business's REAL photos. (anti-fabrication mandate)
  @Input() images: GalleryImage[] = [];
  @Input() ariaLabel = 'Photo gallery';

  activeIndex: number | null = null;

  get activeImage(): GalleryImage | null {
    return this.activeIndex !== null ? this.images[this.activeIndex] : null;
  }

  open(i: number): void { this.activeIndex = i; }
  close(): void { this.activeIndex = null; }
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
    if (e.key === 'ArrowLeft') this.prev();
    if (e.key === 'ArrowRight') this.next();
    if (e.key === 'Home') { e.preventDefault(); this.activeIndex = 0; }
    if (e.key === 'End') { e.preventDefault(); this.activeIndex = this.images.length - 1; }
  }
}
