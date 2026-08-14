import { Component, Input } from '@angular/core';

@Component({
  selector: 'sk-hero-split',
  standalone: true,
  imports: [],
  template: `
    <section
      [style.background]="'var(--ps-bg,#060610)'"
      [style.color]="'var(--ps-ink,#f4f4ff)'"
      style="padding:5rem 1.5rem;"
    >
      <div
        style="max-width:1200px;margin:0 auto;display:grid;
                  grid-template-columns:1fr 1fr;gap:4rem;align-items:center;"
      >
        <!-- Left: text -->
        <div>
          @if (eyebrow) {
            <p
              [style.color]="'var(--ps-accent,#00e5ff)'"
              style="font-size:.85rem;font-weight:600;letter-spacing:.1em;
                    text-transform:uppercase;margin:0 0 .75rem;"
            >
              {{ eyebrow }}
            </p>
          }
          <h1
            style="font-size:clamp(2rem,4vw,3.25rem);font-weight:700;
                     line-height:1.1;margin:0 0 1.25rem;letter-spacing:-.02em;"
          >
            {{ heading }}
          </h1>
          <p
            style="font-size:1.15rem;line-height:1.7;opacity:.8;margin:0 0 2rem;
                    max-width:42ch;"
          >
            {{ subheading }}
          </p>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;">
            <a
              [href]="primaryCtaHref"
              [style.background]="'var(--ps-grad-primary,linear-gradient(135deg,#00e5ff,#00d4ff))'"
              [style.color]="'var(--ps-bg,#060610)'"
              style="padding:.75rem 1.75rem;border-radius:var(--ps-radius-sm,8px);
                      font-weight:600;text-decoration:none;display:inline-block;
                      transition:opacity .15s;"
              (mouseenter)="$event.target['style'].opacity = '.85'"
              (mouseleave)="$event.target['style'].opacity = '1'"
            >
              {{ primaryCtaLabel }}
            </a>
            @if (secondaryCtaLabel) {
              <a
                [href]="secondaryCtaHref"
                [style.color]="'var(--ps-accent,#00e5ff)'"
                style="padding:.75rem 1.75rem;border-radius:var(--ps-radius-sm,8px);
                      font-weight:600;text-decoration:none;display:inline-flex;
                      align-items:center;border:1px solid var(--ps-accent,#00e5ff);
                      transition:opacity .15s;"
                (mouseenter)="$event.target['style'].opacity = '.7'"
                (mouseleave)="$event.target['style'].opacity = '1'"
              >
                {{ secondaryCtaLabel }}
              </a>
            }
          </div>
        </div>
        <!-- Right: image -->
        <div
          style="border-radius:var(--ps-radius-xl,22px);overflow:hidden;
                    box-shadow:var(--ps-shadow-xl,0 20px 60px rgba(0,0,0,.4));"
        >
          <img
            [src]="imageSrc"
            [alt]="imageAlt"
            style="width:100%;height:100%;object-fit:cover;display:block;
                      aspect-ratio:4/3;"
            loading="lazy"
          />
        </div>
      </div>
    </section>
  `,
})
export class SkHeroSplitComponent {
  @Input() eyebrow = 'Introducing v2.0';
  @Input() heading = 'Ship faster with AI-powered tools';
  @Input() subheading = 'Everything your team needs to build, launch, and scale — in one platform.';
  @Input() primaryCtaLabel = 'Start for free';
  @Input() primaryCtaHref = '#signup';
  @Input() secondaryCtaLabel = 'Watch demo';
  @Input() secondaryCtaHref = '#demo';
  @Input() imageSrc = 'https://picsum.photos/seed/hero/800/600';
  @Input() imageAlt = 'Product screenshot';
}
