<!--
GCP Cloud Run fallback — SearXNG serverless container
Referenced by apps/project-sites/infra/searxng/README.md § Fallback Plans
-->
# GCP Cloud Run Fallback — SearXNG

Use if CF Workers Containers, Fly.io, AND Railway are all blocked.

## Prerequisites

- GCP project with billing enabled
- `gcloud` CLI installed and authenticated
- Cloud Run API enabled
- Artifact Registry API enabled

## Deploy Steps

### 1. Set project

```bash
gcloud config set project PROJECT_ID
gcloud auth configure-docker us-central1-docker.pkg.dev
```

### 2. Build and push image

```bash
cd apps/project-sites/infra/searxng
docker build -t us-central1-docker.pkg.dev/PROJECT_ID/searxng/searxng:latest .
docker push us-central1-docker.pkg.dev/PROJECT_ID/searxng/searxng:latest
```

### 3. Store secrets in Secret Manager

```bash
echo -n "$(openssl rand -base64 32)" | gcloud secrets create searxng-secret --data-file=-
echo -n "UPSTASH_REDIS_URL" | gcloud secrets create searxng-valkey-url --data-file=-
```

### 4. Deploy to Cloud Run

```bash
gcloud run deploy projectsites-searxng \
  --image us-central1-docker.pkg.dev/PROJECT_ID/searxng/searxng:latest \
  --region us-central1 \
  --port 8080 \
  --cpu 1 \
  --memory 512Mi \
  --min-instances 0 \
  --max-instances 1 \
  --concurrency 10 \
  --timeout 30 \
  --set-env-vars "SEARXNG_BASE_URL=https://search.projectsites.dev/" \
  --set-env-vars "SEARXNG_LIMITER=true" \
  --set-env-vars "SEARXNG_PUBLIC_INSTANCE=false" \
  --set-secrets "SEARXNG_SECRET=searxng-secret:latest" \
  --set-secrets "SEARXNG_VALKEY_URL=searxng-valkey-url:latest" \
  --allow-unauthenticated
```

### 5. Get URL and point Cloudflare DNS

```bash
gcloud run services describe projectsites-searxng --format='value(status.url)'
# → https://projectsites-searxng-xxxxx-uc.a.run.app
```

Create a CNAME record:
- Name: `search`
- Target: `projectsites-searxng-xxxxx-uc.a.run.app`
- Proxy: ON (orange cloud)

### 6. Restrict to Cloudflare IPs only

Cloud Run allows unauthenticated above so CF Access can reach it. Restrict ingress to Cloudflare IP ranges only:

```bash
# Create an ingress rule that only allows CF IPs (via Cloud Armor or IAP)
# Cloudflare IPs: https://www.cloudflare.com/ips-v4/
gcloud run services update projectsites-searxng \
  --region us-central1 \
  --ingress internal-and-cloud-load-balancing
```

For production, use **Identity-Aware Proxy (IAP)** or **Cloud Armor** IP allowlist for Cloudflare IPs.

### 7. Enable Cloudflare Access

Configure the same CF Access application on `search.projectsites.dev`.

### 8. Verify

```bash
curl -fsS https://search.projectsites.dev/healthz
# → ok
```

## Cost

Cloud Run free tier: 2M requests/month, 360K GB-seconds.
This setup should stay within free tier at typical admin usage.

SearXNG container ~200MB → ~$0.001/GB-s.
At 500 requests/day × 1s each = ~$0.30/month.

## Cleanup

```bash
gcloud run services delete projectsites-searxng --region us-central1
gcloud secrets delete searxng-secret
gcloud secrets delete searxng-valkey-url
gcloud container images delete us-central1-docker.pkg.dev/PROJECT_ID/searxng/searxng:latest
```
