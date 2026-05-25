/**
 * @module data/apps-catalog
 *
 * @description
 * Curated catalog of self-hostable open-source applications that ship with a
 * production-ready Dockerfile or docker-compose.yml. Every entry can be
 * one-click deployed onto Cloudflare Workers Containers (CFC), with auxiliary
 * services (Postgres → Neon, Redis → Upstash, S3 → R2) auto-provisioned
 * during the deploy wizard in `/admin/apps`.
 *
 * ## Picking apps
 *
 * Inclusion criteria, all must hold:
 *  - Active OSS project (commit in last 90 days)
 *  - Either a single official Dockerfile OR a 1-2-service docker-compose
 *  - All required infra is one of: Postgres / Redis / S3 / SQLite / volume
 *    (anything needing ElasticSearch / ClickHouse / Influx / custom message
 *    brokers is excluded — those don't fit the CFC + Neon + Upstash stack)
 *  - Container starts in <30s on cold boot
 *  - Memory ceiling ≤ 1 GiB at p95 (CFC instance class fits)
 *
 * ## Per-entry shape
 * {@link CatalogApp} carries everything the `/admin/apps` UI needs to render
 * the card + the worker needs to provision infra + the container DO needs
 * to start the image.
 */

/** Aux-infra dependencies the deploy wizard must provision before container start. */
export type InfraDep = 'postgres' | 'redis' | 's3' | 'sqlite' | 'volume' | 'mailrelay';

/** Top-level taxonomy used by the catalog filter chips. */
export type AppCategory =
  | 'analytics'
  | 'knowledge'
  | 'productivity'
  | 'communication'
  | 'developer'
  | 'privacy'
  | 'marketing'
  | 'monitoring'
  | 'ai'
  | 'backend'
  | 'media'
  | 'vector-db'
  | 'media-ai'
  | 'voice-ai'
  | 'agent-platform'
  | 'ai-ops'
  | 'ai-search'
  | 'ai-marketing';

export interface CatalogApp {
  /** URL-safe slug, primary key inside `app_instances.app_slug`. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /** One-line value-proposition shown on the catalog card. */
  readonly tagline: string;
  /** Full description rendered on the detail page. */
  readonly description: string;
  /** Filter taxonomy. */
  readonly category: AppCategory;
  /** Container image reference (`registry/name:tag`). */
  readonly image: string;
  /** Optional custom Dockerfile when the upstream image is unsuitable. */
  readonly dockerfile?: string;
  /** Optional compose file path inside the upstream repo (for reference only — CFC runs one container). */
  readonly composeRef?: string;
  /** Required aux infra — provisioned during deploy wizard. */
  readonly infra: InfraDep[];
  /** Default container port to proxy `fetch` to. */
  readonly port: number;
  /** Default env-var shape — `description` shown in the deploy wizard form. */
  readonly env: ReadonlyArray<{
    readonly key: string;
    readonly description: string;
    readonly required: boolean;
    /** Auto-resolved from provisioned infra (e.g. `DATABASE_URL` from Neon). */
    readonly auto?: 'postgres_url' | 'redis_url' | 's3_url' | 'secret' | 'public_url';
    readonly default?: string;
  }>;
  /** Persistent storage hint — bytes the container's `/data` volume needs. */
  readonly volumeMB?: number;
  /** RAM ceiling in MiB — drives CFC instance-class pick. */
  readonly memoryMB: number;
  /** Estimated monthly cost USD at small-to-medium usage. */
  readonly estCostMonthly: number;
  /** Upstream homepage. */
  readonly homepage: string;
  /** Upstream repo. */
  readonly repo: string;
  /** Inline SVG glyph or emoji marker for the catalog card. */
  readonly glyph: string;
  /** License — surfaced in the detail page for compliance. */
  readonly license: string;
  /** Tags surfaced as small chips below the tagline. */
  readonly tags: ReadonlyArray<string>;
  /**
   * `true` once a per-image AppRuntime DO subclass + matching wrangler
   * `[[containers]]` block is wired — the app can actually boot. `false`
   * (or undefined) means the catalog card is decorative only and the
   * `POST /api/apps/instances` preflight returns `424 app_not_supported`.
   * Source of truth lives in
   * `src/durable_objects/app_runtime_subclasses.ts → SUPPORTED_APP_SLUGS`.
   */
  readonly supported?: boolean;
}

