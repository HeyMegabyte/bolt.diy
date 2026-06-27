/**
 * @module durable_objects/app_runtime_subclasses
 *
 * @description
 * Per-image Durable Object subclasses of {@link AppRuntimeContainer}, one per
 * top-10 catalog app. Cloudflare Containers (CFC) binds the container image
 * at `wrangler.toml` config time — `image = "registry/name:tag"` per
 * `[[containers]]` block — so each catalog app that we actually want to boot
 * needs its own DO class + matching `[[containers]]` block pointing at the
 * upstream image.
 *
 * Every subclass is otherwise identical to the base — all lifecycle / proxy
 * / log / restart logic lives in {@link AppRuntimeContainer}. The static
 * `APP_SLUG` field maps the class to its catalog row so the dispatcher can
 * route an `app_instances` row to the right binding by slug.
 *
 * When CFC ships dynamic-image-at-runtime, this file collapses to a single
 * delete + flip the dispatcher back to the generic `APP_RUNTIME` binding.
 *
 * @packageDocumentation
 */

import { AppRuntimeContainer } from './app_runtime.js';

/** Umami — `ghcr.io/umami-software/umami:postgresql-latest` port 3000 */
export class UmamiContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'umami';
  override defaultPort = 3000;
}

/** Outline — `outlinewiki/outline:latest` port 3000 */
export class OutlineContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'outline';
  override defaultPort = 3000;
}

/** n8n — `n8nio/n8n:latest` port 5678 */
export class N8nContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'n8n';
  override defaultPort = 5678;
}

/** Vaultwarden — `vaultwarden/server:latest` port 80 */
export class VaultwardenContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'vaultwarden';
  override defaultPort = 80;
}

/** Uptime Kuma — `louislam/uptime-kuma:1` port 3001 */
export class UptimeKumaContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'uptime-kuma';
  override defaultPort = 3001;
}

/** NocoDB — `nocodb/nocodb:latest` port 8080 */
export class NocodbContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'nocodb';
  override defaultPort = 8080;
}

/** Listmonk — `listmonk/listmonk:latest` port 9000 */
export class ListmonkContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'listmonk';
  override defaultPort = 9000;
}

/** Memos — `neosmemo/memos:stable` port 5230 */
export class MemosContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'memos';
  override defaultPort = 5230;
}

/** PocketBase — `spectado/pocketbase:latest` port 8090 */
export class PocketbaseContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'pocketbase';
  override defaultPort = 8090;
}

/** Open WebUI — `ghcr.io/open-webui/open-webui:main` port 8080 */
export class OpenWebuiContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'open-webui';
  override defaultPort = 8080;
}

/**
 * Catalog-slug → DO class-name map. Drives the dispatcher's binding-lookup
 * table and the runtime existence check (`isSupportedSlug`).
 *
 * Keep in lockstep with the `wrangler.toml` `[[env.production.containers]]`
 * blocks + the `[[env.production.durable_objects.bindings]]` `name` fields.
 */
export const SUPPORTED_APP_SLUGS = [
  'umami',
  'outline',
  'n8n',
  'vaultwarden',
  'uptime-kuma',
  'nocodb',
  'listmonk',
  'memos',
  'pocketbase',
  'open-webui',
] as const;

export type SupportedAppSlug = (typeof SUPPORTED_APP_SLUGS)[number];

/** Type-guard for catalog slugs the dispatcher can route. */
export function isSupportedSlug(slug: string): slug is SupportedAppSlug {
  return (SUPPORTED_APP_SLUGS as readonly string[]).includes(slug);
}
