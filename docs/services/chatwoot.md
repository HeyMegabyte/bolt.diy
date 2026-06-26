# Chatwoot

Chatwoot is the customer support platform for projectsites.dev, accessible at **support.projectsites.dev**. It runs on Fly.io because it requires multi-process supervision (Rails, Sidekiq, PostgreSQL, Redis) that CF Containers cannot provide as a single-process runtime.

---

## Deployment: Fly.io

See [fly.md](../deployment/fly.md) for the complete deployment guide.

### fly.toml

```toml
# apps/chatwoot/fly.toml
app = "projectsites-chatwoot"
primary_region = "iad"

[build]
  image = "chatwoot/chatwoot:v3.12.0"

[[services]]
  internal_port = 3000
  protocol = "tcp"

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

  [services.http_checks]
    interval = "30s"
    timeout = "5s"
    grace_period = "60s"
    method = "get"
    path = "/auth/sign_in"
    protocol = "http"

[env]
  RAILS_ENV = "production"
  INSTALLATION_NAME = "ProjectSites Support"
  DEFAULT_LOCALE = "en"
  FRONTEND_URL = "https://support.projectsites.dev"
  FORCE_SSL = "true"
  ENABLE_ACCOUNT_SIGNUP = "false"

# Secrets set via fly secrets set:
# DATABASE_URL (Neon connection string)
# REDIS_URL (Upstash)
# SECRET_KEY_BASE
# MAILER_SENDER_EMAIL
# SMTP_ADDRESS, SMTP_USERNAME, SMTP_PASSWORD
```

---

## Data Layer

### Postgres: Neon (Shared Project)

Chatwoot's Postgres database is provisioned as a **new database** inside an existing Neon project — not a new Neon project. See the [Neon Database Conservation](../../rules/neon-database-conservation.md) rule.

```sql
-- Run against the shared Neon project
CREATE DATABASE projectsites_chatwoot;
```

The `DATABASE_URL` secret is set to the Neon connection string for `projectsites_chatwoot`.

### Redis: Upstash

Chatwoot uses Redis for action cable (websockets), Sidekiq job queue, and caching. Provision a dedicated Upstash Redis database.

```bash
fly secrets set REDIS_URL="rediss://default:<password>@<host>.upstash.io:6379" --app projectsites-chatwoot
```

---

## Environment Variables

| Variable | Description | Where Set |
|---|---|---|
| `CHATWOOT_API_KEY` | Chatwoot API key for Worker integration | Worker secret (wrangler) |
| `CHATWOOT_API_URL` | Base URL of Chatwoot API | Worker secret (`https://support.projectsites.dev`) |
| `CHATWOOT_WEBHOOK_TOKEN` | Secret token for verifying Chatwoot webhooks | Worker secret (wrangler) |
| `CHATWOOT_INBOX_ID` | ID of the inbox that receives support conversations | Worker secret (wrangler) |
| `CHATWOOT_ACCOUNT_ID` | Chatwoot account ID | Worker secret (wrangler) |
| `DATABASE_URL` | Neon Postgres connection string | Fly secret |
| `REDIS_URL` | Upstash Redis connection string | Fly secret |
| `SECRET_KEY_BASE` | Rails secret key | Fly secret |

### Setting Worker Secrets

```bash
wrangler secret put CHATWOOT_API_KEY --env production
wrangler secret put CHATWOOT_API_URL --env production
wrangler secret put CHATWOOT_WEBHOOK_TOKEN --env production
wrangler secret put CHATWOOT_INBOX_ID --env production
wrangler secret put CHATWOOT_ACCOUNT_ID --env production
```

---

## Worker Integration

### Auto-Create Conversation on Support Request

When a user triggers a support request (e.g. clicks "Contact Support" in the admin), the main Worker creates a Chatwoot conversation automatically.

