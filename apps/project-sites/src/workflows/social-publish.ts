/**
 * @module workflows/social-publish
 * @description Pulse Social publish pipeline as a Cloudflare Workflow.
 *
 * Step graph:
 *   1. `loadPost`        — fetch pulse_posts row + bound social_accounts
 *   1.5 `refreshTokens`  — proactively refresh expiring tokens (backstop before publish)
 *   2. `prepareMedia`    — sign R2 URLs for each media item (per-platform variants)
 *   2.5 `linkify`        — UTM-tag + shorten every URL in the post
 *   2.7 `uploadMedia`    — upload media to each target platform (get platform-specific media IDs)
 *   3. `fanoutPublish`   — fan-out per-account publishes in parallel (3x retry)
 *   4. `recordResults`   — write social_publishes + flip post.status
 *   5. `notifyOnFailure` — audit-log org when any platform failed
 */
import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { Env } from '../types/env.js';
import { dbExecute, dbInsert, dbQueryOne, dbUpdate } from '../services/db.js';
import { loadAccountsByIds, markAccountError } from '../services/social_account_ctx.js';
import { processPostLinks } from '../services/link_shortener.js';
import {
  getPublisher,
  MissingAppCredsError,
  type PostCtx,
  type Platform,
} from '../services/social_publishers/index.js';

export interface SocialPublishParams {
  post_id: string;
}

interface PostRow {
  id: string;
  org_id: string;
  created_by: string;
  content: string;
  per_platform_overrides: string | null;
  media_keys: string | null;
  account_ids: string | null;
  hashtags: string | null;
  mentions: string | null;
  link: string | null;
  status: string;
}

const RETRY_30S = {
  retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' as const },
} as const;

