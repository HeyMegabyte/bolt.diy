/**
 * @module libs/features/site_github/handlers
 *
 * @description
 * Hono routes for a site's **GitHub OAuth backup** — the owner-tapped "Connect
 * GitHub" flow that mirrors a site's current build to a private GitHub repo via
 * a snapshot-scoped branch + Pull Request. No token paste and no repo name: the
 * owner consents on github.com, comes back to `/admin/github`, and the repo name
 * auto-derives from the site slug (`{slug}-projectsites-dev`). Every route is
 * org-scoped via `c.get('orgId')` and guards site ownership through
 * `requireOwnedSite` (404, never 403, on a missing/foreign site so cross-org
 * sites never leak). This is a SITE-SCOPED GitHub OAuth (repo backup) — it does
 * NOT touch the app auth middleware.
 *
 * | Method | Path                                | Auth  | Purpose                                              |
 * | ------ | ----------------------------------- | ----- | --------------------------------------------------- |
 * | GET    | /api/sites/:id/github/status        | orgId | Read connection state + last-backup stats           |
 * | GET    | /api/sites/:id/github/connect       | orgId | Mint CSRF state + return GitHub OAuth authorize URL |
 * | GET    | /api/sites/:id/github/callback      | orgId | Exchange code → ensure repo → upsert integration    |
 * | POST   | /api/sites/:id/github/backup        | orgId | Mirror build to snapshot branch + open a PR         |
 * | POST   | /api/sites/:id/github/disconnect    | orgId | Soft-delete the integration row                     |
 *
 * Extracted VERBATIM from the `api.ts` monolith (route-decomposition installment
 * 11) — only the route-registration receiver changed (`api.` → `siteGithub.`);
 * the handler bodies are byte-for-byte unchanged. The private helpers that only
 * the GitHub routes use moved alongside them: `loadAuthorizedSite` (site-auth
 * guard), `deriveRepoName` (slug → repo name), `githubHeaders` (canonical
 * `api.github.com` headers), and `arrayBufferToBase64` (Workers-safe chunked
 * base64 for the blob-upload path). The customer's OAuth token is encrypted at
 * rest via `encrypt`/`decryptOrPassthrough` (`services/ai_crypto`). Known
 * AppErrors (`unauthorized`/`badRequest`/`notFound`) propagate to the app-level
 * error handler.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { badRequest, unauthorized, notFound, DOMAINS, safeRelativePath } from '@project-sites/shared';
import type { Env, Variables } from '../../../src/types/env.js';
import { dbInsert, dbQueryOne } from '../../../src/services/db.js';
import { requireOwnedSite } from '../../../src/services/site_ownership.js';
import * as auditService from '../../../src/services/audit.js';
import { encrypt, decryptOrPassthrough } from '../../../src/services/ai_crypto.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const siteGithub = new Hono<AppContext>();

// Per-site GitHub OAuth backup. No token paste, no repo name — owner taps
// "Connect GitHub", consents on github.com, comes back to /admin/github.
// Repo name auto-derives from slug: `{slug}-projectsites-dev`. Triggering
// a backup commits every file under `sites/{slug}/{current_build_version}/`
// to the repo's default branch via GitHub Trees API.

/**
 * Site-auth guard. Throws unauthorized when no session; throws notFound
 * when the site doesn't belong to the caller's org. Returns the site row.
 */
async function loadAuthorizedSite(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<Record<string, unknown>> {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const siteId = c.req.param('id');
  // Canonical org-ownership guard: 404 (never 403) so cross-org sites don't leak.
  const site = await requireOwnedSite<Record<string, unknown>>(c.env, orgId, siteId, '*');
  return site;
}

/**
 * Derive the GitHub repo name from a site slug.
 * Example: slug `nyfoldingbox` → repo `nyfoldingbox-projectsites-dev`.
 * Dots are illegal in repo names on some GitHub clients, so we slugify.
 */
function deriveRepoName(slug: string): string {
  return `${slug.replace(/[^a-zA-Z0-9-]/g, '-')}-projectsites-dev`;
}

/**
 * Canonical GitHub API headers — `api.github.com` returns 403 without a
 * User-Agent, so every call must set one.
 */
function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ProjectSites-Backup/1.0',
  };
}

