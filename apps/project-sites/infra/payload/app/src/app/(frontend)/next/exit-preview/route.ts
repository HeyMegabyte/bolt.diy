import { draftMode } from 'next/headers.js'

/** Disable draft mode (exit preview). */
export async function GET() {
  ;(await draftMode()).disable()
  return new Response('Draft mode disabled', { status: 200 })
}
