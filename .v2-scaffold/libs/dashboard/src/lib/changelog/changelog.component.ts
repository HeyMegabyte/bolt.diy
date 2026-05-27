import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Static changelog page. Real entries land here via a build-time
 * generator later; this iteration ships a deliberate empty state with
 * the right shape so the route exists for QA and link audits.
 */
@Component({
  selector: 'lib-changelog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="ps-changelog" data-testid="changelog">
      <header>
        <h1>Changelog</h1>
        <p>Every customer-visible change we ship.</p>
      </header>
      <p class="ps-changelog__empty">
        Recent entries will appear here once the build wires the generator.
      </p>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: 24px;
        max-width: 720px;
      }
      h1 {
        margin: 0;
      }
      .ps-changelog__empty {
        margin-top: 24px;
        opacity: 0.7;
      }
    `,
  ],
})
export class ChangelogComponent {}
