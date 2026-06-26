import type { Endpoint } from 'payload'
import { spawn } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

/** Run pg_dump against DATABASE_URI and return the SQL as a buffer. */
const dump = (uri: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const proc = spawn('pg_dump', [uri, '--no-owner', '--no-acl', '--clean', '--if-exists'])
    const chunks: Buffer[] = []
    const errs: Buffer[] = []
    proc.stdout.on('data', (c: Buffer) => chunks.push(c))
    proc.stderr.on('data', (c: Buffer) => errs.push(c))
    proc.on('error', reject)
    proc.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`pg_dump exit ${code}: ${Buffer.concat(errs).toString().slice(0, 500)}`)),
    )
  })

/**
 * POST /api/db-backup — pg_dump the Neon database, gzip it, and store it in R2 under
 * `backups/`. Belt-and-suspenders on top of Neon PITR; gives a portable off-vendor copy.
 *
 * @remarks Auth: an admin session OR the `x-backup-secret` header matching `BACKUP_SECRET`
 * (so an external cron can trigger it). Requires `pg_dump` (postgresql-client in the image)
 * + the S3/R2 credentials already forwarded for media storage.
 */
export const backupEndpoint: Endpoint = {
  path: '/db-backup',
  method: 'post',
  handler: async (req) => {
    const roles = (req.user as { roles?: string[] } | undefined)?.roles
    const isAdmin = Array.isArray(roles) && roles.includes('admin')
    const secret = process.env.BACKUP_SECRET
    const headerOk = Boolean(secret) && req.headers.get('x-backup-secret') === secret
    if (!isAdmin && !headerOk) return Response.json({ error: 'forbidden' }, { status: 403 })

    const uri = process.env.DATABASE_URI
    const bucket = process.env.S3_BUCKET
    const endpoint = process.env.S3_ENDPOINT
    if (!uri || !bucket || !endpoint) {
      return Response.json({ error: 'backup not configured' }, { status: 503 })
    }

    try {
      const sql = await dump(uri)
      const gz = gzipSync(sql)
      const key = `backups/payload-${new Date().toISOString().replace(/[:.]/g, '-')}.sql.gz`
      const s3 = new S3Client({
        region: 'auto',
        endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
        },
      })
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: gz, ContentType: 'application/gzip' }),
      )
      req.payload.logger.info(`db-backup wrote ${key} (${gz.length} bytes)`)
      return Response.json({ ok: true, key, bytes: gz.length })
    } catch (err) {
      req.payload.logger.error({ err }, 'db-backup failed')
      return Response.json({ error: 'backup failed' }, { status: 500 })
    }
  },
}
