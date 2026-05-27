/**
 * Re-export of `takeUntilDestroyed` from `@angular/core/rxjs-interop`
 * with documented usage notes so feature libs don't have to remember
 * the import path.
 *
 * @example
 * ```ts
 * class Foo {
 *   private readonly api = inject(ApiService);
 *
 *   data$ = this.api.bookings$().pipe(takeUntilDestroyed());
 * }
 * ```
 *
 * @remarks Must be called in an injection context (constructor, field
 * initializer, or inside `runInInjectionContext`). For component-tree
 * subscriptions this is always the cleanest cancellation primitive.
 */
export { takeUntilDestroyed } from '@angular/core/rxjs-interop';
