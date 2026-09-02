/**
 * content-quality-eval.mjs — objective, reusable content-quality scorecard for a
 * PUBLISHED projectsites.dev site. Formalizes the ad-hoc per-fire analysis the
 * self-improving loop runs into ONE tool that emits a JSON scorecard + gate verdicts.
 *
 * Why this exists (loop FIRE-71): the template reached high maturity + 11 straight
 * flawless builds — the frontier shifted from "add gorgeous" to CONTENT quality/
 * uniqueness (which needs LLM generation, non-deterministic). Safe LLM uniqueness
 * requires an objective quality gate to score before/after. This is that gate, and
 * the standard per-fire analysis instrument.
 *
 * Usage:
 *   node e2e/loop-eval/content-quality-eval.mjs <slug> [--theme=light|dark] [--json]
 *   e.g. node e2e/loop-eval/content-quality-eval.mjs forge-athletic-club-austin-2 --theme=dark
 *
 * Real Chromium (post-hydration DOM — JSON-LD + sections are client-rendered), resolves
 * Playwright from the frontend workspace, WAF-safe UA, serviceWorkers blocked. Exits 1
 * when any HARD gate fails so it can gate CI / an LLM-uniqueness loop.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Playwright lives in the frontend workspace; resolve from there.
const req = createRequire(resolve(__dirname, '../../frontend/'));
const { chromium } = req('playwright');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const PAGES = ['/', '/about', '/services', '/faq', '/contact'];

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const wantTheme = (args.find((a) => a.startsWith('--theme=')) || '').split('=')[1] || null;
const asJson = args.includes('--json');
if (!slug) {
  console.error('usage: node content-quality-eval.mjs <slug> [--theme=light|dark] [--json]');
  process.exit(2);
}
const BASE = `https://${slug}.projectsites.dev`;

/** Flesch Reading Ease (higher = easier; the copy-writing gate wants ≥ 50). */
function flesch(text) {
  const sentences = (text.match(/[.!?]+/g) || []).length || 1;
  const words = (text.match(/[A-Za-z]+/g) || []);
  const wc = words.length || 1;
  const syll = words.reduce((n, w) => n + countSyllables(w), 0) || 1;
  return Math.round((206.835 - 1.015 * (wc / sentences) - 84.6 * (syll / wc)) * 10) / 10;
}
function countSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'for', 'with', 'in', 'on', 'at', 'or', 'and', 'your', 'our', 'we', 'us', 'you', 'that', 'this', 'who', 'are', 'is', 'when', 'it', 'every', 'real', 'from', 'here']);

async function scorePage(page, path) {
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 90)); });
  let status = 0;
  try {
    const r = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
    status = r?.status() ?? 0;
  } catch (e) {
    return { path, status: 0, error: String(e).slice(0, 80) };
  }
  await page.waitForTimeout(2600);
  const d = await page.evaluate(() => {
    const text = document.body.innerText || '';
    const jsonld = [...document.querySelectorAll('script[type="application/ld+json"]')];
    let types = [], org = null;
    for (const s of jsonld) {
      try {
        const j = JSON.parse(s.textContent);
        (Array.isArray(j) ? j : [j]).forEach((n) => {
          types.push(n['@type']);
          if (String(n['@id'] || '').endsWith('#org')) org = n;
        });
      } catch {}
    }
    return {
      text,
      words: text.trim().split(/\s+/).filter(Boolean).length,
      tokenLeaks: (document.documentElement.innerHTML.match(/\{[A-Z_]{3,}\}/g) || []).length,
      title: document.title,
      desc: document.querySelector('meta[name=description]')?.content || '',
      imgs: document.querySelectorAll('img').length,
      sections: document.querySelectorAll('section').length,
      h1s: document.querySelectorAll('h1').length,
      h2s: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()),
      jsonldTypes: types,
      orgType: org?.['@type'] || null,
      napHours: Array.isArray(org?.openingHoursSpecification) ? org.openingHoursSpecification.length : 0,
      napAddr: !!org?.address, napTel: !!org?.telephone, napEmail: !!org?.email,
      theme: document.documentElement.getAttribute('data-theme') || '',
      galleryTiles: document.querySelectorAll('[data-gallery] [data-zoomable], [data-gallery] img').length,
    };
  });
  page.removeAllListeners('console');
  return { path, status, errs, ...d, flesch: flesch(d.text) };
}

const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ serviceWorkers: 'block', userAgent: UA });
const results = [];
for (const path of PAGES) {
  const p = await ctx.newPage();
  results.push(await scorePage(p, path));
  await p.close();
}
await b.close();