```typescript
// apps/project-sites/src/services/chatwoot.ts

interface CreateConversationParams {
  tenantId: string;
  userId: string;
  userEmail: string;
  userName: string;
  subject: string;
  message: string;
}

export async function createSupportConversation(
  env: Env,
  params: CreateConversationParams,
): Promise<{ conversationId: number } | null> {
  const { tenantId, userId, userEmail, userName, subject, message } = params;

  // 1. Get or create Chatwoot contact
  const contactRes = await fetch(
    `${env.CHATWOOT_API_URL}/api/v1/accounts/${env.CHATWOOT_ACCOUNT_ID}/contacts/search?q=${encodeURIComponent(userEmail)}`,
    {
      headers: {
        'api_access_token': env.CHATWOOT_API_KEY,
        'Content-Type': 'application/json',
      },
    },
  );

  let contactId: number;
  if (contactRes.ok) {
    const data = await contactRes.json<{ payload: { id: number }[] }>();
    if (data.payload.length > 0) {
      contactId = data.payload[0].id;
    } else {
      // Create new contact
      const createRes = await fetch(
        `${env.CHATWOOT_API_URL}/api/v1/accounts/${env.CHATWOOT_ACCOUNT_ID}/contacts`,
        {
          method: 'POST',
          headers: {
            'api_access_token': env.CHATWOOT_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: userName,
            email: userEmail,
            additional_attributes: { tenant_id: tenantId, user_id: userId },
          }),
        },
      );
      const createData = await createRes.json<{ id: number }>();
      contactId = createData.id;
    }
  } else {
    console.warn('[chatwoot] contact search failed', { status: contactRes.status });
    return null;
  }

  // 2. Create conversation
  const convRes = await fetch(
    `${env.CHATWOOT_API_URL}/api/v1/accounts/${env.CHATWOOT_ACCOUNT_ID}/conversations`,
    {
      method: 'POST',
      headers: {
        'api_access_token': env.CHATWOOT_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inbox_id: Number(env.CHATWOOT_INBOX_ID),
        contact_id: contactId,
        additional_attributes: { tenant_id: tenantId, subject },
        initial_message: { content: message },
      }),
    },
  );

  if (!convRes.ok) {
    console.warn('[chatwoot] create conversation failed', { status: convRes.status });
    return null;
  }

  const convData = await convRes.json<{ id: number }>();
  return { conversationId: convData.id };
}
```

---

## Webhook Handler

Chatwoot sends webhooks when conversations are updated (new message, status change, assignment). The Worker verifies the `CHATWOOT_WEBHOOK_TOKEN` before processing.

```typescript
// apps/project-sites/src/routes/webhooks.ts (Chatwoot section)

app.post('/webhooks/chatwoot', async (c) => {
  const token = c.req.header('X-Chatwoot-Signature');
  if (token !== c.env.CHATWOOT_WEBHOOK_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const payload = await c.req.json<{
    event: string;
    conversation?: { id: number; status: string };
    message?: { content: string; conversation_id: number };
  }>();

  switch (payload.event) {
    case 'conversation_status_changed':
      // Notify tenant when their support ticket is resolved
      if (payload.conversation?.status === 'resolved') {
        // TODO: send in-app notification via psnotify
      }
      break;
    case 'message_created':
      // New agent reply — notify tenant
      break;
  }

  return c.json({ ok: true });
});
```

---

## Email Routing to Chatwoot Inbox

Customer emails sent to `support@projectsites.dev` are routed to the Chatwoot inbox via Chatwoot's email inbox feature.

1. In Chatwoot: **Settings → Inboxes → New Inbox → Email**.
2. Set the forwarding address (Chatwoot provides a unique `@chatwoot.io` address).
3. In Resend: add a domain-level catch-all or specific rule forwarding `support@projectsites.dev` to the Chatwoot forwarding address.

Alternatively, configure IMAP polling in Chatwoot to pull from a dedicated `support@projectsites.dev` mailbox.

---

## Related Docs

- [Deployment: Fly.io guide](../deployment/fly.md)
- [Architecture: CF vs Fly split](../architecture/fly-cloudflare-split.md)
- [Architecture overview](../architecture/current.md)
