/**
 * @module services/social_token_cron
 * @description Pulse Social — token refresh cron backstop sweeper.
 *
 * Scans `social_accounts` for tokens expiring within 72 hours and calls
 * each platform publisher's token-refresh endpoint via the existing
 * `SocialAccountCtx.onTokenRefresh` callback. Marks accounts
 * `needs_reconnect` on unrecoverable failure.
 *
 * This is the BACKSTOP — the primary refresh path is in-workflow
 * (SocialPublishWorkflow), which refreshes inline before publishing.
 * The cron catches accounts that haven't published recently enough
 * for the workflow to refresh them.
 *
 * Rate-limited: max 1000 accounts per cron tick (every 5 min).
 *
 * @see ../workflows/social-publish.ts (primary refresh path)
 * @see ./social_account_ctx.ts (loadAccountsByIds, markAccountError)
 */
import type { Env } from '../types/env.js';
import { dbQuery, dbUpdate } from './db.js';
import { loadAccountsByIds, markAccountError } from './social_account_ctx.js';
import { getPublisher, type Platform } from './social_publishers/index.js';
import { isFlagOn } from '../modules/feature_flags/services.js';

const MAX_PER_TICK = 1000;
const EXPIRY_WINDOW_HOURS = 72;

/**
 * Run the token-refresh backstop sweep.
 *
 * @returns Summary for structured logging.
 *
 * @example
 * ```ts
 * // In src/index.ts scheduled handler:
 * const summary = await runTokenRefreshCron(env);
 * console.warn(JSON.stringify({ ...summary, service: 'social_token_cron' }));
 * ```
 */
export async function runTokenRefreshCron(
  env: Env,
): Promise<{ scanned: number; refreshed: number; failed: number; skipped: number }> {
  if (!(await isFlagOn(env, 'social_publishing_native', { orgId: 'system' }))) {
    return { scanned: 0, refreshed: 0, failed: 0, skipped: 0 };
  }

  const { data: rows } = await dbQuery<{ id: string; platform: string }>(
    env.DB,
    `SELECT id, platform
       FROM social_accounts
      WHERE token_expires_at IS NOT NULL
        AND token_expires_at < datetime('now', '+${EXPIRY_WINDOW_HOURS} hours')
        AND status = 'active'
        AND deleted_at IS NULL
      ORDER BY token_expires_at ASC
      LIMIT ?`,
    [MAX_PER_TICK],
  );

  let refreshed = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const accounts = await loadAccountsByIds(env, [row.id]);
      const account = accounts[0];
      if (!account) {
        skipped++;
        continue;
      }

      const pub = getPublisher(row.platform as Platform);
      if (!pub.exchangeCode) {
        // Platforms without OAuth token refresh (paste-key only) have no refresh path.
        // Their tokens don't expire or are managed out-of-band.
        skipped++;
        continue;
      }

      // Attempt token refresh via the platform. Most platforms expose a
      // dedicated refresh endpoint; for those that don't, we attempt a
      // token-exchange-like flow. If refresh fails with 401/revoke, the
      // account is marked needs_reconnect.
      //
      // The publisher's onTokenRefresh callback (set by loadAccountsByIds
      // via social_account_ctx.ts) re-encrypts and persists new tokens
      // automatically — the cron just needs to call the refresh endpoint.
      const refreshToken = account.refresh_token;
      if (!refreshToken) {
        // No refresh token — mark for re-auth
        await markAccountError(env, row.id, 'no_refresh_token');
        await dbUpdate(
          env.DB,
          'social_accounts',
          { status: 'needs_reconnect', last_error: 'No refresh token available' },
          'id = ?',
          [row.id],
        );
        failed++;
        continue;
      }

      // Use a generic OAuth token refresh via the platform's token endpoint.
      // Most platforms use grant_type=refresh_token at their token URL.
      const TOKEN_URLS: Record<string, string> = {
        twitter: 'https://api.twitter.com/2/oauth2/token',
        linkedin: 'https://www.linkedin.com/oauth/v2/accessToken',
        facebook: 'https://graph.facebook.com/v18.0/oauth/access_token',
        instagram: 'https://api.instagram.com/oauth/access_token',
        threads: 'https://graph.threads.net/v1.0/oauth/access_token',
        tiktok: 'https://open.tiktokapis.com/v2/oauth/token/',
        youtube: 'https://oauth2.googleapis.com/token',
        pinterest: 'https://api.pinterest.com/v5/oauth/token',
        google_business: 'https://oauth2.googleapis.com/token',
        nextdoor: 'https://api.nextdoor.com/v2/oauth/token',
        reddit: 'https://www.reddit.com/api/v1/access_token',
      };

      const tokenUrl = TOKEN_URLS[row.platform];
      if (!tokenUrl) {
        skipped++;
        continue;
      }

      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: (env as unknown as Record<string, string>)[`${row.platform.toUpperCase()}_CLIENT_ID`] ?? '',
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (res.status === 401 || res.status === 403) {
          await markAccountError(env, row.id, `token_refresh_rejected:${res.status}`);
          await dbUpdate(
            env.DB,
            'social_accounts',
            {
              status: 'needs_reconnect',
              last_error: `Token refresh rejected: ${res.status}. ${body.slice(0, 200)}`,
            },
            'id = ?',
            [row.id],
          );
        }
        failed++;
        continue;
      }

      const json = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };

      if (json.access_token && account.onTokenRefresh) {
        const expiresAt = json.expires_in
          ? new Date(Date.now() + json.expires_in * 1000).toISOString()
          : null;
        await account.onTokenRefresh({
          access_token: json.access_token,
          refresh_token: json.refresh_token ?? null,
          expires_at: expiresAt,
        });
        await dbUpdate(
          env.DB,
          'social_accounts',
          {
            last_refreshed_at: new Date().toISOString(),
            refresh_count: (await dbQuery<{ rc: number }>(
              env.DB,
              'SELECT refresh_count as rc FROM social_accounts WHERE id = ?',
              [row.id],
            )).data[0]?.rc ?? 0 + 1,
          },
          'id = ?',
          [row.id],
        );
        refreshed++;
      } else {
        failed++;
      }
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'social_token_cron',
          message: 'token_refresh_error',
          account_id: row.id,
          platform: row.platform,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      failed++;
    }
  }

  return { scanned: rows.length, refreshed, failed, skipped };
}
