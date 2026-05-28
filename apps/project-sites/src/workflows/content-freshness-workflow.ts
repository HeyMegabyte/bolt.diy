/**
 * @module workflows/content-freshness-workflow
 * @description Cloudflare Workflow wrapper for content freshness processing.
 *
 * Triggered by the daily cron or via `POST /api/content/freshness/trigger`.
 * Wraps `scheduledContentFreshness` in a durable, retryable Workflow step.
 *
 * @packageDocumentation
 */

import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { Env } from '../types/env.js';
import { scanStaleSections, rewriteSection, createRewriteDraft } from '../services/content_freshness.js';
import { isFlagOn } from '../modules/feature_flags/services.js';

export interface ContentFreshnessParams {
  triggeredBy: 'cron' | 'manual';
  maxSections?: number;
}

export class ContentFreshnessWorkflow extends WorkflowEntrypoint<Env, ContentFreshnessParams> {
  override async run(event: WorkflowEvent<ContentFreshnessParams>, step: WorkflowStep): Promise<void> {
    const flagOn = await step.do('check-flag', async () => {
      return await isFlagOn(this.env, 'content_freshness');
    });

    if (!flagOn) {
      console.warn('[content-freshness-wf] flag off — aborting workflow');
      return;
    }

    const candidates = await step.do('scan-stale-sections', async () => {
      return await scanStaleSections(this.env);
    });

    if (candidates.length === 0) {
      console.warn('[content-freshness-wf] no candidates found');
      return;
    }

    // Process in batches of 10 for durability
    const batchSize = 10;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);

      await step.do(`process-batch-${i / batchSize}`, async () => {
        for (const candidate of batch) {
          try {
            // Load brand voice inline to avoid passing large objects between steps
            const brandVoice = 'Professional, clear, and trustworthy.';
            const { html, tokensUsed } = await rewriteSection(this.env, candidate, brandVoice);
            await createRewriteDraft(this.env, candidate, html, tokensUsed);
          } catch (err) {
            console.warn(`[content-freshness-wf] section ${candidate.sectionKey} failed: ${String(err)}`);
          }
        }
        return { processed: batch.length };
      });
    }
  }
}
