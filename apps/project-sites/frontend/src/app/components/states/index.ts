/**
 * Cockpit-v2 state kit — reusable EMPTY / ERROR primitives so the 54
 * admin sections stop hand-rolling these states. All use `--ps-*` design
 * tokens, respect `prefers-reduced-motion`, and ship the required aria roles.
 *
 * @example
 * ```ts
 * import { EmptyStateComponent, ErrorCardComponent } from '../../../components/states';
 * ```
 */
export { EmptyStateComponent } from './empty-state.component';
export { ErrorCardComponent } from './error-card.component';
export { InlineErrorComponent } from './inline-error.component';
export { FlagGateNoticeComponent } from './flag-gate-notice.component';
