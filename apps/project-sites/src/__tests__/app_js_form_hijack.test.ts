/**
 * Regression for the edge-injected app.js form-hijack (surf QA 2026-08-27).
 *
 * `submitForm` client-validates (name+email present, message >= 10 chars) and
 * `return`s early on failure. The `ev.preventDefault()` used to sit AFTER those
 * returns, so an INCOMPLETE contact submit fell through to the browser's native
 * GET submit → the page reloaded, wiping BOTH the inline "Please add…" error AND
 * the visitor's typed input — a silent conversion-killer on the lead-gen form of
 * every delivered site. Fix: preventDefault unconditionally at the TOP of
 * submitForm, before serialize/validation. This pins the ordering so it can't
 * regress. (app.js is edge-injected, so this ships to all live sites on deploy.)
 */
import { APP_JS } from '../generated/app_js.js';

/** The `submitForm` function body (up to the next top-level function). */
function submitFormBody(): string {
  const start = APP_JS.indexOf('function submitForm');
  expect(start).toBeGreaterThan(-1);
  const rest = APP_JS.slice(start);
  const nextFn = rest.indexOf('\n  function ', 20);
  return nextFn > -1 ? rest.slice(0, nextFn) : rest.slice(0, 1800);
}

describe('app.js form hijack — preventDefault ordering (lead-gen regression)', () => {
  it('calls ev.preventDefault() BEFORE the client-validation early returns', () => {
    const body = submitFormBody();
    const idxPrevent = body.indexOf('ev.preventDefault()');
    const idxNameErr = body.indexOf('Please add your name and email');
    const idxMsgErr = body.indexOf('Please add a message');
    expect(idxPrevent).toBeGreaterThan(-1);
    expect(idxNameErr).toBeGreaterThan(-1);
    expect(idxMsgErr).toBeGreaterThan(-1);
    // preventDefault MUST precede both validation-fail returns, else an incomplete
    // submit does a native GET reload that wipes the error + the visitor's input.
    expect(idxPrevent).toBeLessThan(idxNameErr);
    expect(idxPrevent).toBeLessThan(idxMsgErr);
  });

  it('has exactly one preventDefault in submitForm (moved to top, not duplicated)', () => {
    const body = submitFormBody();
    const count = (body.match(/ev\.preventDefault\(\)/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('still POSTs valid submissions to /api/contact-form/<slug>', () => {
    // The hijack must keep its correct endpoint (worker route is /api/contact-form/:slug).
    expect(APP_JS).toContain("'/api/contact-form/'");
  });
});
