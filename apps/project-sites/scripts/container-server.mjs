#!/usr/bin/env node
/**
 * container-server.mjs — HTTP server inside SiteBuilderContainer
 *
 * Runs as root (needed for `su cuser`). Exposes:
 *   POST /build   → start async Claude Code job, return { jobId }
 *   GET  /status  → heartbeat polling for a job
 *   GET  /result  → fetch files + status when complete
 *   GET  /health  → liveness probe
 *
 * Job state is persisted to /var/jobs/{jobId}.json so the workflow's
 * heartbeat polling survives container hibernation/restart. Jobs that
 * were running when the container restarted are marked errored on boot
 * (the spawned Claude Code child died with the container).
 */
import { execSync as x, spawn as sp } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';

const JOBS_DIR = '/var/jobs';
const SKILLS_DIR = '/home/cuser/.agentskills';
const TEMPLATE_DIR = '/home/cuser/template';

try { fs.mkdirSync(JOBS_DIR, { recursive: true }); } catch {}

let CP = '/usr/local/bin/claude';
try { CP = x('which claude', { encoding: 'utf-8' }).trim(); } catch {}
console.warn('[boot] Claude at:', CP);

function refreshRepo(prefix, label, dir) {
  try {
    // claude-skills uses master, template uses main — detect the remote HEAD
    // ref instead of hardcoding either one.
    x(
      `cd ${dir} && BR=$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p') && BR=\${BR:-main} && ` +
      `git fetch --depth=1 origin "$BR" 2>&1 && git reset --hard "origin/$BR" 2>&1`,
      { timeout: 30000, shell: true, encoding: 'utf-8' },
    );
    console.warn(`[${prefix}] ${label} updated`);
    return true;
  } catch (e) {
    console.warn(`[${prefix}] ${label} pull failed:`, e.message.slice(0, 100));
    return false;
  }
}

// Sync universal agents from megabytespace/claude-skills into ~/.claude/agents/
// without clobbering project-specific agents (which were COPY'd in the
// Dockerfile after the cp). Runs after every claude-skills git-pull so
// upstream agent edits land in the orchestrator within 10 minutes.
const AGENTS_DST = '/home/cuser/.claude/agents';
const AGENTS_SRC = `${SKILLS_DIR}/agents`;
const PROJECT_AGENTS = new Set(['domain-builder.md', 'validator-fixer.md']);

function syncAgents(prefix) {
  try {
    fs.mkdirSync(AGENTS_DST, { recursive: true });
    if (!fs.existsSync(AGENTS_SRC)) return;
    let copied = 0;
    for (const f of fs.readdirSync(AGENTS_SRC)) {
      if (!f.endsWith('.md')) continue;
      if (PROJECT_AGENTS.has(f)) continue; // never overwrite project overrides
      try {
        fs.copyFileSync(path.join(AGENTS_SRC, f), path.join(AGENTS_DST, f));
        copied++;
      } catch {}
    }
    console.warn(`[${prefix}] Synced ${copied} universal agents`);
  } catch (e) {
    console.warn(`[${prefix}] agent sync failed:`, e.message.slice(0, 100));
  }
}

refreshRepo('boot', 'Skills', SKILLS_DIR);
refreshRepo('boot', 'Template', TEMPLATE_DIR);
syncAgents('boot');

// Long-lived Durable Object containers don't reboot for days — refresh every 10min
// so megabytespace/claude-skills updates land without redeploying the worker.
let lastRefresh = Date.now();
function maybeRefreshSkills() {
  if (Date.now() - lastRefresh < 10 * 60 * 1000) return;
  lastRefresh = Date.now();
  refreshRepo('refresh', 'Skills', SKILLS_DIR);
  refreshRepo('refresh', 'Template', TEMPLATE_DIR);
  syncAgents('refresh');
}

const jobs = {};

function jobPath(jobId) { return path.join(JOBS_DIR, `${jobId}.json`); }

function saveJob(jobId) {
  if (!jobs[jobId]) return;
  try { fs.writeFileSync(jobPath(jobId), JSON.stringify(jobs[jobId])); } catch {}
}

function deleteJob(jobId) {
  delete jobs[jobId];
  try { fs.unlinkSync(jobPath(jobId)); } catch {}
}

function loadJobs() {
  try {
    for (const f of fs.readdirSync(JOBS_DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, f), 'utf-8'));
        if (j && j.jobId) jobs[j.jobId] = j;
      } catch {}
    }
    console.warn(`[boot] Loaded ${Object.keys(jobs).length} jobs from disk`);
  } catch {}
}

loadJobs();

for (const id of Object.keys(jobs)) {
  if (jobs[id].status === 'running') {
    jobs[id].status = 'error';
    jobs[id].error = 'container restarted mid-build — process lost';
    jobs[id].step = 'done';
    saveJob(id);
    console.warn(`[boot] Marked orphaned job ${id} as error`);
  }
}

// Self-keepalive: while any job is running, hit /health every 60s. This keeps the Node
// event loop active and signals "activity" to CF Container infrastructure to prevent
// idle DO hibernation. Without this, the workflow's KV-based heartbeat froze at the
// 2-min mark when the DO went idle after the initial /build POST returned.
setInterval(() => {
  const hasRunning = Object.values(jobs).some(j => j && j.status === 'running');
  if (!hasRunning) return;
  fetch('http://localhost:8080/health').catch(() => {});
}, 60_000);

function liveFileCount(dir) {
  if (!dir) return 0;
  let n = 0;
  const walk = (d) => {
    try {
      for (const f of fs.readdirSync(d)) {
        if (f.startsWith('_') || f === 'node_modules' || f === '.git' || f === '.claude') continue;
        const fp = path.join(d, f);
        const st = fs.statSync(fp);
        if (st.isDirectory()) walk(fp);
        else if (st.isFile() && st.size > 0) n++;
      }
    } catch {}
  };
  walk(dir);
  return n;
}

function pushStatus(jobId) {
  const j = jobs[jobId];
  if (!j || !j.callbackUrl || !j.callbackSecret) return;
  const liveCount = j.status === 'running' && j.dir ? liveFileCount(j.dir) : 0;
  const finalCount = j.files ? j.files.length : 0;
  const payload = {
    jobId,
    status: j.status,
    step: j.step,
    elapsed: ((Date.now() - j.startTime) / 1000) | 0,
    fileCount: finalCount || liveCount,
    error: j.error ? String(j.error).slice(0, 500) : null,
    uploadResult: j.uploadResult || null,
  };
  const body = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', j.callbackSecret).update(body).digest('hex');
  fetch(j.callbackUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Build-Sig': sig },
    body,
  }).then(res => {
    if (!res.ok) console.warn(`[${jobId}] callback HTTP ${res.status}`);
  }).catch(e => console.warn(`[${jobId}] callback err: ${e.message}`));
}

