import { Component, Input } from '@angular/core';

export interface ProcessStep {
  number?: string | number;
  title: string;
  description: string;
  icon?: string;
}

@Component({
  selector: 'sk-process-steps',
  standalone: true,
  imports: [],
  template: `
    @if (steps.length) {
      <section [attr.aria-labelledby]="headingId" style="padding: 48px 24px;">
        @if (heading) {
          <h2
            [id]="headingId"
            style="
          text-align: center;
          color: var(--ps-ink, #f4f4ff);
          font-size: clamp(1.5rem, 4vw, 2.2rem);
          font-weight: 800;
          margin: 0 0 48px;
        "
          >
            {{ heading }}
          </h2>
        }
        <ol
          role="list"
          style="
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 32px;
          max-width: 900px;
          margin: 0 auto;
        "
        >
          @for (step of steps; track step; let i = $index) {
            <li
              style="
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            gap: 12px;
            position: relative;
          "
            >
              <!-- Step number / icon blob -->
              <div
                style="
              width: 64px;
              height: 64px;
              border-radius: 50%;
              background: rgba(0,229,255,0.1);
              border: 2px solid var(--ps-accent, #00e5ff);
              display: flex;
              align-items: center;
              justify-content: center;
              flex-shrink: 0;
              box-shadow: 0 0 24px rgba(0,229,255,0.15);
            "
                aria-hidden="true"
              >
                @if (!step.icon) {
                  <span
                    style="
                color: var(--ps-accent, #00e5ff);
                font-size: 1.4rem;
                font-weight: 900;
                font-variant-numeric: tabular-nums;
              "
                    >{{ step.number ?? i + 1 }}</span
                  >
                }
                @if (step.icon) {
                  <span
                    [innerHTML]="step.icon"
                    style="color:var(--ps-accent,#00e5ff);display:flex;align-items:center;"
                  ></span>
                }
              </div>
              <h3 style="color:var(--ps-ink,#f4f4ff);font-size:1rem;font-weight:700;margin:0;">
                {{ step.title }}
              </h3>
              <p style="color:rgba(244,244,255,0.7);font-size:0.875rem;line-height:1.6;margin:0;">
                {{ step.description }}
              </p>
            </li>
          }
        </ol>
      </section>
    }
  `,
})
export class ProcessStepsComponent {
  @Input() heading = 'How It Works';
  @Input() headingId = 'ps-process-heading';
  // No fabricated defaults — a kit process-steps must NEVER ship invented process copy
  // ("licensed team", "100% satisfaction guaranteed") to a real business site. Empty by
  // default → the <section> self-hides (). The consumer passes the business's REAL
  // process. (anti-fabrication mandate)
  @Input() steps: ProcessStep[] = [];
}
