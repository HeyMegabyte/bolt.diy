# Native Social Architecture

The ProjectSites-native social publishing system is the long-term social product. It is built entirely on Cloudflare primitives — Hono route handlers, Durable Objects, Queues, and Workflows. It has no runtime dependency on Postiz and does not use Temporal or any external workflow engine.

---

## Design Principles

- One Durable Object per connected social account — tokens, rate-limit state, and per-platform state are isolated per account.
- CF Queues decouple publish requests from execution — a slow Twitter API call never blocks the HTTP response.
- CF Workflows handle scheduled posts with step-level retries and durable state.
- Every provider is behind a feature flag (`social_twitter`, `social_linkedin`, etc.) — providers ship independently.
- Media (images, videos) is stored in R2 before being uploaded to platforms — ensures retryability.

---

## Provider Interface

All social platform integrations implement `SocialProvider`. The interface is defined once; each platform is a concrete implementation.

```typescript
// apps/project-sites/src/services/social/provider.ts

export interface PublishResult {
  platformPostId: string;
  url: string;
  publishedAt: string;
}

export interface SocialAccount {
  accountId: string;
  tenantId: string;
  platform: SocialPlatform;
  displayName: string;
  avatarUrl?: string;
  connectedAt: string;
  expiresAt?: string;
}

export type SocialPlatform = 'twitter' | 'linkedin' | 'facebook' | 'instagram';

export interface SocialProvider {
  readonly platform: SocialPlatform;

  /**
   * Initiate OAuth flow. Returns the OAuth authorization URL.
   */
  connect(params: {
    tenantId: string;
    redirectUri: string;
    state: string;
  }): Promise<{ authUrl: string }>;

  /**
   * Complete OAuth flow. Exchanges code for tokens and stores in the Durable Object.
   */
  handleCallback(params: {
    tenantId: string;
    code: string;
    state: string;
    redirectUri: string;
  }): Promise<SocialAccount>;

  /**
   * Publish a post. Called by the Queue consumer.
   */
  publish(params: {
    tenantId: string;
    accountId: string;
    content: string;
    mediaR2Keys?: string[];
  }): Promise<PublishResult>;

  /**
   * Get the status of a previously published post.
   */
  getStatus(params: {
    tenantId: string;
    accountId: string;
    platformPostId: string;
  }): Promise<{ status: 'published' | 'failed' | 'deleted'; url?: string }>;

  /**
   * Revoke tokens and remove the account connection.
   */
  disconnect(params: { tenantId: string; accountId: string }): Promise<void>;
}
```

---

## Durable Object: Per-Account State

Each connected social account has its own Durable Object instance. The DO stores OAuth tokens (encrypted), rate-limit state, and publish history. The DO namespace is keyed by `{platform}:{accountId}`.

```typescript
// apps/project-sites/src/services/social/social_account_do.ts

import { DurableObject } from 'cloudflare:workers';

interface StoredTokens {
  accessToken: string;   // encrypted at rest
  refreshToken?: string;
  expiresAt?: string;
  scopes: string[];
}

export class SocialAccountDO extends DurableObject {
  async storeTokens(tokens: StoredTokens): Promise<void> {
    await this.ctx.storage.put('tokens', tokens);
    await this.ctx.storage.put('updated_at', new Date().toISOString());
  }

  async getTokens(): Promise<StoredTokens | null> {
    return this.ctx.storage.get<StoredTokens>('tokens') ?? null;
  }

  async recordPublish(result: {
    postId: string;
    platformPostId: string;
    publishedAt: string;
  }): Promise<void> {
    const history = await this.ctx.storage.get<typeof result[]>('publish_history') ?? [];
    history.unshift(result);
    // Keep last 100 entries
    await this.ctx.storage.put('publish_history', history.slice(0, 100));
  }

  async checkRateLimit(): Promise<{ allowed: boolean; retryAfter?: number }> {
    const lastPublish = await this.ctx.storage.get<number>('last_publish_ms');
    const now = Date.now();
    const minInterval = 60_000; // 1 minute between posts (conservative default)

    if (lastPublish && now - lastPublish < minInterval) {
      return { allowed: false, retryAfter: minInterval - (now - lastPublish) };
    }
    return { allowed: true };
  }

  async markPublished(): Promise<void> {
    await this.ctx.storage.put('last_publish_ms', Date.now());
  }
}
```

### wrangler.toml Binding

```toml
[[durable_objects.bindings]]
  name = "SOCIAL_ACCOUNT_DO"
  class_name = "SocialAccountDO"

[[migrations]]
  tag = "social-account-do-v1"
  new_sqlite_classes = ["SocialAccountDO"]
```

---

## Publish Flow

### Step 1: Admin Triggers Publish

The Angular admin sends a request to the Worker.

```
POST /api/social/publish
Authorization: Bearer {session_token}
{
  "accountId": "tw_123abc",
  "content": "Hello world from ProjectSites!",
  "mediaR2Keys": ["social/media/abc123.jpg"],
  "scheduleFor": null  // null = publish immediately
}
```

### Step 2: Worker Validates and Enqueues