export const APPS_CATALOG: ReadonlyArray<CatalogApp> = [
  // ── Analytics ───────────────────────────────────────────────
  {
    id: 'umami',
    name: 'Umami',
    tagline: 'Privacy-respecting web analytics',
    description:
      'Cookieless, GDPR-compliant analytics. ~30KB script, real-time dashboard, event tracking. The clean alternative to Google Analytics.',
    category: 'analytics',
    image: 'ghcr.io/umami-software/umami:postgresql-latest',
    composeRef: 'https://github.com/umami-software/umami/blob/master/docker-compose.yml',
    infra: ['postgres'],
    port: 3000,
    env: [
      { key: 'DATABASE_URL', description: 'Postgres connection string', required: true, auto: 'postgres_url' },
      { key: 'APP_SECRET', description: 'Random 32-byte secret for signing tokens', required: true, auto: 'secret' },
      { key: 'HASH_SALT', description: 'Random salt for hashed IPs', required: true, auto: 'secret' },
    ],
    memoryMB: 256,
    volumeMB: 0,
    estCostMonthly: 6,
    homepage: 'https://umami.is',
    repo: 'https://github.com/umami-software/umami',
    glyph: '📊',
    license: 'MIT',
    tags: ['analytics', 'gdpr', 'cookieless'],
    supported: true,
  },
  {
    id: 'matomo',
    name: 'Matomo',
    tagline: 'Self-hosted Google Analytics alternative',
    description:
      'Full-featured analytics with funnels, heatmaps, A/B testing, e-commerce tracking. Heavier than Umami but deeper insights.',
    category: 'analytics',
    image: 'matomo:5-apache',
    infra: ['postgres'],
    port: 80,
    env: [
      { key: 'MATOMO_DATABASE_HOST', description: 'Postgres host', required: true, auto: 'postgres_url' },
      { key: 'MATOMO_DATABASE_USERNAME', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'MATOMO_DATABASE_PASSWORD', description: 'Postgres password', required: true, auto: 'postgres_url' },
    ],
    memoryMB: 512,
    volumeMB: 256,
    estCostMonthly: 14,
    homepage: 'https://matomo.org',
    repo: 'https://github.com/matomo-org/matomo',
    glyph: '📈',
    license: 'GPL-3.0',
    tags: ['analytics', 'enterprise'],
  },
  {
    id: 'plausible',
    name: 'Plausible',
    tagline: 'Simple, lightweight web analytics',
    description:
      'No cookies, no consent banners, 1KB script. Open-source community edition. Note: official build needs ClickHouse — this image uses a SQLite fork for solo deploys.',
    category: 'analytics',
    image: 'plausible/community-edition:latest',
    infra: ['postgres'],
    port: 8000,
    env: [
      { key: 'DATABASE_URL', description: 'Postgres connection', required: true, auto: 'postgres_url' },
      { key: 'SECRET_KEY_BASE', description: '64-byte secret for Phoenix', required: true, auto: 'secret' },
      { key: 'BASE_URL', description: 'Public URL of this Plausible instance', required: true, auto: 'public_url' },
    ],
    memoryMB: 512,
    volumeMB: 0,
    estCostMonthly: 12,
    homepage: 'https://plausible.io',
    repo: 'https://github.com/plausible/community-edition',
    glyph: '🟢',
    license: 'AGPL-3.0',
    tags: ['analytics', 'minimal'],
  },

  // ── Knowledge ───────────────────────────────────────────────
  {
    id: 'outline',
    name: 'Outline',
    tagline: 'Collaborative team wiki — like Notion',
    description:
      'Real-time collaborative editing, markdown native, slack integration. The polished open-source Notion alternative.',
    category: 'knowledge',
    image: 'outlinewiki/outline:latest',
    infra: ['postgres', 'redis', 's3'],
    port: 3000,
    env: [
      { key: 'DATABASE_URL', description: 'Postgres connection', required: true, auto: 'postgres_url' },
      { key: 'REDIS_URL', description: 'Redis connection', required: true, auto: 'redis_url' },
      { key: 'URL', description: 'Public URL', required: true, auto: 'public_url' },
      { key: 'SECRET_KEY', description: '32-byte secret', required: true, auto: 'secret' },
      { key: 'UTILS_SECRET', description: '32-byte secret', required: true, auto: 'secret' },
      { key: 'AWS_ACCESS_KEY_ID', description: 'R2 access key for file uploads', required: true, auto: 's3_url' },
      { key: 'AWS_SECRET_ACCESS_KEY', description: 'R2 secret', required: true, auto: 's3_url' },
      { key: 'AWS_S3_UPLOAD_BUCKET_URL', description: 'R2 bucket URL', required: true, auto: 's3_url' },
    ],
    memoryMB: 768,
    volumeMB: 0,
    estCostMonthly: 22,
    homepage: 'https://www.getoutline.com',
    repo: 'https://github.com/outline/outline',
    glyph: '📚',
    license: 'BSL-1.1',
    tags: ['wiki', 'collaboration', 'team'],
  },
  {
    id: 'wikijs',
    name: 'Wiki.js',
    tagline: 'Modern wiki built on Node.js',
    description:
      'Markdown + WYSIWYG editor, Git sync, granular permissions, multi-locale. Great for documentation portals.',
    category: 'knowledge',
    image: 'ghcr.io/requarks/wiki:2',
    infra: ['postgres'],
    port: 3000,
    env: [
      { key: 'DB_TYPE', description: 'Database type', required: true, default: 'postgres' },
      { key: 'DB_HOST', description: 'Postgres host', required: true, auto: 'postgres_url' },
      { key: 'DB_PORT', description: 'Postgres port', required: true, default: '5432' },
      { key: 'DB_USER', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'DB_PASS', description: 'Postgres password', required: true, auto: 'postgres_url' },
      { key: 'DB_NAME', description: 'Database name', required: true, auto: 'postgres_url' },
    ],
    memoryMB: 384,
    volumeMB: 0,
    estCostMonthly: 9,
    homepage: 'https://js.wiki',
    repo: 'https://github.com/Requarks/wiki',
    glyph: '📖',
    license: 'AGPL-3.0',
    tags: ['wiki', 'docs'],
  },
  {
    id: 'memos',
    name: 'Memos',
    tagline: 'Lightweight note-taking with markdown',
    description: 'Twitter-style microblog for personal knowledge. Self-host your second brain.',
    category: 'knowledge',
    image: 'neosmemo/memos:stable',
    infra: ['sqlite', 'volume'],
    port: 5230,
    env: [
      { key: 'MEMOS_MODE', description: 'demo|prod|dev', required: true, default: 'prod' },
    ],
    memoryMB: 128,
    volumeMB: 128,
    estCostMonthly: 4,
    homepage: 'https://usememos.com',
    repo: 'https://github.com/usememos/memos',
    glyph: '📝',
    license: 'MIT',
    tags: ['notes', 'lightweight', 'sqlite'],
  },
  {
    id: 'bookstack',
    name: 'BookStack',
    tagline: 'Wiki for books and chapters',
    description: 'Hierarchical knowledge base perfect for product manuals + operations runbooks.',
    category: 'knowledge',
    image: 'lscr.io/linuxserver/bookstack:latest',
    infra: ['postgres', 'volume'],
    port: 80,
    env: [
      { key: 'APP_URL', description: 'Public URL', required: true, auto: 'public_url' },
      { key: 'DB_HOST', description: 'Postgres host', required: true, auto: 'postgres_url' },
      { key: 'DB_USER', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'DB_PASS', description: 'Postgres password', required: true, auto: 'postgres_url' },
      { key: 'DB_DATABASE', description: 'Database name', required: true, auto: 'postgres_url' },
    ],
    memoryMB: 384,
    volumeMB: 64,
    estCostMonthly: 9,
    homepage: 'https://www.bookstackapp.com',
    repo: 'https://github.com/BookStackApp/BookStack',
    glyph: '📕',
    license: 'MIT',
    tags: ['wiki', 'manuals'],
  },

  // ── Productivity ────────────────────────────────────────────
  {
    id: 'plane',
    name: 'Plane',
    tagline: 'Open-source Jira / Linear alternative',
    description: 'Sprints, cycles, modules, OKRs. Self-hosted project management without the enterprise tax.',
    category: 'productivity',
    image: 'makeplane/plane-frontend:latest',
    infra: ['postgres', 'redis'],
    port: 3000,
    env: [
      { key: 'DATABASE_URL', description: 'Postgres', required: true, auto: 'postgres_url' },
      { key: 'REDIS_URL', description: 'Redis', required: true, auto: 'redis_url' },
      { key: 'SECRET_KEY', description: '32-byte secret', required: true, auto: 'secret' },
      { key: 'WEB_URL', description: 'Public URL', required: true, auto: 'public_url' },
    ],
    memoryMB: 768,
    volumeMB: 0,
    estCostMonthly: 18,
    homepage: 'https://plane.so',
    repo: 'https://github.com/makeplane/plane',
    glyph: '🛫',
    license: 'AGPL-3.0',
    tags: ['project-management', 'agile'],
  },
  {
    id: 'nocodb',
    name: 'NocoDB',
    tagline: 'No-code Airtable alternative',
    description: 'Turn any Postgres / MySQL DB into a smart spreadsheet UI. Forms, kanban, gallery, calendar views.',
    category: 'productivity',
    image: 'nocodb/nocodb:latest',
    infra: ['postgres'],
    port: 8080,
    env: [
      { key: 'NC_DB', description: 'Postgres URI (e.g. pg://user:pw@host:5432/db)', required: true, auto: 'postgres_url' },
      { key: 'NC_AUTH_JWT_SECRET', description: 'JWT signing secret', required: true, auto: 'secret' },
    ],
    memoryMB: 512,
    volumeMB: 0,
    estCostMonthly: 11,
    homepage: 'https://nocodb.com',
    repo: 'https://github.com/nocodb/nocodb',
    glyph: '🧮',
    license: 'AGPL-3.0',
    tags: ['airtable', 'database', 'no-code'],
  },
  {
    id: 'vikunja',
    name: 'Vikunja',
    tagline: 'Self-hosted to-do app — Todoist alternative',
    description: 'Lists, kanban, gantt, repeating tasks, reminders. Fast Go backend.',
    category: 'productivity',
    image: 'vikunja/vikunja:latest',
    infra: ['postgres', 'volume'],
    port: 3456,
    env: [
      { key: 'VIKUNJA_DATABASE_TYPE', description: 'postgres', required: true, default: 'postgres' },
      { key: 'VIKUNJA_DATABASE_HOST', description: 'Postgres host', required: true, auto: 'postgres_url' },
      { key: 'VIKUNJA_DATABASE_USER', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'VIKUNJA_DATABASE_PASSWORD', description: 'Postgres password', required: true, auto: 'postgres_url' },
      { key: 'VIKUNJA_DATABASE_DATABASE', description: 'DB name', required: true, auto: 'postgres_url' },
      { key: 'VIKUNJA_SERVICE_JWTSECRET', description: '32-byte secret', required: true, auto: 'secret' },
    ],
    memoryMB: 256,
    volumeMB: 32,
    estCostMonthly: 6,
    homepage: 'https://vikunja.io',
    repo: 'https://kolaente.dev/vikunja/vikunja',
    glyph: '✅',
    license: 'AGPL-3.0',
    tags: ['todo', 'tasks'],
  },
  {
    id: 'focalboard',
    name: 'Focalboard',
    tagline: 'Self-hosted Trello / Notion-board alternative',
    description: 'Kanban + galleries + tables for personal + small-team workflows.',
    category: 'productivity',
    image: 'mattermost/focalboard:latest',
    infra: ['postgres', 'volume'],
    port: 8000,
    env: [
      { key: 'FOCALBOARD_DBTYPE', description: 'postgres', required: true, default: 'postgres' },
      { key: 'FOCALBOARD_DBCONFIG', description: 'Postgres URI', required: true, auto: 'postgres_url' },
    ],
    memoryMB: 256,
    volumeMB: 64,
    estCostMonthly: 7,
    homepage: 'https://www.focalboard.com',
    repo: 'https://github.com/mattermost/focalboard',
    glyph: '🎯',
    license: 'MIT',
    tags: ['kanban', 'trello'],
  },
  {
    id: 'cal',
    name: 'Cal.com',
    tagline: 'Open-source Calendly alternative',
    description: 'Self-hosted scheduling with Google/Outlook sync, payments, round-robin, workflows.',
    category: 'productivity',
    image: 'calcom/cal.com:latest',
    infra: ['postgres'],
    port: 3000,
    env: [
      { key: 'DATABASE_URL', description: 'Postgres', required: true, auto: 'postgres_url' },
      { key: 'NEXTAUTH_SECRET', description: 'NextAuth signing secret', required: true, auto: 'secret' },
      { key: 'CALENDSO_ENCRYPTION_KEY', description: '32-byte key', required: true, auto: 'secret' },
      { key: 'NEXT_PUBLIC_WEBAPP_URL', description: 'Public URL', required: true, auto: 'public_url' },
    ],
    memoryMB: 768,
    volumeMB: 0,
    estCostMonthly: 19,
    homepage: 'https://cal.com',
    repo: 'https://github.com/calcom/cal.com',
    glyph: '📅',
    license: 'AGPL-3.0',
    tags: ['scheduling', 'calendar'],
  },

  // ── Communication ───────────────────────────────────────────
  {
    id: 'mattermost',
    name: 'Mattermost',
    tagline: 'Self-hosted Slack alternative',
    description: 'Team messaging, file sharing, integrations. Enterprise-grade, used by Tesla, NASA.',
    category: 'communication',
    image: 'mattermost/mattermost-team-edition:latest',
    infra: ['postgres', 'volume'],
    port: 8065,
    env: [
      { key: 'MM_SQLSETTINGS_DRIVERNAME', description: 'postgres', required: true, default: 'postgres' },
      { key: 'MM_SQLSETTINGS_DATASOURCE', description: 'Postgres URI', required: true, auto: 'postgres_url' },
      { key: 'MM_SERVICESETTINGS_SITEURL', description: 'Public URL', required: true, auto: 'public_url' },
    ],
    memoryMB: 768,
    volumeMB: 256,
    estCostMonthly: 18,
    homepage: 'https://mattermost.com',
    repo: 'https://github.com/mattermost/mattermost',
    glyph: '💬',
    license: 'MIT',
    tags: ['chat', 'slack-alt', 'team'],
  },
  {
    id: 'rocketchat',
    name: 'Rocket.Chat',
    tagline: 'Team communication platform',
    description: 'Chat, voice, video, mobile apps. Open-source Discord/Slack alternative.',
    category: 'communication',
    image: 'rocket.chat:latest',
    infra: ['postgres', 'volume'],
    port: 3000,
    env: [
      { key: 'MONGO_URL', description: 'MongoDB URL — note: Rocket.Chat needs Mongo, this image bundles it', required: false },
      { key: 'ROOT_URL', description: 'Public URL', required: true, auto: 'public_url' },
    ],
    memoryMB: 1024,
    volumeMB: 512,
    estCostMonthly: 28,
    homepage: 'https://rocket.chat',
    repo: 'https://github.com/RocketChat/Rocket.Chat',
    glyph: '🚀',
    license: 'MIT',
    tags: ['chat', 'discord-alt'],
  },

  // ── Developer ───────────────────────────────────────────────
  {
    id: 'code-server',
    name: 'Code Server',
    tagline: 'VS Code in your browser',
    description: 'Run VS Code on a remote container, access from any device. Perfect for ChromeOS / iPad dev.',
    category: 'developer',
    image: 'codercom/code-server:latest',
    infra: ['volume'],
    port: 8080,
    env: [
      { key: 'PASSWORD', description: 'Login password', required: true, auto: 'secret' },
    ],
    memoryMB: 1024,
    volumeMB: 1024,
    estCostMonthly: 24,
    homepage: 'https://github.com/coder/code-server',
    repo: 'https://github.com/coder/code-server',
    glyph: '💻',
    license: 'MIT',
    tags: ['ide', 'vscode', 'remote-dev'],
  },
  {
    id: 'gitea',
    name: 'Gitea',
    tagline: 'Lightweight self-hosted Git service',
    description: 'GitHub-style UI in 100MB of Go. Issues, PRs, actions, packages.',
    category: 'developer',
    image: 'gitea/gitea:latest',
    infra: ['postgres', 'volume'],
    port: 3000,
    env: [
      { key: 'GITEA__database__DB_TYPE', description: 'postgres', required: true, default: 'postgres' },
      { key: 'GITEA__database__HOST', description: 'Postgres host', required: true, auto: 'postgres_url' },
      { key: 'GITEA__database__NAME', description: 'DB name', required: true, auto: 'postgres_url' },
      { key: 'GITEA__database__USER', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'GITEA__database__PASSWD', description: 'Postgres password', required: true, auto: 'postgres_url' },
    ],
    memoryMB: 384,
    volumeMB: 1024,
    estCostMonthly: 14,
    homepage: 'https://about.gitea.com',
    repo: 'https://github.com/go-gitea/gitea',
    glyph: '🍵',
    license: 'MIT',
    tags: ['git', 'github-alt', 'go'],
  },
  {
    id: 'forgejo',
    name: 'Forgejo',
    tagline: 'Community-driven Gitea fork',
    description: 'Self-hosted git with stronger community governance + faster release cadence.',
    category: 'developer',
    image: 'codeberg.org/forgejo/forgejo:latest',
    infra: ['postgres', 'volume'],
    port: 3000,
    env: [
      { key: 'FORGEJO__database__DB_TYPE', description: 'postgres', required: true, default: 'postgres' },
      { key: 'FORGEJO__database__HOST', description: 'Postgres host', required: true, auto: 'postgres_url' },
      { key: 'FORGEJO__database__NAME', description: 'DB name', required: true, auto: 'postgres_url' },
      { key: 'FORGEJO__database__USER', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'FORGEJO__database__PASSWD', description: 'Postgres password', required: true, auto: 'postgres_url' },
    ],
    memoryMB: 384,
    volumeMB: 1024,
    estCostMonthly: 14,
    homepage: 'https://forgejo.org',
    repo: 'https://codeberg.org/forgejo/forgejo',
    glyph: '🌳',
    license: 'GPL-3.0',
    tags: ['git', 'codeberg', 'fork'],
  },
  {
    id: 'drone',
    name: 'Drone CI',
    tagline: 'Self-hosted CI/CD pipeline',
    description: 'Docker-native pipelines defined in YAML. Built-in OSS plan.',
    category: 'developer',
    image: 'drone/drone:2',
    infra: ['postgres', 'volume'],
    port: 80,
    env: [
      { key: 'DRONE_DATABASE_DRIVER', description: 'postgres', required: true, default: 'postgres' },
      { key: 'DRONE_DATABASE_DATASOURCE', description: 'Postgres URI', required: true, auto: 'postgres_url' },
      { key: 'DRONE_RPC_SECRET', description: 'Shared secret between server + runners', required: true, auto: 'secret' },
      { key: 'DRONE_SERVER_HOST', description: 'Public URL', required: true, auto: 'public_url' },
      { key: 'DRONE_SERVER_PROTO', description: 'https', required: true, default: 'https' },
    ],
    memoryMB: 256,
    volumeMB: 64,
    estCostMonthly: 8,
    homepage: 'https://www.drone.io',
    repo: 'https://github.com/harness/drone',
    glyph: '🚁',
    license: 'Apache-2.0',
    tags: ['ci', 'cd', 'pipelines'],
  },

  // ── Privacy ─────────────────────────────────────────────────
  {
    id: 'vaultwarden',
    name: 'Vaultwarden',
    tagline: 'Self-hosted Bitwarden-compatible password manager',
    description: 'Rust rewrite of Bitwarden server, 1/10th the resources. Works with all Bitwarden clients.',
    category: 'privacy',
    image: 'vaultwarden/server:latest',
    infra: ['sqlite', 'volume'],
    port: 80,
    env: [
      { key: 'ADMIN_TOKEN', description: 'Admin panel token', required: true, auto: 'secret' },
      { key: 'DOMAIN', description: 'Public URL', required: true, auto: 'public_url' },
      { key: 'SIGNUPS_ALLOWED', description: 'true/false', required: false, default: 'false' },
    ],
    memoryMB: 128,
    volumeMB: 256,
    estCostMonthly: 5,
    homepage: 'https://github.com/dani-garcia/vaultwarden',
    repo: 'https://github.com/dani-garcia/vaultwarden',
    glyph: '🔐',
    license: 'AGPL-3.0',
    tags: ['passwords', 'bitwarden', 'rust'],
  },
  {
    id: 'nextcloud',
    name: 'Nextcloud',
    tagline: 'Self-hosted Dropbox + Office + Calendar',
    description: 'Full productivity suite: file sync, collaborative documents, video calls, mail, contacts.',
    category: 'privacy',
    image: 'nextcloud:latest',
    infra: ['postgres', 'volume', 's3'],
    port: 80,
    env: [
      { key: 'POSTGRES_HOST', description: 'Postgres host', required: true, auto: 'postgres_url' },
      { key: 'POSTGRES_DB', description: 'DB name', required: true, auto: 'postgres_url' },
      { key: 'POSTGRES_USER', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'POSTGRES_PASSWORD', description: 'Postgres password', required: true, auto: 'postgres_url' },
      { key: 'NEXTCLOUD_ADMIN_USER', description: 'Initial admin login', required: true, default: 'admin' },
      { key: 'NEXTCLOUD_ADMIN_PASSWORD', description: 'Admin password', required: true, auto: 'secret' },
    ],
    memoryMB: 1024,
    volumeMB: 2048,
    estCostMonthly: 32,
    homepage: 'https://nextcloud.com',
    repo: 'https://github.com/nextcloud/server',
    glyph: '☁️',
    license: 'AGPL-3.0',
    tags: ['file-sync', 'dropbox', 'office'],
  },
  {
    id: 'linkwarden',
    name: 'Linkwarden',
    tagline: 'Self-hosted bookmark + read-it-later',
    description: 'Save links, take screenshots, archive content. Open-source Pocket / Raindrop alternative.',
    category: 'privacy',
    image: 'ghcr.io/linkwarden/linkwarden:latest',
    infra: ['postgres'],
    port: 3000,
    env: [
      { key: 'DATABASE_URL', description: 'Postgres', required: true, auto: 'postgres_url' },
      { key: 'NEXTAUTH_SECRET', description: '32-byte secret', required: true, auto: 'secret' },
      { key: 'NEXTAUTH_URL', description: 'Public URL', required: true, auto: 'public_url' },
    ],
    memoryMB: 512,
    volumeMB: 0,
    estCostMonthly: 11,
    homepage: 'https://linkwarden.app',
    repo: 'https://github.com/linkwarden/linkwarden',
    glyph: '🔖',
    license: 'AGPL-3.0',
    tags: ['bookmarks', 'pocket-alt'],
  },

  // ── Marketing ───────────────────────────────────────────────
  {
    id: 'listmonk',
    name: 'Listmonk',
    tagline: 'Self-hosted email + campaign manager',
    description: 'Newsletter blasts, transactional email, segmentation. Go-fast, sends 5M+ emails/hour.',
    category: 'marketing',
    image: 'listmonk/listmonk:latest',
    infra: ['postgres', 'mailrelay'],
    port: 9000,
    env: [
      { key: 'LISTMONK_db__host', description: 'Postgres host', required: true, auto: 'postgres_url' },
      { key: 'LISTMONK_db__user', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'LISTMONK_db__password', description: 'Postgres password', required: true, auto: 'postgres_url' },
      { key: 'LISTMONK_db__database', description: 'DB name', required: true, auto: 'postgres_url' },
      { key: 'LISTMONK_app__address', description: '0.0.0.0:9000', required: true, default: '0.0.0.0:9000' },
    ],
    memoryMB: 256,
    volumeMB: 0,
    estCostMonthly: 7,
    homepage: 'https://listmonk.app',
    repo: 'https://github.com/knadh/listmonk',
    glyph: '📧',
    license: 'AGPL-3.0',
    tags: ['email', 'newsletter', 'mautic-alt'],
  },
  {
    id: 'n8n',
    name: 'n8n',
    tagline: 'Workflow automation — Zapier alternative',
    description: '400+ integrations, visual workflow editor, self-hosted forever-free.',
    category: 'marketing',
    image: 'n8nio/n8n:latest',
    infra: ['postgres', 'volume'],
    port: 5678,
    env: [
      { key: 'DB_TYPE', description: 'postgresdb', required: true, default: 'postgresdb' },
      { key: 'DB_POSTGRESDB_HOST', description: 'Postgres host', required: true, auto: 'postgres_url' },
      { key: 'DB_POSTGRESDB_DATABASE', description: 'DB name', required: true, auto: 'postgres_url' },
      { key: 'DB_POSTGRESDB_USER', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'DB_POSTGRESDB_PASSWORD', description: 'Postgres password', required: true, auto: 'postgres_url' },
      { key: 'N8N_ENCRYPTION_KEY', description: '32-byte key for credential encryption', required: true, auto: 'secret' },
      { key: 'WEBHOOK_URL', description: 'Public URL', required: true, auto: 'public_url' },
    ],
    memoryMB: 512,
    volumeMB: 64,
    estCostMonthly: 13,
    homepage: 'https://n8n.io',
    repo: 'https://github.com/n8n-io/n8n',
    glyph: '🔄',
    license: 'Sustainable-Use',
    tags: ['automation', 'zapier-alt', 'workflows'],
  },
  {
    id: 'mautic',
    name: 'Mautic',
    tagline: 'Open-source marketing automation',
    description: 'Email drip, landing pages, lead scoring, A/B testing. The serious marketer alternative to HubSpot.',
    category: 'marketing',
    image: 'mautic/mautic:5-apache',
    infra: ['postgres', 'volume', 'mailrelay'],
    port: 80,
    env: [
      { key: 'MAUTIC_DB_HOST', description: 'Postgres host', required: true, auto: 'postgres_url' },
      { key: 'MAUTIC_DB_USER', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'MAUTIC_DB_PASSWORD', description: 'Postgres password', required: true, auto: 'postgres_url' },
      { key: 'MAUTIC_DB_NAME', description: 'DB name', required: true, auto: 'postgres_url' },
    ],
    memoryMB: 768,
    volumeMB: 128,
    estCostMonthly: 21,
    homepage: 'https://www.mautic.org',
    repo: 'https://github.com/mautic/mautic',
    glyph: '🎯',
    license: 'GPL-3.0',
    tags: ['marketing', 'hubspot-alt'],
  },

  // ── Monitoring ──────────────────────────────────────────────
  {
    id: 'uptime-kuma',
    name: 'Uptime Kuma',
    tagline: 'Self-hosted uptime monitor',
    description: 'HTTP / DNS / Ping / Steam / Postgres / Redis probes. Beautiful status pages. Single-container.',
    category: 'monitoring',
    image: 'louislam/uptime-kuma:1',
    infra: ['sqlite', 'volume'],
    port: 3001,
    env: [],
    memoryMB: 256,
    volumeMB: 128,
    estCostMonthly: 6,
    homepage: 'https://uptime.kuma.pet',
    repo: 'https://github.com/louislam/uptime-kuma',
    glyph: '🌸',
    license: 'MIT',
    tags: ['uptime', 'status', 'monitor'],
  },
  {
    id: 'healthchecks',
    name: 'Healthchecks',
    tagline: 'Cron-job + heartbeat monitoring',
    description: 'Pings on a schedule, alerts when they stop. Built for cron, backups, queue consumers.',
    category: 'monitoring',
    image: 'healthchecks/healthchecks:latest',
    infra: ['postgres'],
    port: 8000,
    env: [
      { key: 'DB', description: 'postgres', required: true, default: 'postgres' },
      { key: 'DB_HOST', description: 'Postgres host', required: true, auto: 'postgres_url' },
      { key: 'DB_USER', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'DB_PASSWORD', description: 'Postgres password', required: true, auto: 'postgres_url' },
      { key: 'DB_NAME', description: 'DB name', required: true, auto: 'postgres_url' },
      { key: 'SECRET_KEY', description: 'Django secret', required: true, auto: 'secret' },
      { key: 'SITE_ROOT', description: 'Public URL', required: true, auto: 'public_url' },
    ],
    memoryMB: 256,
    volumeMB: 0,
    estCostMonthly: 7,
    homepage: 'https://healthchecks.io',
    repo: 'https://github.com/healthchecks/healthchecks',
    glyph: '🩺',
    license: 'BSD-3-Clause',
    tags: ['cron', 'heartbeat', 'monitor'],
  },
  {
    id: 'grafana',
    name: 'Grafana',
    tagline: 'Observability dashboards',
    description: 'Query, visualize, alert on metrics + logs from 100+ sources. The standard.',
    category: 'monitoring',
    image: 'grafana/grafana-oss:latest',
    infra: ['postgres', 'volume'],
    port: 3000,
    env: [
      { key: 'GF_DATABASE_TYPE', description: 'postgres', required: true, default: 'postgres' },
      { key: 'GF_DATABASE_HOST', description: 'Postgres host:5432', required: true, auto: 'postgres_url' },
      { key: 'GF_DATABASE_NAME', description: 'DB name', required: true, auto: 'postgres_url' },
      { key: 'GF_DATABASE_USER', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'GF_DATABASE_PASSWORD', description: 'Postgres password', required: true, auto: 'postgres_url' },
      { key: 'GF_SECURITY_ADMIN_PASSWORD', description: 'Admin password', required: true, auto: 'secret' },
    ],
    memoryMB: 384,
    volumeMB: 256,
    estCostMonthly: 11,
    homepage: 'https://grafana.com',
    repo: 'https://github.com/grafana/grafana',
    glyph: '📊',
    license: 'AGPL-3.0',
    tags: ['observability', 'dashboards'],
  },

  // ── AI ──────────────────────────────────────────────────────
  {
    id: 'open-webui',
    name: 'Open WebUI',
    tagline: 'Beautiful UI for Ollama + OpenAI + Anthropic',
    description: 'ChatGPT-like UI for your local LLMs. RAG, multi-model, voice. The polished AI playground.',
    category: 'ai',
    image: 'ghcr.io/open-webui/open-webui:main',
    infra: ['sqlite', 'volume'],
    port: 8080,
    env: [
      { key: 'WEBUI_SECRET_KEY', description: 'Session signing key', required: true, auto: 'secret' },
      { key: 'OLLAMA_BASE_URL', description: 'Optional Ollama endpoint', required: false },
      { key: 'OPENAI_API_KEY', description: 'Optional OpenAI key', required: false },
    ],
    memoryMB: 512,
    volumeMB: 256,
    estCostMonthly: 12,
    homepage: 'https://openwebui.com',
    repo: 'https://github.com/open-webui/open-webui',
    glyph: '🤖',
    license: 'MIT',
    tags: ['llm', 'ollama', 'chat'],
  },
  {
    id: 'librechat',
    name: 'LibreChat',
    tagline: 'Multi-model AI chat — Anthropic, OpenAI, Gemini, Ollama',
    description: 'One UI for every model. Agents, plugins, multi-modal, code interpreter. ChatGPT-style polish.',
    category: 'ai',
    image: 'ghcr.io/danny-avila/librechat:latest',
    infra: ['postgres', 'volume'],
    port: 3080,
    env: [
      { key: 'MONGO_URI', description: 'MongoDB URI — bundled', required: false },
      { key: 'CREDS_KEY', description: '32-byte hex secret', required: true, auto: 'secret' },
      { key: 'CREDS_IV', description: '16-byte hex IV', required: true, auto: 'secret' },
      { key: 'JWT_SECRET', description: 'JWT signing secret', required: true, auto: 'secret' },
      { key: 'JWT_REFRESH_SECRET', description: 'JWT refresh secret', required: true, auto: 'secret' },
    ],
    memoryMB: 768,
    volumeMB: 256,
    estCostMonthly: 18,
    homepage: 'https://librechat.ai',
    repo: 'https://github.com/danny-avila/LibreChat',
    glyph: '💭',
    license: 'MIT',
    tags: ['llm', 'multi-model', 'chat'],
  },
  {
    id: 'flowise',
    name: 'Flowise',
    tagline: 'Drag-and-drop UI to build LangChain flows',
    description: 'Visual builder for LLM agents, RAG pipelines, AI workflows. No-code LangChain.',
    category: 'ai',
    image: 'flowiseai/flowise:latest',
    infra: ['postgres', 'volume'],
    port: 3000,
    env: [
      { key: 'DATABASE_TYPE', description: 'postgres', required: true, default: 'postgres' },
      { key: 'DATABASE_HOST', description: 'Postgres host', required: true, auto: 'postgres_url' },
      { key: 'DATABASE_USER', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'DATABASE_PASSWORD', description: 'Postgres password', required: true, auto: 'postgres_url' },
      { key: 'DATABASE_NAME', description: 'DB name', required: true, auto: 'postgres_url' },
      { key: 'FLOWISE_USERNAME', description: 'Admin login', required: true, default: 'admin' },
      { key: 'FLOWISE_PASSWORD', description: 'Admin password', required: true, auto: 'secret' },
    ],
    memoryMB: 512,
    volumeMB: 128,
    estCostMonthly: 14,
    homepage: 'https://flowiseai.com',
    repo: 'https://github.com/FlowiseAI/Flowise',
    glyph: '🌊',
    license: 'Apache-2.0',
    tags: ['llm', 'langchain', 'no-code'],
  },

  // ── Backend ─────────────────────────────────────────────────
  {
    id: 'pocketbase',
    name: 'PocketBase',
    tagline: 'Backend-as-a-service in one Go binary',
    description: 'Database + auth + file storage + realtime + admin UI. Single 50MB executable, SQLite-backed.',
    category: 'backend',
    image: 'spectado/pocketbase:latest',
    infra: ['sqlite', 'volume'],
    port: 8090,
    env: [],
    memoryMB: 128,
    volumeMB: 256,
    estCostMonthly: 4,
    homepage: 'https://pocketbase.io',
    repo: 'https://github.com/pocketbase/pocketbase',
    glyph: '📦',
    license: 'MIT',
    tags: ['backend', 'baas', 'sqlite'],
  },
  {
    id: 'appsmith',
    name: 'Appsmith',
    tagline: 'Low-code internal-tool builder',
    description: 'Drag-drop UI builder for CRUD apps, dashboards, admin panels. Connects to any DB.',
    category: 'backend',
    image: 'appsmith/appsmith-ce:latest',
    infra: ['postgres', 'volume'],
    port: 80,
    env: [
      { key: 'APPSMITH_DB_URL', description: 'Postgres connection', required: true, auto: 'postgres_url' },
      { key: 'APPSMITH_ENCRYPTION_PASSWORD', description: '32-byte secret', required: true, auto: 'secret' },
      { key: 'APPSMITH_ENCRYPTION_SALT', description: '32-byte salt', required: true, auto: 'secret' },
    ],
    memoryMB: 1024,
    volumeMB: 256,
    estCostMonthly: 26,
    homepage: 'https://appsmith.com',
    repo: 'https://github.com/appsmithorg/appsmith',
    glyph: '🛠️',
    license: 'Apache-2.0',
    tags: ['low-code', 'admin-panel', 'retool-alt'],
  },
  {
    id: 'directus',
    name: 'Directus',
    tagline: 'Headless CMS + API on any DB',
    description: 'Instant REST + GraphQL API + admin app. Bring your own Postgres, get a full CMS.',
    category: 'backend',
    image: 'directus/directus:latest',
    infra: ['postgres', 'volume'],
    port: 8055,
    env: [
      { key: 'DB_CLIENT', description: 'postgres', required: true, default: 'pg' },
      { key: 'DB_HOST', description: 'Postgres host', required: true, auto: 'postgres_url' },
      { key: 'DB_PORT', description: 'Postgres port', required: true, default: '5432' },
      { key: 'DB_DATABASE', description: 'DB name', required: true, auto: 'postgres_url' },
      { key: 'DB_USER', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'DB_PASSWORD', description: 'Postgres password', required: true, auto: 'postgres_url' },
      { key: 'KEY', description: '32-byte secret', required: true, auto: 'secret' },
      { key: 'SECRET', description: '32-byte secret', required: true, auto: 'secret' },
      { key: 'ADMIN_EMAIL', description: 'First admin login', required: true, default: 'admin@example.com' },
      { key: 'ADMIN_PASSWORD', description: 'First admin password', required: true, auto: 'secret' },
    ],
    memoryMB: 512,
    volumeMB: 128,
    estCostMonthly: 15,
    homepage: 'https://directus.io',
    repo: 'https://github.com/directus/directus',
    glyph: '🧭',
    license: 'BSL-1.1',
    tags: ['cms', 'headless', 'api'],
  },
  {
    id: 'ghost',
    name: 'Ghost',
    tagline: 'Modern publishing platform',
    description: 'Newsletter + blog + paid memberships in one CMS. Stripe integration, beautiful themes.',
    category: 'backend',
    image: 'ghost:5-alpine',
    infra: ['postgres', 'volume', 'mailrelay'],
    port: 2368,
    env: [
      { key: 'database__client', description: 'pg', required: true, default: 'pg' },
      { key: 'database__connection__host', description: 'Postgres host', required: true, auto: 'postgres_url' },
      { key: 'database__connection__user', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'database__connection__password', description: 'Postgres password', required: true, auto: 'postgres_url' },
      { key: 'database__connection__database', description: 'DB name', required: true, auto: 'postgres_url' },
      { key: 'url', description: 'Public URL', required: true, auto: 'public_url' },
    ],
    memoryMB: 512,
    volumeMB: 256,
    estCostMonthly: 14,
    homepage: 'https://ghost.org',
    repo: 'https://github.com/TryGhost/Ghost',
    glyph: '👻',
    license: 'MIT',
    tags: ['blog', 'newsletter', 'cms'],
  },

  // ── Media ───────────────────────────────────────────────────
  {
    id: 'jellyfin',
    name: 'Jellyfin',
    tagline: 'Free open-source media server',
    description: 'Stream your movies, music, photos to any device. Plex / Emby alternative.',
    category: 'media',
    image: 'jellyfin/jellyfin:latest',
    infra: ['volume'],
    port: 8096,
    env: [
      { key: 'JELLYFIN_PublishedServerUrl', description: 'Public URL', required: true, auto: 'public_url' },
    ],
    memoryMB: 1024,
    volumeMB: 4096,
    estCostMonthly: 38,
    homepage: 'https://jellyfin.org',
    repo: 'https://github.com/jellyfin/jellyfin',
    glyph: '🎬',
    license: 'GPL-2.0',
    tags: ['media', 'plex-alt', 'streaming'],
  },
  {
    id: 'audiobookshelf',
    name: 'Audiobookshelf',
    tagline: 'Self-hosted audiobook + podcast server',
    description: 'Cross-device sync, mobile apps, podcast feeds. The Audible / Spotify alternative for owned media.',
    category: 'media',
    image: 'ghcr.io/advplyr/audiobookshelf:latest',
    infra: ['volume'],
    port: 80,
    env: [],
    memoryMB: 384,
    volumeMB: 2048,
    estCostMonthly: 19,
    homepage: 'https://www.audiobookshelf.org',
    repo: 'https://github.com/advplyr/audiobookshelf',
    glyph: '🎧',
    license: 'GPL-3.0',
    tags: ['audiobooks', 'podcasts'],
  },
  {
    id: 'navidrome',
    name: 'Navidrome',
    tagline: 'Self-hosted music streaming server',
    description: 'Subsonic-compatible, beautiful Spotify-like UI, 1000+ supported clients.',
    category: 'media',
    image: 'deluan/navidrome:latest',
    infra: ['volume'],
    port: 4533,
    env: [
      { key: 'ND_BASEURL', description: 'Public URL', required: false, auto: 'public_url' },
    ],
    memoryMB: 256,
    volumeMB: 1024,
    estCostMonthly: 8,
    homepage: 'https://www.navidrome.org',
    repo: 'https://github.com/navidrome/navidrome',
    glyph: '🎵',
    license: 'GPL-3.0',
    tags: ['music', 'spotify-alt', 'subsonic'],
  },

  // ── AI (catalog v2 expansion 2026-05-24) ───────────────────────
  /**
   * Lobe Chat — 50k+ star polished ChatGPT-style web app with plugins,
   * vision, RAG, and built-in agents. Postgres single-container deploy fits
   * Neon perfectly; React 18 + Next.js shell keeps cold boot well under 30s.
   */
  {
    id: 'lobe-chat',
    name: 'Lobe Chat',
    tagline: 'Polished ChatGPT-style UI for 30+ providers',
    description:
      'Cinematic chat interface for OpenAI, Anthropic, Gemini, Ollama, and local models. Plugins, vision, RAG, agent marketplace. Lighthouse 95+, PWA-ready.',
    category: 'ai',
    image: 'lobehub/lobe-chat-database:latest',
    infra: ['postgres'],
    port: 3210,
    env: [
      { key: 'DATABASE_URL', description: 'Postgres connection string', required: true, auto: 'postgres_url' },
      { key: 'KEY_VAULTS_SECRET', description: '32-byte secret to encrypt user API keys', required: true, auto: 'secret' },
      { key: 'NEXT_AUTH_SECRET', description: 'NextAuth session secret', required: true, auto: 'secret' },
      { key: 'APP_URL', description: 'Public canonical URL', required: true, auto: 'public_url' },
      { key: 'OPENAI_API_KEY', description: 'Optional default OpenAI key', required: false },
    ],
    memoryMB: 768,
    estCostMonthly: 18,
    homepage: 'https://lobehub.com',
    repo: 'https://github.com/lobehub/lobe-chat',
    glyph: '🧠',
    license: 'Apache-2.0',
    tags: ['llm', 'chat', 'pwa'],
  },
  /**
   * AnythingLLM — the most popular self-hosted "chat-your-docs" platform.
   * Bundles its own SQLite + Lance vector DB inside the container — needs
   * only a /app/server/storage volume. Port 3001, instant boot.
   */
  {
    id: 'anything-llm',
    name: 'AnythingLLM',
    tagline: 'Chat with your documents — bring any LLM',
    description:
      'Workspace-scoped doc Q&A with built-in vector store, multi-user permissions, and 30+ LLM providers. Ships an internal LanceDB; only a single volume needed.',
    category: 'ai',
    image: 'mintplexlabs/anythingllm:latest',
    infra: ['volume'],
    port: 3001,
    env: [
      { key: 'STORAGE_DIR', description: 'Container storage path', required: true, default: '/app/server/storage' },
      { key: 'JWT_SECRET', description: '32-byte session signing secret', required: true, auto: 'secret' },
      { key: 'LLM_PROVIDER', description: 'Default LLM (openai/anthropic/ollama)', required: false, default: 'openai' },
      { key: 'OPENAI_API_KEY', description: 'OpenAI API key (if provider=openai)', required: false },
    ],
    memoryMB: 768,
    volumeMB: 1024,
    estCostMonthly: 19,
    homepage: 'https://anythingllm.com',
    repo: 'https://github.com/Mintplex-Labs/anything-llm',
    glyph: '📚',
    license: 'MIT',
    tags: ['rag', 'docs', 'chat'],
  },
  /**
   * NextChat — stateless ChatGPT clone with zero infra. Browser-local
   * storage, no DB. Best fit for tenants who just want a private prompt
   * playground without any persistence overhead.
   */
  {
    id: 'nextchat',
    name: 'NextChat',
    tagline: 'Stateless multi-platform ChatGPT clone',
    description:
      'Fast, light chat UI with browser-local persistence. No DB, no volume — just a container and an OpenAI-compatible key. Apps for iOS, Android, desktop.',
    category: 'ai',
    image: 'yidadaa/chatgpt-next-web:latest',
    infra: [],
    port: 3000,
    env: [
      { key: 'OPENAI_API_KEY', description: 'OpenAI or compatible key', required: false },
      { key: 'CODE', description: 'Optional password gate', required: false, auto: 'secret' },
      { key: 'BASE_URL', description: 'Override API base URL (LiteLLM/OpenAI-compat)', required: false },
    ],
    memoryMB: 256,
    estCostMonthly: 7,
    homepage: 'https://nextchat.club',
    repo: 'https://github.com/ChatGPTNextWeb/NextChat',
    glyph: '⚡',
    license: 'MIT',
    tags: ['chat', 'stateless', 'pwa'],
  },
  /**
   * Khoj — "AI second brain" that indexes Markdown / PDF / Notion notes and
   * answers questions with RAG. Single Postgres + pgvector dependency,
   * official ghcr image, port 42110.
   */
  {
    id: 'khoj',
    name: 'Khoj',
    tagline: 'Your private AI second brain',
    description:
      'Index your notes, docs, and web pages for instant semantic search and chat. Schedules automations, browses the web, runs on local or hosted LLMs.',
    category: 'ai',
    image: 'ghcr.io/khoj-ai/khoj:latest',
    infra: ['postgres', 'volume'],
    port: 42110,
    env: [
      { key: 'POSTGRES_DB', description: 'Postgres DB name', required: true, auto: 'postgres_url' },
      { key: 'POSTGRES_USER', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'POSTGRES_PASSWORD', description: 'Postgres password', required: true, auto: 'postgres_url' },
      { key: 'POSTGRES_HOST', description: 'Postgres host', required: true, auto: 'postgres_url' },
      { key: 'KHOJ_DJANGO_SECRET_KEY', description: 'Django secret key', required: true, auto: 'secret' },
    ],
    memoryMB: 1024,
    volumeMB: 512,
    estCostMonthly: 22,
    homepage: 'https://khoj.dev',
    repo: 'https://github.com/khoj-ai/khoj',
    glyph: '🧭',
    license: 'AGPL-3.0',
    tags: ['rag', 'second-brain', 'search'],
  },
  /**
   * SillyTavern — power-user LLM frontend with character cards, group chats,
   * worldbooks, and presets. Stateless container with mounted /config and
   * /data volumes; no DB needed.
   */
  {
    id: 'sillytavern',
    name: 'SillyTavern',
    tagline: 'LLM frontend for power users',
    description:
      'Character cards, group chats, world-info books, prompt templating, voice. The advanced creative-writing UI for any local or hosted LLM.',
    category: 'ai',
    image: 'ghcr.io/sillytavern/sillytavern:latest',
    infra: ['volume'],
    port: 8000,
    env: [
      { key: 'SILLYTAVERN_BASIC_AUTH', description: 'Enable basic auth (true/false)', required: false, default: 'true' },
      { key: 'SILLYTAVERN_USERNAME', description: 'Basic-auth username', required: false, default: 'admin' },
      { key: 'SILLYTAVERN_PASSWORD', description: 'Basic-auth password', required: false, auto: 'secret' },
    ],
    memoryMB: 384,
    volumeMB: 512,
    estCostMonthly: 11,
    homepage: 'https://sillytavernai.com',
    repo: 'https://github.com/SillyTavern/SillyTavern',
    glyph: '🎭',
    license: 'AGPL-3.0',
    tags: ['llm', 'creative-writing', 'roleplay'],
  },

  // ── Agent Platform ─────────────────────────────────────────────
  /**
   * Langflow — DataStax-backed visual agent/RAG builder. Drag-drop nodes
   * compile to Python LangChain code; Postgres single container; port 7860.
   * Most actively-maintained no-code agent platform of 2026.
   */
  {
    id: 'langflow',
    name: 'Langflow',
    tagline: 'Visual builder for LangChain + LangGraph agents',
    description:
      'Drag-drop graph editor for RAG pipelines, agents, MCP servers. Exports Python. Backed by DataStax. The polished alternative to writing LangChain by hand.',
    category: 'agent-platform',
    image: 'langflowai/langflow:latest',
    infra: ['postgres', 'volume'],
    port: 7860,
    env: [
      { key: 'LANGFLOW_DATABASE_URL', description: 'Postgres connection URL', required: true, auto: 'postgres_url' },
      { key: 'LANGFLOW_AUTO_LOGIN', description: 'Auto-login flag', required: true, default: 'false' },
      { key: 'LANGFLOW_SUPERUSER', description: 'Initial admin email', required: true, default: 'admin@example.com' },
      { key: 'LANGFLOW_SUPERUSER_PASSWORD', description: 'Initial admin password', required: true, auto: 'secret' },
      { key: 'LANGFLOW_SECRET_KEY', description: '32-byte encryption secret', required: true, auto: 'secret' },
    ],
    memoryMB: 1024,
    volumeMB: 512,
    estCostMonthly: 24,
    homepage: 'https://langflow.org',
    repo: 'https://github.com/langflow-ai/langflow',
    glyph: '🪢',
    license: 'MIT',
    tags: ['agents', 'no-code', 'rag'],
  },

  // ── Vector DB ──────────────────────────────────────────────────
  /**
   * Qdrant — Rust-written vector DB, single-container, only needs a volume.
   * 2300 QPS on c5.xlarge, web dashboard at /dashboard. The default pick for
   * any RAG side-deploy.
   */
  {
    id: 'qdrant',
    name: 'Qdrant',
    tagline: 'Blazing-fast Rust vector database',
    description:
      'High-performance vector similarity search with filtering, hybrid search, and a built-in dashboard. The default vector store for production RAG.',
    category: 'vector-db',
    image: 'qdrant/qdrant:latest',
    infra: ['volume'],
    port: 6333,
    env: [
      { key: 'QDRANT__SERVICE__API_KEY', description: 'API key to gate REST/gRPC', required: true, auto: 'secret' },
    ],
    memoryMB: 512,
    volumeMB: 1024,
    estCostMonthly: 14,
    homepage: 'https://qdrant.tech',
    repo: 'https://github.com/qdrant/qdrant',
    glyph: '🦀',
    license: 'Apache-2.0',
    tags: ['vector-db', 'rag', 'rust'],
  },
  /**
   * ChromaDB — Python-first OSS vector DB. Single-container, volume only.
   * Bring-your-own embedding model. The "started with LangChain" default.
   */
  {
    id: 'chromadb',
    name: 'Chroma',
    tagline: 'Open-source vector DB for AI',
    description:
      'Embedding database with built-in token auth, persistent volumes, and a Python-first API. The starter vector store for prototyping RAG apps.',
    category: 'vector-db',
    image: 'chromadb/chroma:latest',
    infra: ['volume'],
    port: 8000,
    env: [
      { key: 'CHROMA_SERVER_AUTHN_PROVIDER', description: 'Auth provider class', required: false, default: 'chromadb.auth.token_authn.TokenAuthenticationServerProvider' },
      { key: 'CHROMA_SERVER_AUTHN_CREDENTIALS', description: 'Token (Bearer ...)', required: true, auto: 'secret' },
      { key: 'IS_PERSISTENT', description: 'Persist to disk', required: true, default: 'TRUE' },
    ],
    memoryMB: 512,
    volumeMB: 1024,
    estCostMonthly: 12,
    homepage: 'https://trychroma.com',
    repo: 'https://github.com/chroma-core/chroma',
    glyph: '🎨',
    license: 'Apache-2.0',
    tags: ['vector-db', 'rag', 'python'],
  },
  /**
   * Weaviate — vector DB with first-class hybrid search and 24+ embedding
   * modules. semitechnologies/weaviate single container, volume only,
   * AWS-grade durability with replication.
   */
  {
    id: 'weaviate',
    name: 'Weaviate',
    tagline: 'Hybrid vector + keyword search engine',
    description:
      'Production-grade vector DB with built-in BM25, generative search modules, and replication. Drop-in OpenAI/Cohere/HuggingFace vectorizers.',
    category: 'vector-db',
    image: 'semitechnologies/weaviate:1.28.0',
    infra: ['volume'],
    port: 8080,
    env: [
      { key: 'AUTHENTICATION_APIKEY_ENABLED', description: 'Enable API key auth', required: true, default: 'true' },
      { key: 'AUTHENTICATION_APIKEY_ALLOWED_KEYS', description: 'Comma-separated API keys', required: true, auto: 'secret' },
      { key: 'AUTHENTICATION_APIKEY_USERS', description: 'Comma-separated usernames', required: true, default: 'admin' },
      { key: 'PERSISTENCE_DATA_PATH', description: 'On-disk data path', required: true, default: '/var/lib/weaviate' },
    ],
    memoryMB: 1024,
    volumeMB: 2048,
    estCostMonthly: 26,
    homepage: 'https://weaviate.io',
    repo: 'https://github.com/weaviate/weaviate',
    glyph: '🕸️',
    license: 'BSD-3-Clause',
    tags: ['vector-db', 'hybrid-search', 'rag'],
  },

  // ── Media AI (image gen) ───────────────────────────────────────
  /**
   * ComfyUI — node-based image generation, the de-facto Stable Diffusion
   * graph editor. yanwk/comfyui-boot CPU image runs on CFC; GPU upgrade
   * via Containers GPU class when available.
   */
  {
    id: 'comfyui',
    name: 'ComfyUI',
    tagline: 'Node-based Stable Diffusion workflow editor',
    description:
      'The most powerful and modular SDXL/Flux graph editor. Drag-drop nodes for txt2img, img2img, inpainting, controlnet, LoRAs, video.',
    category: 'media-ai',
    image: 'yanwk/comfyui-boot:cu128-megapak',
    infra: ['volume'],
    port: 8188,
    env: [
      { key: 'CLI_ARGS', description: 'Extra command-line args (e.g. --listen)', required: false, default: '--listen 0.0.0.0 --enable-cors-header' },
    ],
    memoryMB: 1024,
    volumeMB: 4096,
    estCostMonthly: 42,
    homepage: 'https://comfy.org',
    repo: 'https://github.com/comfyanonymous/ComfyUI',
    glyph: '🪡',
    license: 'GPL-3.0',
    tags: ['image-gen', 'sdxl', 'flux'],
  },
  /**
   * Stable Diffusion WebUI (AUTOMATIC1111) — the legacy default UI for SD.
   * AI-Dock image bundles auth + xformers + persistent volumes. The most
   * extension-rich SD frontend in existence.
   */
  {
    id: 'sd-webui',
    name: 'Stable Diffusion WebUI',
    tagline: 'AUTOMATIC1111 — the extension-king SD frontend',
    description:
      'Text-to-image, image-to-image, inpainting, outpainting, upscaling. 1000+ community extensions. AI-Dock image adds built-in auth + persistent models.',
    category: 'media-ai',
    image: 'ghcr.io/ai-dock/stable-diffusion-webui:latest-cuda',
    infra: ['volume'],
    port: 7860,
    env: [
      { key: 'WEB_USER', description: 'Basic-auth username', required: true, default: 'admin' },
      { key: 'WEB_PASSWORD', description: 'Basic-auth password', required: true, auto: 'secret' },
      { key: 'WEBUI_FLAGS', description: 'Extra A1111 flags (e.g. --xformers)', required: false, default: '--xformers --listen' },
    ],
    memoryMB: 1024,
    volumeMB: 8192,
    estCostMonthly: 58,
    homepage: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui',
    repo: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui',
    glyph: '🎨',
    license: 'AGPL-3.0',
    tags: ['image-gen', 'stable-diffusion', 'a1111'],
  },
  /**
   * Fooocus — plug-and-play SDXL UI, "image gen like Midjourney". 4GB VRAM
   * floor, ships a single container. Most welcoming SD onboarding.
   */
  {
    id: 'fooocus',
    name: 'Fooocus',
    tagline: 'Midjourney-style SDXL — just type, get art',
    description:
      'Zero-config image generation built on SDXL. Smart prompt expansion, style presets, no parameter tweaking. Auto-downloads JuggernautXL on first boot.',
    category: 'media-ai',
    image: 'ghcr.io/lllyasviel/fooocus:latest',
    infra: ['volume'],
    port: 7865,
    env: [
      { key: 'FOOOCUS_ARGS', description: 'Extra launch args', required: false, default: '--listen 0.0.0.0' },
    ],
    memoryMB: 1024,
    volumeMB: 8192,
    estCostMonthly: 48,
    homepage: 'https://github.com/lllyasviel/Fooocus',
    repo: 'https://github.com/lllyasviel/Fooocus',
    glyph: '🌅',
    license: 'GPL-3.0',
    tags: ['image-gen', 'sdxl', 'beginner-friendly'],
  },
  /**
   * InvokeAI — professional-grade SD UI for studios. Canvas with layers,
   * unified inpainting, model manager. Official ghcr image, port 9090.
   */
  {
    id: 'invokeai',
    name: 'InvokeAI',
    tagline: 'Professional SD canvas with layers',
    description:
      'The "Photoshop for AI" — unified canvas with layers, regional prompting, control layers, batch workflows. Studio-grade image generation.',
    category: 'media-ai',
    image: 'ghcr.io/invoke-ai/invokeai:latest',
    infra: ['volume'],
    port: 9090,
    env: [
      { key: 'INVOKEAI_PORT', description: 'Service port', required: true, default: '9090' },
      { key: 'INVOKEAI_ROOT', description: 'Data root', required: true, default: '/invokeai' },
    ],
    memoryMB: 1024,
    volumeMB: 8192,
    estCostMonthly: 52,
    homepage: 'https://invoke.com',
    repo: 'https://github.com/invoke-ai/InvokeAI',
    glyph: '🖼️',
    license: 'Apache-2.0',
    tags: ['image-gen', 'studio', 'canvas'],
  },

  // ── Voice AI ───────────────────────────────────────────────────
  /**
   * Whisper ASR Webservice — OpenAI Whisper / faster-whisper / WhisperX
   * wrapped in a FastAPI server with Swagger UI. Cache models on a volume.
   */
  {
    id: 'whisper-asr',
    name: 'Whisper ASR',
    tagline: 'OpenAI Whisper as a REST API',
    description:
      'Production-ready ASR microservice with faster-whisper backend, multi-format export (SRT/VTT/JSON), and Swagger UI on port 9000.',
    category: 'voice-ai',
    image: 'onerahmet/openai-whisper-asr-webservice:latest',
    infra: ['volume'],
    port: 9000,
    env: [
      { key: 'ASR_MODEL', description: 'tiny / base / small / medium / large-v3', required: true, default: 'base' },
      { key: 'ASR_ENGINE', description: 'openai_whisper / faster_whisper', required: true, default: 'faster_whisper' },
    ],
    memoryMB: 1024,
    volumeMB: 4096,
    estCostMonthly: 22,
    homepage: 'https://ahmetoner.com/whisper-asr-webservice',
    repo: 'https://github.com/ahmetoner/whisper-asr-webservice',
    glyph: '🎙️',
    license: 'MIT',
    tags: ['stt', 'whisper', 'transcription'],
  },
  /**
   * Whishper — full transcription suite (UI + queue + translate). Single
   * pluja/whishper image bundles Mongo + LibreTranslate optional. Port 8082.
   */
  {
    id: 'whishper',
    name: 'Whishper',
    tagline: 'Full transcription suite with editor',
    description:
      'Web UI to upload audio/video, transcribe via Whisper, edit subtitles inline, and translate to 60+ languages. The full Otter.ai replacement.',
    category: 'voice-ai',
    image: 'pluja/whishper:latest',
    infra: ['volume'],
    port: 80,
    env: [
      { key: 'PUBLIC_INTERNAL_API_HOST', description: 'Internal API hostname', required: false, default: 'http://127.0.0.1:8080' },
      { key: 'WHISPER_MODELS', description: 'Comma list (tiny,base,small)', required: false, default: 'tiny,base' },
    ],
    memoryMB: 1024,
    volumeMB: 4096,
    estCostMonthly: 24,
    homepage: 'https://whishper.net',
    repo: 'https://github.com/pluja/whishper',
    glyph: '🎧',
    license: 'GPL-3.0',
    tags: ['transcription', 'whisper', 'subtitles'],
  },
  /**
   * Coqui TTS — open-source text-to-speech with voice cloning (XTTS) in 17
   * languages. ghcr.io/coqui-ai/tts ships a single FastAPI container.
   */
  {
    id: 'coqui-tts',
    name: 'Coqui TTS',
    tagline: 'OSS voice cloning in 17 languages',
    description:
      'Self-hosted text-to-speech with XTTS voice cloning from 6-second samples. REST API, Studio UI, dozens of pretrained voices.',
    category: 'voice-ai',
    image: 'ghcr.io/coqui-ai/tts-cpu:latest',
    infra: ['volume'],
    port: 5002,
    env: [
      { key: 'COQUI_TOS_AGREED', description: 'Must be "1" to accept license', required: true, default: '1' },
    ],
    memoryMB: 1024,
    volumeMB: 2048,
    estCostMonthly: 21,
    homepage: 'https://coqui.ai',
    repo: 'https://github.com/coqui-ai/TTS',
    glyph: '🗣️',
    license: 'MPL-2.0',
    tags: ['tts', 'voice-cloning', 'xtts'],
  },

  // ── AI Search ──────────────────────────────────────────────────
  /**
   * SearXNG — privacy metasearch over 230+ engines. Backbone for every
   * self-hosted AI answer engine. Single-container, volume only.
   */
  {
    id: 'searxng',
    name: 'SearXNG',
    tagline: 'Private metasearch over 230+ engines',
    description:
      'No tracking, no cookies, no profiling. Aggregates Google, Bing, DDG, Wikipedia, and 226 more. The plumbing every AI search needs.',
    category: 'privacy',
    image: 'searxng/searxng:latest',
    infra: ['volume'],
    port: 8080,
    env: [
      { key: 'SEARXNG_BASE_URL', description: 'Public canonical URL', required: true, auto: 'public_url' },
      { key: 'SEARXNG_SECRET', description: 'Random 32-byte secret', required: true, auto: 'secret' },
    ],
    memoryMB: 384,
    volumeMB: 256,
    estCostMonthly: 9,
    homepage: 'https://docs.searxng.org',
    repo: 'https://github.com/searxng/searxng',
    glyph: '🔎',
    license: 'AGPL-3.0',
    tags: ['search', 'privacy', 'metasearch'],
  },
  /**
   * Perplexica — generative AI search bundling SearXNG inside one container.
   * Standard image at port 3000, no external search key needed.
   */
  {
    id: 'perplexica',
    name: 'Perplexica',
    tagline: 'Open-source Perplexity AI alternative',
    description:
      'AI answer engine with citations, follow-up questions, focus modes (academic, YouTube, Reddit). Bundles SearXNG internally — one container.',
    category: 'ai-search',
    image: 'itzcrazykns1337/perplexica:latest',
    infra: ['volume'],
    port: 3000,
    env: [
      { key: 'OPENAI_API_KEY', description: 'OpenAI key (or Ollama URL)', required: false },
      { key: 'GROQ_API_KEY', description: 'Optional Groq key', required: false },
      { key: 'ANTHROPIC_API_KEY', description: 'Optional Anthropic key', required: false },
    ],
    memoryMB: 768,
    volumeMB: 256,
    estCostMonthly: 17,
    homepage: 'https://github.com/ItzCrazyKns/Perplexica',
    repo: 'https://github.com/ItzCrazyKns/Perplexica',
    glyph: '🔮',
    license: 'MIT',
    tags: ['ai-search', 'perplexity-alt', 'generative-ui'],
  },
  /**
   * Morphic — generative-UI answer engine that renders charts, code, cards
   * inline with the answer. Next.js single container + Postgres.
   */
  {
    id: 'morphic',
    name: 'Morphic',
    tagline: 'AI search with generative UI',
    description:
      'Real-time generative-UI answers: charts, code blocks, video cards render inline. Powered by Vercel AI SDK + SearXNG. Multi-provider.',
    category: 'ai-search',
    image: 'ghcr.io/miurla/morphic:latest',
    infra: ['postgres', 'redis'],
    port: 3000,
    env: [
      { key: 'OPENAI_API_KEY', description: 'OpenAI key', required: true },
      { key: 'NEXT_PUBLIC_BASE_URL', description: 'Public canonical URL', required: true, auto: 'public_url' },
      { key: 'UPSTASH_REDIS_REST_URL', description: 'Upstash Redis REST URL', required: true, auto: 'redis_url' },
      { key: 'UPSTASH_REDIS_REST_TOKEN', description: 'Upstash Redis REST token', required: true, auto: 'secret' },
    ],
    memoryMB: 768,
    estCostMonthly: 21,
    homepage: 'https://morphic.sh',
    repo: 'https://github.com/miurla/morphic',
    glyph: '🌀',
    license: 'Apache-2.0',
    tags: ['ai-search', 'generative-ui', 'nextjs'],
  },
  /**
   * Farfalle — minimal Perplexity clone with local-or-cloud LLM support.
   * Single image, Postgres optional.
   */
  {
    id: 'farfalle',
    name: 'Farfalle',
    tagline: 'Minimal local-LLM AI search',
    description:
      'Self-hosted Perplexity clone supporting Tavily, SearXNG, Serper, Bing. Runs against Ollama, Groq, OpenAI, or any local model.',
    category: 'ai-search',
    image: 'ghcr.io/rashadphz/farfalle:latest',
    infra: ['postgres'],
    port: 8000,
    env: [
      { key: 'DATABASE_URL', description: 'Postgres connection string', required: true, auto: 'postgres_url' },
      { key: 'OPENAI_API_KEY', description: 'OpenAI key (or Ollama URL)', required: false },
      { key: 'TAVILY_API_KEY', description: 'Tavily search API key', required: false },
    ],
    memoryMB: 512,
    estCostMonthly: 14,
    homepage: 'https://github.com/rashadphz/farfalle',
    repo: 'https://github.com/rashadphz/farfalle',
    glyph: '🍝',
    license: 'Apache-2.0',
    tags: ['ai-search', 'local-llm', 'minimal'],
  },

  // ── AI Ops ─────────────────────────────────────────────────────
  /**
   * LiteLLM — OpenAI-compatible proxy for 100+ providers. Centralized key
   * vault, spend tracking, rate limits. ghcr.io/berriai/litellm-database
   * single container + Postgres.
   */
  {
    id: 'litellm',
    name: 'LiteLLM',
    tagline: 'OpenAI-compatible proxy for 100+ providers',
    description:
      'Unified API gateway across Anthropic, OpenAI, Bedrock, Vertex, Ollama, and 95 more. Virtual keys, spend tracking, rate limits, observability hooks.',
    category: 'ai-ops',
    image: 'ghcr.io/berriai/litellm-database:main-stable',
    infra: ['postgres'],
    port: 4000,
    env: [
      { key: 'DATABASE_URL', description: 'Postgres connection string', required: true, auto: 'postgres_url' },
      { key: 'LITELLM_MASTER_KEY', description: 'Master admin key (sk-...)', required: true, auto: 'secret' },
      { key: 'LITELLM_SALT_KEY', description: '32-byte salt for key encryption', required: true, auto: 'secret' },
      { key: 'STORE_MODEL_IN_DB', description: 'Persist model config in DB', required: false, default: 'True' },
    ],
    memoryMB: 768,
    estCostMonthly: 18,
    homepage: 'https://litellm.ai',
    repo: 'https://github.com/BerriAI/litellm',
    glyph: '🪪',
    license: 'MIT',
    tags: ['gateway', 'proxy', 'multi-model'],
  },
  /**
   * Langfuse — LLM observability + eval + experiment (web container only).
   * Skip ClickHouse for v2-style basic mode; pair with Postgres for traces.
   */
  {
    id: 'langfuse',
    name: 'Langfuse',
    tagline: 'LLM observability + eval + prompt mgmt',
    description:
      'Trace every LLM call, score outputs, A/B prompts, manage prompt versions. The open-source product analytics layer for AI apps.',
    category: 'ai-ops',
    image: 'langfuse/langfuse:2',
    infra: ['postgres'],
    port: 3000,
    env: [
      { key: 'DATABASE_URL', description: 'Postgres connection string', required: true, auto: 'postgres_url' },
      { key: 'NEXTAUTH_URL', description: 'Public canonical URL', required: true, auto: 'public_url' },
      { key: 'NEXTAUTH_SECRET', description: '32-byte NextAuth secret', required: true, auto: 'secret' },
      { key: 'SALT', description: '32-byte API-key salt', required: true, auto: 'secret' },
    ],
    memoryMB: 768,
    estCostMonthly: 18,
    homepage: 'https://langfuse.com',
    repo: 'https://github.com/langfuse/langfuse',
    glyph: '🔬',
    license: 'MIT',
    tags: ['observability', 'tracing', 'evals'],
  },
  /**
   * Arize Phoenix — OSS LLM tracing + evaluation in a single container.
   * Port 6006 web UI + 4317 OTLP. SQLite by default, Postgres optional.
   */
  {
    id: 'phoenix',
    name: 'Arize Phoenix',
    tagline: 'OSS LLM tracing + evals',
    description:
      'OpenInference-based tracing for LangChain, LlamaIndex, DSPy, Haystack. Built-in eval datasets, prompt experimentation, side-by-side comparison.',
    category: 'ai-ops',
    image: 'arizephoenix/phoenix:latest',
    infra: ['volume'],
    port: 6006,
    env: [
      { key: 'PHOENIX_WORKING_DIR', description: 'Data directory', required: true, default: '/mnt/data' },
      { key: 'PHOENIX_ENABLE_AUTH', description: 'Require login (true/false)', required: false, default: 'true' },
      { key: 'PHOENIX_SECRET', description: '32-byte session secret', required: false, auto: 'secret' },
    ],
    memoryMB: 768,
    volumeMB: 1024,
    estCostMonthly: 17,
    homepage: 'https://phoenix.arize.com',
    repo: 'https://github.com/Arize-ai/phoenix',
    glyph: '🦅',
    license: 'Elastic-2.0',
    tags: ['observability', 'tracing', 'opentelemetry'],
  },

  // ── Developer (AI coding) ──────────────────────────────────────
  /**
   * Tabby — self-hosted GitHub Copilot alternative. tabbyml/tabby single
   * container, OpenAPI inside. CUDA recommended; CPU fallback available.
   */
  {
    id: 'tabby',
    name: 'Tabby',
    tagline: 'Self-hosted GitHub Copilot alternative',
    description:
      'IDE-integrated code completion + chat, OpenAPI gateway, IDE plugins for VSCode/JetBrains/Vim. Runs Qwen2.5-Coder out of the box.',
    category: 'developer',
    image: 'tabbyml/tabby:latest',
    infra: ['volume'],
    port: 8080,
    env: [
      { key: 'TABBY_MODEL', description: 'HuggingFace model id', required: true, default: 'Qwen/Qwen2.5-Coder-7B-Instruct' },
      { key: 'TABBY_CHAT_MODEL', description: 'Chat model id', required: false, default: 'Qwen/Qwen2.5-Coder-7B-Instruct' },
      { key: 'TABBY_DEVICE', description: 'cuda / metal / cpu', required: false, default: 'cpu' },
    ],
    memoryMB: 1024,
    volumeMB: 4096,
    estCostMonthly: 38,
    homepage: 'https://tabbyml.com',
    repo: 'https://github.com/TabbyML/tabby',
    glyph: '😺',
    license: 'Apache-2.0',
    tags: ['ai-coding', 'copilot-alt', 'completion'],
  },

  // ── Knowledge (AI bookmarks + RSS) ─────────────────────────────
  /**
   * Karakeep (ex-Hoarder) — AI-tagged bookmark manager. Postgres + volume,
   * single ghcr.io image. iOS/Android/Chrome/Firefox apps included.
   */
  {
    id: 'karakeep',
    name: 'Karakeep',
    tagline: 'AI-tagged bookmark everything app',
    description:
      'Save links, notes, PDFs, images. AI auto-tags via OpenAI or local Ollama. Full-text + semantic search. Mobile + browser extensions.',
    category: 'knowledge',
    image: 'ghcr.io/karakeep-app/karakeep:release',
    infra: ['postgres', 'volume'],
    port: 3000,
    env: [
      { key: 'DATABASE_URL', description: 'Postgres connection string', required: true, auto: 'postgres_url' },
      { key: 'NEXTAUTH_URL', description: 'Public canonical URL', required: true, auto: 'public_url' },
      { key: 'NEXTAUTH_SECRET', description: '32-byte NextAuth secret', required: true, auto: 'secret' },
      { key: 'MEILI_ADDR', description: 'Optional Meilisearch URL', required: false },
      { key: 'OPENAI_API_KEY', description: 'OpenAI key for AI tagging', required: false },
    ],
    memoryMB: 768,
    volumeMB: 2048,
    estCostMonthly: 19,
    homepage: 'https://karakeep.app',
    repo: 'https://github.com/karakeep-app/karakeep',
    glyph: '🪺',
    license: 'AGPL-3.0',
    tags: ['bookmarks', 'ai-tagging', 'rag'],
  },
  /**
   * Miniflux — Go-written RSS reader, minimalist UX. Single container +
   * Postgres, ~20 MiB RAM idle. The fastest self-hosted feed reader.
   */
  {
    id: 'miniflux',
    name: 'Miniflux',
    tagline: 'Minimalist Go RSS reader',
    description:
      'Tiny, fast feed reader written in Go. Google Reader API for mobile clients, fever API, integrations with Wallabag, Pocket, Pinboard, Instapaper.',
    category: 'knowledge',
    image: 'miniflux/miniflux:latest',
    infra: ['postgres'],
    port: 8080,
    env: [
      { key: 'DATABASE_URL', description: 'Postgres connection string', required: true, auto: 'postgres_url' },
      { key: 'RUN_MIGRATIONS', description: 'Run DB migrations on boot', required: true, default: '1' },
      { key: 'CREATE_ADMIN', description: 'Create initial admin user', required: true, default: '1' },
      { key: 'ADMIN_USERNAME', description: 'Initial admin login', required: true, default: 'admin' },
      { key: 'ADMIN_PASSWORD', description: 'Initial admin password', required: true, auto: 'secret' },
    ],
    memoryMB: 128,
    estCostMonthly: 6,
    homepage: 'https://miniflux.app',
    repo: 'https://github.com/miniflux/v2',
    glyph: '📰',
    license: 'Apache-2.0',
    tags: ['rss', 'reader', 'go'],
  },
  /**
   * FreshRSS — PHP RSS aggregator with extensions, themes, multi-user.
   * SQLite default keeps it single-container.
   */
  {
    id: 'freshrss',
    name: 'FreshRSS',
    tagline: 'Self-hosted RSS aggregator with extensions',
    description:
      'Multi-user RSS reader with themes, extensions, opml import/export, mobile API. SQLite by default — no DB needed.',
    category: 'knowledge',
    image: 'freshrss/freshrss:latest',
    infra: ['sqlite', 'volume'],
    port: 80,
    env: [
      { key: 'TZ', description: 'Timezone (e.g. America/New_York)', required: true, default: 'UTC' },
      { key: 'CRON_MIN', description: 'Cron schedule (refresh cadence)', required: false, default: '13,43' },
    ],
    memoryMB: 256,
    volumeMB: 512,
    estCostMonthly: 7,
    homepage: 'https://freshrss.org',
    repo: 'https://github.com/FreshRSS/FreshRSS',
    glyph: '🌿',
    license: 'AGPL-3.0',
    tags: ['rss', 'reader', 'php'],
  },

  // ── Productivity (AI doc tools) ────────────────────────────────
  /**
   * Stirling PDF — 60+ PDF tools, OCR, splitting, signing. Single container
   * port 8080, no DB. The OSS Adobe Acrobat alternative.
   */
  {
    id: 'stirling-pdf',
    name: 'Stirling PDF',
    tagline: '60+ PDF tools — the OSS Acrobat',
    description:
      'Merge, split, sign, redact, OCR, convert, compress. 60+ REST endpoints. Files held in memory only — never written to disk.',
    category: 'productivity',
    image: 'docker.stirlingpdf.com/stirlingtools/stirling-pdf:latest',
    infra: [],
    port: 8080,
    env: [
      { key: 'DOCKER_ENABLE_SECURITY', description: 'Enable login (true/false)', required: false, default: 'true' },
      { key: 'SECURITY_INITIALLOGIN_USERNAME', description: 'Initial admin user', required: false, default: 'admin' },
      { key: 'SECURITY_INITIALLOGIN_PASSWORD', description: 'Initial admin password', required: false, auto: 'secret' },
    ],
    memoryMB: 512,
    estCostMonthly: 11,
    homepage: 'https://stirlingpdf.com',
    repo: 'https://github.com/Stirling-Tools/Stirling-PDF',
    glyph: '📄',
    license: 'MIT',
    tags: ['pdf', 'ocr', 'acrobat-alt'],
  },

  // ── AI Marketing ───────────────────────────────────────────────
  /**
   * Postiz — open Buffer/Hootsuite alternative with AI scheduler. 17+
   * platforms, AI auto-complete. Single image + Postgres.
   */
  {
    id: 'postiz',
    name: 'Postiz',
    tagline: 'AI social media scheduler — 17+ platforms',
    description:
      'Schedule across X, Bluesky, LinkedIn, Mastodon, TikTok, YouTube, Discord, Threads. AI auto-complete, team collab, analytics. Buffer/Hootsuite alt.',
    category: 'ai-marketing',
    image: 'ghcr.io/gitroomhq/postiz-app:latest',
    infra: ['postgres', 'redis'],
    port: 5000,
    env: [
      { key: 'DATABASE_URL', description: 'Postgres connection string', required: true, auto: 'postgres_url' },
      { key: 'REDIS_URL', description: 'Redis connection URL', required: true, auto: 'redis_url' },
      { key: 'JWT_SECRET', description: '32-byte JWT signing secret', required: true, auto: 'secret' },
      { key: 'FRONTEND_URL', description: 'Public canonical URL', required: true, auto: 'public_url' },
      { key: 'NEXT_PUBLIC_BACKEND_URL', description: 'Public API URL', required: true, auto: 'public_url' },
      { key: 'BACKEND_INTERNAL_URL', description: 'Internal API URL', required: true, default: 'http://localhost:3000' },
    ],
    memoryMB: 1024,
    estCostMonthly: 24,
    homepage: 'https://postiz.com',
    repo: 'https://github.com/gitroomhq/postiz-app',
    glyph: '📨',
    license: 'AGPL-3.0',
    tags: ['social', 'scheduler', 'ai'],
  },

  // ── Media (AI photo management) ────────────────────────────────
  /**
   * Immich — AI-powered self-hosted photo + video manager (90k+ stars).
   * Monolithic image from imagegenius keeps it single-container.
   */
  {
    id: 'immich',
    name: 'Immich',
    tagline: 'AI-powered Google Photos alternative',
    description:
      'Auto-backup from mobile, facial recognition, CLIP smart search, shared albums. 90k+ stars, the fastest-growing self-hosted app of 2026.',
    category: 'media',
    image: 'ghcr.io/imagegenius/immich:latest',
    infra: ['postgres', 'redis', 'volume'],
    port: 8080,
    env: [
      { key: 'DB_HOSTNAME', description: 'Postgres host', required: true, auto: 'postgres_url' },
      { key: 'DB_USERNAME', description: 'Postgres user', required: true, auto: 'postgres_url' },
      { key: 'DB_PASSWORD', description: 'Postgres password', required: true, auto: 'postgres_url' },
      { key: 'DB_DATABASE_NAME', description: 'Postgres database', required: true, auto: 'postgres_url' },
      { key: 'REDIS_HOSTNAME', description: 'Redis host', required: true, auto: 'redis_url' },
      { key: 'UPLOAD_LOCATION', description: 'Container upload path', required: true, default: '/photos' },
    ],
    memoryMB: 1024,
    volumeMB: 8192,
    estCostMonthly: 36,
    homepage: 'https://immich.app',
    repo: 'https://github.com/immich-app/immich',
    glyph: '📸',
    license: 'AGPL-3.0',
    tags: ['photos', 'ai-tagging', 'face-recognition'],
  },
];

