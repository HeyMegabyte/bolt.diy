import { Component } from '@angular/core';

interface Pledge {
  readonly icon: string;
  readonly title: string;
  readonly detail: string;
}

/**
 * AN40 — Analytics privacy pledge (anti-Google positioning).
 *
 * @remarks
 * A static, always-visible trust strip in the owner analytics UI. States the
 * three promises that differentiate us from surveillance-adtech analytics
 * (Plausible/Fathom positioning): no cookies, IP anonymized, data never sold.
 * Pure presentational — no inputs, no network.
 *
 * @example
 * <app-data-pledge />
 */
@Component({
  selector: 'app-data-pledge',
  standalone: true,
  template: `
    <aside
      data-testid="data-pledge"
      role="note"
      aria-label="Analytics privacy pledge"
      class="mt-6 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] px-4 py-3">
      <p class="text-[0.78rem] font-semibold text-emerald-300 m-0 mb-2 uppercase tracking-wide">
        Your visitors' privacy is protected
      </p>
      <ul class="grid gap-2 sm:grid-cols-3 m-0 p-0 list-none">
        @for (p of pledges; track p.title) {
          <li class="flex items-start gap-2" data-testid="data-pledge-item">
            <span aria-hidden="true" class="text-[1rem] leading-none mt-0.5">{{ p.icon }}</span>
            <span class="text-[0.8rem]">
              <span class="block text-white font-medium">{{ p.title }}</span>
              <span class="block text-text-secondary text-[0.74rem] mt-0.5">{{ p.detail }}</span>
            </span>
          </li>
        }
      </ul>
    </aside>
  `,
})
export class DataPledgeComponent {
  readonly pledges: ReadonlyArray<Pledge> = [
    { icon: '🍪', title: 'No cookies', detail: 'Cookieless by design — your visitors never see a consent banner.' },
    { icon: '🛡️', title: 'IP anonymized', detail: 'We never store a full visitor IP or any personal identifier.' },
    { icon: '🔒', title: 'Never sold', detail: 'Your visitor data is yours. We never sell or share it. Ever.' },
  ];
}