```typescript
// apps/project-sites/src/routes/social.ts

app.post('/api/social/publish', authMiddleware, async (c) => {
  const body = await c.req.json();
  const parsed = PublishRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'VALIDATION_FAILED' }, 400);

  const { accountId, content, mediaR2Keys, scheduleFor } = parsed.data;
  const tenantId = c.get('tenantId');

  const jobId = crypto.randomUUID();
  await c.env.SOCIAL_PUBLISH_QUEUE.send({
    jobId,
    tenantId,
    accountId,
    content,
    mediaR2Keys: mediaR2Keys ?? [],
    scheduleFor: scheduleFor ?? new Date().toISOString(),
  });

  return c.json({ jobId, status: 'queued' });
});
```

### Step 3: Queue Consumer Executes Publish

```typescript
// apps/project-sites/src/workers/social_consumer.ts

export default {
  async queue(batch: MessageBatch<PublishJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const job = message.body;
      try {
        const provider = getProvider(env, job.accountId);
        const rateLimit = await checkAccountRateLimit(env, job.accountId);

        if (!rateLimit.allowed) {
          // Re-queue with delay
          message.retry({ delaySeconds: Math.ceil((rateLimit.retryAfter ?? 60000) / 1000) });
          continue;
        }

        const result = await provider.publish({
          tenantId: job.tenantId,
          accountId: job.accountId,
          content: job.content,
          mediaR2Keys: job.mediaR2Keys,
        });

        await recordPublishResult(env, job, result);
        message.ack();
      } catch (err) {
        console.warn('[social-consumer] publish failed', { jobId: job.jobId, error: String(err) });
        message.retry();
      }
    }
  },
};
```

### Step 4: CF Workflow for Scheduled Posts

Scheduled posts run through a CF Workflow with durable steps and automatic retries.

```typescript
// apps/project-sites/src/workflows/social_scheduled_publish.ts

import { WorkflowEntrypoint } from 'cloudflare:workers';

interface ScheduledPublishParams {
  jobId: string;
  tenantId: string;
  accountId: string;
  content: string;
  mediaR2Keys: string[];
  scheduleFor: string;
}

export class SocialScheduledPublishWorkflow extends WorkflowEntrypoint<Env, ScheduledPublishParams> {
  async run(event: WorkflowEvent<ScheduledPublishParams>, step: WorkflowStep) {
    const params = event.payload;

    // Step 1: Validate the account is still connected
    const account = await step.do('validate-account', async () => {
      return getAccountFromDO(this.env, params.accountId);
    });

    if (!account) {
      throw new Error(`Account ${params.accountId} not found or disconnected`);
    }

    // Step 2: Pre-upload media to platform CDN
    const uploadedMedia = await step.do('upload-media', async () => {
      if (params.mediaR2Keys.length === 0) return [];
      return uploadMediaToPlatform(this.env, account.platform, params.mediaR2Keys);
    });

    // Step 3: Publish
    const result = await step.do('publish', async () => {
      const provider = getProvider(this.env, params.accountId);
      return provider.publish({
        tenantId: params.tenantId,
        accountId: params.accountId,
        content: params.content,
        mediaR2Keys: params.mediaR2Keys,
      });
    });

    // Step 4: Record result
    await step.do('record-result', async () => {
      await recordPublishResult(this.env, params, result);
    });

    return result;
  }
}
```

---

## Provider Implementations

Each provider is behind a feature flag. A provider must not be instantiated if its flag is off.

| Provider | Feature Flag | Status |
|---|---|---|
| `TwitterProvider` | `social_twitter` | Planned |
| `LinkedInProvider` | `social_linkedin` | Planned |
| `FacebookProvider` | `social_facebook` | Planned |
| `InstagramProvider` | `social_instagram` | Planned |

```typescript
// apps/project-sites/src/services/social/registry.ts

function getProvider(env: Env, accountId: string): SocialProvider {
  const platform = getPlatformFromAccountId(accountId);

  switch (platform) {
    case 'twitter':
      if (!env.SOCIAL_TWITTER_CLIENT_ID) throw new Error('Twitter provider not configured');
      return new TwitterProvider(env);
    case 'linkedin':
      if (!env.SOCIAL_LINKEDIN_CLIENT_ID) throw new Error('LinkedIn provider not configured');
      return new LinkedInProvider(env);
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}
```

---

## API Routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/social/connect` | Initiate OAuth for a platform |
| `GET` | `/api/social/callback/:platform` | OAuth callback handler |
| `GET` | `/api/social/accounts` | List connected accounts for tenant |
| `DELETE` | `/api/social/accounts/:accountId` | Disconnect an account |
| `POST` | `/api/social/publish` | Queue an immediate or scheduled post |
| `GET` | `/api/social/posts` | List publish history |
| `DELETE` | `/api/social/posts/:postId` | Cancel a scheduled post |

---

## Environment Variables

| Variable | Description |
|---|---|
| `SOCIAL_SIGNING_KEY` | HMAC key for signing OAuth state parameters |
| `SOCIAL_DO_NAMESPACE` | Durable Object namespace binding (wrangler.toml) |
| `SOCIAL_R2_BUCKET` | R2 bucket for social media storage (wrangler.toml) |
| `SOCIAL_TWITTER_CLIENT_ID` | Twitter OAuth 2.0 client ID |
| `SOCIAL_TWITTER_CLIENT_SECRET` | Twitter OAuth 2.0 client secret |
| `SOCIAL_LINKEDIN_CLIENT_ID` | LinkedIn OAuth client ID |
| `SOCIAL_LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth client secret |

---

## Related Docs

- [Social publishing overview](./README.md)
- [Postiz reference implementation](./postiz-reference.md)
- [Postiz service docs](../services/postiz.md)
