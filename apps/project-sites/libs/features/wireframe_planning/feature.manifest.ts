/**
 * @module libs/features/wireframe_planning/feature.manifest.ts
 * @description Feature manifest for the wireframe planning module.
 *
 * This module lets owners generate a structured section plan for a site before
 * AI site generation begins. It stores a prompt and an ordered list of sections
 * in D1 so the generation pipeline can consume a pre-approved wireframe instead
 * of deriving layout entirely from scratch.
 *
 * @packageDocumentation
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'wireframe_planning',
  name: 'Wireframe Planning',
  description:
    'Generate and store a structured wireframe plan (ordered sections) for a site before AI site generation runs.',
  lifecycle: 'alpha',
  flagKey: 'wireframe_planning',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-17',
  updatedAt: '2026-06-17',
  routes: [],
  apiRoutes: [
    'POST /api/wireframe/plan',
    'GET /api/wireframe/:siteId',
  ],
  permissions: ['site:write', 'site:read'],
  dependencies: ['sites'],
  e2eTests: [],
  unitTests: [
    '../libs/features/wireframe_planning/__tests__/wireframe_planning.test.ts',
  ],
  integrationTests: [],
  testStatus: 'not-started',
  zodSchemas: ['schemas.ts'],
  observability: { sentry: true, logs: true, analytics: false },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes: 'Generation pipeline falls back to prompt-only layout when disabled.',
  },
  risks: ['When disabled the /api/wireframe/* routes return 404; generation pipeline falls back to prompt-only layout.'],
  removalNotes: 'Drop wireframe_plans table and remove handlers from src/index.ts.',
});
