import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { isSysAdminEmail } from '../../pages/admin/sys-admin';

/**
 * Shared flag-gate notice — the calm cyan "this section is behind a platform
 * feature flag (currently disabled)" banner that ~14 admin sections previously
 * hand-rolled as a near-identical 200-char `<div>`. Part of the cockpit state
 * kit ({@link SkeletonComponent} / {@link EmptyStateComponent} /
 * {@link ErrorCardComponent}).
 *
 * Renders a "PLATFORM FLAG" eyebrow + cyan lock glyph, the disabled-feature
 * sentence, and a SPA link to the operator's **System Admin** layer (renamed
 * from "Feature Flags" 2026-06-07). A non-operator who follows the link is
 * redirected to their owner Features layer by `sysAdminGuard`.
 *
 * @example
 * <app-flag-gate-notice feature="The Section Marketplace" flag="section_marketplace"
 *   testid="marketplace-flag-gate" margin="mb-5" />
 */
@Component({
  selector: 'app-flag-gate-notice',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="flag-gate" [class]="margin()" role="status" [attr.data-testid]="testid()" [attr.aria-label]="(heading() || feature()) + ' is disabled — gated by a platform feature flag'">
      <span class="flag-gate__eyebrow">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Platform flag
      </span>
      @if (heading()) {
        <p class="flag-gate__heading">{{ heading() }}</p>
      }
      @if (isOperator()) {
        <p class="flag-gate__body">
          {{ feature() }} {{ plural() ? 'are' : 'is' }} behind the <code>{{ flag() }}</code> feature flag (currently disabled). Enable it in
          <a routerLink="/admin/feature-flags" class="flag-gate__link">System&nbsp;Admin</a>@if (suffix()) { {{ ' ' + suffix() }}}.
        </p>
      } @else {
        <!-- Owner view: a site owner can't toggle a platform flag (it lives in the
             operator-only System Admin layer), so don't send them there — give a
             plain, plan-aware explanation. -->
        <p class="flag-gate__body">
          {{ feature() }} {{ plural() ? 'are' : 'is' }} not available for your site yet. It's a platform feature managed by ProjectSites.
        </p>
      }
    </div>
  `,
  styles: [`
    .flag-gate { border-radius: 0.85rem; border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 18%, transparent); background: color-mix(in oklch, var(--ps-accent, #00e5ff) 5%, transparent); padding: 0.9rem 1rem; }
    .flag-gate__eyebrow { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.6rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ps-accent, #00e5ff); margin-bottom: 0.4rem; }
    .flag-gate__heading { margin: 0 0 0.25rem; font-size: 0.86rem; font-weight: 600; color: #fff; }
    .flag-gate__body { margin: 0; font-size: 0.8rem; line-height: 1.45; color: var(--ps-ink-dim, rgba(255,255,255,0.62)); }
    .flag-gate__body code { color: var(--ps-accent, #00e5ff); font-size: 0.78em; }
    .flag-gate__link { color: var(--ps-accent, #00e5ff); text-decoration: underline; text-underline-offset: 2px; border-radius: 2px; }
    .flag-gate__link:hover { color: #fff; }
    .flag-gate__link:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }
  `],
})
export class FlagGateNoticeComponent {
  // AuthService is providedIn:'root' so it's always resolvable (optional guards
  // the rare no-DI render). An EMPTY email means "no active session" — never a
  // signed-in owner viewing a gated section (those always carry a non-operator
  // email in prod), so unknown identity → OPERATOR view (link shown). That also
  // keeps every existing section spec's "links to System Admin" assertion green.
  private readonly auth = inject(AuthService, { optional: true });
  /** True for platform operators (or when identity is unknown) → show the System Admin CTA. */
  readonly isOperator = computed(() => {
    const email = this.auth?.email() ?? '';
    return email === '' || isSysAdminEmail(email);
  });

  /** Subject of the sentence, e.g. "The Section Marketplace" / "Webhooks". */
  readonly feature = input.required<string>();
  /** The flag key rendered in `<code>`, e.g. "section_marketplace". */
  readonly flag = input.required<string>();
  /** `data-testid` on the container (preserves each section's existing test hook). */
  readonly testid = input.required<string>();
  /** Subject plural? → "are" vs "is". Default false. */
  readonly plural = input(false);
  /** Optional margin utility class (e.g. "mb-5" / "mt-5") to match the host's spacing. */
  readonly margin = input('');
  /** Optional bold heading line above the sentence (e.g. "Log Explorer isn't enabled"). */
  readonly heading = input('');
  /** Optional trailing clause appended after "System Admin" (e.g. "to search Worker tail logs"). */
  readonly suffix = input('');
}
