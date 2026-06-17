import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface SplitItem {
  eyebrow?: string;
  heading: string;
  body: string;
  imageSrc: string;
  imageAlt: string;
  imageRight?: boolean;
}

@Component({
  selector: 'sk-feature-split',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section
      [style.background]="'var(--ps-bg,#060610)'"
      [style.color]="'var(--ps-ink,#f4f4ff)'"
      style="padding:5rem 1.5rem;">
      <div style="max-width:1100px;margin:0 auto;display:flex;flex-direction:column;gap:6rem;">
        <div *ngFor="let item of items"
             style="display:grid;grid-template-columns:1fr 1fr;gap:4rem;align-items:center;"
             [style.direction]="item.imageRight ? 'rtl' : 'ltr'">

          <!-- Text -->
          <div style="direction:ltr;">
            <p *ngIf="item.eyebrow"
               [style.color]="'var(--ps-accent,#00e5ff)'"
               style="font-size:.8rem;font-weight:600;letter-spacing:.1em;
                      text-transform:uppercase;margin:0 0 .75rem;">
              {{ item.eyebrow }}
            </p>
            <h3 style="font-size:clamp(1.5rem,3vw,2.25rem);font-weight:700;
                       margin:0 0 1rem;letter-spacing:-.02em;line-height:1.2;text-wrap:balance;">
              {{ item.heading }}
            </h3>
            <p style="font-size:1.05rem;line-height:1.75;opacity:.75;margin:0;">{{ item.body }}</p>
          </div>

          <!-- Screenshot -->
          <div style="direction:ltr;border-radius:var(--ps-radius-xl,22px);overflow:hidden;
                      box-shadow:var(--ps-shadow-lg,0 12px 40px rgba(0,0,0,.35));">
            <img [src]="item.imageSrc" [alt]="item.imageAlt"
                 style="width:100%;display:block;aspect-ratio:16/10;object-fit:cover;"
                 loading="lazy" />
          </div>
        </div>
      </div>
    </section>
  `,
})
export class SkFeatureSplitComponent {
  @Input() items: SplitItem[] = [
    {
      eyebrow: 'Collaboration',
      heading: 'Work together, ship together',
      body: 'Real-time collaboration tools that keep your team aligned across every timezone. No more merge conflicts, no more lost context.',
      imageSrc: 'https://picsum.photos/seed/feat1/800/500',
      imageAlt: 'Collaboration dashboard',
      imageRight: false,
    },
    {
      eyebrow: 'Automation',
      heading: 'Let the machine do the heavy lifting',
      body: 'Automate repetitive tasks with powerful workflow tools. Free your team to focus on what only humans can do.',
      imageSrc: 'https://picsum.photos/seed/feat2/800/500',
      imageAlt: 'Automation workflow',
      imageRight: true,
    },
  ];
}
