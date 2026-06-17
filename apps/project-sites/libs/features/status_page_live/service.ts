/**
 * @module libs/features/status_page_live/service
 * @description Business logic for the status_page_live feature module.
 *
 * @remarks
 * Manages the platform status feed and incident lifecycle. Derives an overall
 * platform health status from open incidents: `critical` severity drives
 * `outage`, `major` drives `degraded`, and `operational` when no open incidents.
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { dbQuery, dbInsert } from '../../../src/services/db.js';
import type { StatusIncident, OverallStatus } from './schemas.js';

export const FLAG_KEY = 'status_page_live';

interface IncidentRow {
  id: string;
  title: string;
  severity: string;
  message: string;
  status: string;
  created_at: string;
}

/**
 * Fetch the current status feed.
 *
 * @remarks
 * Queries recent open incidents (most recent 20, ordered by created_at DESC).
 * Derives overall platform status:
 * - Any `critical` incident → `outage`
 * - Any `major` incident → `degraded`
 * - Otherwise → `operational`
 *
 * @param env - Worker environment bindings
 * @returns Overall status string + list of open incidents
 */
export async function getStatusFeed(
  env: Env,
): Promise<{ status: OverallStatus; incidents: StatusIncident[] }> {
  const { data: rows } = await dbQuery<IncidentRow>(
    env.DB,
    `SELECT id, title, severity, message, status, created_at
     FROM status_incidents
     WHERE status = 'open'
     ORDER BY created_at DESC
     LIMIT 20`,
    [],
  );

  const incidents: StatusIncident[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    severity: r.severity as StatusIncident['severity'],
    message: r.message,
    status: r.status as StatusIncident['status'],
    createdAt: r.created_at,
  }));

  let status: OverallStatus = 'operational';
  for (const inc of incidents) {
    if (inc.severity === 'critical') {
      status = 'outage';
      break;
    }
    if (inc.severity === 'major') {
      status = 'degraded';
    }
  }

  return { status, incidents };
}

/**
 * Create a new status incident.
 *
 * @param env - Worker environment bindings
 * @param data - Incident fields (title, severity, message)
 * @returns The newly created StatusIncident
 */
export async function createIncident(
  env: Env,
  data: { title: string; severity: string; message: string },
): Promise<StatusIncident> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await dbInsert(env.DB, 'status_incidents', {
    id,
    title: data.title,
    severity: data.severity,
    message: data.message,
    status: 'open',
    created_at: now,
    updated_at: now,
  });

  return {
    id,
    title: data.title,
    severity: data.severity as StatusIncident['severity'],
    message: data.message,
    status: 'open',
    createdAt: now,
  };
}
