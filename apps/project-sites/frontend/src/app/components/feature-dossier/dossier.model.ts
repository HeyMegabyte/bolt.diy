/**
 * Feature / Feature-Flag "Spec Sheet" model + the pure builders behind it.
 *
 * Split from the component so the markdown assembly + coverage maths are unit-
 * testable without TestBed. `buildDossierMarkdown` produces a complete GFM
 * document — enough to fully document AND integrate the capability — and
 * `coverageSignal` derives a transparent documentation+test score (NOT a claim
 * of literal line coverage; it's a completeness signal from the artifacts that
 * exist).
 */

export interface DossierModel {
  /** 'Feature Flag' (Layer 1) or 'Feature' (Layer 2). */
  kind: 'Feature Flag' | 'Feature';
  key: string;
  name: string;
  /** One-paragraph human summary (description or explanation). */
  summary: string;
  /** Longer mechanism prose, if distinct from the summary. */
  explanation?: string;
  /** "What it does" checkpoints. */
  checklist?: readonly string[];
  /** Copy-pasteable verification steps. */
  smokeTest?: readonly string[];
  /** Playwright spec paths covering this capability. */
  e2eTests?: readonly string[];
  /** External docs / research links. */
  references?: readonly string[];
  stage?: string;
  rolloutPercent?: number;
  owner?: string;
  enabled?: boolean;
  /** Feature-only (Layer 2). */
  requiredPlan?: string;
  category?: string;
  entitled?: string;
}

const STAGES = ['experimental', 'beta', 'stable', 'deprecated'] as const;

/** Transparent documentation + test completeness score (0-100) + its parts. */
export function coverageSignal(m: DossierModel): {
  score: number;
  label: string;
  parts: ReadonlyArray<{ label: string; got: boolean; pts: number }>;
} {
  const stageBase: Record<string, number> = { experimental: 25, beta: 55, stable: 90, deprecated: 70, killswitch: 10 };
  const base = stageBase[m.stage ?? 'experimental'] ?? 25;
  const e2e = m.e2eTests?.length ?? 0;
  const parts = [
    { label: 'Lifecycle stage', got: true, pts: Math.round(base * 0.4) },
    { label: 'Checklist documented', got: (m.checklist?.length ?? 0) > 0, pts: 10 },
    { label: 'Smoke test steps', got: (m.smokeTest?.length ?? 0) > 0, pts: 10 },
    { label: 'E2E spec linked', got: e2e >= 1, pts: 15 },
    { label: 'E2E specs ≥ 2', got: e2e >= 2, pts: 5 },
    { label: 'Mechanism explained', got: (m.explanation?.length ?? 0) > 0, pts: 5 },
    { label: 'Sources cited', got: (m.references?.length ?? 0) > 0, pts: 5 },
  ];
  const earned = parts.reduce((s, p) => s + (p.got ? p.pts : 0), 0);
  const score = Math.max(0, Math.min(100, earned));
  const label = score >= 85 ? 'Well covered' : score >= 60 ? 'Adequately covered' : score >= 35 ? 'Partially covered' : 'Lightly covered';
  return { score, label, parts };
}

/** Estimated read time in minutes from a word count (≈220 wpm, min 1). */
export function readMinutes(words: number): number {
  return Math.max(1, Math.round(words / 220));
}

function bullet(items: readonly string[] | undefined, prefix = '- '): string {
  return (items ?? []).map((i) => `${prefix}${i}`).join('\n');
}

/**
 * Assemble the full GFM dossier. Pure + deterministic so a snapshot test can
 * assert section presence. The output is intentionally integration-complete:
 * the "Integration guide" section carries the exact server + UI guard snippets,
 * flag key, promotion path and module locations.
 */
