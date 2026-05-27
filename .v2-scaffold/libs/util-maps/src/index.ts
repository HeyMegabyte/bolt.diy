/**
 * `@org/util-maps` — single Google Maps JS API loader.
 *
 * One singleton, one `<script>` tag, one Promise. Fixes the v1
 * regression (doctrine §18) where the SDK loaded twice on the quote
 * page and the second loader silently failed.
 */
export * from './lib/maps-loader.service.js';
