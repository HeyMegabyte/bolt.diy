import { getClient } from '@/lib/payload'

export const dynamic = 'force-dynamic'

/** Liveness + DB-connectivity probe for uptime monitors. */
export async function GET() {
  try {
    const payload = await getClient()
    await payload.count({ collection: 'users' })
    return Response.json({ status: 'ok', db: 'up', ts: new Date().toISOString() })
  } catch {
    return Response.json({ status: 'degraded', db: 'down' }, { status: 503 })
  }
}