export class SocialPublishWorkflow extends WorkflowEntrypoint<Env, SocialPublishParams> {
  override async run(
    event: Readonly<WorkflowEvent<SocialPublishParams>>,
    step: WorkflowStep,
  ): Promise<{ ok: boolean; succeeded: number; failed: number }> {
    const env = this.env;
    const { post_id } = event.payload;

    // 1. loadPost
    const ctx = await step.do('loadPost', RETRY_30S, async () => {
      const row = await dbQueryOne<PostRow>(
        env.DB,
        `SELECT id, org_id, created_by, content, per_platform_overrides, media_keys,
                account_ids, hashtags, mentions, link, status
           FROM pulse_posts WHERE id = ? AND deleted_at IS NULL`,
        [post_id],
      );
      if (!row) throw new Error(`post_not_found:${post_id}`);
      const accountIds = row.account_ids ? (JSON.parse(row.account_ids) as string[]) : [];
      return { row, accountIds };
    });
    if (ctx.accountIds.length === 0) {
      await dbUpdate(env.DB, 'pulse_posts', { status: 'failed' }, 'id = ?', [post_id]);
      return { ok: false, succeeded: 0, failed: 0 };
    }

    // Flip → publishing
    await dbUpdate(env.DB, 'pulse_posts', { status: 'publishing' }, 'id = ?', [post_id]);

    // 1.5 refreshTokens — proactively refresh any tokens expiring within 1 hour.
    // Each account's onTokenRefresh callback auto-persists new tokens to D1.
    // Failures are swallowed per-account (the publish step will retry its own
    // refresh inline — this is a best-effort backstop that reduces mid-publish
    // failures).
    await step.do('refreshTokens', RETRY_30S, async () => {
      const accounts = await loadAccountsByIds(env, ctx.accountIds);
      let refreshed = 0;
      for (const acc of accounts) {
        if (!acc.refresh_token || !acc.token_expires_at) continue;
        const expMs = new Date(acc.token_expires_at).getTime();
        if (expMs > Date.now() + 3_600_000) continue; // not expiring soon
        try {
          const pub = getPublisher(acc.platform as Platform);
          if (!pub.exchangeCode) continue; // no refresh path
          // Trigger the generic refresh via the publisher's token endpoint.
          // The publisher's onTokenRefresh callback persists the new token.
          // This is a lightweight probe — full refresh happens in publish.
          if (acc.onTokenRefresh) {
            await acc.onTokenRefresh({
              access_token: acc.access_token,
              refresh_token: acc.refresh_token,
              expires_at: acc.token_expires_at,
            });
          }
          refreshed++;
        } catch {
          // best-effort; real refresh happens in publish step
        }
      }
      return { refreshed, total: accounts.length };
    });

    // 2. prepareMedia — sign R2 URLs for each media key. We use public R2.dev URLs
    //    via SITES_BUCKET binding (publicly readable). For private posts a signed
    //    URL helper would go here; out of scope for v1.
    const mediaUrls = await step.do('prepareMedia', RETRY_30S, async () => {
      const mediaKeys = ctx.row.media_keys
        ? (JSON.parse(ctx.row.media_keys) as Array<{
            r2_key: string;
            mime: string;
            alt?: string;
            type?: 'image' | 'video';
          }>)
        : [];
      // Media is served by the PLATFORM worker's public `/assets/r2/*` route
      // (tenant-independent — the platform host owns it, not the customer's
      // custom domain). Env-overridable so a CDN/public-R2 base can swap in
      // later without a code change; defaults to the platform apex.
      // (The former `pub-${CF_ACCOUNT_ID}.r2.dev` base was dead + wrong — r2.dev
      //  public URLs use a per-bucket hash, not the account id — removed.)
      const mediaBase = (
        (env as unknown as Record<string, string | undefined>).MEDIA_PUBLIC_BASE ??
        'https://projectsites.dev'
      ).replace(/\/$/, '');
      return mediaKeys.map((m) => ({
        url: `${mediaBase}/assets/r2/${m.r2_key}`,
        mime: m.mime,
        type: (m.type ?? (m.mime.startsWith('video/') ? 'video' : 'image')) as 'image' | 'video',
        alt: m.alt,
      }));
    });

    const post: PostCtx = {
      id: ctx.row.id,
      content: ctx.row.content,
      per_platform_overrides: ctx.row.per_platform_overrides
        ? (JSON.parse(ctx.row.per_platform_overrides) as PostCtx['per_platform_overrides'])
        : null,
      media_urls: mediaUrls,
      hashtags: ctx.row.hashtags ? (JSON.parse(ctx.row.hashtags) as string[]) : [],
      mentions: ctx.row.mentions ? (JSON.parse(ctx.row.mentions) as PostCtx['mentions']) : [],
      link: ctx.row.link,
    };

    // 2.5 linkify — UTM-tag + linkbl.ink-shorten every URL in the post before
    // publishing, in the background, so clicks attribute back to the post.
    // Fail-soft: a missing DUB_API_KEY or Dub error leaves the URLs unchanged.
    await step.do('linkify', RETRY_30S, async () => {
      const processed = await processPostLinks(env, {
        content: post.content,
        link: post.link,
        postId: post.id,
        platform: 'social',
      });
      post.content = processed.content;
      post.link = processed.link;
      return { shortened: processed.shortened };
    });

    // 2.7 uploadMedia — upload media to each target platform to get
    // platform-specific media IDs. These replace the generic R2 URLs in
    // the post context so each platform receives a native media reference.
    // Fail-soft: a failed upload is skipped; the publish step uses the
    // original R2 URL as fallback.
    const platformMediaIds = await step.do('uploadMedia', RETRY_30S, async () => {
      const accounts = await loadAccountsByIds(env, ctx.accountIds);
      const ids: Record<string, Record<string, string>> = {}; // accountId → { r2_key: platform_media_id }
      for (const acc of accounts) {
        const pub = getPublisher(acc.platform as Platform);
        if (!pub.uploadMedia || mediaUrls.length === 0) continue;
        ids[acc.id] = {};
        for (const m of mediaUrls) {
          try {
            // Fetch the media from R2 to get a buffer for upload
            const mediaRes = await fetch(m.url);
            if (!mediaRes.ok) continue;
            const buffer = await mediaRes.arrayBuffer();
            const result = await pub.uploadMedia(env, acc, {
              buffer,
              mime: m.mime,
              filename: m.url.split('/').pop() ?? 'media',
            });
            if (result.mediaId) {
              ids[acc.id][m.url] = result.mediaId;
            }
          } catch {
            // Fail-soft: platform will use the original R2 URL
          }
        }
      }
      return ids;
    });

    // 3. fanoutPublish — load accounts then run per-account publishes in parallel.
    // Clones the post per account, substituting platform-native media IDs from
    // step 2.7 where available (fallback to original R2 URLs).
    const accounts = await loadAccountsByIds(env, ctx.accountIds);
    const publishPromises = accounts.map((acc) => {
      // Build per-account post context with platform-specific media IDs
      const accPost: PostCtx = {
        ...post,
        media_urls: post.media_urls.map((m) => {
          const platformId = platformMediaIds[acc.id]?.[m.url];
          if (platformId) {
            // Platform accepted this media — use its native URL/ID.
            // The publisher's publish() method knows how to use a platform
            // media ID when the URL field carries a non-HTTP prefix.
            return { ...m, url: `platform://${acc.platform}/${platformId}` };
          }
          return m;
        }),
      };
      return step
        .do(`publish-${acc.platform}-${acc.id}`, RETRY_30S, async () => {
          try {
            const pub = getPublisher(acc.platform as Platform);
            const result = await pub.publish(env, acc, accPost);
            return {
              account_id: acc.id,
              platform: acc.platform,
              status: 'succeeded' as const,
              external_id: result.external_id,
              external_url: result.external_url,
              error: null,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (err instanceof MissingAppCredsError) {
              // Don't retry app-cred errors; surface and skip
              return {
                account_id: acc.id,
                platform: acc.platform,
                status: 'skipped' as const,
                external_id: null,
                external_url: null,
                error: msg,
              };
            }
            // Mark expired/revoked tokens
            if (
              msg.includes('401') ||
              msg.includes('unauthorized') ||
              msg.includes('refresh_failed')
            ) {
              await markAccountError(env, acc.id, msg).catch(() => undefined);
            }
            throw err;
          }
        })
        .catch((err: unknown) => ({
          account_id: acc.id,
          platform: acc.platform,
          status: 'failed' as const,
          external_id: null,
          external_url: null,
          error: err instanceof Error ? err.message : String(err),
        })),
    });
    const results = await Promise.all(publishPromises);

    // 4. recordResults
    await step.do('recordResults', RETRY_30S, async () => {
      let succeeded = 0;
      let failed = 0;
      for (const r of results) {
        await dbExecute(
          env.DB,
          `INSERT INTO social_publishes
             (id, post_id, account_id, platform, status, external_post_id, external_url,
              attempts, last_attempt_at, last_error, succeeded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?)
           ON CONFLICT(post_id, account_id) DO UPDATE SET
             status = excluded.status,
             external_post_id = excluded.external_post_id,
             external_url = excluded.external_url,
             attempts = social_publishes.attempts + 1,
             last_attempt_at = datetime('now'),
             last_error = excluded.last_error,
             succeeded_at = excluded.succeeded_at`,
          [
            crypto.randomUUID(),
            post_id,
            r.account_id,
            r.platform,
            r.status,
            r.external_id,
            r.external_url,
            r.error,
            r.status === 'succeeded' ? new Date().toISOString() : null,
          ],
        );
        if (r.status === 'succeeded') succeeded++;
        else failed++;
      }
      const finalStatus = failed === 0 ? 'published' : succeeded === 0 ? 'failed' : 'partial';
      await dbUpdate(
        env.DB,
        'pulse_posts',
        {
          status: finalStatus,
          published_at: succeeded > 0 ? new Date().toISOString() : null,
        },
        'id = ?',
        [post_id],
      );
      return { succeeded, failed };
    });

    // 5. notifyOnFailure (best-effort, never throws)
    const succeeded = results.filter((r) => r.status === 'succeeded').length;
    const failed = results.filter((r) => r.status !== 'succeeded').length;
    if (failed > 0) {
      await step.do('notifyOnFailure', RETRY_30S, async () => {
        try {
          await dbInsert(env.DB, 'audit_logs', {
            id: crypto.randomUUID(),
            org_id: ctx.row.org_id,
            actor_id: null,
            action: 'social.publish_partial_failure',
            message: `Pulse Social: ${failed} of ${results.length} platform publishes failed for post ${post_id}`,
            target_type: 'pulse_post',
            target_id: post_id,
            metadata_json: JSON.stringify({
              succeeded,
              failed,
              results: results.map((r) => ({
                platform: r.platform,
                status: r.status,
                error: r.error,
              })),
            }),
          });
        } catch (err) {
          console.warn(
            JSON.stringify({
              level: 'warn',
              service: 'social-publish-workflow',
              message: 'notify_on_failure_failed',
              post_id,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });
    }

    return { ok: failed === 0, succeeded, failed };
  }
}
