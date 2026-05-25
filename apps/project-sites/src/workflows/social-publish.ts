/**
 * @module workflows/social-publish
 * @description Pulse Social publish pipeline as a Cloudflare Workflow.
 *
 * Step graph:
 *   1. `loadPost`        — fetch pulse_posts row + bound social_accounts
 *   2. `prepareMedia`    — sign R2 URLs for each media item (per-platform variants)
 *   3. `fanoutPublish`   — fan-out per-account publishes in parallel (3x retry)
 *   4. `recordResults`   — write social_publishes + flip post.status
 *   5. `notifyOnFailure` — toast org owner when any platform failed
 */
import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { Env } from '../types/env.js';
import { dbExecute, dbInsert, dbQueryOne, dbUpdate } from '../services/db.js';
import { loadAccountsByIds, markAccountError } from '../services/social_account_ctx.js';
import { getPublisher, MissingAppCredsError, type PostCtx, type Platform } from '../services/social_publishers/index.js';

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

    // 2. prepareMedia — sign R2 URLs for each media key. We use public R2.dev URLs
    //    via SITES_BUCKET binding (publicly readable). For private posts a signed
    //    URL helper would go here; out of scope for v1.
    const mediaUrls = await step.do('prepareMedia', RETRY_30S, async () => {
      const mediaKeys = ctx.row.media_keys
        ? (JSON.parse(ctx.row.media_keys) as Array<{ r2_key: string; mime: string; alt?: string; type?: 'image' | 'video' }>)
        : [];
      const accountBase = 'https://pub-' + (env as unknown as Record<string, string>).CF_ACCOUNT_ID + '.r2.dev/';
      // We expose media via /assets/r2/* route (existing assets route) — public read
      return mediaKeys.map((m) => ({
        url: `https://projectsites.dev/assets/r2/${m.r2_key}`,
        mime: m.mime,
        type: (m.type ?? (m.mime.startsWith('video/') ? 'video' : 'image')) as 'image' | 'video',
        alt: m.alt,
      }));
      void accountBase;
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

    // 3. fanoutPublish — load accounts then run per-account publishes in parallel
    const accounts = await loadAccountsByIds(env, ctx.accountIds);
    const publishPromises = accounts.map((acc) =>
      step.do(`publish-${acc.platform}-${acc.id}`, RETRY_30S, async () => {
        try {
          const pub = getPublisher(acc.platform as Platform);
          const result = await pub.publish(env, acc, post);
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
          if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('refresh_failed')) {
            await markAccountError(env, acc.id, msg).catch(() => undefined);
          }
          throw err;
        }
      }).catch((err: unknown) => ({
        account_id: acc.id,
        platform: acc.platform,
        status: 'failed' as const,
        external_id: null,
        external_url: null,
        error: err instanceof Error ? err.message : String(err),
      })),
    );
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
      const finalStatus =
        failed === 0 ? 'published' : succeeded === 0 ? 'failed' : 'partial';
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
            metadata_json: JSON.stringify({ succeeded, failed, results: results.map((r) => ({ platform: r.platform, status: r.status, error: r.error })) }),
          });
        } catch (err) {
          console.warn(JSON.stringify({
            level: 'warn',
            service: 'social-publish-workflow',
            message: 'notify_on_failure_failed',
            post_id,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      });
    }

    return { ok: failed === 0, succeeded, failed };
  }
}