export function buildDossierMarkdown(m: DossierModel): string {
  const isFlag = m.kind === 'Feature Flag';
  const cov = coverageSignal(m);
  const out: string[] = [];

  out.push(`> **${m.kind}** · \`${m.key}\`${m.enabled !== undefined ? ` · ${m.enabled ? 'ON' : 'OFF'}` : ''}`);
  out.push('');
  out.push('## Overview');
  out.push(m.summary || '_No summary documented yet._');

  if (m.explanation && m.explanation.trim() && m.explanation.trim() !== m.summary.trim()) {
    out.push('');
    out.push('## How it works');
    out.push(m.explanation);
  }

  out.push('');
  out.push('## At a glance');
  out.push('| Property | Value |');
  out.push('| --- | --- |');
  out.push(`| Key | \`${m.key}\` |`);
  if (m.stage) out.push(`| Lifecycle stage | ${m.stage} |`);
  if (m.rolloutPercent !== undefined) out.push(`| Rollout | ${m.rolloutPercent}% |`);
  if (m.enabled !== undefined) out.push(`| Status | ${m.enabled ? 'On' : 'Off'} |`);
  if (m.requiredPlan) out.push(`| Required plan | ${m.requiredPlan}${m.category ? ` · ${m.category}` : ''} |`);
  if (m.owner) out.push(`| Owner | ${m.owner} |`);
  out.push(`| Coverage signal | ${cov.score}/100 — ${cov.label} |`);

  if (m.checklist?.length) {
    out.push('');
    out.push('## What it does');
    out.push(m.checklist.map((c) => `- [x] ${c}`).join('\n'));
  }

  out.push('');
  out.push('## Lifecycle & rollout');
  out.push(
    isFlag
      ? `Promotion path: **experimental → beta (5–25%) → stable (100%)**. This flag is at **${m.stage ?? 'experimental'}**${m.rolloutPercent !== undefined ? ` with a ${m.rolloutPercent}% rollout` : ''}. Disable safely at any time — the server returns 404 (never 403) and the UI renders nothing when off.`
      : `Owner-facing capability${m.requiredPlan ? ` included on the **${m.requiredPlan}** plan and above` : ''}. Toggling is entitlement-checked server-side and tenant-isolated; the live site updates instantly and the change is undoable.`,
  );

  if (m.smokeTest?.length) {
    out.push('');
    out.push('## Smoke test (2-minute verification)');
    out.push(m.smokeTest.map((s, i) => `${i + 1}. \`${s}\``).join('\n'));
  }

  out.push('');
  out.push('## Automated coverage');
  if (m.e2eTests?.length) {
    out.push('Playwright specs exercising this against the prod URL:');
    out.push('');
    out.push(bullet(m.e2eTests.map((p) => `\`${p}\``)));
  } else {
    out.push('_No E2E specs linked yet._ Per the feature-flags rule, a promoted flag must carry at least one Playwright spec before reaching `beta`.');
  }
  out.push('');
  out.push(`Coverage signal: **${cov.score}/100 — ${cov.label}.** Breakdown:`);
  out.push('');
  out.push(cov.parts.map((p) => `- [${p.got ? 'x' : ' '}] ${p.label} (+${p.pts})`).join('\n'));

  out.push('');
  out.push('## Integration guide');
  if (isFlag) {
    out.push('Wire this capability end-to-end:');
    out.push('');
    out.push(`1. **Reserve the key** in \`src/modules/feature_flags/registry.ts\` at \`enabled=false, rollout_percent=0, stage='experimental'\`.`);
    out.push('2. **Guard the server route** — return 404 (never 403) when off:');
    out.push('');
    out.push('```ts');
    out.push(`if (!(await isFlagOn(env, '${m.key}', { orgId, siteId, userId, anonId }))) {`);
    out.push('  return c.notFound();');
    out.push('}');
    out.push('```');
    out.push('3. **Guard the UI** component:');
    out.push('');
    out.push('```ts');
    out.push(`if (!useFeatureFlag('${m.key}')) return null;`);
    out.push('```');
    out.push(`4. **Document it** in \`src/modules/feature_flags/docs.ts\` (checklist + explanation + smoke_test + e2e_tests).`);
    out.push(`5. **Add E2E** specs under \`e2e/_fortress/${m.key}/\` (happy-path + adversarial).`);
    out.push('6. **Promote** in `/admin/feature-flags`: experimental → beta → stable.');
  } else {
    out.push('Wire this owner-facing feature:');
    out.push('');
    out.push(`1. **Catalog entry** in \`src/routes/features.ts\` \`SITE_FEATURE_CATALOG\` (+ the frontend mirror) with \`requiredPlan\` + \`category\`.`);
    out.push(`2. **Capability checklist** in the frontend \`FEATURE_CAPABILITIES['${m.key}']\`.`);
    out.push('3. **Server feature module** at `libs/features/' + m.key + '/` (manifest + schemas + handlers + service + tests).');
    out.push(`4. **Entitlement** — the toggle is gated by plan rank server-side; \`POST /api/site-features/${m.key}\` flips state per tenant.`);
    out.push(`5. **Add E2E** under \`apps/project-sites/e2e/${m.key}/\`.`);
  }

  if (m.references?.length) {
    out.push('');
    out.push('## Sources & references');
    out.push(bullet(m.references.map((r) => `[${r}](${r})`)));
  }

  return out.join('\n');
}

/** Word count of the rendered dossier (for read-time + a metric chip). */
export function wordCount(md: string): number {
  return md.split(/\s+/).filter(Boolean).length;
}

/** Section headings (## …) → TOC entries with slug anchors. */
export function tableOfContents(md: string): ReadonlyArray<{ title: string; slug: string }> {
  return md
    .split('\n')
    .filter((l) => l.startsWith('## '))
    .map((l) => {
      const title = l.replace(/^##\s+/, '').trim();
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      return { title, slug };
    });
}

export { STAGES };
