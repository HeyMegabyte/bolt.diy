# ProjectSites.dev — Security & Supply-Chain

> The supply-chain + DAST toolchain for the platform. Secret scanning, dependency/vuln scanning,
> SBOM, code security rules, live-surface scanning, and artifact signing. Wired into CI; secret +
> dependency gates block the merge. Stack source: `docs/STACK.md` §Observability/quality.

## Toolchain

| Tool | Status | Stage | Purpose |
|------|--------|-------|---------|
| **Gitleaks** | Core | pre-commit + CI | Block secrets before they land |
| **Renovate** | Core | scheduled | Dependency update PRs |
| **Semgrep** | Recommended | CI | OWASP Top 10 + custom code rules |
| **Trivy** | Recommended | CI | Container/filesystem/IaC vuln scan |
| **OSV-Scanner** | Recommended | CI | Lockfile vuln scan (OSV database) |
| **Syft** | Recommended | CI/release | Generate SBOM (CycloneDX/SPDX) |
| **Grype** | Recommended | CI/release | Scan the Syft SBOM for vulns |
| **Nuclei** | Conditional | scheduled/manual | DAST against live surfaces |
| **OWASP ZAP** | Conditional | scheduled/manual | DAST against live surfaces |
| **Cosign / Sigstore** | Recommended | release | Sign + attest build artifacts/images |

## Secret scanning (Gitleaks)

- `gitleaks protect` at pre-commit (lefthook) blocks a commit that introduces a secret.
- `gitleaks detect` in CI scans the full history on every push.
- Any verified finding is a hard block. Rotate the exposed secret immediately (rotation is `approval-required` per autonomous-engineering).
- Self-generable secrets (HMAC/session/JWT/signing keys) are auto-generated via `openssl rand`, never hand-pasted; data-at-rest `*_ENCRYPTION_KEY` is detect-only (auto-gen destroys persisted data).

## Dependency + vuln scanning

- **OSV-Scanner** on the lockfile every CI run — fails on a known-exploitable vuln with a fix available.
- **Trivy** on Dockerfiles + filesystem + IaC — config misconfig + CVE scan.
- **Renovate** opens grouped update PRs; security updates are prioritized + auto-merged when tests pass.
- No `git+https` deps — every package resolves from the npm registry (no private GitLab/Megabyte packages).

## SBOM (Syft → Grype)

- **Syft** generates an SBOM (CycloneDX) per release artifact / container image.
- **Grype** scans that SBOM for vulns; release blocks on a critical with a fix.
- SBOM is attached to the GitHub Release + signed (below).

## Code security rules (Semgrep)

- OWASP Top 10 ruleset + custom rules in `templates/lint-stack/semgrep-custom/*.yml`.
- Every novel finding becomes a new rule the same turn (self-improving).
- Checks: injection (parameterized Drizzle only), hardcoded secrets, missing auth checks, SSRF (validate fetched URLs), XSS (DOMPurify + Trusted Types), IDOR (derive `orgId` server-side, never from a client `x-org-id` header).

## DAST (Nuclei / OWASP ZAP) — conditional

- Run against `projectsites.dev` + a sample `{slug}.projectsites.dev` on a schedule, not every push.
- Gate on `workflow_dispatch` / release — not on the PR critical path.
- Findings triaged into the security backlog; criticals block the next release.

## Artifact signing (Cosign / Sigstore)

- Sign every published container image + release artifact with Cosign (keyless/OIDC via Sigstore).
- Attach the SBOM + provenance attestation to the signature.
- Deploy targets verify the signature before pulling (where the platform supports it).

## CI gate policy

- [ ] Gitleaks (pre-commit + CI) — blocks on verified secret
- [ ] OSV-Scanner + Trivy — block on fixable critical/high
- [ ] Semgrep — block on high-severity rule hit
- [ ] Syft SBOM generated + Grype clean on release
- [ ] Cosign signature + attestation on every release artifact
- [ ] Nuclei/ZAP scheduled scans triaged (non-blocking on PR)

## Supply-chain hardening

- GitHub Actions pinned by commit SHA (not mutable tags).
- OIDC for cloud auth (`cloudflare/wrangler-action@v3` + GitHub OIDC) — never long-lived `CLOUDFLARE_API_TOKEN`/`AWS_*` secrets.
- Least-privilege tokens; scoped, expiring API keys for the platform MCP.

## See

- `docs/STACK.md` §Observability/quality · `rules/ai-agent-security` · `rules/lint-doctrine`
- `rules/supply-chain-integrity` · `/security-supply-chain` skill (unified audit command)
