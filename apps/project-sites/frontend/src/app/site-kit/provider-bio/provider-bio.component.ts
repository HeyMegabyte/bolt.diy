import { Component, Input } from '@angular/core';

export interface ProviderCredential {
  label: string;
}

@Component({
  selector: 'sk-provider-bio',
  standalone: true,
  imports: [],
  template: `
    @if (name) {
      <article
        [attr.aria-labelledby]="headingId"
        itemscope
        itemtype="https://schema.org/Person"
        style="
        max-width: 680px;
        margin: 0 auto;
        padding: 40px 24px;
        display: flex;
        flex-wrap: wrap;
        gap: 32px;
        align-items: flex-start;
      "
      >
        <!-- Avatar -->
        <figure
          aria-hidden="true"
          style="
          flex-shrink: 0;
          width: 140px;
          height: 140px;
          border-radius: 50%;
          overflow: hidden;
          border: 3px solid var(--ps-accent, #00e5ff);
          margin: 0;
          box-shadow: 0 0 0 4px rgba(0,229,255,0.12);
          background: rgba(0,229,255,0.07);
        "
        >
          <!-- SVG placeholder portrait -->
          <svg
            viewBox="0 0 140 140"
            xmlns="http://www.w3.org/2000/svg"
            width="140"
            height="140"
            aria-hidden="true"
          >
            <rect width="140" height="140" fill="rgba(0,229,255,0.07)" />
            <circle cx="70" cy="52" r="28" fill="rgba(0,229,255,0.2)" />
            <ellipse cx="70" cy="130" rx="44" ry="36" fill="rgba(0,229,255,0.15)" />
          </svg>
        </figure>
        <!-- Info -->
        <div style="flex: 1; min-width: 200px;">
          <h2
            [id]="headingId"
            itemprop="name"
            style="
            color: var(--ps-ink, #f4f4ff);
            font-size: clamp(1.3rem, 4vw, 1.75rem);
            font-weight: 800;
            margin: 0 0 4px;
          "
          >
            {{ name }}
          </h2>
          @if (title) {
            <p
              itemprop="jobTitle"
              style="
            color: var(--ps-accent, #00e5ff);
            font-size: 0.9rem;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            margin: 0 0 16px;
          "
            >
              {{ title }}
            </p>
          }
          <!-- Credentials as pills -->
          @if (credentials.length) {
            <ul
              role="list"
              aria-label="Credentials"
              style="
            list-style: none;
            margin: 0 0 16px;
            padding: 0;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
          "
            >
              @for (cred of credentials; track cred) {
                <li
                  style="
              background: rgba(0,229,255,0.1);
              border: 1px solid rgba(0,229,255,0.3);
              border-radius: 99px;
              padding: 4px 12px;
              font-size: 0.8rem;
              font-weight: 700;
              color: var(--ps-accent, #00e5ff);
              letter-spacing: 0.02em;
            "
                >
                  {{ cred.label }}
                </li>
              }
            </ul>
          }
          @if (bio) {
            <p
              itemprop="description"
              style="
            color: rgba(244,244,255,0.75);
            font-size: 0.92rem;
            line-height: 1.65;
            margin: 0 0 20px;
          "
            >
              {{ bio }}
            </p>
          }
          <!-- Specialties list -->
          @if (specialties.length) {
            <div style="margin-bottom: 20px;">
              <p
                style="font-size: 0.8rem; font-weight: 700; color: rgba(244,244,255,0.45); letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 8px;"
              >
                Specialties
              </p>
              <ul
                role="list"
                aria-label="Specialties"
                style="list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px;"
              >
                @for (spec of specialties; track spec) {
                  <li
                    style="
                background: rgba(244,244,255,0.05);
                border: 1px solid rgba(244,244,255,0.1);
                border-radius: 6px;
                padding: 4px 10px;
                font-size: 0.8rem;
                color: rgba(244,244,255,0.7);
              "
                  >
                    {{ spec }}
                  </li>
                }
              </ul>
            </div>
          }
          @if (ctaText) {
            <a
              [href]="ctaHref"
              [attr.aria-label]="'Book appointment with ' + name"
              style="
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: var(--ps-accent, #00e5ff);
            color: #060610;
            padding: 10px 24px;
            border-radius: 99px;
            font-weight: 800;
            font-size: 0.88rem;
            text-decoration: none;
            transition: opacity 0.22s;
          "
              onmouseenter="this.style.opacity='0.85'"
              onmouseleave="this.style.opacity='1'"
              >{{ ctaText }}</a
            >
          }
        </div>
      </article>
    }
  `,
})
export class ProviderBioComponent {
  // No fabricated defaults — this shipped a FAKE DOCTOR: "Dr. Sarah Okafor, MD"
  // with invented Howard University / Johns Hopkins credentials. Fabricating a
  // named person + professional bio + medical credentials is the most deceptive
  // default in the kit (and the fabricated-people gate missed it — bio, not quote).
  // Empty `name` self-hides the <article> (); the consumer passes the REAL
  // provider's verified name/bio/credentials or nothing. (anti-fabrication mandate)
  @Input() name = '';
  @Input() headingId = 'sk-provider-heading';
  @Input() title = '';
  @Input() bio = '';
  @Input() credentials: ProviderCredential[] = [];
  @Input() specialties: string[] = [];
  @Input() ctaText = 'Book an Appointment';
  @Input() ctaHref = '#book';
}
