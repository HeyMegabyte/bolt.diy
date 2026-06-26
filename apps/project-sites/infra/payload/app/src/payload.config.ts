import { postgresAdapter } from '@payloadcms/db-postgres'
import { s3Storage } from '@payloadcms/storage-s3'
import { seoPlugin } from '@payloadcms/plugin-seo'
import { redirectsPlugin } from '@payloadcms/plugin-redirects'
import { searchPlugin } from '@payloadcms/plugin-search'
import { formBuilderPlugin } from '@payloadcms/plugin-form-builder'
import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { resendAdapter } from '@payloadcms/email-resend'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Tags } from './collections/Tags'
import { Posts } from './collections/Posts'
import { Categories } from './collections/Categories'
import { Pages } from './collections/Pages'
import { globals } from './globals'
import { defaultEditor } from './lexical'
import { backupEndpoint } from './endpoints/backup'
import { blogFeedEndpoint } from './endpoints/blog'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const SERVER_URL = process.env.PAYLOAD_PUBLIC_SERVER_URL || 'https://cms.projectsites.dev'

/** Origins allowed to call the API + submit forms (CORS + CSRF). */
const allowedOrigins = [
  SERVER_URL,
  'https://projectsites.dev',
  'https://www.projectsites.dev',
  'https://editor.projectsites.dev',
]

export default buildConfig({
  serverURL: SERVER_URL,
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    meta: {
      titleSuffix: '· ProjectSites CMS',
      description: 'Content management for projectsites.dev',
    },
    dateFormat: 'MMM d, yyyy h:mm a',
  },
  collections: [Posts, Pages, Categories, Media, Tags, Users],
  globals,
  endpoints: [backupEndpoint, blogFeedEndpoint],
  editor: defaultEditor,
  secret: process.env.PAYLOAD_SECRET || '',
  cors: allowedOrigins,
  csrf: allowedOrigins,
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  // Schema is migration-managed (`payload migrate` on boot). `push:false` in prod.
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URI || '' },
    push: false,
  }),
  sharp,
  localization: { locales: ['en'], fallback: true, defaultLocale: 'en' },
  // Background jobs: process the queue every minute so scheduled-publish fires
  // inside the long-running container. autoRun is safe here (persistent Next server).
  jobs: {
    access: { run: ({ req }) => Boolean(req.user) },
    autoRun: [{ cron: '* * * * *', queue: 'default', limit: 10 }],
    shouldAutoRun: async () => true,
  },
  email: resendAdapter({
    defaultFromAddress: 'noreply@projectsites.dev',
    defaultFromName: 'ProjectSites CMS',
    apiKey: process.env.RESEND_API_KEY || '',
  }),
  plugins: [
    s3Storage({
      collections: { media: { prefix: 'media' } },
      bucket: process.env.S3_BUCKET || 'mb-cms',
      config: {
        endpoint: process.env.S3_ENDPOINT || '',
        region: 'auto',
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
        },
        forcePathStyle: true,
      },
    }),
    seoPlugin({
      collections: ['posts', 'pages'],
      uploadsCollection: 'media',
      tabbedUI: true,
      generateTitle: ({ doc }: { doc: { title?: string } }) => doc?.title ?? '',
      generateDescription: ({ doc }: { doc: { excerpt?: string } }) => doc?.excerpt ?? '',
      generateURL: ({ doc, collectionSlug }: { doc: { slug?: string }; collectionSlug?: string }) =>
        collectionSlug === 'pages'
          ? `${SERVER_URL}/${doc?.slug === 'home' ? '' : (doc?.slug ?? '')}`
          : `${SERVER_URL}/posts/${doc?.slug ?? ''}`,
    }),
    // Category taxonomy hierarchy (parent + breadcrumbs).
    nestedDocsPlugin({
      collections: ['categories'],
      generateLabel: (_, doc) => String(doc?.title ?? ''),
      generateURL: (docs) => docs.reduce((url, d) => `${url}/${d?.slug ?? ''}`, ''),
    }),
    // 301/302 management for migrated URLs.
    redirectsPlugin({
      collections: ['pages', 'posts'],
      overrides: {
        admin: { group: 'Settings' },
      },
    }),
    // Full-text search index (published only).
    searchPlugin({
      collections: ['posts', 'pages'],
      defaultPriorities: { posts: 20, pages: 10 },
      searchOverrides: { admin: { group: 'Settings' } },
      beforeSync: ({ originalDoc, searchDoc }) => ({
        ...searchDoc,
        excerpt: originalDoc?.excerpt ?? '',
      }),
    }),
    // Editor-built forms + submissions + Resend confirmation emails.
    formBuilderPlugin({
      fields: { payment: false },
      redirectRelationships: ['pages'],
      formOverrides: { admin: { group: 'Settings' } },
      formSubmissionOverrides: { admin: { group: 'Settings' } },
    }),
    // Official MCP plugin — agents (Claude/Cursor) read+write content at /api/mcp,
    // gated by admin-panel API keys; Payload access control still applies per-key.
    mcpPlugin({
      collections: {
        posts: { enabled: true },
        pages: { enabled: true },
        categories: { enabled: true },
        tags: { enabled: true },
        media: { enabled: true },
      },
    }),
  ],
})
