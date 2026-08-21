# ProjectSites.dev — Security & Supply-Chain

> **Canonical doctrine is global**, not here. The full supply-chain toolchain + method lives in
> the `~/.agentskills` `security-supply-chain` skill (the unified `/security-supply-chain` audit
> command) + the `ai-agent-security`, `supply-chain-integrity`, and `lint-doctrine` rules. This
> file keeps only the **repo-specific delta**: the CI gate checklist this project enforces.

## What this project enforces (the delta)

- **Gitleaks** — pre-commit (lefthook) + CI full-history; verified finding = hard block; rotate immediately (rotation is `approval-required`).
- **OSV-Scanner + Trivy** — lockfile + Dockerfile/IaC vuln scan; block on fixable critical/high.
- **Semgrep** — OWASP Top 10 + `templates/lint-stack/semgrep-custom/*.yml`; block on high-severity hit. Repo-specific checks: parameterized Drizzle only, SSRF (validate fetched URLs), IDOR (`orgId` server-side, never client `x-org-id`).
- **Syft → Grype** — SBOM per release artifact/image; release blocks on a critical with a fix.
- **Cosign / Sigstore** — sign every published image + release artifact (keyless OIDC); attach SBOM + provenance.
- **Supply-chain hardening** — GitHub Actions SHA-pinned (not tags); OIDC for cloud auth (`cloudflare/wrangler-action@v3`), never long-lived `CLOUDFLARE_API_TOKEN`/`AWS_*` secrets; least-privilege, scoped, expiring keys for the platform MCP.

Run `/security-supply-chain` for the unified audit.
