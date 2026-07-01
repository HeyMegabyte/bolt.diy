<!--
Railway fallback — SearXNG container deploy
Referenced by apps/project-sites/infra/searxng/README.md § Fallback Plans
-->
# Railway Fallback — SearXNG

Use if both CF Workers Containers and Fly.io are blocked.

## Deploy Steps

### 1. Create Railway project

```bash
# Install Railway CLI
brew install railway

# Login + create project
railway login
railway init --name projectsites-searxng
```

### 2. Create a Dockerfile (use the same one)

The repo Dockerfile at `apps/project-sites/infra/searxng/Dockerfile` works on Railway directly.

```bash
railway up --detach
```

### 3. Set secrets

```bash
railway variables set SEARXNG_SECRET=$(openssl rand -base64 32)
railway variables set SEARXNG_VALKEY_URL=<upstash-redis-url>
railway variables set SEARXNG_BASE_URL=https://search.projectsites.dev/
railway variables set SEARXNG_LIMITER=true
railway variables set SEARXNG_PUBLIC_INSTANCE=false
```

### 4. Configure port

Railway auto-detects port 8080 from the Dockerfile `EXPOSE`.

### 5. Get the Railway domain

```bash
railway domain
# → something.railway.app
```

### 6. Point Cloudflare DNS

Create a CNAME record:
- Name: `search`
- Target: `<app>.railway.app`
- Proxy: ON (orange cloud)

### 7. Enable Cloudflare Access

The CF Access policy now protects the Railway backend. Configure the same Access application on `search.projectsites.dev`.

### 8. Verify

```bash
curl -fsS https://search.projectsites.dev/healthz
# → ok

curl -I https://search.projectsites.dev/
# → CF Access login page or redirect
```

## Cost

Railway ~$5/month for basic container (1 vCPU, 512MB RAM).

## Cleanup

```bash
railway down
railway project delete
```