function setStatus(jobId, patch) {
  if (!jobs[jobId]) return;
  Object.assign(jobs[jobId], patch);
  saveJob(jobId);
  pushStatus(jobId);
}

// Boot-time push: surface any orphan errors marked above to KV via callback NOW so
// the workflow's next heartbeat sees status=error instead of waiting 8 minutes for
// stale threshold to expire.
for (const id of Object.keys(jobs)) {
  if (jobs[id].status === 'error') {
    try { pushStatus(id); } catch {}
  }
}

function collectFiles(dir, base = '') {
  const files = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('_') || f === 'node_modules' || f === '.git' || f === '.claude') continue;
      const fp = path.join(dir, f);
      const rel = base ? `${base}/${f}` : f;
      const st = fs.statSync(fp);
      if (st.isDirectory()) files.push(...collectFiles(fp, rel));
      else if (st.isFile() && st.size > 0 && st.size < 500000) {
        try { files.push({ name: rel, content: fs.readFileSync(fp, 'utf-8') }); } catch {}
      }
    }
  } catch {}
  return files;
}

// ═══════════════════════════════════════════════════════════════════════════
// DETERMINISTIC TEMPLATE-TOKEN SAFETY NET + POST-BUILD GATE
// ───────────────────────────────────────────────────────────────────────────
// Root cause (journey 2026-08-22, e.g. summit-peak-pt): the template ships every
// page as TypeScript with single-brace {TOKEN} placeholders — {BUSINESS_NAME},
// {HERO_SUBHEADLINE}, {ABOUT_HEADLINE}, {BLOG_1_TITLE}, {CS_1_CLIENT}, {FAQ_*},
// {STAT_*}, {TIER_*}, … (hundreds across src/**/*.tsx + index.html + public/**
// + _brand.json). The orchestrator is TOLD to fill them but nothing GUARANTEES
// it — a partial/failed generation ships raw {TOKEN}s to the live site.
//
// This is the guarantee: after the orchestrator finishes, deterministically fill
// EVERY remaining content token from the job's context (whatever _content.json /
// _brand.json / _research.json / params landed in the build dir), and for any
// token still unfilled substitute a SAFE fallback by semantics so ZERO {TOKEN}
// can survive. Then a post-build GATE greps dist/ and FAILS the job if any leak.
// Pure w.r.t. inputs (fillTemplateTokens/distUnfilledTokens are unit-checkable).
// ═══════════════════════════════════════════════════════════════════════════

// A content token = {ALL_CAPS_SNAKE} in a string/text position. A JS-expression
// token (`={IDENT}` JSX container or `${IDENT}` template-literal interpolation,
// e.g. sw.js `${CACHE_VERSION}`) is NOT content — replacing it corrupts source.
// Discriminate on the char immediately before `{`: `=`/`$` = JS-expr (skip).
const TEMPLATE_TOKEN_RE = /(^|[^=$])\{([A-Z][A-Z0-9_]+)\}/g;
const TEMPLATE_TEXT_EXT = new Set([
  '.tsx', '.ts', '.jsx', '.js', '.mjs', '.html', '.htm', '.css',
  '.json', '.xml', '.txt', '.svg', '.webmanifest', '.md',
]);

/** Recursively list text files under `root` (skips node_modules/.git/dist/.claude). */
function walkTemplateTextFiles(root, acc = []) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === '.claude') continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) walkTemplateTextFiles(full, acc);
    else if (TEMPLATE_TEXT_EXT.has(path.extname(e.name).toLowerCase())) acc.push(full);
  }
  return acc;
}

// The surfaces the build reads + ships: source pages/components, the SPA shell,
// public/** (Vite copies verbatim into dist/), AND root _brand.json — brand.ts
// imports it (bundled into assets/index-*.js) and build-feeds.mjs postbuild reads
// it raw, so its {BUSINESS_*} $value leaves re-emit into dist/ if left tokenized.
function templateFillSurfaces(dir) {
  const out = [];
  for (const sub of ['src', 'public']) {
    const p = path.join(dir, sub);
    if (fs.existsSync(p)) out.push(...walkTemplateTextFiles(p));
  }
  for (const rootFile of ['index.html', '_brand.json']) {
    const p = path.join(dir, rootFile);
    if (fs.existsSync(p)) out.push(p);
  }
  return out;
}

// Strip JS comments so a token documented in JSDoc/comments (e.g. `{TOKEN}` in a
// doc block, `{FEATURE_N_TITLE}` in a note) is never treated as fillable content.
// NEVER strip .html/.svg/.txt/.md/.json/.xml — `//` and `<...>` are content there.
function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Best-effort content map from whatever context files landed in the build dir.
 * Priority: _content.json (explicit token→value) > _brand.json business $value
 * leaves > _research.json profile. Returns a flat { TOKEN: string } map.
 */
function loadContentMap(dir) {
  const map = {};
  const readJson = (name) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8')); } catch { return null; }
  };
  // 1. _content.json — the ideal explicit token→value map (may or may not exist).
  const content = readJson('_content.json');
  if (content && typeof content === 'object') {
    for (const [k, v] of Object.entries(content)) {
      if (typeof v === 'string' || typeof v === 'number') map[k] = String(v);
    }
  }
  // 2. _brand.json business leaves → the BUSINESS_* tokens (don't overwrite _content.json).
  const brand = readJson('_brand.json');
  const biz = (brand && brand.business) || {};
  const leaf = (l) => (l && typeof l === 'object' && typeof l.$value === 'string' ? l.$value : (typeof l === 'string' ? l : ''));
  const put = (k, v) => { if (v && !map[k]) map[k] = v; };
  put('BUSINESS_NAME', leaf(biz.name));
  put('BUSINESS_SHORT_NAME', leaf(biz.shortName));
  put('BUSINESS_TAGLINE', leaf(biz.tagline));
  put('BUSINESS_DESCRIPTION', leaf(biz.description));
  put('BUSINESS_URL', leaf(biz.url));
  put('BUSINESS_EMAIL', leaf(biz.email) || leaf(biz.contactEmail));
  put('BUSINESS_PHONE', leaf(biz.phone));
  put('BUSINESS_ADDRESS', leaf(biz.address));
  put('BUSINESS_HOURS', leaf(biz.hours));
  put('BUSINESS_CLASS', leaf(biz.businessClass));
  // 3. _research.json profile as a last-resort source for the identity tokens.
  const research = readJson('_research.json');
  const prof = (research && research.profile) || {};
  put('BUSINESS_NAME', typeof prof.name === 'string' ? prof.name : '');
  put('BUSINESS_PHONE', typeof prof.phone === 'string' ? prof.phone : '');
  put('BUSINESS_EMAIL', typeof prof.email === 'string' ? prof.email : '');
  // Drop any value that is itself a placeholder (a token pointing at a token).
  for (const k of Object.keys(map)) {
    if (typeof map[k] !== 'string' || map[k].trim() === '' || /^\{[A-Z0-9_]+\}$/.test(map[k].trim())) delete map[k];
  }
  return map;
}

