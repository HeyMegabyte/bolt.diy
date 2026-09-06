// verify-auth-a11y.mjs — WCAG 2.2 §3.3.8 Accessible Authentication (Minimum, AA) on /signin,
// the flow that GATES /admin. axe cannot test 3.3.8. A cognitive-function test (remembering a
// password, solving a CAPTCHA puzzle) must NOT be REQUIRED unless the step offers a
// cognitive-test-free ALTERNATIVE or a mechanism to ASSIST. This guards the whole auth surface:
//   • ≥1 cognitive-test-free path exists (magic-link OR federated OAuth), AND
//   • any REAL user password field supports a password manager (`autocomplete=current-password`
//     / `new-password`) and does NOT block paste (blocking paste forces manual transcription), AND
//   • no MANDATORY CAPTCHA puzzle (a non-interactive Turnstile is fine when alternatives exist).
// Excludes the dev-only `[data-testid="test-signin-panel"]` fixture (its E2E test-password field
// legitimately uses autocomplete="off" and is not a real auth path).
//
// Fail-open (E2E_API_KEY not required — /signin is public). Runs on local Chromium (SPA shell,
// no CF challenge). Usage: node e2e/admin-verify/verify-auth-a11y.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(__dirname, '../../frontend/'));
const { chromium } = req('playwright');
const ORIGIN = process.env.ORIGIN || 'https://projectsites.dev';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const browser = await chromium.launch();
const page = await (await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage();
const rows = [];
let fails = 0;
const check = (label, ok, detail) => { rows.push({ label, ok, detail }); if (!ok) fails++; };

try {
  await page.goto(`${ORIGIN}/signin`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const a = await page.evaluate(() => {
    const vis = (el) => el && el.offsetParent != null;
    const btns = [...document.querySelectorAll('button,a')].filter(vis).map((e) => (e.textContent || '').trim());
    const magicLink = btns.some((t) => /magic link|email me a|email link|sign in with email/i.test(t));
    const oauth = btns.filter((t) => /continue with (google|github|apple)|sign in with (google|github|apple)/i.test(t));
    // Real user password field = a visible type=password NOT inside the dev test-signin fixture.
    const pw = [...document.querySelectorAll('input[type="password"]')]
      .filter((el) => vis(el) && !el.closest('[data-testid="test-signin-panel"]'))[0];
    const pwInfo = pw ? { autocomplete: pw.getAttribute('autocomplete'), pasteBlocked: !!pw.getAttribute('onpaste'), labeled: !!(pw.labels && pw.labels.length) || !!pw.getAttribute('aria-label') } : null;
    const turnstile = document.querySelectorAll('.cf-turnstile, iframe[src*="challenges.cloudflare"]').length;
    const puzzle = /solve (the|this) puzzle|select all (images|squares)|drag the|rotate the|which of these/i.test(document.body.innerText || '');
    return { magicLink, oauth, pwInfo, turnstile, puzzle };
  });

  // 1. A cognitive-test-free ALTERNATIVE must exist (magic-link or OAuth).
  const altCount = (a.magicLink ? 1 : 0) + a.oauth.length;
  check('cognitive-test-free auth alternative exists', altCount >= 1, `magic-link=${a.magicLink} oauth=[${a.oauth.join(',')}]`);

  // 2. Any real password field must support a password manager + allow paste.
  if (a.pwInfo) {
    const acOk = /current-password|new-password/.test(a.pwInfo.autocomplete || '');
    check('password field is password-manager-friendly', acOk && !a.pwInfo.pasteBlocked,
      `autocomplete="${a.pwInfo.autocomplete}" pasteBlocked=${a.pwInfo.pasteBlocked}`);
    check('password field is labeled', a.pwInfo.labeled, `labeled=${a.pwInfo.labeled}`);
  } else {
    rows.push({ label: 'no real password field (passwordless — inherently 3.3.8-clean)', ok: true, detail: 'magic-link/OAuth only' });
  }

  // 3. No MANDATORY cognitive-test puzzle (Turnstile non-interactive is OK given the alternatives).
  check('no mandatory CAPTCHA puzzle', !a.puzzle, `puzzleText=${a.puzzle} turnstileWidgets=${a.turnstile}`);
} catch (e) {
  check('signin loaded', false, 'error: ' + String(e).slice(0, 100));
}
await browser.close();

for (const r of rows) console.log(`  ${r.ok ? '✓' : '✗'} ${r.label.padEnd(46)} ${r.detail}`);
console.log(
  fails
    ? `\nVERDICT: ❌ FAIL — ${fails} WCAG 3.3.8 Accessible-Authentication issue(s) on /signin (a cognitive test with no alternative / autofill blocked).`
    : `\nVERDICT: ✅ PASS — /signin meets WCAG 3.3.8 (cognitive-test-free alternatives + password-manager autofill, no mandatory puzzle).`,
);
process.exit(fails ? 1 : 0);
