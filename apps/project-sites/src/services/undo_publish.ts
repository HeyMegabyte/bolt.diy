/**
 * @module services/undo_publish
 * @description S17 — undo-publish window. After every publish the owner gets a
 * one-tap "revert" toast for a short grace period. Pure + zero-I/O: the caller
 * passes the publish timestamp + current time (no `Date.now()` inside, so it's
 * deterministic + testable), and the revert action itself reuses the existing
 * snapshot-restore path. This layer is the window math + countdown formatting.
 * Never throws.
 *
 * @packageDocumentation
 */

/** Default grace period after a publish during which one-tap undo is offered. */
export const UNDO_WINDOW_MS = 5 * 60 * 1000;

/** State of an undo window at a given moment. */
export interface UndoWindowState {
  /** True while the undo toast should be offered. */
  readonly withinWindow: boolean;
  /** Whole seconds left in the window (0 once expired). */
  readonly secondsRemaining: number;
  /** Unix-ms instant the window closes. */
  readonly expiresAtMs: number;
  /** True once the window has closed. */
  readonly expired: boolean;
}

/** Coerce a value to a finite number of ms, else null. */
function toMs(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Date.parse(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/**
 * Compute the undo-window state for a publish.
 *
 * @param publishedAt - Publish instant (Unix ms or ISO string).
 * @param now - Current instant (Unix ms or ISO string) — pass it in for testability.
 * @param windowMs - Grace period; defaults to {@link UNDO_WINDOW_MS}. Negative → 0.
 * @returns {@link UndoWindowState}. Unparseable inputs → an expired window.
 *
 * @example
 * computeUndoWindow(1000, 1000 + 60_000) // → { withinWindow: true, secondsRemaining: 240, ... }
 */
export function computeUndoWindow(
  publishedAt: number | string | null | undefined,
  now: number | string | null | undefined,
  windowMs: number = UNDO_WINDOW_MS,
): UndoWindowState {
  const pub = toMs(publishedAt);
  const cur = toMs(now);
  const win = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 0;

  if (pub === null || cur === null) {
    return { withinWindow: false, secondsRemaining: 0, expiresAtMs: 0, expired: true };
  }

  const expiresAtMs = pub + win;
  // Clock skew: a "now" before the publish still gets the full window.
  const remainingMs = Math.max(0, expiresAtMs - Math.max(cur, pub));
  const withinWindow = remainingMs > 0;

  return {
    withinWindow,
    secondsRemaining: Math.ceil(remainingMs / 1000),
    expiresAtMs,
    expired: !withinWindow,
  };
}

/**
 * Format remaining seconds as a `m:ss` countdown for the undo toast.
 *
 * @param secondsRemaining - Whole seconds left (clamped at 0).
 * @returns e.g. `"4:32"`, `"0:09"`.
 *
 * @example
 * formatUndoCountdown(272) // → '4:32'
 */
export function formatUndoCountdown(secondsRemaining: number): string {
  const s = Number.isFinite(secondsRemaining) ? Math.max(0, Math.floor(secondsRemaining)) : 0;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}
