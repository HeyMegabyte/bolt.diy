/**
 * Cockpit-v2 state kit — reusable LOADING / EMPTY / ERROR primitives so the 54
 * admin sections stop hand-rolling these states. All three use `--ps-*` design
 * tokens, respect `prefers-reduced-motion`, and ship the required aria roles.
 *
 * @example
 * ```ts
 * import { SkeletonComponent, EmptyStateComponent, ErrorCardComponent } from '../../../components/states';
 * ```
 */
export { SkeletonComponent, type SkeletonVariant } from './skeleton.component';
export { EmptyStateComponent } from './empty-state.component';
export { ErrorCardComponent } from './error-card.component';
