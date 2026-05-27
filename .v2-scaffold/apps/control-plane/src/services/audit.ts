/**
 * Append-only audit log writer.
 */

import { dbInsert } from './db.js';
import type { Env } from '../env.js';

export interface AuditEntry {
  actor_user_id: string | null;
  actor_email: string | null;
  tenant_id: string | null;
  event: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
}

export async function writeAudit(env: Env, entry: AuditEntry): Promise<void> {
  await dbInsert(env.DB, 'audit', {
    id: crypto.randomUUID(),
    actor_user_id: entry.actor_user_id,
    actor_email: entry.actor_email,
    tenant_id: entry.tenant_id,
    event: entry.event,
    target_type: entry.target_type,
    target_id: entry.target_id,
    metadata_json: JSON.stringify(entry.metadata),
    ip: entry.ip,
    user_agent: entry.user_agent,
  });
}
