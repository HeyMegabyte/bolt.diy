# Post-Deploy Verification Playbook

Run these checks after every deployment. Do not declare a deploy complete until all checks pass.

The script `scripts/verify-all-services.sh` automates the curl-based checks (marked with "automated" below). Playwright-based checks require a running browser session.

---

## Verification Checklist

| Check | Command | Expected Result | Automated |
|---|---|---|---|
| Worker health | `curl -sf https://projectsites.dev/health` | HTTP 200, `{"status":"ok"}` | Yes |
| Worker JSON-LD | `curl -s https://projectsites.dev/ \| grep application/ld+json` | JSON-LD present | Yes |
| Marketing homepage | `curl -sf -o /dev/null -w "%{http_code}" https://projectsites.dev/` | `200` | Yes |
| Admin SPA | `curl -sf -o /dev/null -w "%{http_code}" https://projectsites.dev/admin` | `200` | Yes |
| PostHog ingestion | See PostHog section below | Event appears in PostHog | Yes |
| Axiom log ingestion | See Axiom section below | Log line appears in Axiom Play | Yes |
| OTel spans visible | See OTel section below | Spans in Axiom | Manual |
| ClickHouse query | `curl ... "SELECT 1"` | `1` | Yes |
| Chatwoot API | `curl -I https://support.projectsites.dev/auth/sign_in` | HTTP 200 | Yes |
| Postiz API | `curl -I https://social.projectsites.dev/` | HTTP 200 | Yes |
| social.projectsites.dev | `curl -sf -o /dev/null -w "%{http_code}" https://social.projectsites.dev/` | `200` | Yes |
| support.projectsites.dev | `curl -sf -o /dev/null -w "%{http_code}" https://support.projectsites.dev/` | `200` | Yes |
| Editor embed | `curl -sf -o /dev/null -w "%{http_code}" https://editor.projectsites.dev/` | `200` | Yes |
| Site serving (test site) | `curl -sf https://megabytespace.projectsites.dev/` | HTTP 200, site HTML | Yes |
| Security headers | See headers section below | CSP, HSTS, X-Frame-Options present | Yes |

---

## Detailed Checks

### Worker Health

```bash
curl -sf https://projectsites.dev/health
# Expected:
# {"status":"ok","version":"<worker-version>","timestamp":"<iso8601>"}
```

### PostHog Ingestion

Send a test event and verify it appears in PostHog within 30 seconds.

```bash
curl -X POST https://us.i.posthog.com/capture \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "'$POSTHOG_API_KEY'",
    "event": "deploy.verification",
    "distinct_id": "deploy-verify-bot",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "properties": {
      "env": "production",
      "source": "verify-all-services"
    }
  }'
# Expected: HTTP 200, {"status":1}

# Then query in PostHog UI: Events → filter by event = "deploy.verification" (last 5 min)
# Or via PostHog MCP: posthog exec "SELECT count() FROM events WHERE event = 'deploy.verification' AND timestamp > now() - INTERVAL 5 MINUTE"
```

### Axiom Log Ingestion

```bash
curl -X POST "https://api.axiom.co/v1/datasets/${AXIOM_DATASET}/ingest" \
  -H "Authorization: Bearer ${AXIOM_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '[{
    "_time": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "level": "info",
    "service": "project-sites",
    "env": "production",
    "message": "deploy.verification test log",
    "trace_id": "verify-'$(date +%s)'"
  }]'
# Expected: HTTP 200

# Verify in Axiom Play (logs.projectsites.dev):
# ['project-sites-production'] | where message contains "deploy.verification" | where _time >= ago(5m)
```

### OTel Spans Visible

Trigger a real request and check spans appear in Axiom.

```bash
# Make a real request that creates OTel spans
curl -sf https://projectsites.dev/health

# In Axiom Play, query by the CF-Ray header from the response:
# ['project-sites-production'] | where cf_ray == "<ray-id-from-response-header>"
```

### ClickHouse Query

```bash
curl -u "default:${CLICKHOUSE_PASSWORD}" \
  "https://projectsites-clickhouse.fly.dev/?query=SELECT+version()"
# Expected: 24.x.x.x
```

### Chatwoot API Reachable

```bash
curl -I \
  -H "CF-Access-Client-Id: ${CF_SERVICE_TOKEN_ID}" \
  -H "CF-Access-Client-Secret: ${CF_SERVICE_TOKEN_SECRET}" \
  https://support.projectsites.dev/auth/sign_in
# Expected: HTTP/2 200
```

### Postiz API Reachable

```bash
curl -I https://social.projectsites.dev/
# Expected: HTTP/2 200
```

### Security Headers

```bash
curl -sI https://projectsites.dev/ | grep -iE "content-security-policy|strict-transport-security|x-frame-options|x-content-type-options"
# Expected (all must be present):
# strict-transport-security: max-age=31536000; includeSubDomains; preload
# x-frame-options: SAMEORIGIN  (or CSP frame-ancestors)
# x-content-type-options: nosniff
# content-security-policy: (non-empty value)
```

### Site Serving (Test Site)

```bash
curl -sf https://megabytespace.projectsites.dev/
# Expected: HTTP 200, HTML with site content (not blank, not the marketing homepage)

# Verify it is NOT the marketing homepage:
curl -s https://megabytespace.projectsites.dev/ | grep -v "projectsites.dev" | head -5
```

---

## Automated Script

`scripts/verify-all-services.sh` runs all curl-based checks above and exits non-zero if any fail.

```bash
# Run all automated checks
./scripts/verify-all-services.sh

# The script sources get-secret for credentials:
# POSTHOG_API_KEY, AXIOM_API_KEY, AXIOM_DATASET, CLICKHOUSE_PASSWORD,
# CF_SERVICE_TOKEN_ID, CF_SERVICE_TOKEN_SECRET
```

Expected output:
```
[ok] Worker health: {"status":"ok"}
[ok] PostHog ingestion: 200
[ok] Axiom log ingestion: 200
[ok] ClickHouse query: 24.6.x
[ok] Chatwoot API: 200
[ok] Postiz API: 200
[ok] social.projectsites.dev: 200
[ok] support.projectsites.dev: 200
[ok] Site serving (megabytespace): 200
[ok] Security headers: HSTS + CSP present

All checks passed.
```

---

## When a Check Fails

| Failure | First step |
|---|---|
| Worker health 500/503 | `wrangler tail --env production` — look for unhandled exception |
| PostHog ingestion fails | Check `POSTHOG_API_KEY` secret is set: `wrangler secret list --env production` |
| Axiom ingestion fails | Check `AXIOM_API_KEY` and `AXIOM_DATASET` secrets |
| ClickHouse unreachable | `fly status --app projectsites-clickhouse` |
| Chatwoot unreachable | `fly status --app projectsites-chatwoot` + check CF Access policy |
| Site serving 404/500 | Check R2 object exists: `wrangler r2 object get project-sites-production/sites/{slug}/...` |
| Security headers missing | Check `apps/project-sites/src/middleware/security_headers.ts` deployed correctly |

---

## Related Docs

- [Deployment: Fly.io guide](./fly.md)
- [Observability overview](../observability/README.md)
- [Architecture overview](../architecture/current.md)