/**
 * Deterministic vertical → brand-preset selector. The orchestrator is TOLD to
 * `cp examples/_brand.<vertical>.json _brand.json`, but it crashes/truncates
 * often enough that theme selection cannot depend on it (journey 2026-08-24:
 * a dentist build shipped the DARK default because the orchestrator died before
 * the cp). Classify the vertical from the deterministic signals already in the
 * build dir (slug + prompt + research/content/brand JSON) so the container can
 * force the right preset regardless of orchestrator health.
 * @returns the preset filename under examples/, or '' when no confident match.
 */
function pickVerticalPreset(dir, promptText = '') {
  let hay = String(promptText || '').toLowerCase();
  hay += ' ' + path.basename(dir).toLowerCase();
  for (const f of ['_content.json', '_research.json', '_brand.json']) {
    try { hay += ' ' + fs.readFileSync(path.join(dir, f), 'utf-8').toLowerCase(); } catch { /* absent */ }
  }
  // Leading \b + STEM match (no trailing \b) so inflections resolve: dentist→
  // "dentistry", plumb→"plumbing", landscap→"landscaping", photograph→
  // "photography", charit→"charitable". Short/ambiguous tokens carry an explicit
  // trailing \b (spa\b not "space", law\b not "lawn", app\b not "apparel").
  const rules = [
    ['_brand.medical.json', /\b(dentist|dental|orthodont|endodont|periodont|doctor|physician|clinic|medical|health|hospital|chiropract|dermatolog|pediatric|veterinar|optometr|ophthalmolog|physical therapy|physiotherap|physio|urgent care|family medicine|surgeon|cardiolog|pharmac)/],
    ['_brand.wellness.json', /\b(yoga|pilates|spa\b|massage|wellness|meditation|fitness|gym\b|crossfit|salon|beaut|nail|barber|acupunctur|reiki|nutrition|wellbeing|well-being)/],
    ['_brand.legal.json', /\b(law\b|lawyer|attorney|legal|counsel|litigation|paralegal|notary|estate planning|llp\b)/],
    ['_brand.restaurant.json', /\b(restaurant|cafe|café|coffee|bakery|bar\b|bistro|diner|eatery|catering|pizzeria|brewery|food truck|grill|steakhouse|winery|taqueria|deli\b)/],
    ['_brand.local-service.json', /\b(plumb|hvac|electric|roofing|roofer|landscap|lawn|cleaning|janitor|contractor|handyman|pest control|locksmith|moving|movers|garage door|paint|construction|remodel|flooring|fencing|paving|towing|auto repair|mechanic)/],
    ['_brand.nonprofit.json', /\b(nonprofit|non-profit|charit|foundation|ministry|church|synagogue|mosque|temple|community center|volunteer|shelter|soup kitchen|food bank|outreach|humanitarian|advocacy|ngo\b)/],
    ['_brand.retail.json', /\b(shop|store|retail|boutique|apparel|clothing|jewelr|goods|merchandise|marketplace|e-commerce|ecommerce|outfitter)/],
    ['_brand.saas.json', /\b(saas|software|platform|api\b|startup|analytics|dashboard|developer tool|automation|machine learning|fintech|cybersecurity|app\b|web app)/],
    ['_brand.agency.json', /\b(agency|marketing|advertis|branding|design studio|creative studio|consult|pr firm|media agency|growth marketing|seo agency)/],
    ['_brand.portfolio.json', /\b(portfolio|photograph|artist|freelance|illustrat|filmmaker|musician|architect|videograph)/],
  ];
  for (const [file, re] of rules) if (re.test(hay)) return file;
  return '';
}

// Presets whose colorScheme is light — Brian directive: healthcare/wellness/legal/
// restaurant/local-service/nonprofit render LIGHT (white/cyan), never dark.
const LIGHT_VERTICAL_PRESETS = new Set([
  '_brand.medical.json', '_brand.wellness.json', '_brand.legal.json',
  '_brand.restaurant.json', '_brand.local-service.json', '_brand.nonprofit.json',
]);

/**
 * Force the vertical brand preset into _brand.json when the orchestrator left the
 * template DEFAULT (crash) OR mis-themed a light vertical dark. Design-merge only:
 * the preset supplies color/colorScheme/font/etc.; the real business identity
 * (business/social/logo, research-derived) is preserved so we never ship the
 * preset's placeholder name. No-op when the orchestrator already produced a
 * correctly-themed custom brand.
 * @returns a short status string for the log.
 */
function applyVerticalPreset(dir, preset, templateDir) {
  if (!preset) return 'no-match';
  let presetPath = path.join(dir, 'examples', preset);
  if (!fs.existsSync(presetPath) && templateDir) presetPath = path.join(templateDir, 'examples', preset);
  if (!fs.existsSync(presetPath)) return `preset-missing:${preset}`;
  const brandPath = path.join(dir, '_brand.json');
  let presetJson;
  let current = null;
  try { presetJson = JSON.parse(fs.readFileSync(presetPath, 'utf-8')); } catch { return 'preset-unreadable'; }
  try { current = JSON.parse(fs.readFileSync(brandPath, 'utf-8')); } catch { /* missing/default */ }
  const curScheme = current && (current.colorScheme?.$value || current.colorScheme);
  const curBg = String((current && current.color && current.color.background && current.color.background.$value) || '');
  // "default" = the template dark shell the crash path leaves behind.
  const isDefault = !current || !current.color || !curScheme || curBg.includes('0.08 0.02');
  const forceLight = LIGHT_VERTICAL_PRESETS.has(preset) && curScheme !== 'light';
  if (!isDefault && !forceLight) return `kept-custom (scheme=${curScheme})`;
  const merged = { ...presetJson };
  for (const idKey of ['business', 'social', 'logo']) {
    if (current && current[idKey]) merged[idKey] = current[idKey];
  }
  fs.writeFileSync(brandPath, JSON.stringify(merged, null, 2));
  return `applied ${preset} (default=${isDefault} forceLight=${forceLight})`;
}

