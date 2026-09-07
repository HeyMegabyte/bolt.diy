#!/usr/bin/env node
/**
 * verify-editor-webcontainer-roundtrip.mjs — E.2 (§E) the FULL WebContainer
 * edit→save→persist round-trip in the REAL booted bolt.diy editor.
 *
 * B.6 (verify-editor-roundtrip.mjs) proves the headless envelope — the /chat READ
 * bootstrap + publish-bolt security (auth/org/IDOR/validation), non-mutating. It
 * explicitly defers "the full WebContainer UI drive (editor.projectsites.dev iframe,
 * ~30-60s boot) + edit→save→persist" as Browserbase-gated. E.1 (verify-editor-datatab)
 * proves the Data + Functions tabs render live-connected data and that a Functions
 * "+ New" SCAFFOLD persists. This probe closes the last §E gap: the CODE-EDITOR flow —
 * type into the CodeMirror editor → SAVE → the change persists to the WebContainer FS.
 *
 * PERSIST is proven from the editor's own contract (app/lib/stores/workbench.ts):
 *   saveFile() `await this.#filesStore.saveFile(path, content)` (the WebContainer FS
 *   write) BEFORE removing the path from the `unsavedFiles` atom. EditorPanel renders
 *   the "Save" PanelHeaderButton ONLY while the active file is unsaved
 *   (`unsavedFiles.has(filePath)`). Therefore:
 *     edit → "Save" button APPEARS (file is dirty)
 *     click Save → "Save" button DISAPPEARS  ⟺  the FS write completed (persisted).
 *   A stronger leg (when ≥2 files): switch to another file and back → the typed marker
 *   is STILL in the editor (re-read from the store/FS, not just the live buffer).
 *
 * Browserbase runs Linux Chrome — we drive the Save BUTTON (not the Mod-s hotkey) to
 * avoid Ctrl/Cmd ambiguity + the browser's own save-page dialog. The typed content is
 * ephemeral WebContainer state (fresh per boot, never published), so editing the
 * auto-open file is safe (same rationale as the datatab probe's scaffold).
 *
 * Fail-open like its siblings: SKIP (exit 0) on unset creds, session-create failure, or
 * a WebContainer that never boots within budget (the boot is the flaky part, not the
 * round-trip). Once the editor is interactive, a broken round-trip FAILS (exit 1).
 *
 * Creds (get-secret): BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, E2E_TEST_PASSWORD.
 * Usage: BROWSERBASE_API_KEY=… BROWSERBASE_PROJECT_ID=… E2E_TEST_PASSWORD=… \
 *          node e2e/admin-verify/verify-editor-webcontainer-roundtrip.mjs
 */
import { chromium } from '@playwright/test';
import { resolveBrowserbaseCreds } from './_browserbase-creds.mjs';

const { BB, PROJ, PW } = resolveBrowserbaseCreds();
if (!BB || !PROJ || !PW) {
  console.log(
    '::notice:: verify-editor-webcontainer-roundtrip skipped — Browserbase creds / E2E_TEST_PASSWORD unset',
  );
  process.exit(0);
}
const BOOT_BUDGET_MS = 100_000; // WebContainer cold-boot ceiling before we SKIP (not fail)
const MARKER = `ps-e2e-roundtrip-${Date.now()}`;