/**
 * GET /api/sites/:id/github/status
 *
 * Read connection state for a site. Returns `{ connected: false }` when
 * no row exists in `github_integrations`. When connected, returns the
 * repo metadata + last-backup stats. Never returns the access token.
 */
siteGithub.get('/api/sites/:id/github/status', async (c) => {
  const site = await loadAuthorizedSite(c);
  const integration = await dbQueryOne<{
    repo_owner: string;
    repo_name: string;
    repo_html_url: string;
    last_backup_at: string | null;
    last_commit_sha: string | null;
    commit_count: number;
    github_user: string;
    github_avatar_url: string | null;
  }>(
    c.env.DB,
    `SELECT repo_owner, repo_name, repo_html_url, last_backup_at,
            last_commit_sha, commit_count, github_user, github_avatar_url
     FROM github_integrations
     WHERE site_id = ? AND deleted_at IS NULL`,
    [site.id as string],
  );

  if (!integration) {
    return c.json({ data: { connected: false } });
  }

  return c.json({
    data: {
      connected: true,
      owner: integration.repo_owner,
      repo: integration.repo_name,
      html_url: integration.repo_html_url,
      last_backup_at: integration.last_backup_at ?? undefined,
      last_commit_sha: integration.last_commit_sha ?? undefined,
      commit_count: integration.commit_count,
      github_user: integration.github_user,
      github_avatar_url: integration.github_avatar_url ?? undefined,
    },
  });
});

/**
 * GET /api/sites/:id/github/connect?return_url=/admin/github
 *
 * Mint a CSRF state row in `github_backup_states`, build the GitHub OAuth
 * authorize URL with `repo` scope (so we can create + push to a repo on
 * the user's behalf), and return `{ url }`. The frontend redirects.
 */
siteGithub.get('/api/sites/:id/github/connect', async (c) => {
  const site = await loadAuthorizedSite(c);
  if (!c.env.GITHUB_CLIENT_ID) {
    throw badRequest('GitHub OAuth is not configured. GITHUB_CLIENT_ID secret is missing.');
  }

  // Same-origin relative path only — the callback redirects to this value
  // DIRECTLY (`c.redirect(`${returnUrl}?connected=1`)`), so an absolute
  // `return_url=https://evil.com` would be an open redirect.
  const returnUrl = safeRelativePath(c.req.query('return_url'), '/admin/github');
  const state = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

  await dbInsert(c.env.DB, 'github_backup_states', {
    id: crypto.randomUUID(),
    site_id: site.id,
    org_id: site.org_id,
    state,
    return_url: returnUrl,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    deleted_at: null,
  });

  const params = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: `https://${DOMAINS.SITES_BASE}/api/sites/${site.id}/github/callback`,
    scope: 'repo read:user',
    state,
    allow_signup: 'true',
  });

  return c.json({
    url: `https://github.com/login/oauth/authorize?${params.toString()}`,
  });
});

/**
 * GET /api/sites/:id/github/callback?code=...&state=...
 *
 * GitHub redirects here after consent. We exchange the code for an
 * access token, fetch the GitHub user profile, ensure the auto-derived
 * repo exists (create it if not), upsert the `github_integrations` row,
 * delete the state row, then 302 to the frontend `return_url` with
 * `?connected=1`.
 *
 * On any error, redirect with `?connected=0&error=<short_code>` so the
 * Angular component can render a toast instead of seeing a JSON 500.
 */
