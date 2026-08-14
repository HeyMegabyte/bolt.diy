import { Component, Input } from '@angular/core';

@Component({
  selector: 'sk-hero-centered',
  standalone: true,
  imports: [],
  template: `
    <section
      [style.background]="'var(--ps-bg,#060610)'"
      [style.color]="'var(--ps-ink,#f4f4ff)'"
      style="min-height:90vh;display:flex;flex-direction:column;
             align-items:center;justify-content:center;
             text-align:center;padding:5rem 1.5rem;position:relative;overflow:hidden;"
    >
      <!-- Ambient glow -->
      <div
        aria-hidden="true"
        [style.background]="'radial-gradient(ellipse 60% 40% at 50% 50%, var(--ps-accent-soft,rgba(0,229,255,0.12)), transparent)'"
        style="position:absolute;inset:0;pointer-events:none;"
      ></div>

      <div style="position:relative;max-width:800px;margin:0 auto;">
        @if (eyebrow) {
          <p
            [style.color]="'var(--ps-accent,#00e5ff)'"
            style="font-size:.85rem;font-weight:600;letter-spacing:.12em;
                  text-transform:uppercase;margin:0 0 1rem;"
          >
            {{ eyebrow }}
          </p>
        }
        <h1
          style="font-size:clamp(2.5rem,6vw,4.5rem);font-weight:800;
                   line-height:1.05;margin:0 0 1.5rem;letter-spacing:-.03em;
                   text-wrap:balance;"
        >
          {{ heading }}
        </h1>
        <p
          style="font-size:1.2rem;line-height:1.75;opacity:.75;
                  margin:0 0 2.5rem;max-width:56ch;margin-inline:auto;"
        >
          {{ subheading }}
        </p>
        <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;">
          <a
            [href]="primaryCtaHref"
            [style.background]="'var(--ps-grad-primary,linear-gradient(135deg,#00e5ff,#00d4ff))'"
            [style.color]="'var(--ps-bg,#060610)'"
            style="padding:.875rem 2rem;border-radius:var(--ps-radius-sm,8px);
                    font-weight:700;font-size:1.05rem;text-decoration:none;
                    transition:opacity .15s;"
            (mouseenter)="$event.target['style'].opacity = '.85'"
            (mouseleave)="$event.target['style'].opacity = '1'"
          >
            {{ primaryCtaLabel }}
          </a>
          @if (secondaryCtaLabel) {
            <a
              [href]="secondaryCtaHref"
              [style.color]="'var(--ps-ink,#f4f4ff)'"
              style="padding:.875rem 2rem;border-radius:var(--ps-radius-sm,8px);
                    font-weight:600;font-size:1.05rem;text-decoration:none;
                    border:1px solid rgba(255,255,255,.2);
                    transition:border-color .15s;"
              (mouseenter)="$event.target['style'].borderColor = 'rgba(255,255,255,.5)'"
              (mouseleave)="$event.target['style'].borderColor = 'rgba(255,255,255,.2)'"
            >
              {{ secondaryCtaLabel }}
            </a>
          }
        </div>
      </div>
    </section>
  `,
})
export class SkHeroCenteredComponent {
  @Input() eyebrow = 'Now in beta';
  @Input() heading = 'The platform built for makers';
  @Input() subheading =
    'Design, build, and ship your next product — faster than you thought possible.';
  @Input() primaryCtaLabel = 'Get early access';
  @Input() primaryCtaHref = '#signup';
  @Input() secondaryCtaLabel = 'Learn more';
  @Input() secondaryCtaHref = '#features';
}