export const APP_CATEGORIES: ReadonlyArray<{ id: AppCategory; label: string; glyph: string }> = [
  { id: 'analytics', label: 'Analytics', glyph: '📊' },
  { id: 'knowledge', label: 'Knowledge', glyph: '📚' },
  { id: 'productivity', label: 'Productivity', glyph: '✅' },
  { id: 'communication', label: 'Communication', glyph: '💬' },
  { id: 'developer', label: 'Developer', glyph: '💻' },
  { id: 'privacy', label: 'Privacy', glyph: '🔐' },
  { id: 'marketing', label: 'Marketing', glyph: '📧' },
  { id: 'monitoring', label: 'Monitoring', glyph: '🩺' },
  { id: 'ai', label: 'AI', glyph: '🤖' },
  { id: 'backend', label: 'Backend', glyph: '🛠️' },
  { id: 'media', label: 'Media', glyph: '🎬' },
  { id: 'vector-db', label: 'Vector DB', glyph: '🧮' },
  { id: 'media-ai', label: 'AI image', glyph: '🖼️' },
  { id: 'voice-ai', label: 'AI voice', glyph: '🗣️' },
  { id: 'agent-platform', label: 'Agents', glyph: '🪢' },
  { id: 'ai-ops', label: 'AI ops', glyph: '🔬' },
  { id: 'ai-search', label: 'AI search', glyph: '🔮' },
  { id: 'ai-marketing', label: 'AI marketing', glyph: '📨' },
];

/** Lookup an app by id — throws if missing so callers fail loud. */
export function findApp(id: string): CatalogApp {
  const app = APPS_CATALOG.find((a) => a.id === id);
  if (!app) throw new Error(`Unknown app id: ${id}`);
  return app;
}