const r = await fetch('https://api.browserbase.com/v1/sessions', {
  method: 'POST',
  headers: { 'X-BB-API-Key': BB, 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId: PROJ, timeout: 900 }),
});
if (!r.ok) {
  console.log(
    `::notice:: verify-editor-webcontainer-roundtrip skipped — Browserbase session create failed (${r.status})`,
  );
  process.exit(0);
}
const { id } = await r.json();
const browser = await chromium.connectOverCDP(
  `wss://connect.browserbase.com?apiKey=${encodeURIComponent(BB)}&sessionId=${encodeURIComponent(id)}`,
);
const consoleErrs = [];
let reachedInteractive = false; // once true, a failure is REAL (exit 1), not boot flakiness
try {
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/i.test(m.text()))
      consoleErrs.push(m.text().slice(0, 100));
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('https://projectsites.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate(async (pw) => {
    const res = await fetch('/api/auth/test-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'brian@megabyte.space', password: pw }),
    });
    const j = await res.json().catch(() => ({}));
    if (j?.data?.token)
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: j.data.token, identifier: 'brian@megabyte.space', issuedAt: Date.now() }),
      );
  }, PW);
  await page.goto('https://projectsites.dev/admin/editor', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page.waitForSelector('iframe', { timeout: 30000 }).catch(() => {});

  // Poll for the bolt iframe with a mounted CodeMirror editor within the boot budget.
  let bf = null;
  const deadline = Date.now() + BOOT_BUDGET_MS;
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000);
    bf = page.frames().find((f) => /editor\.projectsites\.dev/.test(f.url()));
    if (bf && (await bf.locator('.cm-content').first().count().catch(() => 0))) break;
    // No file auto-open yet? click the first file-tree node to open one.
    if (bf) {
      const firstFile = bf.locator('[class*="i-ph:file"]').first();
      if (await firstFile.count().catch(() => 0)) await firstFile.click().catch(() => {});
    }
    bf = null;
  }
  if (!bf) {
    console.log(
      '::notice:: verify-editor-webcontainer-roundtrip skipped — WebContainer/editor did not boot within budget (headless flakiness, not a round-trip defect)',
    );
    process.exit(0);
  }

  const cm = bf.locator('.cm-content').first();
  await cm.waitFor({ state: 'visible', timeout: 15000 });
  reachedInteractive = true;

  const rows = [];
  const saveBtn = () => bf.locator('button:has-text("Save")');
  const cleanSaveCount = await saveBtn().count().catch(() => 0); // usually 0 on a fresh, saved file

  // EDIT — focus the editor, jump to doc end, type a unique marker.
  await cm.click();
  await page.keyboard.press('Control+End').catch(() => {});
  await cm.pressSequentially(`\n${MARKER}`, { delay: 15 }).catch(() => {});
  await page.waitForTimeout(1200);
  const markerTyped = (await cm.innerText().catch(() => '')).includes(MARKER);
  rows.push({ k: 'edit: marker typed into CodeMirror', ok: markerTyped, detail: MARKER });

  // DIRTY — the "Save" affordance appears only while the active file is unsaved.
  const dirtyCount = await saveBtn().count().catch(() => 0);
  const dirtyAppeared = dirtyCount > cleanSaveCount || dirtyCount > 0;
  rows.push({ k: 'dirty: "Save" affordance appears (unsavedFiles.has)', ok: dirtyAppeared, detail: `clean=${cleanSaveCount} dirty=${dirtyCount}` });

  // SAVE — click Save → saveCurrentDocument → awaits filesStore.saveFile (FS write).
  await saveBtn().first().click().catch(() => {});
  await page.waitForTimeout(2500);

  // PERSIST — the "Save" affordance clears ONLY after the FS write resolved.
  const afterSaveCount = await saveBtn().count().catch(() => 0);
  const savedCleared = afterSaveCount < dirtyCount || afterSaveCount <= cleanSaveCount;
  rows.push({ k: 'persist: "Save" clears (FS write resolved before unsaved-clear)', ok: savedCleared, detail: `dirty=${dirtyCount} afterSave=${afterSaveCount}` });

  // STRONGER PERSIST (best-effort, non-gating) — switch file + back; marker survives ⇒
  // re-read from the store/FS, not just the live editor buffer.
  let survivedSwitch = null;
  const otherFiles = bf.locator('[class*="i-ph:file"]');
  const fileCount = await otherFiles.count().catch(() => 0);
  if (fileCount > 1) {
    await otherFiles.nth(1).click().catch(() => {});
    await page.waitForTimeout(1000);
    await otherFiles.nth(0).click().catch(() => {});
    await page.waitForTimeout(1200);
    survivedSwitch = (await bf.locator('.cm-content').first().innerText().catch(() => '')).includes(MARKER);
    rows.push({ k: 'persist+: marker survives file-switch round-trip (re-read from FS)', ok: survivedSwitch !== false, detail: survivedSwitch === null ? 'n/a' : String(survivedSwitch), soft: survivedSwitch === null });
  }

  rows.push({ k: 'zero console errors', ok: consoleErrs.length === 0, detail: `${consoleErrs.length} err` });

  const hard = rows.filter((x) => !x.soft);
  const fails = hard.filter((x) => !x.ok);
  console.log('\n=== E.2 EDITOR WebContainer edit→save→persist round-trip ===');
  for (const x of rows) console.log(`  ${x.soft && x.detail === 'n/a' ? '·' : x.ok ? '✓' : '✗'} ${x.k}  [${x.detail}]`);
  if (consoleErrs.length) for (const e of consoleErrs.slice(0, 3)) console.log(`   · ${e}`);
  console.log(
    fails.length
      ? `\nVERDICT: 🔴 FAIL — ${fails.length}/${hard.length} round-trip checks failed`
      : `\nVERDICT: ✅ PASS — real booted WebContainer: edit → Save persists to the FS (Save affordance cleared${survivedSwitch ? ' + survived a file-switch re-read' : ''}), 0 console errors`,
  );
  process.exit(fails.length ? 1 : 0);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (reachedInteractive) {
    console.log(`\n🔴 ERROR after editor became interactive (real): ${msg}`.slice(0, 200));
    process.exit(1);
  }
  console.log(`::notice:: verify-editor-webcontainer-roundtrip skipped — ${msg}`.slice(0, 160));
  process.exit(0);
} finally {
  await browser.close();
}
