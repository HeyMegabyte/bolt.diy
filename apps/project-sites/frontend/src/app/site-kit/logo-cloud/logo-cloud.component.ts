import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface LogoItem { name: string; src?: string; }

@Component({
  selector: 'sk-logo-cloud',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    .lc-track {
      display: flex;
      gap: 3rem;
      align-items: center;
      animation: lc-scroll 28s linear infinite;
    }
    @keyframes lc-scroll {
      from { transform: translateX(0); }
      to { transform: translateX(-50%); }
    }
    @media (prefers-reduced-motion: reduce) {
      .lc-track { animation: none; }
    }
  `],
  template: `
    <section
      *ngIf="logos.length"
      [style.background]="'var(--ps-bg,#060610)'"
      [style.borderTop]="'1px solid var(--ps-hairline,rgba(255,255,255,.08))'"
      [style.borderBottom]="'1px solid var(--ps-hairline,rgba(255,255,255,.08))'"
      style="padding:2.5rem 0;overflow:hidden;">

      <p *ngIf="label"
         style="text-align:center;font-size:.8rem;letter-spacing:.1em;
                text-transform:uppercase;opacity:.45;margin:0 0 1.75rem;"
         [style.color]="'var(--ps-ink,#f4f4ff)'">
        {{ label }}
      </p>

      <!-- Marquee: duplicate items so scroll looks infinite -->
      <div style="overflow:hidden;mask:linear-gradient(90deg,transparent,black 10%,black 90%,transparent);">
        <div class="lc-track">
          <ng-container *ngFor="let item of doubledLogos">
            <div style="flex-shrink:0;opacity:.55;transition:opacity .2s;"
                 (mouseenter)="$event.currentTarget['style'].opacity='1'"
                 (mouseleave)="$event.currentTarget['style'].opacity='.55'">
              <img *ngIf="item.src" [src]="item.src" [alt]="item.name"
                   style="height:28px;max-width:120px;object-fit:contain;filter:brightness(0) invert(1);" />
              <span *ngIf="!item.src"
                    [style.color]="'var(--ps-ink,#f4f4ff)'"
                    style="font-size:1rem;font-weight:700;white-space:nowrap;letter-spacing:-.02em;">
                {{ item.name }}
              </span>
            </div>
          </ng-container>
        </div>
      </div>
    </section>
  `,
})
export class SkLogoCloudComponent {
  @Input() label = 'Trusted by teams at';
  // No fabricated defaults — a "trusted by" logo cloud must NEVER ship a fake
  // client roster (Globex / Hooli / Pied Piper …) to a generated business site.
  // The consumer passes REAL client logos; with none the <section> self-hides
  // (*ngIf). Demo data lives in the Storybook story. (anti-fabrication mandate)
  @Input() logos: LogoItem[] = [];

  get doubledLogos(): LogoItem[] {
    return [...this.logos, ...this.logos];
  }
}