/**
 * Merge the per-vertical DEFAULT content pack (examples/_content.<vertical>.json)
 * into _content.json so section tokens (HERO, FEATURE, SERVICE, STAT, PROCESS,
 * FAQ, CTA, ABOUT groups) fill with strong generic per-vertical copy even when the
 * orchestrator crashes/under-fills — turning a self-hiding stub into a full,
 * on-vertical site. Existing _content.json values (real orchestrator/research
 * content) WIN token-by-token; the pack only fills gaps + blanks. No-op when the
 * vertical has no pack. Pairs with applyVerticalPreset (theme) — same crash-proof
 * "determinism lives in the container, not the orchestrator" pattern.
 * @returns a short status string for the log.
 */
function applyVerticalContentPack(dir, preset, templateDir) {
  if (!preset) return 'no-vertical';
  const packName = preset.replace('_brand.', '_content.');
  let packPath = path.join(dir, 'examples', packName);
  if (!fs.existsSync(packPath) && templateDir) packPath = path.join(templateDir, 'examples', packName);
  if (!fs.existsSync(packPath)) return `no-pack:${packName}`;
  let pack;
  try { pack = JSON.parse(fs.readFileSync(packPath, 'utf-8')); } catch { return 'pack-unreadable'; }
  if (!pack || typeof pack !== 'object') return 'pack-not-object';
  const contentPath = path.join(dir, '_content.json');
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(contentPath, 'utf-8')) || {}; } catch { /* none yet */ }
  // Pack defaults are the BASE; a non-blank existing value (orchestrator/research)
  // overrides its token. A blank existing token falls back to the rich default.
  const merged = {};
  for (const [k, v] of Object.entries(pack)) {
    if (typeof v === 'string' || typeof v === 'number') merged[k] = String(v);
  }
  for (const [k, v] of Object.entries(existing)) {
    if ((typeof v === 'string' || typeof v === 'number') && String(v).trim() !== '') merged[k] = String(v);
  }
  fs.writeFileSync(contentPath, JSON.stringify(merged, null, 2));
  return `merged ${packName} (${Object.keys(pack).length} defaults, ${Object.keys(existing).length} existing)`;
}

/**
 * Deterministic safety net. Replace EVERY content {TOKEN} across the shipped
 * surfaces with a real value from `contentMap`, else a SAFE fallback by token
 * semantics, so ZERO {TOKEN} can survive to dist/. Writes files in place.
 *
 * Safe fallbacks: BUSINESS_NAME → real name (never blank); *_IMAGE_URL / *_COVER
 * / *_PHOTO / *_LOGO / *_LINKEDIN → '' (template placeholders.ts then hides the
 * <img>/link); all other text → '' (the section self-hides via its {value && …}
 * guard). Returns { filled, fromMap, fromFallback, filesTouched }.
 *
 * @param {string} dir             build directory
 * @param {Record<string,string>} contentMap  token → value
 * @param {{businessName?:string, businessUrl?:string}} params  identity fallbacks
 */
function fillTemplateTokens(dir, contentMap, params = {}) {
  const realName = String(contentMap.BUSINESS_NAME || params.businessName || '').trim();
  const realUrl = String(contentMap.BUSINESS_URL || params.businessUrl || '').trim();
  const fallback = (token) => {
    if (token === 'BUSINESS_NAME') return realName || 'Our Business';
    if (token === 'BUSINESS_SHORT_NAME') return (realName || 'Our Business').slice(0, 12);
    if (token === 'BUSINESS_URL' || token === 'DOMAIN') return realUrl;
    // image/media/link tokens → '' so the template hides the element (no 404).
    if (/(_IMAGE_URL|_COVER|_PHOTO|_LOGO|_ICON|_LINKEDIN)$/.test(token) || /IMAGE_URL$/.test(token)) return '';
    // all other text → '' so the owning section self-hides.
    return '';
  };
  let fromMap = 0, fromFallback = 0, filesTouched = 0;
  for (const f of templateFillSurfaces(dir)) {
    let before;
    try { before = fs.readFileSync(f, 'utf-8'); } catch { continue; }
    const after = before.replace(TEMPLATE_TOKEN_RE, (_m, pre, key, offset) => {
      // Tokens live inside quoted string literals ('…'/"…"/`…`) or JSX attributes
      // (attr="…"). Escape the value for its enclosing context so real content
      // (apostrophes, quotes, &, <, >, newlines) can NEVER break TS/JSX compilation.
      // isJsxAttr: pre is a double-quote immediately preceded by '=' → attr="…".
      const isJsxAttr = pre === '"' && before[offset - 1] === '=';
      const enc = (raw) => {
        const s = String(raw).replace(/\r?\n/g, ' ').trim();
        if (isJsxAttr) {
          return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }
        // JS string literal (', ", or backtick): backslash-escape.
        let e = s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
        e = pre === '"' ? e.replace(/"/g, '\\"') : e.replace(/'/g, "\\'");
        return e;
      };
      const v = Object.prototype.hasOwnProperty.call(contentMap, key) ? contentMap[key] : undefined;
      if (typeof v === 'string' && v.trim() !== '') { fromMap++; return pre + enc(v); }
      fromFallback++;
      return pre + enc(fallback(key));
    });
    if (after !== before) { try { fs.writeFileSync(f, after); filesTouched++; } catch {} }
  }
  return { filled: fromMap + fromFallback, fromMap, fromFallback, filesTouched };
}

/**
 * Post-build gate. Return the distinct content tokens still present anywhere in
 * `distDir` (excludes `${…}` JS interpolation via TEMPLATE_TOKEN_RE). A non-empty
 * result means a token leaked into the shippable output → the job must FAIL.
 */
function distUnfilledTokens(distDir) {
  if (!fs.existsSync(distDir)) return [];
  const set = new Set();
  for (const f of walkTemplateTextFiles(distDir)) {
    let raw;
    try { raw = fs.readFileSync(f, 'utf-8'); } catch { continue; }
    for (const m of raw.matchAll(TEMPLATE_TOKEN_RE)) set.add(m[2]);
  }
  return [...set].sort();
}

