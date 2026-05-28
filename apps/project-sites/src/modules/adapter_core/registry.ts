/**
 * @module modules/adapter_core/registry
 *
 * @description
 * Single-source-of-truth registry of every `ServiceAdapter`. Routes lazily
 * import each adapter to avoid bundling cost when a tenant only enables a
 * subset of services.
 *
 * Provides:
 *  - `getAdapter(name)` — resolves a name to its implementation
 *  - `listAdapters()` — every adapter (for catalog UI)
 *  - `neonClientFromEnv(env)` — adapter-friendly Neon facade
 *
 * @packageDocumentation
 */
import {
  type NeonClient,
  type ServiceAdapter,
  type ServiceName,
  SERVICE_NAMES,
  isServiceName,
} from './types.js';
import type { Env } from '../../types/env.js';
import { createProject, deleteProject } from '../../services/neon_provisioner.js';

// TODO Wave 2: re-add when adapter_<name>/adapter.ts ships
// import { listmonkAdapter } from '../adapters_listmonk/adapter.js';
// import { calcomAdapter } from '../adapters_calcom/adapter.js';
// import { chatwootAdapter } from '../adapters_chatwoot/adapter.js';
// import { ghostAdapter } from '../adapters_ghost/adapter.js';
// import { openstatusAdapter } from '../adapters_openstatus/adapter.js';
// import { mauticAdapter } from '../adapters_mautic/adapter.js';
// import { documensoAdapter } from '../adapters_documenso/adapter.js';
// import { plausibleAdapter } from '../adapters_plausible/adapter.js';
// import { n8nAdapter } from '../adapters_n8n/adapter.js';
// import { vaultwardenAdapter } from '../adapters_vaultwarden/adapter.js';
// import { outlineAdapter } from '../adapters_outline/adapter.js';
// import { uptimeKumaAdapter } from '../adapters_uptime_kuma/adapter.js';

const REGISTRY: Readonly<Record<ServiceName, ServiceAdapter>> = Object.freeze(
  {} as Record<ServiceName, ServiceAdapter>,
);

/** Resolve a service identifier to its adapter. Throws if unknown. */
export function getAdapter(name: string): ServiceAdapter {
  if (!isServiceName(name)) {
    throw new Error(`Unknown service: ${name}. Known: ${SERVICE_NAMES.join(', ')}`);
  }
  return REGISTRY[name];
}

/** Every adapter, ordered by canonical service-name order. */
export function listAdapters(): readonly ServiceAdapter[] {
  return SERVICE_NAMES.map((n) => REGISTRY[n]);
}

/** Build a thin Neon facade matching the `NeonClient` shape adapters expect. */
export function neonClientFromEnv(env: Env): NeonClient {
  return {
    createProject: (name) => createProject(env, name),
    deleteProject: (id) => deleteProject(env, id),
  };
}
