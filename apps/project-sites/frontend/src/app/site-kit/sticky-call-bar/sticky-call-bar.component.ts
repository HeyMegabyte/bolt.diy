import { Component, Input } from '@angular/core';
import { NgIf } from '@angular/common';

@Component({
  selector: 'sk-sticky-call-bar',
  standalone: true,
  imports: [NgIf],
  template: `
    <div
      role="complementary"
      [attr.aria-label]="label"
      style="
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: var(--ps-z-sticky, 1100);
        background: var(--ps-bg, #060610);
        border-top: 1px solid var(--ps-accent, #00e5ff);
        box-shadow: 0 -4px 24px rgba(0,229,255,0.12);
        padding: 12px 24px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      "
    >
      <span
        style="
          color: var(--ps-ink, #f4f4ff);
          font-size: 0.9rem;
          font-weight: 500;
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        "
      >{{ message }}</span>
      <a
        *ngIf="phone"
        [href]="'tel:' + phone"
        style="
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--ps-accent, #00e5ff);
          color: var(--ps-bg, #060610);
          font-weight: 700;
          font-size: 0.95rem;
          padding: 10px 20px;
          border-radius: var(--ps-radius-md, 12px);
          text-decoration: none;
          white-space: nowrap;
          transition: opacity var(--ps-dur-base, 220ms) var(--ps-ease-out, ease-out),
                      transform var(--ps-dur-base, 220ms) var(--ps-ease-spring, cubic-bezier(0.34,1.56,0.64,1));
        "
        onmouseover="this.style.opacity='0.88';this.style.transform='translateY(-1px)'"
        onmouseout="this.style.opacity='1';this.style.transform='translateY(0)'"
        onfocus="this.style.outline='var(--ps-ring-focus,2px solid #00e5ff)';this.style.outlineOffset='var(--ps-ring-focus-offset,2px)'"
        onblur="this.style.outline='none'"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.07 12 19.79 19.79 0 0 1 1 3.18 2 2 0 0 1 2.96 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.09a16 16 0 0 0 6.07 6.07l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 15z"/>
        </svg>
        {{ ctaLabel }}
      </a>
      <ng-container *ngIf="!phone && ctaHref">
        <a
          [href]="ctaHref"
          style="
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: var(--ps-accent, #00e5ff);
            color: var(--ps-bg, #060610);
            font-weight: 700;
            font-size: 0.95rem;
            padding: 10px 20px;
            border-radius: var(--ps-radius-md, 12px);
            text-decoration: none;
            white-space: nowrap;
          "
        >{{ ctaLabel }}</a>
      </ng-container>
    </div>
  `,
})
export class StickyCallBarComponent {
  @Input() message = 'Ready to get started?';
  @Input() phone = '';
  @Input() ctaLabel = 'Call Now';
  @Input() ctaHref = '';
  @Input() label = 'Sticky call bar';
}