// ── Gate evaluation ──────────────────────────────────────────────────────────
const gates = [];
const g = (name, ok, detail) => gates.push({ name, ok, detail });
const home = results.find((r) => r.path === '/') || {};

for (const r of results) {
  if (r.status !== 200) { g(`status ${r.path}`, false, `HTTP ${r.status}`); continue; }
  g(`status ${r.path}`, true, '200');
  g(`words ${r.path}`, r.words >= 120, `${r.words}w (≥120)`);
  g(`no-tokens ${r.path}`, r.tokenLeaks === 0, `${r.tokenLeaks} leaks`);
  g(`no-console-err ${r.path}`, (r.errs?.length ?? 0) === 0, `${r.errs?.length ?? 0} errors`);
  g(`title ${r.path}`, r.title.length >= 50 && r.title.length <= 60, `${r.title.length} (50-60)`);
  g(`desc ${r.path}`, r.desc.length >= 120 && r.desc.length <= 156, `${r.desc.length} (120-156)`);
  g(`one-h1 ${r.path}`, r.h1s === 1, `${r.h1s} h1`);
  g(`flesch ${r.path}`, r.flesch >= 45, `${r.flesch} (≥45)`); // ≥50 target, 45 floor for pro copy
}
// Home-only structural gates
g('home ≥9 sections', (home.sections ?? 0) >= 9, `${home.sections} sections`);
g('home ≥6 images', (home.imgs ?? 0) >= 6, `${home.imgs} imgs`);
g('home ≥4 JSON-LD', (home.jsonldTypes?.length ?? 0) >= 4, `${home.jsonldTypes?.length} nodes`);
g('gallery 8 tiles', (home.galleryTiles ?? 0) === 8, `${home.galleryTiles} tiles`);
if (wantTheme) g('theme', home.theme === wantTheme, `${home.theme} (want ${wantTheme})`);

// Cross-page headline repetition: a salient word repeated across ≥2 DIFFERENT pages'
// H1s is a soft signal (WARN, not a hard gate — on-brand keyword reuse over-flags).
const salient = (s) => (s.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOP.has(w));
const h1words = {};
for (const r of results) for (const w of new Set(salient(r.h1s ? (r.h2s[0] || '') : ''))) (h1words[w] ||= []).push(r.path);
const repeats = Object.entries(h1words).filter(([, ps]) => ps.length > 1);

const hard = gates.filter((x) => !x.ok);
const overall = hard.length === 0 ? 'PASS' : 'FAIL';
const scorecard = {
  slug, url: BASE, overall,
  perPage: results.map((r) => ({ path: r.path, status: r.status, words: r.words, flesch: r.flesch, title: r.title.length, desc: r.desc.length, sections: r.sections, imgs: r.imgs, errs: r.errs?.length ?? 0, tokens: r.tokenLeaks })),
  home: { theme: home.theme, sections: home.sections, imgs: home.imgs, jsonld: home.jsonldTypes, orgType: home.orgType, gallery: home.galleryTiles, nap: { hours: home.napHours, addr: home.napAddr, tel: home.napTel, email: home.napEmail } },
  softRepeats: repeats.map(([w, ps]) => `${w}: ${ps.join('+')}`),
  gatesFailed: hard.map((x) => `${x.name} — ${x.detail}`),
};

if (asJson) {
  console.log(JSON.stringify(scorecard, null, 2));
} else {
  console.log(`\n━━ Content-Quality Eval: ${slug} → ${overall} ━━`);
  for (const r of scorecard.perPage) console.log(`  ${r.path.padEnd(10)} ${r.status} · ${r.words}w · Flesch ${r.flesch} · title ${r.title} · desc ${r.desc} · ${r.sections}sec · ${r.imgs}img · ${r.errs}err · ${r.tokens}tok`);
  console.log(`  HOME theme=${scorecard.home.theme} · ${scorecard.home.orgType} · JSON-LD ${scorecard.home.jsonld?.length} · gallery ${scorecard.home.gallery} · NAP hours=${scorecard.home.nap.hours} addr=${scorecard.home.nap.addr} tel=${scorecard.home.nap.tel} email=${scorecard.home.nap.email}`);
  if (scorecard.softRepeats.length) console.log(`  ⚠ soft headline repeats: ${scorecard.softRepeats.join(' · ')}`);
  if (hard.length) console.log(`  ✗ FAILED: ${scorecard.gatesFailed.join(' | ')}`);
  else console.log(`  ✓ all ${gates.length} hard gates pass`);
}
process.exit(overall === 'PASS' ? 0 : 1);
