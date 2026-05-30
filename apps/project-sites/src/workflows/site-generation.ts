/**
 * @module workflows/site-generation
 * @description Cloudflare Workflow for AI-powered site generation.
 *
 * Architecture: Heartbeat polling with async container execution.
 * 1. POST /build to container → starts Claude Code async, returns { jobId }
 * 2. Poll GET /status every 30s via tiny workflow steps (no timeout risk)
 * 3. GET /result when complete → upload files to R2 → update D1
 *
 * Claude Code handles EVERYTHING in a single run:
 * - Business research via curl + API keys
 * - Logo discovery / generation
 * - Website building from template (Vite+React+Tailwind)
 * - GPT-4o self-inspection via inspect.js
 * - Iterative fixes
 *
 * @packageDocumentation
 */

import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { Env } from '../types/env.js';
import { DOMAINS, AppError } from '@project-sites/shared';
import { loadBuildFromR2, validateBuild } from '../services/build_validators.js';
import { postAskUser } from '../services/task_inbox.js';
import { appendBuildEvent, type BuildEvent } from '../services/build_events.js';
import { checkBudget, recordSpend } from '../services/build_budget.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { submitSite } from '../../libs/features/search_submit/service.js';

/**
 * Per-variant omit of the auto-injected base fields, distributed across the
 * discriminated union so each variant keeps its own discriminator + payload.
 * A plain `Omit<BuildEvent, ...>` collapses the union and trips excess-property
 * checks; this distributive form preserves the per-`type` shape.
 */
type BuildEventBody = BuildEvent extends infer T
  ? T extends BuildEvent
    ? Omit<T, 'buildId' | 'ts' | 'featureSlug'>
    : never
  : never;

/**
 * Emit an event-sourced build-progress event (best-effort, never throws).
 *
 * Keyed by `siteId` so the cockpit subscribes via `/api/sites/:id/build/*`
 * with the id it already has. Validates via `BuildEventSchema` inside
 * `appendBuildEvent`; a malformed event is swallowed here so build progress
 * never breaks the workflow. See feature module `libs/features/build_progress/`.
 */