siteGithub.get('/api/sites/:id/github/callback', async (c) => {
  const orgId = c.get('orgId');
  const siteIdParam = c.req.param('id');
  const code = c.req.query('code');
  const state = c.req.query('state');
  const errorParam = c.req.query('error');

  const redirectFail = (reason: string): Response =>
    c.redirect(`/admin/github?connected=0&error=${encodeURIComponent(reason)}`);

  if (errorParam) return redirectFail(errorParam);
  if (!code || !state) return redirectFail('missing_code_or_state');
  if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) {
    return redirectFail('oauth_not_configured');
  }

  const stateRow = await dbQueryOne<{
    id: string;
    site_id: string;
    org_id: string;
    return_url: string | null;
    expires_at: string;
  }>(
    c.env.DB,
    `SELECT id, site_id, org_id, return_url, expires_at
     FROM github_backup_states
     WHERE state = ? AND deleted_at IS NULL`,
    [state],
  );

  if (!stateRow) return redirectFail('invalid_state');
  if (new Date(stateRow.expires_at) < new Date()) return redirectFail('state_expired');
  if (stateRow.site_id !== siteIdParam) return redirectFail('state_site_mismatch');
  if (orgId && stateRow.org_id !== orgId) return redirectFail('state_org_mismatch');

  // Single-use state — delete BEFORE the network calls so a retry can't replay it.
  await c.env.DB.prepare('DELETE FROM github_backup_states WHERE id = ?').bind(stateRow.id).run();

  // Reload site to get the slug for repo derivation.
  const site = await dbQueryOne<Record<string, unknown>>(
    c.env.DB,
    'SELECT * FROM sites WHERE id = ? AND deleted_at IS NULL',
    [stateRow.site_id],
  );
  if (!site) return redirectFail('site_not_found');

  // Exchange code for token.
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `https://${DOMAINS.SITES_BASE}/api/sites/${site.id}/github/callback`,
    }),
  });

  if (!tokenRes.ok) return redirectFail('token_exchange_failed');
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) return redirectFail(tokenJson.error || 'no_access_token');
  const accessToken = tokenJson.access_token;

  // Identify the user.
  const userRes = await fetch('https://api.github.com/user', {
    headers: githubHeaders(accessToken),
  });
  if (!userRes.ok) return redirectFail('user_fetch_failed');
  const ghUser = (await userRes.json()) as { login: string; id: number; avatar_url: string | null };

  // Ensure repo exists. Try GET first; 404 → POST /user/repos.
  const repoName = deriveRepoName(site.slug as string);
  const repoOwner = ghUser.login;
  let repoHtmlUrl: string;
  let defaultBranch = 'main';

  const repoGet = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}`, {
    headers: githubHeaders(accessToken),
  });

  if (repoGet.ok) {
    const repo = (await repoGet.json()) as { html_url: string; default_branch: string };
    repoHtmlUrl = repo.html_url;
    defaultBranch = repo.default_branch || 'main';
  } else if (repoGet.status === 404) {
    const repoCreate = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: { ...githubHeaders(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: repoName,
        description: `Backup of ${site.business_name as string} — projectsites.dev`,
        private: true,
        auto_init: true,
        has_issues: false,
        has_projects: false,
        has_wiki: false,
      }),
    });
    if (!repoCreate.ok) return redirectFail('repo_create_failed');
    const repo = (await repoCreate.json()) as { html_url: string; default_branch: string };
    repoHtmlUrl = repo.html_url;
    defaultBranch = repo.default_branch || 'main';
  } else {
    return redirectFail('repo_lookup_failed');
  }

  // Upsert integration row.
  const existing = await dbQueryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM github_integrations WHERE site_id = ? AND deleted_at IS NULL',
    [site.id as string],
  );

  const nowIso = new Date().toISOString();
  // The customer's GitHub OAuth token grants read/write to their repos — encrypt it
  // at rest (the column name always promised it; it previously stored plaintext).
  const accessTokenEncrypted = await encrypt(c.env, accessToken);
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE github_integrations SET
         access_token_encrypted = ?, github_user = ?, github_user_id = ?,
         github_avatar_url = ?, repo_owner = ?, repo_name = ?,
         repo_html_url = ?, default_branch = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        accessTokenEncrypted,
        ghUser.login,
        ghUser.id,
        ghUser.avatar_url ?? null,
        repoOwner,
        repoName,
        repoHtmlUrl,
        defaultBranch,
        nowIso,
        existing.id,
      )
      .run();
  } else {
    await dbInsert(c.env.DB, 'github_integrations', {
      id: crypto.randomUUID(),
      site_id: site.id,
      org_id: site.org_id,
      access_token_encrypted: accessTokenEncrypted,
      github_user: ghUser.login,
      github_user_id: ghUser.id,
      github_avatar_url: ghUser.avatar_url ?? null,
      repo_owner: repoOwner,
      repo_name: repoName,
      repo_html_url: repoHtmlUrl,
      default_branch: defaultBranch,
      last_backup_at: null,
      last_commit_sha: null,
      commit_count: 0,
      deleted_at: null,
    });
  }

  await auditService
    .writeAuditLog(c.env.DB, {
      org_id: site.org_id as string,
      actor_id: c.get('userId') ?? null,
      action: 'github.backup_connected',
      message: `GitHub repo '${repoOwner}/${repoName}' connected as backup for site '${site.slug as string}' (user '${ghUser.login}')`,
      target_type: 'site',
      target_id: site.id as string,
      metadata_json: { github_user: ghUser.login, repo: `${repoOwner}/${repoName}` },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  const returnUrl = stateRow.return_url || '/admin/github';
  return c.redirect(`${returnUrl}?connected=1`);
});

/**
 * POST /api/sites/:id/github/backup
 *
 * **Bundle B finish (2026-05-24)** — replaces the legacy force-push to the
 * default branch with a snapshot-scoped branch + Pull Request. Pull every
 * R2 object under `sites/{slug}/{current_build_version}/`, commit them to a
 * `snapshot-{snapshot_id}-{ts}` branch, then open a PR against the default
 * branch with an AI-generated body summarizing the diff.
 *
 * Persists `github_branch_name`, `github_pr_number`, and `github_pr_html_url`
 * on the source `site_snapshots` row (columns added in migration 0032).
 *
 * Returns `{ data: { commit_sha, html_url, pr_number, pr_html_url,
 * branch_name } }`.
 */
siteGithub.post('/api/sites/:id/github/backup', async (c) => {
  const site = await loadAuthorizedSite(c);
  const integration = await dbQueryOne<{
    id: string;
    access_token_encrypted: string;
    repo_owner: string;
    repo_name: string;
    repo_html_url: string;
    default_branch: string;
    commit_count: number;
  }>(
    c.env.DB,
    `SELECT id, access_token_encrypted, repo_owner, repo_name,
            repo_html_url, default_branch, commit_count
     FROM github_integrations
     WHERE site_id = ? AND deleted_at IS NULL`,
    [site.id as string],
  );

  if (!integration) throw notFound('GitHub backup is not connected for this site');

  const buildVersion = site.current_build_version as string | null;
  if (!buildVersion) throw badRequest('Site has no published build to back up');

  // Decrypt the stored OAuth token to plaintext for the GitHub API call; legacy
  // plaintext rows pass through unchanged (re-encrypt on the owner's next connect).
  const token = await decryptOrPassthrough(c.env, integration.access_token_encrypted);
  const { repo_owner: owner, repo_name: repo, default_branch: branch } = integration;
  const prefix = `sites/${site.slug as string}/${buildVersion}/`;

  // List all R2 objects for this build.
  const objects: { key: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await c.env.SITES_BUCKET.list({ prefix, limit: 1000, cursor });
    for (const obj of page.objects) objects.push({ key: obj.key, size: obj.size });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  if (objects.length === 0) throw notFound('No files found for this build');

  // Get the current branch HEAD SHA.
  const refRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    { headers: githubHeaders(token) },
  );
  if (!refRes.ok) throw badRequest(`GitHub ref lookup failed (${refRes.status})`);
  const refJson = (await refRes.json()) as { object: { sha: string } };
  const baseCommitSha = refJson.object.sha;

  const baseCommitRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits/${baseCommitSha}`,
    { headers: githubHeaders(token) },
  );
  if (!baseCommitRes.ok) throw badRequest('GitHub base commit lookup failed');
  const baseCommit = (await baseCommitRes.json()) as { tree: { sha: string } };
  const baseTreeSha = baseCommit.tree.sha;

  // Create blobs in parallel (GitHub allows ~5k req/hr authenticated).
  const treeEntries = await Promise.all(
    objects.map(async (obj) => {
      const r2Obj = await c.env.SITES_BUCKET.get(obj.key);
      if (!r2Obj) throw badRequest(`R2 fetch failed for ${obj.key}`);
      const buf = await r2Obj.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);

      const blobRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST',
        headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: base64, encoding: 'base64' }),
      });
      if (!blobRes.ok) throw badRequest(`GitHub blob create failed for ${obj.key}`);
      const blob = (await blobRes.json()) as { sha: string };
      return {
        path: obj.key.slice(prefix.length),
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      };
    }),
  );

  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });
  if (!treeRes.ok) throw badRequest('GitHub tree create failed');
  const tree = (await treeRes.json()) as { sha: string };

  const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Backup build ${buildVersion} — ${new Date().toISOString()}`,
      tree: tree.sha,
      parents: [baseCommitSha],
    }),
  });
  if (!commitRes.ok) throw badRequest('GitHub commit create failed');
  const commit = (await commitRes.json()) as { sha: string; html_url: string };

  // Branch name — derive from snapshot_id query param when present, fall
  // back to the build version + timestamp so legacy callers still work.
  const snapshotIdParam = c.req.query('snapshot_id') ?? '';
  const branchSeed = (snapshotIdParam || buildVersion).slice(0, 24).replace(/[^a-zA-Z0-9._-]/g, '');
  const branchTs = Date.now().toString(36);
  const branchName = `snapshot-${branchSeed}-${branchTs}`;

  // Create the snapshot branch pointing at the new tree commit.
  const createRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: commit.sha }),
  });
  if (!createRefRes.ok) {
    const body = await createRefRes.text().catch(() => '');
    throw badRequest(`GitHub branch create failed: ${createRefRes.status} ${body.slice(0, 200)}`);
  }

  // AI-summarize the diff via Workers AI Llama 3.3 70B FP8-fast (NEVER the
  // bare alias — see ai-fp8 regression test). Fail-soft to a deterministic
  // body if the AI call errors; the PR still opens.
  let aiBody = `Snapshot \`${buildVersion}\` — ${objects.length} file${objects.length === 1 ? '' : 's'} mirrored from R2.`;
  try {
    const fileList = objects
      .slice(0, 60)
      .map((o) => `- ${o.key.slice(prefix.length)} (${o.size}b)`)
      .join('\n');
    const aiPrompt = `Write a 2-paragraph GitHub PR description for a website snapshot pushed by ProjectSites. Build version: ${buildVersion}. Files (${objects.length}): \n${fileList}\nFocus on what changed conceptually — sections, pages, asset updates — and keep it under 120 words. End with one sentence on how to merge or close the PR.`;
    const aiRes = await (c.env.AI.run as (model: string, input: unknown) => Promise<unknown>)(
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      {
        messages: [
          {
            role: 'system',
            content:
              'You write concise, helpful GitHub PR descriptions for website-snapshot mirrors. Plain markdown, no preamble.',
          },
          { role: 'user', content: aiPrompt },
        ],
        max_tokens: 320,
      },
    );
    const text = (aiRes as { response?: string })?.response?.trim();
    if (text && text.length > 20) aiBody = text;
  } catch {
    // AI Gateway or Workers AI flaked — ship the deterministic body.
  }

  // Open the PR.
  const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `Snapshot ${buildVersion} from ProjectSites`,
      head: branchName,
      base: branch,
      body: `${aiBody}\n\n---\n\nAuto-generated by ProjectSites · branch \`${branchName}\` · build version \`${buildVersion}\` · ${objects.length} file${objects.length === 1 ? '' : 's'}.`,
      maintainer_can_modify: true,
    }),
  });
  if (!prRes.ok) {
    const body = await prRes.text().catch(() => '');
    throw badRequest(`GitHub PR create failed: ${prRes.status} ${body.slice(0, 200)}`);
  }
  const pr = (await prRes.json()) as { number: number; html_url: string };

  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE github_integrations SET
       last_backup_at = ?, last_commit_sha = ?, commit_count = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(nowIso, commit.sha, integration.commit_count + 1, nowIso, integration.id)
    .run();

  // Persist the PR metadata back onto the snapshot row when we have one.
  // Wrap in try so missing-column / missing-row never blocks the response.
  if (snapshotIdParam) {
    try {
      await c.env.DB.prepare(
        `UPDATE site_snapshots SET
           github_branch_name = ?, github_pr_number = ?, github_pr_html_url = ?, updated_at = ?
         WHERE id = ? AND site_id = ?`,
      )
        .bind(branchName, pr.number, pr.html_url, nowIso, snapshotIdParam, site.id as string)
        .run();
    } catch {
      // Column not migrated yet — surface only in audit log, never to user.
    }
  }

  await auditService
    .writeAuditLog(c.env.DB, {
      org_id: site.org_id as string,
      actor_id: c.get('userId') ?? null,
      action: 'github.pr_opened',
      message: `PR #${pr.number} opened on '${owner}/${repo}' for snapshot ${buildVersion} (${objects.length} file${objects.length === 1 ? '' : 's'})`,
      target_type: 'site',
      target_id: site.id as string,
      metadata_json: {
        repo: `${owner}/${repo}`,
        commit_sha: commit.sha,
        branch_name: branchName,
        pr_number: pr.number,
        pr_html_url: pr.html_url,
        file_count: objects.length,
        build_version: buildVersion,
        snapshot_id: snapshotIdParam || null,
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.json({
    data: {
      commit_sha: commit.sha,
      html_url: commit.html_url,
      pr_number: pr.number,
      pr_html_url: pr.html_url,
      branch_name: branchName,
    },
  });
});

/**
 * POST /api/sites/:id/github/disconnect
 *
 * Soft-delete the integration row (sets `deleted_at`). The OAuth token
 * is NOT revoked on GitHub's side — the owner can revoke from the GitHub
 * Settings → Applications page. We log the disconnect for audit.
 */
siteGithub.post('/api/sites/:id/github/disconnect', async (c) => {
  const site = await loadAuthorizedSite(c);
  const integration = await dbQueryOne<{ id: string; repo_owner: string; repo_name: string }>(
    c.env.DB,
    `SELECT id, repo_owner, repo_name FROM github_integrations
     WHERE site_id = ? AND deleted_at IS NULL`,
    [site.id as string],
  );

  if (!integration) throw notFound('GitHub backup is not connected for this site');

  await c.env.DB.prepare(
    `UPDATE github_integrations SET deleted_at = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(new Date().toISOString(), new Date().toISOString(), integration.id)
    .run();

  await auditService
    .writeAuditLog(c.env.DB, {
      org_id: site.org_id as string,
      actor_id: c.get('userId') ?? null,
      action: 'github.backup_disconnected',
      message: `GitHub repo '${integration.repo_owner}/${integration.repo_name}' disconnected from site '${site.slug as string}'`,
      target_type: 'site',
      target_id: site.id as string,
      metadata_json: { repo: `${integration.repo_owner}/${integration.repo_name}` },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.json({ data: { disconnected: true } });
});

/**
 * Convert an ArrayBuffer to a base64 string. Works in Workers (no Buffer)
 * via a chunked btoa over Latin-1 byte strings. Chunked to stay under the
 * 8KB call-stack budget for `String.fromCharCode(...)` on large blobs.
 */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
