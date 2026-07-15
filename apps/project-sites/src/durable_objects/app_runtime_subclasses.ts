/**
 * @module durable_objects/app_runtime_subclasses
 * @description Per-image DO subclasses for catalog apps deployable on CFC+Neon+Upstash.
 * Excludes GPU apps + unprofessional/ugly UIs + always-on services (Postiz: BullMQ scheduler).
 * @packageDocumentation
 */

import { AppRuntimeContainer } from './app_runtime.js';

/** AnythingLLM — `mintplexlabs/anythingllm:latest` port 3001 */
export class AnythingLlmContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'anything-llm';
  override defaultPort = 3001;
}
/** Appsmith — `appsmith/appsmith-ce:latest` port 80 */
export class AppsmithContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'appsmith';
  override defaultPort = 80;
}
/** Audiobookshelf — `ghcr.io/advplyr/audiobookshelf:latest` port 80 */
export class AudiobookshelfContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'audiobookshelf';
  override defaultPort = 80;
}
/** BookStack — `lscr.io/linuxserver/bookstack:latest` port 80 */
export class BookstackContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'bookstack';
  override defaultPort = 80;
}
/** Cal.com — `calcom/cal.com:latest` port 3000 */
export class CalComContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'cal';
  override defaultPort = 3000;
}
/** Chroma — `chromadb/chroma:latest` port 8000 */
export class ChromaContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'chromadb';
  override defaultPort = 8000;
}
/** Code Server — `codercom/code-server:latest` port 8080 */
export class CodeServerContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'code-server';
  override defaultPort = 8080;
}
/** Coqui TTS — `ghcr.io/coqui-ai/tts-cpu:latest` port 5002 */
export class CoquiTtsContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'coqui-tts';
  override defaultPort = 5002;
}
/** Directus — `directus/directus:latest` port 8055 */
export class DirectusContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'directus';
  override defaultPort = 8055;
}
/** Drone CI — `drone/drone:2` port 80 */
export class DroneCiContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'drone';
  override defaultPort = 80;
}
/** Flowise — `flowiseai/flowise:latest` port 3000 */
export class FlowiseContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'flowise';
  override defaultPort = 3000;
}
/** Focalboard — `mattermost/focalboard:latest` port 8000 */
export class FocalboardContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'focalboard';
  override defaultPort = 8000;
}
/** Forgejo — `codeberg.org/forgejo/forgejo:latest` port 3000 */
export class ForgejoContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'forgejo';
  override defaultPort = 3000;
}
/** FreshRSS — `freshrss/freshrss:latest` port 80 */
export class FreshrssContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'freshrss';
  override defaultPort = 80;
}
/** Ghost — `ghost:5-alpine` port 2368 */
export class GhostContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'ghost';
  override defaultPort = 2368;
}
/** Gitea — `gitea/gitea:latest` port 3000 */
export class GiteaContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'gitea';
  override defaultPort = 3000;
}
/** Grafana — `grafana/grafana-oss:latest` port 3000 */
export class GrafanaContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'grafana';
  override defaultPort = 3000;
}
/** Healthchecks — `healthchecks/healthchecks:latest` port 8000 */
export class HealthchecksContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'healthchecks';
  override defaultPort = 8000;
}
/** Immich — `ghcr.io/imagegenius/immich:latest` port 8080 */
export class ImmichContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'immich';
  override defaultPort = 8080;
}
/** Jellyfin — `jellyfin/jellyfin:latest` port 8096 */
export class JellyfinContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'jellyfin';
  override defaultPort = 8096;
}
/** Khoj — `ghcr.io/khoj-ai/khoj:latest` port 42110 */
export class KhojContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'khoj';
  override defaultPort = 42110;
}
/** Langflow — `langflowai/langflow:latest` port 7860 */
export class LangflowContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'langflow';
  override defaultPort = 7860;
}
/** Langfuse — `langfuse/langfuse:2` port 3000 */
export class LangfuseContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'langfuse';
  override defaultPort = 3000;
}
/** LibreChat — `ghcr.io/danny-avila/librechat:latest` port 3080 */
export class LibrechatContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'librechat';
  override defaultPort = 3080;
}
/** Linkwarden — `ghcr.io/linkwarden/linkwarden:latest` port 3000 */
export class LinkwardenContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'linkwarden';
  override defaultPort = 3000;
}
/** Listmonk — `listmonk/listmonk:latest` port 9000 */
export class ListmonkContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'listmonk';
  override defaultPort = 9000;
}
/** LiteLLM — `ghcr.io/berriai/litellm-database:main-stable` port 4000 */
export class LitellmContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'litellm';
  override defaultPort = 4000;
}
/** Lobe Chat — `lobehub/lobe-chat-database:latest` port 3210 */
export class LobeChatContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'lobe-chat';
  override defaultPort = 3210;
}
/** Mattermost — `mattermost/mattermost-team-edition:latest` port 8065 */
export class MattermostContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'mattermost';
  override defaultPort = 8065;
}
/** Memos — `neosmemo/memos:stable` port 5230 */
export class MemosContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'memos';
  override defaultPort = 5230;
}
/** Miniflux — `miniflux/miniflux:latest` port 8080 */
export class MinifluxContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'miniflux';
  override defaultPort = 8080;
}
/** Morphic — `ghcr.io/miurla/morphic:latest` port 3000 */
export class MorphicContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'morphic';
  override defaultPort = 3000;
}
/** n8n — `n8nio/n8n:latest` port 5678 */
export class N8NContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'n8n';
  override defaultPort = 5678;
}
/** Navidrome — `deluan/navidrome:latest` port 4533 */
export class NavidromeContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'navidrome';
  override defaultPort = 4533;
}
/** Nextcloud — `nextcloud:latest` port 80 */
export class NextcloudContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'nextcloud';
  override defaultPort = 80;
}
/** NocoDB — `nocodb/nocodb:latest` port 8080 */
export class NocodbContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'nocodb';
  override defaultPort = 8080;
}
/** Open WebUI — `ghcr.io/open-webui/open-webui:main` port 8080 */
export class OpenWebuiContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'open-webui';
  override defaultPort = 8080;
}
/** Outline — `outlinewiki/outline:latest` port 3000 */
export class OutlineContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'outline';
  override defaultPort = 3000;
}
/** Perplexica — `itzcrazykns1337/perplexica:latest` port 3000 */
export class PerplexicaContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'perplexica';
  override defaultPort = 3000;
}
/** Arize Phoenix — `arizephoenix/phoenix:latest` port 6006 */
export class ArizePhoenixContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'phoenix';
  override defaultPort = 6006;
}
/** Plane — `makeplane/plane-frontend:latest` port 3000 */
export class PlaneContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'plane';
  override defaultPort = 3000;
}
/** Plausible — `plausible/community-edition:latest` port 8000 */
export class PlausibleContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'plausible';
  override defaultPort = 8000;
}
/** PocketBase — `spectado/pocketbase:latest` port 8090 */
export class PocketbaseContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'pocketbase';
  override defaultPort = 8090;
}
/** Qdrant — `qdrant/qdrant:latest` port 6333 */
export class QdrantContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'qdrant';
  override defaultPort = 6333;
}
/** SearXNG — `searxng/searxng:latest` port 8080 */
export class SearxngContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'searxng';
  override defaultPort = 8080;
}
/** Stirling PDF — `docker.stirlingpdf.com/stirlingtools/stirling-pdf:latest` port 8080 */
export class StirlingPdfContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'stirling-pdf';
  override defaultPort = 8080;
}
/** Tabby — `tabbyml/tabby:latest` port 8080 */
export class TabbyContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'tabby';
  override defaultPort = 8080;
}
/** Teable — `teableio/teable:latest` port 3000 */
export class TeableContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'teable';
  override defaultPort = 3000;
}
/** Umami — `ghcr.io/umami-software/umami:postgresql-latest` port 3000 */
export class UmamiContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'umami';
  override defaultPort = 3000;
}
/** Uptime Kuma — `louislam/uptime-kuma:1` port 3001 */
export class UptimeKumaContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'uptime-kuma';
  override defaultPort = 3001;
}
/** Vaultwarden — `vaultwarden/server:latest` port 80 */
export class VaultwardenContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'vaultwarden';
  override defaultPort = 80;
}
/** Vikunja — `vikunja/vikunja:latest` port 3456 */
export class VikunjaContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'vikunja';
  override defaultPort = 3456;
}
/** Weaviate — `semitechnologies/weaviate:1.28.0` port 8080 */
export class WeaviateContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'weaviate';
  override defaultPort = 8080;
}
/** Whisper ASR — `onerahmet/openai-whisper-asr-webservice:latest` port 9000 */
export class WhisperAsrContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'whisper-asr';
  override defaultPort = 9000;
}
/** Wiki.js — `ghcr.io/requarks/wiki:2` port 3000 */
export class WikiJsContainer extends AppRuntimeContainer {
  static readonly APP_SLUG = 'wikijs';
  override defaultPort = 3000;
}
export const SUPPORTED_APP_SLUGS = [
  'anything-llm',
  'appsmith',
  'audiobookshelf',
  'bookstack',
  'cal',
  'chromadb',
  'code-server',
  'coqui-tts',
  'directus',
  'drone',
  'flowise',
  'focalboard',
  'forgejo',
  'freshrss',
  'ghost',
  'gitea',
  'grafana',
  'healthchecks',
  'immich',
  'jellyfin',
  'khoj',
  'langflow',
  'langfuse',
  'librechat',
  'linkwarden',
  'listmonk',
  'litellm',
  'lobe-chat',
  'mattermost',
  'memos',
  'miniflux',
  'morphic',
  'n8n',
  'navidrome',
  'nextcloud',
  'nocodb',
  'open-webui',
  'outline',
  'perplexica',
  'phoenix',
  'plane',
  'plausible',
  'pocketbase',
  'qdrant',
  'searxng',
  'stirling-pdf',
  'tabby',
  'teable',
  'umami',
  'uptime-kuma',
  'vaultwarden',
  'vikunja',
  'weaviate',
  'whisper-asr',
  'wikijs',
] as const;
export type SupportedAppSlug = (typeof SUPPORTED_APP_SLUGS)[number];
export function isSupportedSlug(slug: string): slug is SupportedAppSlug {
  return (SUPPORTED_APP_SLUGS as readonly string[]).includes(slug);
}
