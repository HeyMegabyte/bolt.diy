# Project Sites Setup Guide

This guide covers setting up the Project Sites platform for development and production.

## Prerequisites

- Node.js 20+
- pnpm 9.14+
- Cloudflare account with Workers, Pages, KV, R2, Queues enabled
- Supabase project
- Stripe account
- SendGrid account
- Google Cloud project (for OAuth + Places API)

## Environment Variables

### Required Secrets (Cloudflare Worker)

Set these using `wrangler secret put <NAME>`:

```
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_live_...

# Cloudflare
CF_API_TOKEN=...
CF_ZONE_ID=...
CF_ACCOUNT_ID=...

# SendGrid
SENDGRID_API_KEY=SG....

# Google
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_PLACES_API_KEY=...

# Sentry
SENTRY_DSN=https://...@sentry.io/...

# Optional
OPENAI_API_KEY=sk-...
CHATWOOT_API_URL=https://...
CHATWOOT_API_KEY=...
NOVU_API_KEY=...
LAGO_API_URL=https://...
LAGO_API_KEY=...
SALE_WEBHOOK_URL=https://...
SALE_WEBHOOK_SECRET=...
```

### Environment Validation

The worker validates required environment variables at startup. Production requires:
- All Supabase, Stripe, Cloudflare, SendGrid, Google, and Sentry credentials
- Stripe keys must be live (not test) in production

## Local Development

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Build Shared Package

```bash
pnpm --filter @project-sites/shared build
```

### 3. Run Worker Locally

```bash
cd apps/project-sites
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your credentials
pnpm dev
```

### 4. Run Tests

```bash
# Unit tests
pnpm --filter @project-sites/shared test

# Integration tests
pnpm --filter @project-sites/worker test:integration
```

## Database Setup

### 1. Create Supabase Project

Create a new project at supabase.com

### 2. Run Migrations

```bash
# Using Supabase CLI
supabase db push --db-url "postgresql://..."

# Or apply migrations manually via Supabase dashboard
```

### 3. Configure RLS

RLS is enabled on all tables. The service role key bypasses RLS for server-side operations.

## Cloudflare Setup

### 1. Create KV Namespace

```bash
wrangler kv:namespace create "CACHE_KV"
wrangler kv:namespace create "CACHE_KV" --preview
```

### 2. Create R2 Bucket

```bash
wrangler r2 bucket create project-sites
```

### 3. Create Queue

```bash
wrangler queues create project-sites-workflows
wrangler queues create project-sites-dlq
```

### 4. Configure Custom Hostnames

Enable Cloudflare for SaaS on your zone for custom domain support.

## Stripe Setup

### 1. Create Products

Create a subscription product for $50/month in Stripe dashboard.

### 2. Configure Webhook

Add webhook endpoint: `https://sites.megabyte.space/webhooks/stripe`

Events to subscribe:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

### 3. Enable Stripe Link

Enable Link in Stripe dashboard settings for faster checkout.

## Google OAuth Setup

### 1. Create OAuth Client

In Google Cloud Console:
- Create OAuth 2.0 Client ID
- Add authorized JavaScript origin: `https://sites.megabyte.space`
- Add authorized redirect URI: `https://sites.megabyte.space/api/auth/google/callback`

### 2. Enable APIs

Enable:
- Google Places API
- Google+ API (for OAuth)

## Deployment

### Staging

```bash
pnpm --filter @project-sites/worker deploy:staging
```

### Production

```bash
pnpm --filter @project-sites/worker deploy:production
```

## Monitoring

### Sentry

Sentry is integrated for error tracking. Configure sampling rates:
- Production: 10% for performance, 100% for errors
- Staging: 100% for both

### Cloudflare Analytics

Use Cloudflare dashboard for:
- Worker metrics
- R2 analytics
- KV metrics
- Queue metrics

### Custom Dashboards

Build dashboards using:
- Supabase: analytics_daily, funnel_events tables
- Admin API: /api/admin/stats endpoint

## Troubleshooting

### Common Issues

1. **Webhook signature verification fails**
   - Ensure STRIPE_WEBHOOK_SECRET is set correctly
   - Check webhook endpoint URL matches

2. **Custom hostnames stuck in pending**
   - Verify CF_API_TOKEN has correct permissions
   - Check DNS CNAME is configured

3. **Session validation fails**
   - Check SUPABASE_SERVICE_ROLE_KEY is correct
   - Verify sessions table has correct RLS policies

### Debug Mode

Set `LOG_LEVEL=debug` for verbose logging.

### Support

File issues at: https://github.com/your-org/bolt.diy/issues
