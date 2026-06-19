import { Component, input } from '@angular/core';

/** One labelled fact in an integration tile's `?` help disclosure (#12). */
export interface IntegrationHelpRow {
  readonly k: string;
  readonly v: string;
}

/**
 * Reusable "What does connecting do?" help disclosure for an integration /
 * OAuth / MCP connect tile (backlog #12 — integration-tile `?` doctrine).
 *
 * @remarks
 * A native `<details>`/`<summary>` disclosure — keyboard-accessible, no popover
 * state, no z-index/stacking traps. The caller supplies accurate-by-construction
 * `rows` (account · auth type · optional · data handling) so the component never
 * asserts a scope or retention policy the platform can't honour. Used by the MCP
 * connect tiles and the social account cards; lives here once so neither surface
 * duplicates the markup or CSS.
 *
 * @example
 * <app-integration-help [rows]="helpRows(p)" [subject]="p.label" testid="mcp-help-stripe" />
 */
@Component({
  selector: 'app-integration-help',
  standalone: true,
  template: `
    @if (rows().length) {
      <details class="ih" [attr.data-testid]="testid()">
        <summary class="ih__q" [attr.aria-label]="'What connecting ' + subject() + ' means'">
          <span class="ih__qmark" aria-hidden="true">?</span> What does connecting do?
        </summary>
        <dl class="ih__dl">
          @for (row of rows(); track row.k) {
            <dt>{{ row.k }}</dt>
            <dd>{{ row.v }}</dd>
          }
        </dl>
      </details>
    }
  `,
  styles: [`
    :host { display: block; }
    .ih { margin-top: 0.5rem; }
    .ih__q {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 0.68rem; color: var(--ps-accent, #00e5ff);
      cursor: pointer; list-style: none; user-select: none;
      border-radius: 6px; padding: 1px 2px;
    }
    .ih__q::-webkit-details-marker { display: none; }
    .ih__q:hover { text-decoration: underline; }
    .ih__q:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 2px; }
    .ih__qmark {
      display: inline-flex; align-items: center; justify-content: center;
      width: 14px; height: 14px; border-radius: 999px;
      font-size: 0.6rem; font-weight: 700;
      color: var(--ps-bg, #060610); background: var(--ps-accent, #00e5ff);
    }
    .ih__dl {
      margin: 8px 0 2px; display: grid; grid-template-columns: auto 1fr;
      gap: 3px 10px; font-size: 0.68rem; line-height: 1.45;
    }
    .ih__dl dt { color: #94a3b8; font-weight: 600; white-space: nowrap; }
    .ih__dl dd { color: #cbd5e1; margin: 0; }
  `],
})
export class IntegrationHelpComponent {
  /** Labelled facts to show; empty → renders nothing. */
  readonly rows = input<readonly IntegrationHelpRow[]>([]);
  /** Provider/platform label, used in the summary's aria-label. */
  readonly subject = input<string>('');
  /** Stable test id for the disclosure element. */
  readonly testid = input<string>('integration-help');
}
