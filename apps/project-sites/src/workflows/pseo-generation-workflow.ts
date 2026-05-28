/**
 * @module workflows/pseo-generation-workflow
 * @description Cloudflare Workflow for pSEO matrix page generation.
 *
 * Triggered by `POST /api/pseo/:siteId/generate`. Builds the matrix
 * (inserts draft rows) then generates content for approved-ready rows.
 *
 * @packageDocumentation
 */

import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { Env } from '../types/env.js';
import {
  buildPseoMatrix,
  generatePseoPageContent,
  getPseoMatrixStats,
} from '../services/pseo_matrix.js';
import { dbQuery } from '../services/db.js';
import { isFlagOn } from '../modules/feature_flags/services.js';

export interface PseoGenerationParams {
  siteId: string;
  orgId: string;
}

export class PseoGenerationWorkflow extends WorkflowEntrypoint<Env, PseoGenerationParams> {
  override async run(event: WorkflowEvent<PseoGenerationParams>, step: WorkflowStep): Promise<void> {
    const { siteId, orgId } = event.payload;

    const flagOn = await step.do('check-flag', async () => {
      return await isFlagOn(this.env, 'pseo_matrix_builder');
    });

    if (!flagOn) {
      console.warn('[pseo-wf] flag off — aborting');
      return;
    }

    // Step 1: build matrix rows
    const buildResult = await step.do('build-matrix', async () => {
      return await buildPseoMatrix(this.env, siteId, orgId);
    });

    console.warn(`[pseo-wf] matrix built: queued=${buildResult.queued} skipped=${buildResult.skipped}`);

    // Step 2: generate content for new draft rows (up to 200)
    const { data: newRows } = await dbQuery<{ id: string }>(
      this.env.DB,
      `SELECT id FROM pseo_pages
       WHERE site_id = ? AND status = 'draft' AND html_content IS NULL
       AND deleted_at IS NULL
       LIMIT 200`,
      [siteId],
    );

    const batchSize = 5;
    for (let i = 0; i < newRows.length; i += batchSize) {
      const batch = newRows.slice(i, i + batchSize);

      await step.do(`generate-content-${i / batchSize}`, async () => {
        for (const { id } of batch) {
          try {
            await generatePseoPageContent(this.env, id);
          } catch (err) {
            console.warn(`[pseo-wf] page ${id} failed: ${String(err)}`);
          }
        }
        return { generated: batch.length };
      });
    }

    // Step 3: log summary
    await step.do('log-stats', async () => {
      return await getPseoMatrixStats(this.env, siteId);
    });
  }
}