async function emitBuildEvent(
  env: Env,
  siteId: string,
  event: BuildEventBody,
): Promise<void> {
  try {
    await appendBuildEvent(env, {
      ...event,
      buildId: siteId,
      ts: new Date().toISOString(),
      featureSlug: 'build_progress',
    } as BuildEvent);
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'workflow',
        message: 'Failed to emit build event',
        siteId,
        type: (event as { type?: string }).type,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Update site status in D1 (best-effort, never throws). */
async function updateSiteStatus(db: D1Database, siteId: string, status: string): Promise<void> {
  try {
    await db
      .prepare("UPDATE sites SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(status, siteId)
      .run();
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'workflow',
        message: 'Failed to update site status',
        siteId,
        status,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Write a workflow audit log entry (best-effort, never throws). */
async function workflowLog(
  db: D1Database,
  orgId: string,
  siteId: string,
  action: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  // Heartbeat actions are pure noise — the audit page filters them out anyway.
  // Don't bother persisting them.
  if (action === 'workflow.heartbeat' || action === 'workflow.stub_heartbeat') {
    return;
  }
  try {
    // Lift a `message` key out of metadata so it lands in the new dedicated
    // column. Falls back to a synthesised one from the action namespace when
    // the caller omitted it.
    const { message: rawMessage, ...restMeta } = metadata as { message?: unknown } & Record<
      string,
      unknown
    >;
    const message =
      typeof rawMessage === 'string' && rawMessage.trim().length > 0
        ? rawMessage.trim().slice(0, 500)
        : action.replace(/^workflow\./, 'Workflow ').replace(/_/g, ' ');
    const enrichedMeta = { ...restMeta, site_id: siteId };
    await db
      .prepare(
        `INSERT INTO audit_logs (id, org_id, actor_id, action, message, target_type, target_id, metadata_json, created_at)
         VALUES (?, ?, NULL, ?, ?, 'site', ?, ?, datetime('now'))`,
      )
      .bind(
        crypto.randomUUID(),
        orgId,
        action,
        message,
        siteId,
        JSON.stringify(enrichedMeta),
      )
      .run();
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'workflow',
        message: 'Failed to write workflow audit log',
        action,
        siteId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Parameters passed when creating a workflow instance. */
export interface SiteGenerationParams {
  siteId: string;
  slug: string;
  businessName: string;
  businessAddress?: string;
  businessPhone?: string;
  businessCategory?: string;
  businessWebsite?: string;
  googlePlaceId?: string;
  additionalContext?: string;
  uploadedAssets?: string[];
  uploadId?: string;
  orgId: string;
  /** Diagnostic: skip Claude Code, write a static index.html, upload to R2. */
  minimalMode?: boolean;
  /** Diagnostic: hit /build-stub (no API cost) to validate KV-callback persistence. */
  stubMode?: boolean;
}

/** Container status response shape. */
interface ContainerStatus {
  status: 'running' | 'complete' | 'error';
  step: string;
  elapsed: number;
  fileCount: number;
  error: string | null;
}

/** Container result response shape. */
interface ContainerResult {
  status: string;
  files: { name: string; content: string }[];
  error?: string;
}

/** KV-backed build status record (written by /api/internal/build-status). */
interface KvBuildRecord {
  jobId: string;
  status: 'running' | 'complete' | 'error';
  step: string;
  elapsed: number;
  fileCount: number;
  error: string | null;
  uploadResult: { uploaded?: number; failed?: number; version?: string } | null;
  lastUpdate: number;
}

/**
 * Build the orchestrator prompt for Claude Code.
 *
 * The orchestrator does NOT implement components itself. It delegates to
 * specialist subagents in parallel via the Task tool, then routes their
 * findings to fix-capable specialists. Universal agents come from
 * megabytespace/claude-skills (synced into ~/.claude/agents/), project agents
 * are layered on top via the Dockerfile COPY.
 *
 * @see ~/.agentskills/15-site-generation/ for methodology
 * @see /home/cuser/.claude/CLAUDE.md for inherited base instructions
 */
function buildPrompt(params: SiteGenerationParams): string {
  const safeName = (params.businessName || 'Business').replace(/[^\w\s\-'.]/g, '').slice(0, 100);
  const category = params.businessCategory || 'general business';
  const address = params.businessAddress || '';
  const phone = params.businessPhone || '';
  const website = params.businessWebsite || '';
  const slug = params.slug;

  return [
    `# Mission: Orchestrate a BREATHTAKINGLY GORGEOUS website for "${safeName}"`,
    '',
    '## Inherited Instructions',
    'Your ~/.claude/CLAUDE.md @-imports the upstream megabytespace/claude-skills CLAUDE.md, AGENTS.md, and _router.md. Follow the orchestrator overlay there. This prompt is the per-build dispatch — the meta surface controls HOW.',
    '',
    '## Skills',
    'Load ~/.agentskills/_router.md, then skill 15 (~/.agentskills/15-site-generation/) IN FULL — research pipeline, media acquisition, build prompts, quality gates, domain features, template system. Skill 15 governs methodology.',
    '',
    '## Business Data',
    `Business: ${safeName}`,
    `Category: ${category}`,
    `Slug: ${slug}`,
    `Site URL: https://${slug}.${DOMAINS.SITES_SUFFIX}`,
    address ? `Address: ${address}` : '',
    phone ? `Phone: ${phone}` : '',
    website ? `Website: ${website}` : '',
    params.googlePlaceId ? `Google Place ID: ${params.googlePlaceId}` : '',
    '',
    '## Context Files (read ALL before delegating)',
    '_research.json, _brand.json, _scraped_content.json, _assets.json, _image_profiles.json, _videos.json, _places.json, _form_data.json, _domain_features.json, _citations.json',
    '',
    '## Architecture: Orchestrator + Parallel Subagents',
    'You are the ORCHESTRATOR. You do not write components yourself — you delegate. Subagents have isolated context windows, so fan-out is free. Issue every parallel Task call in a SINGLE message; sequential dispatch defeats the architecture.',
    '',
    '## Available Subagents',
    'Universal (from megabytespace/claude-skills, synced into ~/.claude/agents/):',
    '- visual-qa — screenshots 6 breakpoints + AI vision. Audit-only.',
    '- seo-auditor — title/meta/H1/JSON-LD/OG/sitemap. Audit-only.',
    '- accessibility-auditor — axe-core WCAG 2.2 AA at 6 breakpoints. Audit-only.',
    '- performance-profiler — Lighthouse + CWV + bundle budgets. Audit-only.',
    '- completeness-checker — Zero Recommendations Gate, final ship verdict.',
    '- content-writer — Emdash brand voice copy, Flesch >= 60.',
    '- security-reviewer — OWASP audit. Audit-only.',
    'Project-specific (~/.claude/agents/ overlay):',
    '- domain-builder — donation/menu/booking/medical/child-safety/local-business sections, NEW files only in src/components/sections/.',
    '- validator-fixer — runs `node /home/cuser/run-validators.mjs dist`, applies surgical fixes for the 13 build_validators violation codes (manifest/asset/image/og/icon/meta/jsonld/html/sitemap/copy/js/lightbox).',
    '',
    '## Orchestration Loop',
    '1. Read every _ context file + skill 15.',
    '2. Customize template (~/template/) with brand colors, logo, content, images. This is the ONLY work you do directly. `cd <build dir>`.',
    '3. `npm run build`. Fix any errors before proceeding.',
    '4. PARALLEL FAN-OUT (single message, multiple Task calls):',
    '   - domain-builder: create section components from _domain_features.json',
    '   - visual-qa: screenshot all routes 6 breakpoints + GPT-4o critique',
    '   - seo-auditor: title/meta/H1/JSON-LD/OG/sitemap audit',
    '   - accessibility-auditor: axe-core 6 breakpoints',
    '   - performance-profiler: Lighthouse + bundle budgets',
    '5. Collect reports. Route to fix-capable agents:',
    '   - Copy/voice issues -> content-writer',
    '   - HTML shell / asset / meta / JSON-LD / sitemap / lightbox / js-chunk fixes -> validator-fixer',
    '   - Accessibility/perf remediation -> validator-fixer (uses audit reports as input; it has Edit)',
    '6. Rebuild. Run validator-fixer until `blockers === 0` from run-validators.mjs.',
    '7. completeness-checker as final gate. If NOT_DONE, loop back to step 4 with its findings.',
    '8. `node /home/cuser/upload-to-r2.mjs` to publish. Env vars CF_API_TOKEN, CF_ACCOUNT_ID, R2_BUCKET_NAME, SITE_SLUG, SITE_VERSION are set.',
    '',
    '## Hard Rules',
    '- Spawn parallel subagents in a SINGLE message with multiple Task calls.',
    '- File partition: domain-builder owns src/components/sections/, validator-fixer owns public/ + index.html shell + vite.config.ts + package.json + sitemap.xml. Never let two agents in one fan-out edit the same file.',
    '- Audit-only agents (visual-qa, seo-auditor, accessibility-auditor, performance-profiler, security-reviewer) MUST NOT be asked to edit. Forward their reports to validator-fixer or content-writer.',
    '- Stripe/Linear/Vercel-level polish. 10+ animations, 15+ images, dark theme by default, WCAG 2.2 AA, 6 breakpoints (375/390/768/1024/1280/1920), zero console errors.',
    '- DONE = blockers === 0 from run-validators.mjs AND completeness-checker returns DONE.',
    '',
    params.additionalContext ? `ADDITIONAL CONTEXT FROM USER: ${params.additionalContext}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Cloudflare Workflow for AI site generation.
 *
 * Uses heartbeat polling pattern:
 * 1. start-build: POST to container, get jobId
 * 2. heartbeat-N: Poll status every 30s (tiny steps, no timeout risk)
 * 3. fetch-result: GET files when complete
 * 4. upload-to-r2: Upload files + update D1
 */
export class SiteGenerationWorkflow extends WorkflowEntrypoint<Env, SiteGenerationParams> {
  override async run(
    event: Readonly<WorkflowEvent<SiteGenerationParams>>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const params = event.payload;
    const env = this.env;
    const startTime = Date.now();

    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.started', {
      slug: params.slug,
      business_name: params.businessName,
      business_address: params.businessAddress ?? null,
      google_place_id: params.googlePlaceId ?? null,
      has_additional_context: !!params.additionalContext,
      message: 'AI build workflow started for ' + params.businessName + ' (' + params.slug + ')',
    });

    await updateSiteStatus(env.DB, params.siteId, 'generating');

    await emitBuildEvent(env, params.siteId, {
      type: 'build.started',
      prompt: `${params.businessName} (${params.slug})`,
    });

    // ── Validate container binding ──
    if (!env.SITE_BUILDER) {
      await updateSiteStatus(env.DB, params.siteId, 'error');
      throw new Error('SITE_BUILDER container not configured');
    }

    // Per-run container ID — each workflow run gets a fresh DO + container.
    // Eliminates stale-image problems and means containers are disposable.
    // State persistence comes from KV-backed callbacks, not container disk.
    const runNonce = Date.now().toString(36);
    const containerName = `${params.slug}-build-${params.siteId.slice(0, 8)}-${runNonce}`;
    const containerId = env.SITE_BUILDER.idFromName(containerName);
    const getContainer = () => env.SITE_BUILDER!.get(containerId);

    // ── Minimal mode: short-circuit, prove container infra ──
    if (params.minimalMode) {
      const minimalRes = await step.do(
        'minimal-build',
        { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '3 minutes' },
        async () => {
          const container = getContainer();
          const res = await container.fetch('http://container/build-minimal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              slug: params.slug,
              envVars: {
                CF_API_TOKEN: typeof env.CF_API_TOKEN === 'string' ? env.CF_API_TOKEN : '',
                CF_ACCOUNT_ID: '84fa0d1b16ff8086dd958c468ce7fd59',
                R2_BUCKET_NAME: 'project-sites-production',
                SITE_SLUG: params.slug,
                SITE_VERSION: `v-${Date.now()}`,
              },
            }),
          });
          if (!res.ok) throw new Error(`build-minimal HTTP ${res.status}`);
          return await res.text();
        },
      );
      const parsed = JSON.parse(minimalRes) as {
        ok: boolean;
        uploadResult?: { uploaded?: number };
        stdoutTail?: string;
        elapsedMs?: number;
      };
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.minimal_done', {
        ok: parsed.ok,
        uploaded: parsed.uploadResult?.uploaded ?? 0,
        elapsedMs: parsed.elapsedMs,
        stdoutTail: parsed.stdoutTail,
      });
      if (parsed.ok) {
        await updateSiteStatus(env.DB, params.siteId, 'published');
        return { ok: true, mode: 'minimal', uploaded: parsed.uploadResult?.uploaded };
      }
      await updateSiteStatus(env.DB, params.siteId, 'error');
      throw new Error('minimal build failed: ' + (parsed.stdoutTail || 'unknown'));
    }

    // ── Stub mode: validate KV-callback persistence end-to-end (no API cost) ──
    if (params.stubMode) {
      const stubJobId = await step.do(
        'stub-start-build',
        {
          retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' },
          timeout: '5 minutes',
        },
        async () => {
          const container = getContainer();
          const cbSecret = env.INTERNAL_BUILD_SECRET || '';
          const cbUrl =
            env.INTERNAL_CALLBACK_URL || `https://${DOMAINS.SITES_BASE}/api/internal/build-status`;
          const res = await container.fetch('http://container/build-stub', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              slug: params.slug,
              callbackUrl: cbUrl,
              callbackSecret: cbSecret,
            }),
          });
          if (!res.ok) throw new Error(`stub start failed: ${res.status}`);
          const r = (await res.json()) as { jobId?: string; error?: string };
          if (r.error || !r.jobId) throw new Error(`stub start error: ${r.error ?? 'no jobId'}`);
          return r.jobId;
        },
      );

      let stubFinal: KvBuildRecord | null = null;
      for (let i = 0; i < 30; i++) {
        const status = await step.do(
          `stub-heartbeat-${i}`,
          {
            retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
            timeout: '1 minute',
          },
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 6_000));
            const raw = await env.CACHE_KV.get(`build:${stubJobId}`);
            return raw || JSON.stringify({ _missing: true });
          },
        );
        const parsed = JSON.parse(status) as KvBuildRecord & { _missing?: boolean };
        if (parsed._missing) continue;
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.stub_heartbeat', {
          poll: i,
          status: parsed.status,
          step: parsed.step,
          message: `stub poll ${i}: ${parsed.status} ${parsed.step}`,
        });
        if (parsed.status !== 'running') {
          stubFinal = parsed;
          break;
        }
      }
      if (!stubFinal || stubFinal.status !== 'complete') {
        throw new Error(`stub mode failed: ${JSON.stringify(stubFinal)}`);
      }
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.stub_done', {
        jobId: stubJobId,
        uploadResult: stubFinal.uploadResult,
        message: 'KV-callback persistence proof: complete',
      });
      return { ok: true, mode: 'stub', jobId: stubJobId, kvFinal: stubFinal };
    }

    // ── Move uploaded assets (if any) ──
    let assetManifest: string[] = params.uploadedAssets || [];
    if (params.uploadId) {
      try {
        const moved = await step.do(
          'move-uploaded-assets',
          {
            retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
            timeout: '1 minute',
          },
          async () => {
            const prefix = `uploads/${params.uploadId}/`;
            const listed = await env.SITES_BUCKET.list({ prefix, limit: 50 });
            const movedKeys: string[] = [];
            for (const obj of listed.objects) {
              const relativePath = obj.key.replace(prefix, '');
              const destKey = `sites/${params.slug}/assets/${relativePath}`;
              const data = await env.SITES_BUCKET.get(obj.key);
              if (data) {
                await env.SITES_BUCKET.put(destKey, await data.arrayBuffer(), {
                  httpMetadata: data.httpMetadata,
                });
                movedKeys.push(destKey);
              }
            }
            return JSON.stringify(movedKeys);
          },
        );
        assetManifest = [...assetManifest, ...JSON.parse(moved)];
      } catch {
        // Non-blocking — continue without uploaded assets
      }
    }

    // ── Build the prompt + context ──
    const prompt = buildPrompt(params);

    // Mint version inside step.do so workflow replay returns the cached value.
    // Without this, line `new Date().toISOString()` re-runs on replay and produces
    // a fresh timestamp — finalize-build then writes the wrong R2 prefix to D1
    // and the live site 404s while R2 has files at the *original* version path.
    const version = await step.do(
      'mint-version',
      { retries: { limit: 0, delay: '1 second' }, timeout: '30 seconds' },
      async () => new Date().toISOString().replace(/[:.]/g, '-'),
    );
    const envVars: Record<string, string> = {
      // R2 upload credentials (used by /home/cuser/upload-to-r2.mjs)
      CF_API_TOKEN: typeof env.CF_API_TOKEN === 'string' ? env.CF_API_TOKEN : '',
      CF_ACCOUNT_ID: '84fa0d1b16ff8086dd958c468ce7fd59',
      R2_BUCKET_NAME: 'project-sites-production',
      SITE_SLUG: params.slug,
      SITE_VERSION: version,
    };
    const keysToCopy: (keyof Env)[] = [
      'OPENAI_API_KEY',
      'UNSPLASH_ACCESS_KEY',
      'PEXELS_API_KEY',
      'PIXABAY_API_KEY',
      'YOUTUBE_API_KEY',
      'LOGODEV_TOKEN',
      'BRANDFETCH_API_KEY',
      'FOURSQUARE_API_KEY',
      'YELP_API_KEY',
      'GOOGLE_PLACES_API_KEY',
      'GOOGLE_CSE_KEY',
      'GOOGLE_CSE_CX',
      'IDEOGRAM_API_KEY',
      'REPLICATE_API_TOKEN',
      'STABILITY_API_KEY',
      'GOOGLE_MAPS_API_KEY',
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
      'MAPBOX_ACCESS_TOKEN',
    ];
    for (const key of keysToCopy) {
      const val = env[key];
      if (typeof val === 'string' && val) envVars[key] = val;
    }

    // Context files: asset manifest + any uploaded asset URLs
    const contextFiles: Record<string, string> = {};
    if (assetManifest.length > 0) {
      const assetUrls = assetManifest.map(
        (key) => `https://${params.slug}.${DOMAINS.SITES_SUFFIX}/assets/${key.split('/').pop()}`,
      );
      contextFiles['assets.json'] = JSON.stringify(
        { keys: assetManifest, urls: assetUrls },
        null,
        2,
      );
    }

    // ── Optional: Human-in-the-loop logo approval (Workflows v2 elicitation) ──
    //
    // CANONICAL human-in-loop pattern for future workflows. Pauses the workflow
    // mid-run, surfaces a task in the admin tray via `ai_task_inbox`, and
    // resumes when the user clicks an option (or auto-defaults on timeout).
    //
    // ## Activation
    // Gated on `env.SITE_GEN_REQUIRES_LOGO_APPROVAL === 'true'`. When unset
    // (the default), the step is skipped entirely — full backwards
    // compatibility. Flip the env var to start gating builds on logo review.
    //
    // ## How it pauses
    // 1. `postAskUser` writes a row to `ai_task_inbox` with `task_kind`,
    //    `prompt`, `options[]`, `defaultChoice`, and a 30-minute expiry.
    // 2. `step.waitForEvent(\`task-resolved-${id}\`)` parks the workflow
    //    instance until the matching event fires OR the step timeout hits.
    // 3. The admin tray polls `listOpenTasks(env, orgId)`; user clicks an
    //    option; the route handler calls `resolveTask(env, id, {choice})`
    //    which (a) marks the row resolved and (b) fans the resolution into
    //    the workflow via `env.SITE_GENERATION.sendEvent`.
    //
    // ## How it resumes
    // The `waitForEvent` resolves with the resolution payload. We branch on
    // `choice`:
    //  - `Approve` → fall through to `start-build` unchanged.
    //  - `Regenerate` → loop back to logo regeneration (left as a TODO in
    //    this example — real impl re-fires the `generate-logo` step).
    //  - `Use my own` → halt the workflow; user uploads via the admin UI,
    //    which re-creates the workflow with the new asset already in R2.
    //
    // ## Auto-defaulting
    // If the user doesn't respond in 30 min, the `applyExpiredDefaults`
    // sweep cron auto-resolves to `defaultChoice` and the workflow continues
    // — `Approve` is chosen here as the failsafe.
    //
    // @see services/task_inbox.ts postAskUser / resolveTask
    // @see migrations/0039_task_inbox.sql
    if (
      (env as unknown as { SITE_GEN_REQUIRES_LOGO_APPROVAL?: string })
        .SITE_GEN_REQUIRES_LOGO_APPROVAL === 'true'
    ) {
      // Sub-step 1: post the elicitation task. Kept inside step.do so the
      // ai_task_inbox INSERT replays deterministically on workflow restart.
      const elicitationTaskId = await step.do(
        'logo-approval-post',
        {
          retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
          timeout: '30 seconds',
        },
        async () => {
          const { id } = await postAskUser(env, {
            orgId: params.orgId,
            workflowInstanceId: event.instanceId,
            taskKind: 'approve_logo',
            prompt:
              `Approve the generated logo for ${params.businessName}? ` +
              'Choose Approve to continue the build, Regenerate to try a new logo, ' +
              'or Use my own to upload a custom logo via the admin UI.',
            options: ['Approve', 'Regenerate', 'Use my own'],
            defaultChoice: 'Approve',
            timeoutMs: 30 * 60 * 1000,
            createdBy: params.orgId,
          });
          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.logo_approval_posted', {
            task_id: id,
            message: 'Logo approval requested — workflow paused waiting for user',
          });
          return id;
        },
      );

      // Sub-step 2: park the workflow on the matching `task-resolved-${id}`
      // event. `step.waitForEvent` is the Workflows v2 primitive — survives
      // hibernation, retries, and worker restarts. On timeout it throws, and
      // we fall back to the default `Approve` choice so the build never
      // wedges indefinitely (the `applyExpiredDefaults` cron also auto-
      // resolves the row with `defaultChoice` for UI consistency).
      let approvalChoice: string = 'Approve';
      try {
        const resolution = await step.waitForEvent<{ choice?: string }>(
          `task-resolved-${elicitationTaskId}`,
          {
            type: `task-resolved-${elicitationTaskId}`,
            timeout: '30 minutes',
          },
        );
        approvalChoice = resolution?.payload?.choice ?? 'Approve';
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            service: 'workflow',
            step: 'logo-approval-wait',
            error: err instanceof Error ? err.message : String(err),
            message: 'logo approval elicitation timed out — defaulting to Approve',
          }),
        );
      }

      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.logo_approval_resolved', {
        task_id: elicitationTaskId,
        choice: approvalChoice,
        message: `Logo approval resolved: ${approvalChoice}`,
      });

      // Branch on resolution. Approve = fall through. Regenerate = re-fire
      // the logo generation pipeline (left as a follow-up — the orchestrator
      // prompt already covers regeneration on its next pass). Use-my-own =
      // halt cleanly; admin UI re-creates the workflow once asset uploaded.
      if (approvalChoice === 'Use my own') {
        await updateSiteStatus(env.DB, params.siteId, 'collecting');
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.halted_for_upload', {
          message: 'Build halted — awaiting custom-logo upload from user',
        });
        return {
          siteId: params.siteId,
          slug: params.slug,
          status: 'halted',
          reason: 'awaiting_user_upload',
        };
      }
      // 'Regenerate' falls through with the orchestrator prompt picking up the
      // signal via _research.json on the next pass. 'Approve' falls through.
    }

    // ── Budget killswitch: cap AI spend per org BEFORE the expensive build ──
    // Feature `token_burn_meter` (idea #13). Flag-gated so unmetered builds run
    // exactly as before when the flag is off. When monthly spend hits the plan
    // cap, throw a friendly AppError pre-build so a runaway org never burns past
    // its budget. See services/build_budget.ts + libs/features/token_burn_meter/.
    await step.do(
      'budget-killswitch',
      { retries: { limit: 1, delay: '2 seconds', backoff: 'exponential' }, timeout: '30 seconds' },
      async () => {
        const flagOn = await isFlagOn(env, 'token_burn_meter', { orgId: params.orgId }).catch(
          () => false,
        );
        if (!flagOn) return JSON.stringify({ skipped: true, reason: 'flag_off' });

        const sub = (await env.DB.prepare(
          'SELECT plan, status FROM subscriptions WHERE org_id = ? AND deleted_at IS NULL',
        )
          .bind(params.orgId)
          .first()
          .catch(() => null)) as { plan: string; status: string } | null;
        const plan = sub?.plan === 'paid' && sub.status === 'active' ? 'paid' : 'free';

        const meter = await checkBudget(env.DB, params.orgId, plan);
        if (!meter.allowed) {
          const friendly =
            `AI budget exhausted for this month — $${meter.spentUsd.toFixed(2)} of ` +
            `$${meter.capUsd === Infinity ? '∞' : meter.capUsd.toFixed(2)} used. ` +
            'Upgrade your plan or wait for the monthly reset to build again.';
          await updateSiteStatus(env.DB, params.siteId, 'error');
          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.budget_blocked', {
            spent_usd: meter.spentUsd,
            cap_usd: meter.capUsd,
            pct: meter.pct,
            message: friendly,
          });
          await emitBuildEvent(env, params.siteId, {
            type: 'build.failed',
            reason: friendly,
            code: 'budget_exhausted',
          });
          throw new AppError({ code: 'FORBIDDEN', message: friendly, statusCode: 403 });
        }

        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.budget_ok', {
          spent_usd: meter.spentUsd,
          cap_usd: meter.capUsd,
          remaining_usd: meter.remainingUsd,
          pct: meter.pct,
          message: `Budget OK: $${meter.spentUsd.toFixed(2)}/$${meter.capUsd === Infinity ? '∞' : meter.capUsd.toFixed(2)} (${meter.pct.toFixed(0)}%)`,
        });
        return JSON.stringify({ allowed: true, plan, pct: meter.pct });
      },
    );

    // ── Step 1: Start build (POST to container) ──
    // Use workers.dev URL to bypass zone-level CF managed challenge intercepting POSTs.
    const callbackSecret = env.INTERNAL_BUILD_SECRET || '';
    const callbackUrl =
      env.INTERNAL_CALLBACK_URL || `https://${DOMAINS.SITES_BASE}/api/internal/build-status`;

    const jobId = await step.do(
      'start-build',
      {
        retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' },
        timeout: '5 minutes',
      },
      async () => {
        const container = getContainer();

        const payload = {
          slug: params.slug,
          _anthropicKey: env.ANTHROPIC_API_KEY || '',
          prompt,
          contextFiles,
          envVars,
          timeoutMin: 45,
          callbackUrl,
          callbackSecret,
        };

        const res = await container.fetch('http://container/build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => 'Unknown');
          throw new Error(`Container start failed: ${res.status} ${errText}`);
        }

        const result = (await res.json()) as { jobId?: string; error?: string };
        if (result.error) throw new Error(`Container start error: ${result.error}`);
        if (!result.jobId) throw new Error('Container did not return jobId');

        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.build_started', {
          jobId: result.jobId,
          prompt_length: prompt.length,
          env_vars_count: Object.keys(envVars).length,
          message: `Claude Code build started (${Math.round(prompt.length / 1024)}KB prompt, ${Object.keys(envVars).length} API keys)`,
        });

        await emitBuildEvent(env, params.siteId, {
          type: 'agent.started',
          agent: 'orchestrator',
          step: 'container-build',
        });

        return result.jobId;
      },
    );

    // ── Step 2: Heartbeat loop polls container directly with KV fallback ──
    // Each heartbeat sleeps 30s, then hits the container's /status. The inbound
    // HTTP traffic on a regular cadence keeps the DO warm (preventing the idle
    // hibernation that froze the previous KV-only heartbeat at the 2-min mark).
    // The container also runs its own 60s self-keepalive (/health). KV is the
    // durable fallback if the container fetch errors (DO replaced, etc).
    const MAX_POLLS = 120;
    const POLL_INTERVAL_MS = 30_000;
    const STALE_THRESHOLD_MS = 8 * 60_000;

    let finalStatus: ContainerStatus | null = null;
    let kvFinalRecord: KvBuildRecord | null = null;
    let lastFreshAt = Date.now();
    let lastSeenStatus: string | null = null;
    let lastSeenStep: string | null = null;

    for (let i = 0; i < MAX_POLLS; i++) {
      const result = await step.do(
        `heartbeat-${i}`,
        {
          retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
          timeout: '1 minute',
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

          // Primary: short-poll the container directly. Inbound HTTP keeps DO warm.
          try {
            const container = getContainer();
            const res = await container.fetch(`http://container/status?jobId=${jobId}`, {
              method: 'GET',
            });
            if (res.ok) {
              const body = await res.text();
              return JSON.stringify({ _src: 'container', body });
            }
          } catch {
            // fall through to KV fallback
          }

          // Fallback: KV record (set by container's pushStatus callback). Survives DO replacement.
          const raw = await env.CACHE_KV.get(`build:${jobId}`);
          if (!raw) return JSON.stringify({ _src: 'kv', _missing: true });
          return JSON.stringify({ _src: 'kv', body: raw });
        },
      );

      const wrap = JSON.parse(result) as { _src: string; _missing?: boolean; body?: string };

      if (wrap._missing) {
        if (i >= 4) {
          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.kv_no_status', {
            poll: i,
            message: 'No build status in KV after 2min — container failed to start',
          });
          finalStatus = {
            status: 'error',
            step: 'no-callback',
            elapsed: 0,
            fileCount: 0,
            error: 'Container never reported status to KV',
          };
          break;
        }
        continue;
      }

      const parsed = JSON.parse(wrap.body || '{}') as KvBuildRecord &
        ContainerStatus & { error?: string | null };

      const TERMINAL = new Set(['complete', 'error']);
      const unknownJob = wrap._src === 'container' && parsed.status === undefined;

      // Container DO restart → /status returns {error:'unknown job'} with no `status` field.
      // First try KV (terminal record may exist from before the DO died). If KV is empty too,
      // the job is unrecoverable — break immediately instead of polling for 8 more minutes.
      if (unknownJob) {
        const raw = await env.CACHE_KV.get(`build:${jobId}`);
        if (raw) {
          const kv = JSON.parse(raw) as KvBuildRecord;
          if (TERMINAL.has(kv.status)) {
            finalStatus = {
              status: kv.status,
              step: kv.step,
              elapsed: kv.elapsed,
              fileCount: kv.fileCount,
              error: kv.error || null,
            };
            kvFinalRecord = kv;
            break;
          }
        }
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.container_unknown_job', {
          poll: i,
          message: 'Container DO lost job and KV has no terminal record — abandoning build',
        });
        finalStatus = {
          status: 'error',
          step: 'unknown-job',
          elapsed: 0,
          fileCount: 0,
          error: 'Container DO evicted before build completed (job state lost)',
        };
        break;
      }

      // Container /status returns plain ContainerStatus (no lastUpdate). For wall-clock
      // freshness, treat every successful container response as fresh; KV path uses lastUpdate.
      const isFromContainer = wrap._src === 'container';
      const ageMs = isFromContainer
        ? Date.now() - lastFreshAt
        : Date.now() - ((parsed as KvBuildRecord).lastUpdate || 0);

      const stateChanged = parsed.status !== lastSeenStatus || parsed.step !== lastSeenStep;
      // Only bump freshness on responses with a real status; unknown-job (handled above)
      // would otherwise mask staleness forever.
      if (isFromContainer && parsed.status) lastFreshAt = Date.now();
      lastSeenStatus = parsed.status || lastSeenStatus;
      lastSeenStep = parsed.step || lastSeenStep;

      if (i % 5 === 0 || stateChanged) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.heartbeat', {
          poll: i,
          src: wrap._src,
          status: parsed.status,
          step: parsed.step,
          elapsed_seconds: parsed.elapsed,
          file_count: parsed.fileCount,
          age_ms: ageMs,
          message: `heartbeat ${i} (${wrap._src}): status=${parsed.status}, step=${parsed.step}, elapsed=${parsed.elapsed}s`,
        });
      }

      // Surface phase transitions to the event stream — only on state change
      // so the cockpit gets a clean phase log, not 120 polls of noise.
      if (stateChanged && parsed.step) {
        await emitBuildEvent(env, params.siteId, {
          type: 'agent.started',
          agent: 'container',
          step: parsed.step,
        });
      }

      if (TERMINAL.has(String(parsed.status))) {
        finalStatus = {
          status: parsed.status,
          step: parsed.step,
          elapsed: parsed.elapsed,
          fileCount: parsed.fileCount,
          error: parsed.error || null,
        };
        // Both KV records and container /status responses include uploadResult.
        // Capture it from whichever source delivered the terminal status.
        kvFinalRecord = parsed as KvBuildRecord;
        break;
      }

      if (ageMs > STALE_THRESHOLD_MS) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.container_stale', {
          poll: i,
          age_ms: ageMs,
          message: `Status stale ${(ageMs / 1000) | 0}s — container died without reporting completion`,
        });
        finalStatus = {
          status: 'error',
          step: 'stale',
          elapsed: parsed.elapsed,
          fileCount: parsed.fileCount,
          error: 'Container stopped reporting status (stale)',
        };
        break;
      }
    }

    if (!finalStatus) {
      await updateSiteStatus(env.DB, params.siteId, 'error');
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.timeout', {
        message: `Build timed out after ${MAX_POLLS} polls (${MAX_POLLS * 30}s)`,
      });
      await emitBuildEvent(env, params.siteId, {
        type: 'build.failed',
        reason: `Build timed out after ${MAX_POLLS} heartbeat polls`,
        code: 'timeout',
      });
      throw new Error('Build timed out after ' + MAX_POLLS + ' heartbeat polls');
    }

    if (finalStatus.status === 'error') {
      await updateSiteStatus(env.DB, params.siteId, 'error');
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.build_error', {
        error: finalStatus.error,
        elapsed_seconds: finalStatus.elapsed,
        message: `Build failed after ${finalStatus.elapsed}s: ${finalStatus.error}`,
      });
      await emitBuildEvent(env, params.siteId, {
        type: 'build.failed',
        reason: finalStatus.error || 'unknown error',
        code: finalStatus.step || 'build_failed',
      });
      throw new Error('Build failed: ' + (finalStatus.error || 'unknown error'));
    }

    // ── Step 3: Finalize — verify R2 upload succeeded via KV record ──
    const filesJson = await step.do(
      'finalize-build',
      {
        retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
        timeout: '2 minutes',
      },
      async () => {
        const fileCount = finalStatus!.fileCount || 0;
        // Prefer in-memory record from heartbeat poll. If missing or empty, re-read
        // KV — the container's HMAC-protected callback always writes the canonical
        // uploadResult to `build:${jobId}` regardless of which path saw terminal status first.
        let uploadResult = kvFinalRecord?.uploadResult || null;
        if (!uploadResult || !uploadResult.uploaded) {
          try {
            const raw = await env.CACHE_KV.get(`build:${jobId}`);
            if (raw) {
              const fresh = JSON.parse(raw) as KvBuildRecord;
              if (fresh?.uploadResult) uploadResult = fresh.uploadResult;
            }
          } catch {}
        }
        const uploadCount = uploadResult?.uploaded || 0;

        if (uploadCount === 0) {
          await updateSiteStatus(env.DB, params.siteId, 'error');
          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.upload_failed', {
            file_count: fileCount,
            upload_result: uploadResult,
            message: `R2 upload failed — refusing to mark published. uploaded=${uploadCount} failed=${uploadResult?.failed ?? 'n/a'}`,
          });
          await emitBuildEvent(env, params.siteId, {
            type: 'build.failed',
            reason: `R2 upload produced 0 files (failed=${uploadResult?.failed ?? 'n/a'})`,
            code: 'upload_failed',
          });
          throw new Error(
            `R2 upload produced 0 files (uploadResult=${JSON.stringify(uploadResult)})`,
          );
        }

        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.build_complete', {
          file_count: fileCount,
          upload_count: uploadCount,
          upload_failed: uploadResult?.failed || 0,
          message: `Build complete: ${fileCount} source files, ${uploadCount} files uploaded to R2`,
        });

        // Update D1 status to published
        await env.DB.prepare(
          "UPDATE sites SET status = 'published', current_build_version = ?, updated_at = datetime('now') WHERE id = ?",
        )
          .bind(version, params.siteId)
          .run();

        // Create initial snapshot
        await env.DB.prepare(
          "INSERT OR IGNORE INTO site_snapshots (id, site_id, snapshot_name, build_version, description) VALUES (?, ?, 'initial', ?, 'First published version')",
        )
          .bind(crypto.randomUUID(), params.siteId, version)
          .run();

        await emitBuildEvent(env, params.siteId, {
          type: 'preview.updated',
          url: `https://${params.slug}.${DOMAINS.SITES_SUFFIX}`,
        });

        // Best-effort: auto-submit the freshly-published site to search + AI
        // engines (IndexNow → Bing+Yandex, Bing+Google sitemap pings). Idea #3.
        // Flag-gated so it's a no-op when search_engine_submit is off; awaited
        // but error-swallowed so a submission failure NEVER fails the publish.
        try {
          const submitOn = await isFlagOn(env, 'search_engine_submit', {
            orgId: params.orgId,
          }).catch(() => false);
          if (submitOn) {
            await submitSite(env, params.siteId).catch(() => []);
          }
        } catch {
          // search-engine submission must never break the publish path
        }

        // Best-effort: accumulate the build's AI spend into the token-burn meter.
        // The container build's exact token usage isn't surfaced here yet, so we
        // record a conservative per-build estimate keyed off elapsed time. Never
        // throws; flag-gated so it's a no-op when token_burn_meter is off.
        try {
          const meterOn = await isFlagOn(env, 'token_burn_meter', { orgId: params.orgId }).catch(
            () => false,
          );
          if (meterOn) {
            const elapsedSec = finalStatus!.elapsed || 0;
            // Rough container-build estimate: ~$0.01 per build-minute, $1 floor.
            const estUsd = Math.max(1, (elapsedSec / 60) * 0.01);
            await recordSpend(env, params.orgId, {
              tokensIn: 0,
              tokensOut: 0,
              model: 'container-build',
              usd: estUsd,
              siteId: params.siteId,
            });
          }
        } catch {
          // metering must never break the build
        }

        return JSON.stringify({ fileCount, version });
      },
    );

    // ── Step 3.5: Build validators (report mode — log to D1, never throw) ──
    // Enforces audit recommendations: asset existence, JSON-LD count, image format,
    // og-image quality, apple-touch-icon, meta lengths, H1 in shell, sitemap lastmod,
    // banned slop words, JS chunk size, lightbox presence, required well-known files.
    // See services/build_validators.ts and skill 15 quality-gates.md.
    await step.do(
      'validate-build',
      {
        retries: { limit: 1, delay: '5 seconds', backoff: 'exponential' },
        timeout: '2 minutes',
      },
      async () => {
        try {
          await emitBuildEvent(env, params.siteId, {
            type: 'tests.started',
            runner: 'build_validators',
          });
          const prefix = `sites/${params.slug}/${version}/`;
          const files = await loadBuildFromR2(env.SITES_BUCKET, prefix);
          const report = validateBuild(files);
          await emitBuildEvent(env, params.siteId, {
            type: 'tests.completed',
            passed: report.ok ? 1 : 0,
            failed: report.errors.length,
          });
          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.build_validation', {
            ok: report.ok,
            file_count: files.length,
            errors: report.errors.slice(0, 50),
            warnings: report.warnings.slice(0, 50),
            summary: report.summary,
            message: `Build validation: ${report.summary}`,
          });
          return JSON.stringify({ ok: report.ok, summary: report.summary });
        } catch (err) {
          await workflowLog(
            env.DB,
            params.orgId,
            params.siteId,
            'workflow.build_validation_error',
            {
              error: err instanceof Error ? err.message : String(err),
              message: 'Build validation skipped due to error',
            },
          );
          return JSON.stringify({ skipped: true });
        }
      },
    );

    // ── Step 4: Final visual inspection (non-blocking) ──
    await step.do(
      'visual-inspection',
      {
        retries: { limit: 1, delay: '5 seconds', backoff: 'exponential' },
        timeout: '2 minutes',
      },
      async () => {
        if (!env.OPENAI_API_KEY) return JSON.stringify({ skipped: true, reason: 'no_openai_key' });
        try {
          const ssUrl = `https://api.microlink.io/?url=https://${params.slug}.${DOMAINS.SITES_SUFFIX}&screenshot=true&meta=false&embed=screenshot.url`;
          const ssRes = await fetch(ssUrl);
          if (!ssRes.ok) return JSON.stringify({ skipped: true, reason: 'screenshot_failed' });
          const ssData = (await ssRes.json()) as { data?: { screenshot?: { url?: string } } };
          const imageUrl = ssData?.data?.screenshot?.url;
          if (!imageUrl) return JSON.stringify({ skipped: true, reason: 'no_screenshot_url' });

          const critiqueRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: 'Score this website screenshot 1-10 on visual quality. List top 5 issues. Return JSON: { score: number, issues: string[], logo_visible: boolean, brand_colors_correct: boolean }',
                    },
                    { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
                  ],
                },
              ],
              max_tokens: 500,
              temperature: 0.2,
            }),
          });
          if (!critiqueRes.ok) return JSON.stringify({ skipped: true, reason: 'gpt4o_failed' });
          const critiqueData = (await critiqueRes.json()) as {
            choices: { message: { content: string } }[];
          };
          const raw = critiqueData.choices?.[0]?.message?.content || '';
          const cleaned = raw
            .replace(/```json\n?/g, '')
            .replace(/```/g, '')
            .trim();
          const parsed = JSON.parse(cleaned) as { score?: number; issues?: string[] };

          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.visual_inspection', {
            score: parsed.score,
            issues: parsed.issues,
            screenshot_url: imageUrl,
            message: `Visual inspection: score=${parsed.score}/10, ${(parsed.issues || []).length} issues`,
          });

          return JSON.stringify(parsed);
        } catch {
          return JSON.stringify({ skipped: true, reason: 'error' });
        }
      },
    );

    // ── Step 4.5: Benchmark + retrospective (non-blocking, $0 default) ──
    // Tier 1 (programmatic) + Tier 2 (PSI) both free. Retrospective LLM call
    // (~$0.001 Haiku) only fires when build regressed or score < 0.85.
    // See services/benchmark.ts and services/retrospective.ts.
    await step.do(
      'benchmark-and-learn',
      {
        retries: { limit: 1, delay: '10 seconds', backoff: 'exponential' },
        timeout: '3 minutes',
      },
      async () => {
        try {
          const { runBenchmarks } = await import('../services/benchmark.js');
          const { buildRetrospective, recordRetrospectivePath } =
            await import('../services/retrospective.js');

          const prevRow = (await env.DB.prepare(
            'SELECT id, mean_score FROM site_benchmarks WHERE site_id = ? ORDER BY run_at DESC LIMIT 1',
          )
            .bind(params.siteId)
            .first()) as { id: string; mean_score: number | null } | null;

          const result = await runBenchmarks({
            env,
            siteId: params.siteId,
            slug: params.slug,
            siteUrl: `https://${params.slug}.${DOMAINS.SITES_SUFFIX}`,
            previousMeanScore: prevRow?.mean_score ?? null,
          });

          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.benchmark', {
            mean_score: result.meanScore,
            programmatic_score: result.programmatic.score,
            psi_perf: result.psi?.performance ?? null,
            regressed: result.regressedFromPrevious,
            banned_words: result.programmatic.bannedWordHits,
            message: `Benchmark: mean=${result.meanScore.toFixed(2)} regressed=${result.regressedFromPrevious}`,
          });

          const retro = await buildRetrospective({ env, current: result });
          if (!retro.generated) {
            await workflowLog(
              env.DB,
              params.orgId,
              params.siteId,
              'workflow.retrospective_skipped',
              {
                reason: retro.skipReason,
              },
            );
            return JSON.stringify({ benchmark: result.meanScore, retrospective: 'skipped' });
          }

          const retroRow = (await env.DB.prepare(
            'SELECT id FROM site_benchmarks WHERE site_id = ? ORDER BY run_at DESC LIMIT 1',
          )
            .bind(params.siteId)
            .first()) as { id: string } | null;

          const retroPath = `retrospectives/${retro.filename}`;
          await env.SITES_BUCKET.put(retroPath, retro.markdown, {
            httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
          });

          if (retroRow) await recordRetrospectivePath(env, retroRow.id, retroPath);

          await workflowLog(
            env.DB,
            params.orgId,
            params.siteId,
            'workflow.retrospective_generated',
            {
              path: retroPath,
              filename: retro.filename,
              message: `Retrospective written to ${retroPath}`,
            },
          );

          return JSON.stringify({ benchmark: result.meanScore, retrospective: retroPath });
        } catch (err) {
          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.benchmark_error', {
            error: err instanceof Error ? err.message : String(err),
            message: 'Benchmark/retrospective skipped due to error',
          });
          return JSON.stringify({ skipped: true });
        }
      },
    );

    // ── Step 5: Send notification ──
    await step.do(
      'notify',
      {
        retries: { limit: 1, delay: '5 seconds', backoff: 'exponential' },
        timeout: '30 seconds',
      },
      async () => {
        try {
          // Look up user email for notification
          const siteRow = (await env.DB.prepare(
            'SELECT o.id as org_id FROM sites s JOIN orgs o ON s.org_id = o.id WHERE s.id = ?',
          )
            .bind(params.siteId)
            .first()) as { org_id: string } | null;
          if (siteRow) {
            const userRow = (await env.DB.prepare(
              'SELECT u.email FROM memberships m JOIN users u ON m.user_id = u.id WHERE m.org_id = ? LIMIT 1',
            )
              .bind(siteRow.org_id)
              .first()) as { email: string } | null;
            if (userRow?.email) {
              const { notifySiteBuilt } = await import('../services/notifications.js');
              await notifySiteBuilt(env, {
                email: userRow.email,
                siteName: params.businessName,
                slug: params.slug,
                siteUrl: `https://${params.slug}.${DOMAINS.SITES_SUFFIX}`,
                version: (JSON.parse(filesJson) as { version: string }).version,
              });
            }
          }
        } catch {
          // Non-critical
        }
        return 'ok';
      },
    );

    const totalSeconds = Math.round((Date.now() - startTime) / 1000);
    const result = JSON.parse(filesJson) as { fileCount: number; version: string };

    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.complete', {
      slug: params.slug,
      url: `https://${params.slug}.${DOMAINS.SITES_SUFFIX}`,
      total_seconds: totalSeconds,
      files: result.fileCount,
      version: result.version,
      message: `Published ${params.businessName} with ${result.fileCount} files in ${totalSeconds}s`,
    });

    await emitBuildEvent(env, params.siteId, {
      type: 'publish.completed',
      fileCount: result.fileCount,
      version: result.version,
    });

    return {
      siteId: params.siteId,
      slug: params.slug,
      status: 'published',
      files: result.fileCount,
      elapsed_seconds: totalSeconds,
    };
  }
}
