/**
 * @module commands/sites
 * @description `psctl sites list|get|create` commands.
 */

import { getClient } from '../index.js';
import { ProjectSitesApiError } from '@projectsites/sdk';

function flag(args: string[], name: string): string | undefined {
  const f = args.find((a) => a.startsWith(`--${name}=`));
  return f?.split('=').slice(1).join('=');
}

export async function sitesList(args: string[]): Promise<void> {
  const client = getClient();
  const limit = parseInt(flag(args, 'limit') ?? '20', 10);
  const offset = parseInt(flag(args, 'offset') ?? '0', 10);
  try {
    const res = await client.sites.list({ limit, offset });
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    handleError(err);
  }
}

export async function sitesGet(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) { console.error('Usage: psctl sites get <id>'); process.exit(1); }
  const client = getClient();
  try {
    const site = await client.sites.get(id);
    console.log(JSON.stringify(site, null, 2));
  } catch (err) {
    handleError(err);
  }
}

export async function sitesCreate(args: string[]): Promise<void> {
  const fromJson = flag(args, 'from');
  if (!fromJson) { console.error('Usage: psctl sites create --from=\'{"slug":"...","business_name":"..."}\''); process.exit(1); }

  let data: { slug: string; business_name: string };
  try {
    data = JSON.parse(fromJson) as typeof data;
  } catch {
    console.error('Invalid JSON for --from flag');
    process.exit(1);
  }

  if (!data.slug || !data.business_name) {
    console.error('--from JSON must include "slug" and "business_name"');
    process.exit(1);
  }

  const client = getClient();
  try {
    const site = await client.sites.create(data);
    console.log(JSON.stringify(site, null, 2));
  } catch (err) {
    handleError(err);
  }
}

export async function sitesDeploy(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) { console.error('Usage: psctl deploy <site-id>'); process.exit(1); }
  const client = getClient();
  try {
    const res = await client.sites.deploy(id);
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    handleError(err);
  }
}

export async function sitesSnapshots(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) { console.error('Usage: psctl snapshots list <site-id>'); process.exit(1); }
  const client = getClient();
  try {
    const res = await client.sites.snapshots(id);
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    handleError(err);
  }
}

export async function sitesLogs(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) { console.error('Usage: psctl logs tail <site-id>'); process.exit(1); }
  console.log(`Tailing logs for site ${id}...`);
  console.log('(Connect to /api/sites/:id/logs for streaming log output)');
}

function handleError(err: unknown): void {
  if (err instanceof ProjectSitesApiError) {
    console.error(`Error ${(err as ProjectSitesApiError).statusCode} (${(err as ProjectSitesApiError).code}): ${(err as ProjectSitesApiError).message}`);
  } else {
    console.error('Error:', (err as Error).message);
  }
  process.exit(1);
}