function runJob(jobId, dir, prompt, envVars, timeoutMin, callbackUrl, callbackSecret, skipBuild) {
  jobs[jobId] = {
    jobId,
    status: 'running',
    dir,
    startTime: Date.now(),
    step: 'claude-code',
    error: null,
    files: null,
    uploadResult: null,
    callbackUrl: callbackUrl || null,
    callbackSecret: callbackSecret || null,
    skipBuild: Boolean(skipBuild),
  };
  saveJob(jobId);
  pushStatus(jobId);

  const pf = path.join(dir, '_prompt.txt');
  fs.writeFileSync(pf, prompt);

  const envLines = ['#!/bin/sh'];
  for (const k in envVars) if (envVars[k]) envLines.push(`export ${k}=${JSON.stringify(envVars[k])}`);
  envLines.push('export HOME=/home/cuser');
  envLines.push(`export SKILLS_DIR=${SKILLS_DIR}`);
  envLines.push(`export TEMPLATE_DIR=${TEMPLATE_DIR}`);
  envLines.push(`cd ${dir}`);
  envLines.push(`${CP} --dangerously-skip-permissions -p < ${pf}`);
  const sf = `/tmp/run_${jobId}.sh`;
  fs.writeFileSync(sf, envLines.join('\n'));
  try { x(`chmod +x ${sf}`, { stdio: 'pipe' }); } catch {}

  const to = (timeoutMin || 14) * 60000;
  console.warn(`[${jobId}] Starting Claude Code (${Math.round(prompt.length / 1024)}KB prompt, ${timeoutMin}min timeout)`);

  // Heartbeat every 30s for the ENTIRE job (claude -p + npm install + npm build + R2 upload).
  // Workflow staleness threshold is 8min — npm install alone can be 5min, so heartbeat must
  // outlive child process. Cleared only when status terminal (complete/error).
  const hb = setInterval(() => {
    const j = jobs[jobId];
    if (!j) { clearInterval(hb); return; }
    if (j.status === 'complete' || j.status === 'error') { clearInterval(hb); return; }
    pushStatus(jobId);
  }, 30_000);

  // shell:false is critical — with shell:true Node wraps the args in `/bin/sh -c "su cuser -s /bin/sh -c sh /tmp/...sh"`,
  // and the outer shell tokenizes that so su's -c receives only "sh" (no script path), leaving an idle inner shell
  // that never invokes claude. Pass argv directly so su gets `-c "sh ${sf}"` as one argument.
  const child = sp('su', ['cuser', '-s', '/bin/sh', '-c', `sh ${sf}`], {
    timeout: to, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 100 * 1024 * 1024,
  });

  // HARD WALL-CLOCK GUARD (Brian 2026-08-20): CF Containers cap wall-clock at
  // ~15 min — anything longer gets evicted mid-run and the workflow can only
  // recover ONCE. Beyond the spawn timeout's SIGTERM, kill the whole process
  // GROUP 45s earlier than the budget so Claude's subagent children (which the
  // su-wrapper SIGTERM may orphan) are reaped BEFORE the container eviction
  // boundary, and the terminal status lands in KV while the container is
  // still alive to report it.
  const killAt = to - 45_000;
  const killTimer = setTimeout(() => {
    console.warn(`[${jobId}] Hard time-box reached (${(killAt / 60000).toFixed(1)}min) — killing the process group`);
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
    }
  }, killAt);
  child.on('close', () => clearTimeout(killTimer));
  child.on('error', () => clearTimeout(killTimer));
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d.toString(); });
  child.stderr.on('data', d => { stderr += d.toString(); });

  // Run a shell command async via spawn so the Node event loop stays free for setInterval heartbeats.
  // Returns { code, stdout } or throws on timeout/spawn error.
  // Build-job env vars (CF creds, R2 bucket, etc.) are merged in so npm + the R2 upload script see them.
  const runEnv = { ...process.env, ...envVars, HOME: '/home/cuser' };
  function runAsync(cmd, timeoutMs, maxOutBytes) {
    return new Promise((resolve, reject) => {
      const c = sp('sh', ['-c', cmd], { timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: maxOutBytes || 50 * 1024 * 1024, env: runEnv });
      let out = '', err = '';
      c.stdout.on('data', d => { out += d.toString(); });
      c.stderr.on('data', d => { err += d.toString(); });
      c.on('close', code => resolve({ code, stdout: out, stderr: err }));
      c.on('error', e => reject(e));
    });
  }

  child.on('close', async code => {
    console.warn(`[${jobId}] Claude Code exited code=${code} stdout=${stdout.length}b stderr=${stderr.length}b elapsed=${((Date.now() - jobs[jobId].startTime) / 1000) | 0}s`);

    setStatus(jobId, { step: 'npm-build' });

    let buildOk = false;
    // WHY-tracker — the workflow only surfaces the generic error; recording
    // the container-side reason makes the next failure self-diagnosing
    // (journey 2026-08-19: repeated 'npm build failed' with zero root-cause
    // visibility).
    let buildFailReason = '';
    if (jobs[jobId] && jobs[jobId].skipBuild) {
      // Smoke-test path: skip npm install/build, treat any non-underscore files as the upload set.
      buildOk = liveFileCount(dir) > 0;
      console.warn(`[${jobId}] skipBuild=true, file count=${liveFileCount(dir)}, buildOk=${buildOk}`);
      if (!buildOk) buildFailReason = 'skipBuild=true and no live files';
    } else if (fs.existsSync(path.join(dir, 'package.json'))) {
      try {
        // ── SAFETY NET: deterministically fill EVERY remaining template {TOKEN}
        // before build so a partial/failed orchestrator run can never ship raw
        // {BUSINESS_NAME}/{HERO_SUBHEADLINE}/… to the live site. Idempotent —
        // tokens the orchestrator already filled are simply absent here. ──
        try {
          // ── DETERMINISTIC VERTICAL THEME (journey 2026-08-24): the orchestrator's
          // `cp examples/_brand.<vertical>.json` step is unreliable — a crash ships the
          // DARK default for a light vertical (dentist). Force the right preset here so
          // the theme survives an orchestrator crash; design-merge preserves identity. ──
          try {
            const preset = pickVerticalPreset(dir, prompt);
            console.warn(`[${jobId}] Vertical theme: ${applyVerticalPreset(dir, preset, TEMPLATE_DIR)}`);
            console.warn(`[${jobId}] Vertical content: ${applyVerticalContentPack(dir, preset, TEMPLATE_DIR)}`);
          } catch (te) {
            console.warn(`[${jobId}] Vertical theme/content skipped: ${te.message.slice(0, 200)}`);
          }
          const contentMap = loadContentMap(dir);
          // Identity fallbacks come from the context map itself (BUSINESS_NAME/URL
          // sourced from _content.json/_brand.json/_research.json in loadContentMap)
          // and the slug parsed from the build dir name (/tmp/build-<slug>-<ts>) —
          // no dependence on a build-param that may be absent.
          const slugFromDir = (path.basename(dir).match(/^build-(.+)-\d+$/) || [])[1] || '';
          const fill = fillTemplateTokens(dir, contentMap, {
            businessName: contentMap.BUSINESS_NAME,
            businessUrl: contentMap.BUSINESS_URL || (slugFromDir ? `https://${slugFromDir}.projectsites.dev` : ''),
          });
          console.warn(`[${jobId}] Token safety-net: filled ${fill.filled} (${fill.fromMap} from context, ${fill.fromFallback} safe-fallback) across ${fill.filesTouched} files`);
        } catch (fe) {
          console.warn(`[${jobId}] Token safety-net skipped: ${fe.message.slice(0, 200)}`);
        }
        const inst = await runAsync(`cd ${dir} && npm install --legacy-peer-deps 2>&1`, 300000, 50 * 1024 * 1024);
        if (inst.code !== 0) {
          console.warn(`[${jobId}] npm install exit=${inst.code} tail=`, inst.stdout.slice(-500));
          buildFailReason = `npm install failed code=${inst.code}: ${inst.stdout.slice(-800)}`;
          throw new Error(`npm install failed code=${inst.code}`);
        }
        const bld = await runAsync(`cd ${dir} && npm run build 2>&1`, 300000, 50 * 1024 * 1024);
        if (bld.code !== 0) {
          console.warn(`[${jobId}] npm build exit=${bld.code} tail=`, bld.stdout.slice(-500));
          buildFailReason = `npm build failed code=${bld.code}: ${(bld.stdout.match(/[^\n]*error[^\n]*/gi) || []).slice(-6).join(' | ') || bld.stdout.slice(-1500)}`;
          throw new Error(`npm build failed code=${bld.code}`);
        }
        const distDir = path.join(dir, 'dist');
        if (fs.existsSync(distDir)) {
          const distFiles = collectFiles(distDir);
          if (distFiles.length > 0) {
            // ── QUALITY GATE: a build that still emits raw {TOKEN}s into dist/
            // is a token-leaking site (the summit-peak-pt class). FAIL it — never
            // publish. Excludes ${…} JS interpolation via TEMPLATE_TOKEN_RE. ──
            const leaked = distUnfilledTokens(distDir);
            if (leaked.length > 0) {
              console.warn(`[${jobId}] TOKEN GATE FAIL: ${leaked.length} unfilled tokens in dist/ — ${leaked.slice(0, 12).join(', ')}${leaked.length > 12 ? '…' : ''}`);
              buildFailReason = `dist/ still contains ${leaked.length} unfilled template tokens (${leaked.slice(0, 8).join(', ')}${leaked.length > 8 ? '…' : ''}) — site would render raw {TOKEN}s`;
            } else {
              buildOk = true;
              console.warn(`[${jobId}] npm build ok: ${distFiles.length} dist files, 0 unfilled tokens`);
            }
          } else {
            console.warn(`[${jobId}] dist/ empty after build`);
            buildFailReason = 'dist/ exists but is empty after npm run build';
          }
        } else {
          console.warn(`[${jobId}] dist/ missing after build`);
          buildFailReason = 'dist/ missing after npm run build';
        }
      } catch (be) {
        console.warn(`[${jobId}] Build error:`, be.message.slice(0, 500));
        buildFailReason = buildFailReason || be.message.slice(0, 500);
      }
    } else {
      console.warn(`[${jobId}] No package.json — skipping build`);
      buildFailReason = 'no package.json in build dir — Claude Code never produced a buildable project';
    }

    if (!buildOk) {
      setStatus(jobId, {
        status: 'error',
        error: `npm build failed or produced no dist/ files — ${buildFailReason || 'unknown'}`, 
        step: 'done',
        files: [],
      });
      return;
    }

    setStatus(jobId, { step: 'r2-upload' });
    let uploadOk = false;
    let uploadResult = null;
    try {
      const up = await runAsync(`cd ${dir} && node /home/cuser/upload-to-r2.mjs 2>&1`, 300000, 10 * 1024 * 1024);
      console.warn(`[${jobId}] R2 upload exit=${up.code} tail:`, up.stdout.slice(-500));
      try {
        uploadResult = JSON.parse(fs.readFileSync(path.join(dir, '_upload_result.json'), 'utf-8'));
        if (uploadResult && typeof uploadResult.uploaded === 'number' && uploadResult.uploaded > 0) {
          uploadOk = true;
        } else {
          console.warn(`[${jobId}] Upload result has uploaded=${uploadResult && uploadResult.uploaded}`);
        }
      } catch (pe) {
        console.warn(`[${jobId}] Could not parse _upload_result.json:`, pe.message.slice(0, 200));
      }
    } catch (ue) {
      console.warn(`[${jobId}] R2 upload error:`, ue.message.slice(0, 500));
    }

    if (!uploadOk) {
      setStatus(jobId, {
        status: 'error',
        error: `R2 upload failed or uploaded 0 files. claude_exit=${code} upload_result=${JSON.stringify(uploadResult)}`,
        step: 'done',
        files: collectFiles(dir),
        uploadResult,
      });
      return;
    }

    setStatus(jobId, { step: 'collecting' });
    const files = collectFiles(dir);
    console.warn(`[${jobId}] Collected ${files.length} source files`);
    setStatus(jobId, {
      files,
      uploadResult,
      status: 'complete',
      step: 'done',
    });
  });

  child.on('error', e => {
    console.warn(`[${jobId}] Process error:`, e.message);
    const files = collectFiles(dir);
    setStatus(jobId, {
      files,
      status: files.length > 0 ? 'complete' : 'error',
      error: e.message,
      step: 'done',
    });
  });
}

