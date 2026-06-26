import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import { seoPlugin } from '@payloadcms/plugin-seo'
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

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Posts, Pages, Categories, Media, Tags, Users],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  // Schema is managed by migrations (src/migrations/*) — `payload migrate` runs on
  // container boot (see Dockerfile). `push` is a dev-only no-op in production.
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URI || '' },
    push: false,
  }),
  sharp,
  localization: {
    locales: ['en'],
    fallback: true,
    defaultLocale: 'en',
  },
  // Password-reset / verification / invite emails go through Resend.
  email: resendAdapter({
    defaultFromAddress: 'noreply@projectsites.dev',
    defaultFromName: 'ProjectSites CMS',
    apiKey: process.env.RESEND_API_KEY || '',
  }),
  plugins: [
    // Media uploads persist in R2 (S3-compatible) — container disk is ephemeral.
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
    // SEO meta (title/description/og-image) on content collections.
    seoPlugin({
      collections: ['posts', 'pages'],
      uploadsCollection: 'media',
      tabbedUI: true,
      generateTitle: ({ doc }: { doc: { title?: string } }) => doc?.title ?? '',
      generateDescription: ({ doc }: { doc: { excerpt?: string } }) => doc?.excerpt ?? '',
    }),
  ],
})
