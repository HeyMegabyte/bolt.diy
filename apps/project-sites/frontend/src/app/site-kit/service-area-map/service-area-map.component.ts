import { Component, Input } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';

export interface ServiceZone {
  label: string;
  color?: string;
  highlight?: boolean;
}

@Component({
  selector: 'sk-service-area-map',
  standalone: true,
  imports: [NgFor, NgIf],
  template: `
    <section [attr.aria-labelledby]="headingId" style="padding: 48px 24px; max-width: 700px; margin: 0 auto;">
      <h2
        *ngIf="heading"
        [id]="headingId"
        style="
          color: var(--ps-ink, #f4f4ff);
          font-size: clamp(1.4rem, 4vw, 2rem);
          font-weight: 800;
          text-align: center;
          margin: 0 0 8px;
        "
      >{{ heading }}</h2>
      <p
        *ngIf="subtitle"
        style="text-align:center;color:rgba(244,244,255,0.6);font-size:0.9rem;margin:0 0 32px;"
      >{{ subtitle }}</p>

      <!-- Illustrated SVG map placeholder -->
      <div
        style="
          position: relative;
          background: rgba(0,229,255,0.04);
          border: 1px solid rgba(0,229,255,0.15);
          border-radius: var(--ps-radius-xl, 22px);
          overflow: hidden;
          aspect-ratio: 16/9;
          display: flex;
          align-items: center;
          justify-content: center;
        "
        role="img"
        [attr.aria-label]="'Service area map for ' + heading"
      >
        <svg viewBox="0 0 640 360" xmlns="http://www.w3.org/2000/svg"
          style="width:100%;height:100%;position:absolute;inset:0;"
          aria-hidden="true"
        >
          <!-- Grid lines -->
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(0,229,255,0.06)" stroke-width="1"/>
            </pattern>
          </defs>
          <rect width="640" height="360" fill="url(#grid)"/>
          <!-- Primary service zone -->
          <ellipse cx="320" cy="180" rx="180" ry="130"
            fill="rgba(0,229,255,0.08)" stroke="rgba(0,229,255,0.35)" stroke-width="1.5" stroke-dasharray="6 4"/>
          <!-- Secondary zone -->
          <ellipse cx="320" cy="180" rx="110" ry="80"
            fill="rgba(0,229,255,0.13)" stroke="rgba(0,229,255,0.55)" stroke-width="2"/>
          <!-- Core zone -->
          <ellipse cx="320" cy="180" rx="48" ry="34"
            fill="rgba(0,229,255,0.22)" stroke="var(--ps-accent,#00e5ff)" stroke-width="2.5"/>
          <!-- Pin -->
          <circle cx="320" cy="174" r="8" fill="var(--ps-accent,#00e5ff)"/>
          <line x1="320" y1="174" x2="320" y2="195" stroke="var(--ps-accent,#00e5ff)" stroke-width="2"/>
          <!-- Location label -->
          <rect x="240" y="202" width="160" height="26" rx="6" fill="rgba(6,6,16,0.85)"/>
          <text x="320" y="220" text-anchor="middle" font-family="sans-serif" font-size="12"
            fill="var(--ps-accent,#00e5ff)" font-weight="700">{{ centerLabel }}</text>
        </svg>
      </div>

      <!-- Zone legend -->
      <ul
        *ngIf="zones.length"
        role="list"
        aria-label="Service zones"
        style="
          list-style: none;
          margin: 24px 0 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          justify-content: center;
        "
      >
        <li
          *ngFor="let zone of zones"
          style="
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(244,244,255,0.05);
            border: 1px solid rgba(244,244,255,0.1);
            border-radius: 99px;
            padding: 6px 14px;
            font-size: 0.83rem;
            color: var(--ps-ink, #f4f4ff);
          "
          [style.border-color]="zone.highlight ? 'rgba(0,229,255,0.4)' : ''"
        >
          <span
            style="
              width: 10px;
              height: 10px;
              border-radius: 50%;
              flex-shrink: 0;
            "
            [style.background]="zone.color || 'rgba(0,229,255,0.5)'"
            aria-hidden="true"
          ></span>
          {{ zone.label }}
        </li>
      </ul>

      <p
        *ngIf="ctaText"
        style="text-align:center;margin:24px 0 0;"
      >
        <a
          [href]="ctaHref"
          style="
            display: inline-block;
            background: var(--ps-accent, #00e5ff);
            color: #060610;
            padding: 12px 28px;
            border-radius: 99px;
            font-weight: 800;
            font-size: 0.9rem;
            text-decoration: none;
            transition: opacity 0.22s;
          "
          onmouseenter="this.style.opacity='0.85'"
          onmouseleave="this.style.opacity='1'"
        >{{ ctaText }}</a>
      </p>
    </section>
  `,
})
export class ServiceAreaMapComponent {
  @Input() heading = 'Areas We Serve';
  @Input() headingId = 'sk-area-heading';
  @Input() subtitle = 'Providing reliable service across the region.';
  @Input() centerLabel = 'Our Coverage Area';
  @Input() ctaText = 'Check Your Address';
  @Input() ctaHref = '#contact';
  // No fabricated defaults — a kit service-area map must NEVER ship invented coverage
  // zones/SLAs (same-day / next-day …) to a real business site; a visitor would read
  // fabricated service promises as fact. Empty by default → the zone legend self-hides
  // (*ngIf="zones.length"). The consumer passes the business's REAL zones. (anti-fabrication mandate)
  @Input() zones: ServiceZone[] = [];
}