http.createServer((q, r) => {
  r.setHeader('Content-Type', 'application/json');
  const url = new URL(q.url, 'http://localhost');

  if (q.method === 'GET' && url.pathname === '/health') {
    return r.end(JSON.stringify({ ok: true, jobs: Object.keys(jobs).length }));
  }

  if (q.method === 'GET' && url.pathname === '/status') {
    const jid = url.searchParams.get('jobId');
    if (!jid || !jobs[jid]) return r.end(JSON.stringify({ error: 'unknown job' }));
    const waitMs = Math.min(parseInt(url.searchParams.get('wait') || '0', 10) || 0, 60_000);
    const sinceStep = url.searchParams.get('sinceStep') || null;
    const sinceStatus = url.searchParams.get('sinceStatus') || null;

    const snapshot = () => {
      const j = jobs[jid];
      return {
        status: j.status,
        step: j.step,
        elapsed: ((Date.now() - j.startTime) / 1000) | 0,
        fileCount: j.files ? j.files.length : 0,
        error: j.error ? j.error.slice(0, 500) : null,
        uploadResult: j.uploadResult || null,
      };
    };

    const immediate = snapshot();
    const changed = (s) => s.status !== sinceStatus || s.step !== sinceStep;
    if (waitMs <= 0 || changed(immediate) || immediate.status !== 'running') {
      return r.end(JSON.stringify(immediate));
    }

    // Long-poll: hold the request open until status/step changes or wait expires.
    // This keeps inbound traffic flowing to the DO, preventing hibernation, AND
    // delivers state changes to the workflow with sub-second latency instead of 30s.
    const start = Date.now();
    const poll = setInterval(() => {
      if (!jobs[jid]) { clearInterval(poll); try { r.end(JSON.stringify({ error: 'job lost' })); } catch {} return; }
      const s = snapshot();
      if (changed(s) || s.status !== 'running' || Date.now() - start >= waitMs) {
        clearInterval(poll);
        try { r.end(JSON.stringify(s)); } catch {}
      }
    }, 1000);
    q.on('close', () => { clearInterval(poll); });
    return;
  }

  if (q.method === 'GET' && url.pathname === '/result') {
    const jid = url.searchParams.get('jobId');
    if (!jid || !jobs[jid]) return r.end(JSON.stringify({ error: 'unknown job' }));
    const j = jobs[jid];
    if (j.status === 'running') {
      return r.end(JSON.stringify({ error: 'still running', status: j.status, step: j.step }));
    }
    try { if (j.dir) fs.rmSync(j.dir, { recursive: true, force: true }); } catch {}
    const result = { status: j.status, files: j.files || [], error: j.error, uploadResult: j.uploadResult || null };
    deleteJob(jid);
    return r.end(JSON.stringify(result));
  }

  if (q.method === 'POST' && url.pathname === '/build-minimal') {
    let b = '';
    q.on('data', c => { b += c; });
    q.on('end', () => {
      const t0 = Date.now();
      try {
        const P = JSON.parse(b || '{}');
        const slug = P.slug || 'minimal-test';
        const dir = `/tmp/build-${slug}-${Date.now()}`;
        fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
        const html = `<!doctype html><html><head><meta charset=utf-8><title>${slug}</title></head><body><h1>Hello from container — ${slug}</h1><p>2+2=${2 + 2}</p><p>Built: ${new Date().toISOString()}</p></body></html>`;
        fs.writeFileSync(path.join(dir, 'dist', 'index.html'), html);

        const envVars = {};
        if (P.envVars && typeof P.envVars === 'object') {
          for (const ek in P.envVars) envVars[ek] = P.envVars[ek];
        }
        const envLines = ['#!/bin/sh'];
        for (const k in envVars) if (envVars[k]) envLines.push(`export ${k}=${JSON.stringify(envVars[k])}`);
        envLines.push('export HOME=/home/cuser');
        envLines.push(`cd ${dir}`);
        envLines.push(`node /home/cuser/upload-to-r2.mjs 2>&1`);
        const sf = `/tmp/run_min_${Date.now()}.sh`;
        fs.writeFileSync(sf, envLines.join('\n'));
        try { x(`chmod +x ${sf}`, { stdio: 'pipe' }); } catch {}
        try { x(`chown -R cuser:cuser ${dir}`, { stdio: 'pipe', shell: true }); } catch {}

        let uploadOk = false, uploadResult = null, stdoutTail = '';
        try {
          stdoutTail = x(`sh ${sf}`, { timeout: 60000, maxBuffer: 5 * 1024 * 1024, shell: true, encoding: 'utf-8' }).slice(-400);
          uploadResult = JSON.parse(fs.readFileSync(path.join(dir, '_upload_result.json'), 'utf-8'));
          uploadOk = uploadResult && uploadResult.uploaded > 0;
        } catch (e) { stdoutTail = (e.message || String(e)).slice(0, 400); }

        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}

        r.writeHead(200);
        r.end(JSON.stringify({
          ok: uploadOk,
          elapsedMs: Date.now() - t0,
          uploadResult,
          stdoutTail,
        }));
      } catch (e) {
        r.writeHead(200);
        r.end(JSON.stringify({ ok: false, error: e.message, elapsedMs: Date.now() - t0 }));
      }
    });
    return;
  }

  if (q.method === 'POST' && url.pathname === '/build-stub') {
    let b = '';
    q.on('data', c => { b += c; });
    q.on('end', () => {
      try {
        const P = JSON.parse(b);
        const jobId = `stub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const callbackUrl = P.callbackUrl || null;
        const callbackSecret = P.callbackSecret || null;
        jobs[jobId] = {
          jobId,
          status: 'running',
          dir: null,
          startTime: Date.now(),
          step: 'stub-init',
          error: null,
          files: null,
          uploadResult: null,
          callbackUrl,
          callbackSecret,
        };
        saveJob(jobId);
        pushStatus(jobId);

        const steps = ['stub-foundation', 'stub-inspect', 'stub-enhance', 'stub-finalize'];
        let i = 0;
        const tick = setInterval(() => {
          if (!jobs[jobId]) { clearInterval(tick); return; }
          if (i < steps.length) {
            setStatus(jobId, { step: steps[i] });
            i++;
          } else {
            setStatus(jobId, {
              status: 'complete',
              step: 'done',
              uploadResult: { uploaded: 3, failed: 0, version: `stub-v-${Date.now()}` },
              files: [{ name: 'index.html', content: '<h1>stub ok</h1>' }],
            });
            clearInterval(tick);
          }
        }, 6000);

        r.writeHead(200);
        r.end(JSON.stringify({ jobId, status: 'started', mode: 'stub' }));
      } catch (e) {
        r.writeHead(200);
        r.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (q.method === 'POST' && url.pathname === '/build') {
    let b = '';
    q.on('data', c => { b += c; });
    q.on('end', () => {
      try {
        const P = JSON.parse(b);
        const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const dir = `/tmp/build-${P.slug || 'site'}-${Date.now()}`;
        fs.mkdirSync(dir, { recursive: true });

        // Lazy refresh — bring skills + template up to origin/main on burst job arrivals.
        maybeRefreshSkills();

        if (P.skipBuild !== true && fs.existsSync(`${TEMPLATE_DIR}/package.json`)) {
          try {
            x(`cp -r ${TEMPLATE_DIR}/* ${dir}/ 2>/dev/null; cp -r ${TEMPLATE_DIR}/.[!.]* ${dir}/ 2>/dev/null; true`, { shell: true, stdio: 'pipe' });
            console.warn(`[${jobId}] Template copied`);
          } catch {}
        }

        // ORDERING (journey defect 2026-08-19): contextFiles MUST be written AFTER
        // the template copy — the template's shipped _brand.json carries
        // {BUSINESS_NAME} placeholders and the cp -r OVERWROTE the workflow's
        // materialized seed on every build. The seed writes last and wins.
        if (P.contextFiles && typeof P.contextFiles === 'object') {
          for (const k in P.contextFiles) {
            fs.writeFileSync(
              path.join(dir, `_${k}`),
              typeof P.contextFiles[k] === 'string' ? P.contextFiles[k] : JSON.stringify(P.contextFiles[k], null, 2)
            );
          }
          console.warn(`[${jobId}] contextFiles written (post-template-copy): ${Object.keys(P.contextFiles).join(', ')}`);
        }

        // MECHANICAL TOKEN SUBSTITUTION — the template ships error pages
        // (offline.html, 500.html, something-went-wrong) with RAW
        // {BUSINESS_NAME}-style tokens the LLM never touches; the brand gate
        // correctly blocks those. Substitute them here, deterministically, in
        // EVERY text file of the build dir — no LLM compliance involved.
        // (Journey 2026-08-19: the gate's error list showed offline/500 pages
        // were the remaining token carriers.)
        try {
          const brandJson = P.contextFiles && P.contextFiles['brand.json'];
          if (brandJson) {
            const brand = JSON.parse(brandJson);
            const biz = brand.business || {};
            const val = (leaf) => (leaf && typeof leaf.$value === 'string' ? leaf.$value : '');
            const TOKENS = {
              '{BUSINESS_NAME}': val(biz.name),
              '{BUSINESS_SHORT_NAME}': val(biz.shortName) || val(biz.name).slice(0, 12),
              '{BUSINESS_TAGLINE}': val(biz.tagline),
              '{BUSINESS_DESCRIPTION}': val(biz.description),
              '{BUSINESS_URL}': val(biz.url),
              '{BUSINESS_EMAIL}': val(biz.email),
              '{BUSINESS_PHONE}': val(biz.phone),
              '{BUSINESS_ADDRESS}': val(biz.address),
              '{BUSINESS_HOURS}': val(biz.hours),
              '{BUSINESS_CLASS}': val(biz.businessClass) || 'organization',
            };
            const TEXT_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.xml', '.txt', '.svg', '.webmanifest', '.md']);
            let replaced = 0;
            const walk = (d) => {
              for (const f of fs.readdirSync(d)) {
                if (f === 'node_modules' || f === '.git' || f === '.claude') continue;
                const fp = path.join(d, f);
                const st = fs.statSync(fp);
                if (st.isDirectory()) { walk(fp); continue; }
                if (!TEXT_EXT.has(path.extname(f).toLowerCase())) continue;
                let content = fs.readFileSync(fp, 'utf-8');
                let changed = false;
                for (const [tok, rep] of Object.entries(TOKENS)) {
                  if (content.includes(tok)) { content = content.split(tok).join(rep); changed = true; replaced++; }
                }
                // Empty-tagline repair — an empty {BUSINESS_TAGLINE} leaves a
                // dangling 'NAME — ' in <title>/og:title (the live 'Cedar Ridge
                // Bakeshop — ' title, journey 2026-08-19). Collapse any
                // substituted ' —  '/' — ' remnant that ends a text node.
                if (content.includes('\u2014')) {
                  content = content
                    .replace(/\u2014\s*(<\/title>|<\/meta>|"\s*\/?>|'\s*\/?>)/gi, '$1')
                    .replace(/\s\u2014\s*$/gm, '');
                  changed = true;
                }
                // Double-dot canonical repair — the LLM writes
                // https://<slug>..projectsites.dev (slug already dot-suffixed
                // in its mental model). Mechanical repair, no LLM compliance.
                if (content.includes('..projectsites.dev')) {
                  content = content.split('..projectsites.dev').join('.projectsites.dev');
                  changed = true; replaced++;
                }
                if (changed) fs.writeFileSync(fp, content);
              }
            };
            walk(dir);
            console.warn(`[${jobId}] Token substitution: ${replaced} replacements in build dir`);
          }
        } catch (subErr) {
          console.warn(`[${jobId}] Token substitution skipped: ${subErr.message}`);
        }

        if (P.claudeMd) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), P.claudeMd);

        try { x(`chown -R cuser:cuser ${dir}`, { stdio: 'pipe', shell: true }); } catch {}

        const envVars = { ANTHROPIC_API_KEY: P._anthropicKey || '' };
        if (P.envVars && typeof P.envVars === 'object') {
          for (const ek in P.envVars) envVars[ek] = P.envVars[ek];
        }
        // DeepSeek-primary path: override Claude Code's Anthropic endpoint with DeepSeek's
        // Anthropic-compatible API. ANTHROPIC_API_KEY stays as fallback if DeepSeek errors.
        if (P._deepseekKey && P._anthropicBaseUrl) {
          envVars.ANTHROPIC_BASE_URL = P._anthropicBaseUrl;
          envVars.ANTHROPIC_AUTH_TOKEN = P._deepseekKey;
          envVars.ANTHROPIC_MODEL = P._anthropicModel || 'deepseek-chat';
        }

        const callbackUrl = P.callbackUrl || envVars.CALLBACK_URL || null;
        const callbackSecret = P.callbackSecret || envVars.CALLBACK_SECRET || null;

        runJob(jobId, dir, P.prompt || '', envVars, P.timeoutMin || 14, callbackUrl, callbackSecret, P.skipBuild === true);
        r.writeHead(200);
        r.end(JSON.stringify({ jobId, status: 'started' }));
      } catch (e) {
        r.writeHead(200);
        r.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  r.writeHead(404);
  r.end(JSON.stringify({ error: 'not found' }));
}).listen(8080, () => console.warn('[container] Ready on :8080'));
