import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'sk-cta-band',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section
      [style.background]="'var(--ps-accent-secondary,#7C3AED)'"
      [style.color]="'var(--ps-ink,#f4f4ff)'"
      style="padding:5rem 1.5rem;text-align:center;position:relative;overflow:hidden;">

      <!-- Glow accents -->
      <div aria-hidden="true"
           style="position:absolute;top:-60%;left:50%;transform:translateX(-50%);
                  width:800px;height:600px;border-radius:50%;
                  background:radial-gradient(ellipse,rgba(255,255,255,.12),transparent 70%);
                  pointer-events:none;"></div>

      <div style="position:relative;max-width:720px;margin:0 auto;">
        <h2 style="font-size:clamp(2rem,4.5vw,3.25rem);font-weight:800;
                   margin:0 0 1.25rem;letter-spacing:-.03em;text-wrap:balance;line-height:1.1;">
          {{ heading }}
        </h2>
        <p *ngIf="subheading"
           style="font-size:1.15rem;line-height:1.7;opacity:.85;margin:0 0 2.5rem;max-width:52ch;margin-inline:auto;">
          {{ subheading }}
        </p>
        <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;">
          <a [href]="primaryCtaHref"
             style="padding:.875rem 2.25rem;border-radius:var(--ps-radius-sm,8px);
                    font-weight:700;font-size:1.05rem;text-decoration:none;
                    background:#fff;color:#060610;transition:opacity .15s;"
             (mouseenter)="$event.target['style'].opacity='.88'"
             (mouseleave)="$event.target['style'].opacity='1'">
            {{ primaryCtaLabel }}
          </a>
          <a *ngIf="secondaryCtaLabel" [href]="secondaryCtaHref"
             style="padding:.875rem 2.25rem;border-radius:var(--ps-radius-sm,8px);
                    font-weight:600;font-size:1.05rem;text-decoration:none;
                    border:2px solid rgba(255,255,255,.5);color:#fff;
                    transition:border-color .15s;"
             (mouseenter)="$event.target['style'].borderColor='rgba(255,255,255,.9)'"
             (mouseleave)="$event.target['style'].borderColor='rgba(255,255,255,.5)'">
            {{ secondaryCtaLabel }}
          </a>
        </div>
        <p *ngIf="footnote" style="margin:1.5rem 0 0;font-size:.85rem;opacity:.6;">{{ footnote }}</p>
      </div>
    </section>
  `,
})
export class SkCtaBandComponent {
  @Input() heading = 'Ready to get started?';
  @Input() subheading = 'Join over 10,000 teams building the future. Start for free today.';
  @Input() primaryCtaLabel = 'Start free trial';
  @Input() primaryCtaHref = '#signup';
  @Input() secondaryCtaLabel = 'Talk to sales';
  @Input() secondaryCtaHref = '#contact';
  @Input() footnote = 'No credit card required · Cancel anytime';
}
